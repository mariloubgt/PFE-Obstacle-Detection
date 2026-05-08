import { useCallback, useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ExpoCamera from 'expo-camera';
import { COLORS, LAYOUT } from '../constants/theme';
import { FONTS } from '../constants/typography';
import { querySceneFromAudioAsync } from '../services/sceneQueryApi';

const CameraComponent = ExpoCamera.Camera || ExpoCamera.default;
const CAMERA_TYPE = ExpoCamera.Camera?.Constants?.Type || ExpoCamera.Constants?.Type || { back: 'back' };

const WELCOME_MESSAGE =
  'Hello! Ask about your surroundings and I will describe the scene.';

function nextId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(d = new Date()) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function Waveform({ active }) {
  const a1 = useRef(new Animated.Value(0.4)).current;
  const a2 = useRef(new Animated.Value(0.7)).current;
  const a3 = useRef(new Animated.Value(0.5)).current;
  const a4 = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    if (!active) {
      return;
    }
    const mk = (v, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, {
            toValue: 1,
            duration: 280 + delay,
            useNativeDriver: false,
          }),
          Animated.timing(v, {
            toValue: 0.25,
            duration: 280 + delay,
            useNativeDriver: false,
          }),
        ])
      );
    const l1 = mk(a1, 0);
    const l2 = mk(a2, 60);
    const l3 = mk(a3, 120);
    const l4 = mk(a4, 40);
    l1.start();
    l2.start();
    l3.start();
    l4.start();
    return () => {
      l1.stop();
      l2.stop();
      l3.stop();
      l4.stop();
    };
  }, [active, a1, a2, a3, a4]);

  const bar = (anim) => (
    <Animated.View
      style={[
        styles.waveBar,
        {
          height: anim.interpolate({
            inputRange: [0, 1],
            outputRange: [6, 22],
          }),
        },
      ]}
    />
  );

  return (
    <View style={styles.waveRow}>
      {bar(a1)}
      {bar(a2)}
      {bar(a3)}
      {bar(a4)}
    </View>
  );
}

export default function SceneQueryScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);
  const recordingRef = useRef(null);
  const cameraRef = useRef(null);
  const [messages, setMessages] = useState(() => [
    { id: nextId(), role: 'assistant', text: WELCOME_MESSAGE, time: formatTime() },
  ]);
  const [isListening, setIsListening] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  const speakReply = useCallback((text) => {
    Speech.stop();
    Speech.speak(text, {
      language: 'en-US',
      rate: 0.92,
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

  const startRecording = useCallback(async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Microphone', 'Audio permission is required for voice input.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      recordingRef.current = rec;
      setIsListening(true);
    } catch (e) {
      Alert.alert('Recording', e?.message || String(e));
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const rec = recordingRef.current;
    if (!rec) {
      setIsListening(false);
      return null;
    }
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      recordingRef.current = null;
      return uri;
    } catch (e) {
      recordingRef.current = null;
      return null;
    } finally {
      setIsListening(false);
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
        });
      } catch {
        // ignore
      }
    }
  }, []);

  const onPressMic = useCallback(async () => {
    if (isTyping) return;
    if (!isListening) {
      await startRecording();
      return;
    }
    
    // Stop recording and get audio URI
    const audioUri = await stopRecording();
    if (!audioUri) return;

    setIsTyping(true);
    try {
      // 1. Take a picture right now to see the environment
      let photoUri = null;
      if (cameraRef.current) {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.3,
          skipProcessing: true,
        });
        photoUri = photo.uri;
      }

      // 2. Call our new multimodal endpoint
      const answer = await querySceneFromAudioAsync(photoUri, audioUri);
      
      if (answer.userSaid) {
        appendMessage({ id: nextId(), role: 'user', text: answer.userSaid });
      }
      
      appendMessage({ id: nextId(), role: 'assistant', text: answer.text });
      speakReply(answer.text);
    } catch (e) {
      console.error(e);
      appendMessage({
        id: nextId(),
        role: 'assistant',
        text: 'Could not reach scene service. Please try again.',
      });
    } finally {
      setIsTyping(false);
    }
  }, [appendMessage, isListening, isTyping, speakReply, startRecording, stopRecording]);

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
        <Text style={styles.headerTitle}>Scene Query</Text>
        <View style={styles.geminiPill}>
          <Text style={styles.geminiPillText}>Gemini AI</Text>
        </View>
      </View>

      <View style={styles.cameraContainer}>
        <CameraComponent
          ref={cameraRef}
          style={styles.cameraPreview}
          type={CAMERA_TYPE.back}
          mode="picture"
        />
      </View>

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

      <View style={styles.micBlock}>
        <View style={styles.listeningLine}>
          <View style={styles.listeningDot} />
          <Text style={styles.listeningText}>
            {isListening ? 'Listening...' : 'Tap the mic to speak'}
          </Text>
        </View>
        <Pressable
          style={[styles.micPress, isListening && styles.micPressOn]}
          onPress={onPressMic}
          disabled={isTyping}
          accessibilityRole="button"
          accessibilityLabel={isListening ? 'Stop and send' : 'Start voice input'}
        >
          <Waveform active={isListening} />
        </Pressable>
      </View>

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
  geminiPill: {
    backgroundColor: 'rgba(45, 212, 191, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(102, 210, 177, 0.4)',
  },
  geminiPillText: {
    color: COLORS.tealBright,
    fontSize: 12,
    fontFamily: FONTS.en.semibold,
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
  micBlock: {
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  listeningLine: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
    marginBottom: 10,
  },
  listeningDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.teal,
  },
  listeningText: {
    color: COLORS.tealBright,
    fontSize: 14,
    fontFamily: FONTS.en.semibold,
  },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 28,
  },
  waveBar: {
    width: 4,
    borderRadius: 2,
    backgroundColor: COLORS.teal,
  },
  micPress: {
    minWidth: 200,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.borderMuted,
    backgroundColor: COLORS.bgElevated,
  },
  micPressOn: {
    borderColor: COLORS.teal,
    backgroundColor: 'rgba(102, 210, 177, 0.08)',
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
});
