import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ExpoCamera from 'expo-camera';
import { COLORS, LAYOUT } from '../constants/theme';
import { FONTS } from '../constants/typography';
import { useVolumeHardwareShortcut } from '../hooks/useVolumeHardwareShortcut';
import { predictImage } from '../services/predict';
import { DEFAULTS, loadAppPreferences } from '../utils/appSettings';
import { syncStoredAlertVolumeToSystem } from '../utils/alertVolumeStorage';
import { loadInferenceApiUrl } from '../utils/inferenceApiUrl';
import { ttsVolumeOptions } from '../utils/ttsVolumeOptions';

const CameraComponent = ExpoCamera.Camera || ExpoCamera.default;
const CAMERA_TYPE = ExpoCamera.Camera?.Constants?.Type || ExpoCamera.Constants?.Type || { back: 'back' };

// Module-level slot: MainNavigationScreen calls triggerSceneDescribe() directly.
// No React Navigation param tricks — guaranteed to fire every tap.
let _sceneDescribeCallback = null;
export function triggerSceneDescribe() {
  if (_sceneDescribeCallback) _sceneDescribeCallback();
}

const WELCOME_MESSAGE =
  'Use Sound (top right), Describe scene, or Sound on the main screen — each tap runs a fresh description.';

function nextId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(d = new Date()) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function SceneQueryScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);
  const cameraRef = useRef(null);
  /** Latest describe request wins; older runs exit before speaking / appending. */
  const describeGenerationRef = useRef(0);
  const [camPermission, setCamPermission] = useState(null);
  const [messages, setMessages] = useState(() => [
    { id: nextId(), role: 'assistant', text: WELCOME_MESSAGE, time: formatTime() },
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const alertVolumeRef = useRef(0.8);

  const speakReply = useCallback((text) => {
    Speech.stop();
    Speech.speak(text, {
      language: 'en-US',
      rate: 0.92,
      ...ttsVolumeOptions(alertVolumeRef.current),
    });
  }, []);

  useEffect(() => {
    return () => {
      Speech.stop();
    };
  }, []);

  const appendMessage = useCallback((msg) => {
    setMessages((prev) => [...prev, { ...msg, time: formatTime() }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  const refreshCamPermission = useCallback(async () => {
    const get =
      ExpoCamera.getCameraPermissionsAsync ||
      ExpoCamera.getPermissionsAsync ||
      ExpoCamera.Camera?.getCameraPermissionsAsync ||
      ExpoCamera.Camera?.getPermissionsAsync;
    if (!get) return;
    try {
      const r = await get();
      setCamPermission(r);
    } catch {
      setCamPermission(null);
    }
  }, []);

  const requestCameraPermission = useCallback(async () => {
    const req =
      ExpoCamera.requestCameraPermissionsAsync ||
      ExpoCamera.requestPermissionsAsync ||
      ExpoCamera.Camera?.requestCameraPermissionsAsync ||
      ExpoCamera.Camera?.requestPermissionsAsync;
    if (!req) return false;
    const r = await req();
    setCamPermission(r);
    return Boolean(r?.granted);
  }, []);

  const runGroqDescribe = useCallback(async () => {
    const generation = ++describeGenerationRef.current;
    const stale = () => generation !== describeGenerationRef.current;
    setIsTyping(true);

    Speech.stop();

    try {
      if (stale()) return;
      Speech.speak('Describing.', {
        language: 'en-US',
        rate: 0.92,
        ...ttsVolumeOptions(alertVolumeRef.current),
      });

      let granted = camPermission?.granted === true;
      if (!granted) {
        granted = await requestCameraPermission();
      }
      if (stale()) return;
      if (!granted) {
        appendMessage({
          id: nextId(),
          role: 'assistant',
          text: 'Camera permission is needed. Tap Allow camera on the preview.',
        });
        return;
      }

      if (!cameraRef.current) {
        appendMessage({
          id: nextId(),
          role: 'assistant',
          text: 'Camera is not ready.',
        });
        return;
      }

      let photo;
      try {
        photo = await cameraRef.current.takePictureAsync({
          quality: 0.28,
          skipProcessing: true,
        });
      } catch (camErr) {
        appendMessage({
          id: nextId(),
          role: 'assistant',
          text:
            camErr instanceof Error
              ? `Could not capture a frame: ${camErr.message}`
              : 'Could not capture a camera frame.',
        });
        return;
      }

      if (stale()) return;

      const api = await loadInferenceApiUrl();
      if (stale()) return;
      if (!api) {
        appendMessage({
          id: nextId(),
          role: 'assistant',
          text: 'Set the inference server address in Settings.',
        });
        return;
      }

      const prefs = await loadAppPreferences();
      if (stale()) return;
      let data;
      try {
        data = await predictImage(api, photo.uri, {
          hfovDeg: prefs.cameraHfovDeg,
          depthScale: prefs.depthScale,
          useGemini: false,
          useGroq: true,
          groqMode: 'describe',
          detailed: true,
        });
      } catch (netErr) {
        if (stale()) return;
        const msg =
          netErr instanceof Error ? netErr.message : String(netErr ?? 'Network error');
        appendMessage({
          id: nextId(),
          role: 'assistant',
          text: msg.length > 200 ? 'Could not reach the inference server.' : msg,
        });
        return;
      }

      if (stale()) return;

      const groqScene = typeof data?.groq?.scene === 'string' ? data.groq.scene.trim() : '';
      const groqGuidance =
        typeof data?.groq?.guidance_en === 'string' ? data.groq.guidance_en.trim() : '';
      const groqErr = data?.groq?.error;
      const sceneFallback =
        typeof data?.scene?.top5?.[0]?.label === 'string'
          ? data.scene.top5[0].label.trim()
          : '';
      const groqCombined = [groqScene, groqGuidance].filter(Boolean).join(' ').trim();
      const toSpeak =
        groqCombined ||
        sceneFallback ||
        (groqErr ? `Could not describe the scene. ${groqErr}` : 'No description available.');

      appendMessage({ id: nextId(), role: 'assistant', text: toSpeak });
      speakReply(toSpeak);
    } finally {
      if (generation === describeGenerationRef.current) {
        setIsTyping(false);
      }
    }
  }, [appendMessage, camPermission?.granted, requestCameraPermission, speakReply]);

  const runGroqDescribeRef = useRef(runGroqDescribe);
  runGroqDescribeRef.current = runGroqDescribe;

  // Register this screen's describe function so MainNavigationScreen can call it directly.
  useEffect(() => {
    _sceneDescribeCallback = () => runGroqDescribeRef.current();
    return () => { _sceneDescribeCallback = null; };
  }, []);

  const [volumeHardwareAction, setVolumeHardwareAction] = useState(
    DEFAULTS.volumeHardwareAction
  );

  useVolumeHardwareShortcut(navigation, {
    enabled: true,
    action: volumeHardwareAction,
    onDescribeEnvironment: () => {
      void runGroqDescribeRef.current();
    },
  });

  // Refresh camera permission + prefs + alert TTS volume each time screen comes into view.
  useFocusEffect(
    useCallback(() => {
      void refreshCamPermission();
      void syncStoredAlertVolumeToSystem().then((v) => {
        alertVolumeRef.current = v;
      });
      void loadAppPreferences().then((p) => {
        setVolumeHardwareAction(p.volumeHardwareAction);
      });
    }, [refreshCamPermission])
  );

  const onEndSession = useCallback(() => {
    Speech.stop();
    setMessages([{ id: nextId(), role: 'assistant', text: WELCOME_MESSAGE, time: formatTime() }]);
  }, []);

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top,
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
    >
      <StatusBar style="light" />

      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <MaterialCommunityIcons name="chevron-left" size={28} color={COLORS.teal} />
        </Pressable>
        <Text style={styles.headerTitle}>Scene description</Text>
        <Pressable
          style={({ pressed }) => [styles.headerSoundBtn, pressed && styles.pressed]}
          onPress={() => {
            if (Platform.OS !== 'web') {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            }
            void runGroqDescribe();
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Sound"
          accessibilityHint="Same as Sound on main navigation: captures the scene and reads a new description."
        >
          <MaterialCommunityIcons name="volume-high" size={26} color={COLORS.tealBright} />
        </Pressable>
      </View>

      <View style={styles.cameraContainer}>
        <CameraComponent
          ref={cameraRef}
          style={styles.cameraPreview}
          type={CAMERA_TYPE.back}
          mode="picture"
        />
        {camPermission && !camPermission.granted ? (
          <Pressable
            style={styles.camOverlay}
            onPress={() => void requestCameraPermission()}
            accessibilityRole="button"
            accessibilityLabel="Allow camera for scene descriptions"
          >
            <MaterialCommunityIcons name="camera-outline" size={28} color={COLORS.tealBright} />
            <Text style={styles.camOverlayTitle}>Allow camera</Text>
            <Text style={styles.camOverlaySub}>Needed to grab a photo for describing</Text>
          </Pressable>
        ) : null}
      </View>

      <Pressable
        style={({ pressed }) => [styles.describeSceneBtn, pressed && styles.pressed]}
        onPress={() => void runGroqDescribe()}
        accessibilityRole="button"
        accessibilityLabel="Describe scene"
        accessibilityHint="Takes a photo and reads a summary. Same shortcut as Sound on navigation."
      >
        <MaterialCommunityIcons name="image-text" size={20} color={COLORS.btnText} />
        <Text style={styles.describeSceneBtnText}>Describe scene</Text>
      </Pressable>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map((m) => {
          return (
            <View
              key={m.id}
              style={[
                styles.msgRow,
                m.role === 'user' ? styles.msgRowUser : styles.msgRowBot,
              ]}
            >
              <View
                style={[
                  styles.bubble,
                  m.role === 'user' ? styles.bubbleUser : styles.bubbleBot,
                ]}
              >
                <Text
                  style={[
                    styles.bubbleText,
                    m.role === 'user' ? styles.bubbleTextUser : null,
                    { fontFamily: FONTS.en.regular },
                  ]}
                >
                  {m.text}
                </Text>
                <Text
                  style={[
                    styles.timeText,
                    m.role === 'user' ? styles.timeTextUser : null,
                  ]}
                >
                  {m.time}
                </Text>
              </View>
            </View>
          );
        })}

        {isTyping ? (
          <View style={styles.typingRow}>
            <View style={styles.typingBubble}>
              <View style={styles.typingDot} />
              <View style={[styles.typingDot, { opacity: 0.7 }]} />
              <View style={[styles.typingDot, { opacity: 0.45 }]} />
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footerRow}>
        <Pressable
          style={({ pressed }) => [styles.endBtn, pressed && styles.pressed]}
          onPress={onEndSession}
        >
          <Text style={styles.endBtnText}>End Session</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.backNavBtn, pressed && styles.pressed]}
          onPress={() => {
            Speech.stop();
            navigation.goBack();
          }}
        >
          <MaterialCommunityIcons name="arrow-left" size={20} color={COLORS.teal} />
          <Text style={styles.backNavText}>Back to Nav</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingHorizontal: LAYOUT.screenPaddingH,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    color: COLORS.white,
    fontSize: 20,
    fontFamily: FONTS.en.bold,
  },
  headerSoundBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  describeSceneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.teal,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: LAYOUT.buttonRadius,
    marginBottom: 10,
    minHeight: 48,
  },
  describeSceneBtnDisabled: { opacity: 0.55 },
  describeSceneBtnText: {
    color: COLORS.btnText,
    fontSize: 15,
    fontFamily: FONTS.en.bold,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 16 },
  msgRow: { marginBottom: 12, width: '100%' },
  msgRowUser: { alignItems: 'flex-end' },
  msgRowBot: { alignItems: 'flex-start' },
  bubble: {
    maxWidth: '88%',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  bubbleUser: {
    backgroundColor: COLORS.teal,
    borderBottomRightRadius: 4,
  },
  bubbleBot: {
    backgroundColor: '#1E293B',
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    color: COLORS.white,
    fontSize: 15,
    lineHeight: 22,
  },
  bubbleTextUser: {
    color: COLORS.btnText,
  },
  timeText: {
    color: COLORS.grey,
    fontSize: 11,
    marginTop: 8,
    fontFamily: FONTS.en.regular,
  },
  timeTextUser: {
    color: 'rgba(11, 18, 32, 0.55)',
  },
  typingRow: { alignItems: 'flex-start', marginBottom: 8 },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1E293B',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.grey,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  endBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: LAYOUT.buttonRadius,
    backgroundColor: 'rgba(127, 29, 29, 0.35)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.5)',
    alignItems: 'center',
    minHeight: 56,
    justifyContent: 'center',
  },
  endBtnText: {
    color: '#FCA5A5',
    fontSize: 16,
    fontFamily: FONTS.en.semibold,
  },
  backNavBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
    borderRadius: LAYOUT.buttonRadius,
    backgroundColor: 'rgba(102, 210, 177, 0.1)',
    borderWidth: 1,
    borderColor: COLORS.teal,
    minHeight: 56,
  },
  backNavText: {
    color: COLORS.teal,
    fontSize: 16,
    fontFamily: FONTS.en.semibold,
  },
  pressed: { opacity: 0.9 },
  cameraContainer: {
    height: 120,
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 10,
    backgroundColor: '#000',
  },
  cameraPreview: {
    flex: 1,
  },
  camOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 16,
  },
  camOverlayTitle: {
    color: COLORS.white,
    fontSize: 16,
    fontFamily: FONTS.en.bold,
    marginTop: 4,
  },
  camOverlaySub: {
    color: COLORS.grey,
    fontSize: 12,
    fontFamily: FONTS.en.regular,
    textAlign: 'center',
  },
});
