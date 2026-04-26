import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DangerAlertModal from '../components/DangerAlertModal';
import DetectionOverlay from '../components/DetectionOverlay';
import { predictImage } from '../services/predict';
import { COLORS, LAYOUT } from '../constants/theme';
import { FONTS } from '../constants/typography';
import { loadInferenceApiUrl } from '../utils/inferenceApiUrl';
import { loadAlertVolume, saveAlertVolume } from '../utils/alertVolumeStorage';
import { loadAppPreferences, DEFAULTS } from '../utils/appSettings';
import { useVolumeSceneQueryTrigger } from '../hooks/useVolumeSceneQueryTrigger';
import { pickCloseThreat } from '../utils/evaluateCloseThreat';

export default function MainNavigationScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const aiTestRef = useRef(false);

  const [clock, setClock] = useState('9:41');
  const [facing, setFacing] = useState('back');
  const [torch, setTorch] = useState(false);
  const [tapFlash, setTapFlash] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [alertVolume, setAlertVolume] = useState(0.8);
  const [appPrefs, setAppPrefs] = useState(null);
  const prefs = useMemo(() => appPrefs || DEFAULTS, [appPrefs]);

  /** Phase 3: periodic frame → POST /predict */
  const [aiTestEnabled, setAiTestEnabled] = useState(false);
  const [detections, setDetections] = useState([]);
  const [inferenceMs, setInferenceMs] = useState(null);
  const [inferenceError, setInferenceError] = useState(null);
  const [sceneHint, setSceneHint] = useState(null);
  const [geminiText, setGeminiText] = useState(null);
  const [geminiDarija, setGeminiDarija] = useState(null);
  const [geminiError, setGeminiError] = useState(null);
  const [geminiRisk, setGeminiRisk] = useState(null);
  const [geminiFocus, setGeminiFocus] = useState(null);
  const [pipelineMs, setPipelineMs] = useState(null);
  /**
   * Voix: phrase courte + stable, basée sur l’obstacle le plus proche (mêmes nombres que l’UI).
   * On ne lit PAS Gemini (il change de formulation chaque requête → répétitions incohérentes).
   */
  const lastTtsStateRef = useRef('');
  const lastSpeakTimeRef = useRef(0);
  const lastSceneTimeRef = useRef(0);

  /** Full-screen danger when model reports a very close obstacle (AI test / live). */
  const [dangerPayload, setDangerPayload] = useState(null);
  const safeStreakRef = useRef(0);
  const manualSuppressRef = useRef(false);
  const dangerSoundPlayedRef = useRef(false);

  useVolumeSceneQueryTrigger(navigation, { enabled: !volumeOpen && !dangerPayload });

  useEffect(() => {
    if (!aiTestEnabled) {
      Speech.stop();
      lastTtsStateRef.current = '';
      lastSpeakTimeRef.current = 0;
    }
  }, [aiTestEnabled]);

  useEffect(() => {
    // Old speech logic removed - now handled in runFrame for better stability
    return;
  }, [aiTestEnabled, detections, sceneHint]);

  const openSceneQuery = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    navigation.navigate('SceneQuery');
  }, [navigation]);

  useEffect(() => {
    const tick = () => {
      setClock(
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    loadAlertVolume().then((v) => {
      if (v != null) setAlertVolume(v);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAlertVolume().then((v) => {
        if (v != null) setAlertVolume(v);
      });
      loadAppPreferences().then(setAppPrefs);
      return () => {
        Speech.stop();
      };
    }, [])
  );

  const persistVolume = useCallback(async (v) => {
    const saved = await saveAlertVolume(v);
    setAlertVolume(saved);
  }, []);

  const onCameraPress = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    setTapFlash(true);
    setTimeout(() => setTapFlash(false), 350);
  }, []);

  const toggleFacing = useCallback(() => {
    setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
    setTorch(false);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  }, []);

  useEffect(() => {
    aiTestRef.current = aiTestEnabled;
  }, [aiTestEnabled]);

  const toggleAiTest = useCallback(async () => {
    if (aiTestEnabled) {
      setAiTestEnabled(false);
      return;
    }
    lastTtsStateRef.current = '';
    const api = await loadInferenceApiUrl();
    if (!api || !api.startsWith('http')) {
      Alert.alert(
        'Phase 3 — inference server',
        'Enter your PC server URL in Settings (same Wi‑Fi as the phone), e.g. http://192.168.1.10:8787 — then run python api/inference_server.py on the computer.',
        [
          { text: 'OK' },
          { text: 'Settings', onPress: () => navigation.navigate('Settings') },
        ]
      );
      return;
    }
    setAiTestEnabled(true);
  }, [aiTestEnabled, navigation]);

  const showCamera = Platform.OS !== 'web' && permission?.granted;

  useEffect(() => {
    if (!showCamera || !aiTestEnabled) {
      setDetections([]);
      setInferenceMs(null);
      setSceneHint(null);
      setGeminiText(null);
      setGeminiDarija(null);
      setGeminiError(null);
      setGeminiRisk(null);
      setGeminiFocus(null);
      setPipelineMs(null);
      if (!aiTestEnabled) setInferenceError(null);
      return;
    }

    let cancelled = false;

    const runFrame = async () => {
      if (cancelled || !aiTestRef.current || !cameraRef.current) return;
      try {
        const api = await loadInferenceApiUrl();
        if (!api) return;
        
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.25, skipProcessing: true });
        if (cancelled) return;
        
        const data = await predictImage(api, photo.uri, {
          useGemini: prefs.internetGemini,
        });
        if (cancelled) return;
        
        const currentDetections = data.detections || [];
        const currentScene = data.scene?.top5?.[0]?.label || null;

        setDetections(currentDetections);
        setSceneHint(currentScene);
        setInferenceError(null);

        // --- LOGIQUE VOCALE (STABILISÉE) ---
        if (currentDetections.length > 0) {
          const now = Date.now();
          const sorted = [...currentDetections].sort((a, b) => (a.distance_m ?? 99) - (b.distance_m ?? 99));
          const d0 = sorted[0];
          
          const dist = Math.round((d0.distance_m || 0) * 2) / 2;
          
          const DARIJA_MAP = {
            'person': 'شخص', 'bicycle': 'بشكليطة', 'car': 'طوموبيل', 'motorcycle': 'موطور',
            'bus': 'طوبيس', 'truck': 'كاميو', 'dog': 'كلب', 'bench': 'بنك', 'chair': 'كرسي',
            'stairs': 'دروج', 'curb': 'طروطوار', 'fire_hydrant': 'بونو ديال الما',
            'stop_sign': 'بلاكة سطوب', 'traffic_light': 'ضو حمر', 'tree': 'شجرة',
            'pole': 'poteau', 'waste_container': 'لابوبيل', 'crutch': 'عكاز'
          };
          
          const cleanName = String(d0.name || "").toLowerCase().trim();
          const rawObj = DARIJA_MAP[cleanName] || cleanName;

          // On ne répète la scène que toutes les 15 secondes
          const sceneCooldown = now - (lastSceneTimeRef.current || 0) > 15000;
          let msg = "";
          
          // On utilise la traduction Darja de Gemini si elle existe (pour éviter l'accent anglais)
          const bestSceneDesc = data.gemini?.darija || currentScene;

          if (bestSceneDesc && sceneCooldown) {
            msg += `راني نشوف: ${bestSceneDesc}. `;
            lastSceneTimeRef.current = now;
          }
          
          msg += `كاين ${rawObj} على بعد ${dist} متر.`;

          // On parle si l'objet ou la distance (0.5m) a changé ET cooldown de 3s min
          const stateKey = `${rawObj}|${dist}`;
          const isDifferent = stateKey !== lastTtsStateRef.current;
          const globalCooldown = now - lastSpeakTimeRef.current > 3000;

          if (isDifferent && globalCooldown) {
             lastTtsStateRef.current = stateKey;
             lastSpeakTimeRef.current = now;
             Speech.stop();
             Speech.speak(msg, { language: 'ar-SA', rate: prefs.speechRate });
          }
        }
      } catch (e) {
        if (!cancelled) setInferenceError(e.message);
      }
    };

    runFrame();
    const id = setInterval(runFrame, prefs.aiFrameMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [showCamera, aiTestEnabled, prefs]);

  useEffect(() => {
    if (!aiTestEnabled || !showCamera) {
      safeStreakRef.current = 0;
      manualSuppressRef.current = false;
      dangerSoundPlayedRef.current = false;
      setDangerPayload(null);
      return;
    }
    const threat = pickCloseThreat(detections, {
      dangerWithinMeters: prefs.dangerThresholdM,
    });
    if (threat) {
      safeStreakRef.current = 0;
      if (manualSuppressRef.current) {
        return;
      }
      setDangerPayload(threat);
    } else {
      safeStreakRef.current += 1;
      if (safeStreakRef.current >= 2) {
        setDangerPayload(null);
        manualSuppressRef.current = false;
        dangerSoundPlayedRef.current = false;
      }
    }
  }, [detections, aiTestEnabled, showCamera, prefs.dangerThresholdM]);

  useEffect(() => {
    if (!dangerPayload) {
      return;
    }
    if (dangerSoundPlayedRef.current) {
      return;
    }
    dangerSoundPlayedRef.current = true;
    if (Platform.OS !== 'web' && prefs.vibrationDanger) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
    Speech.stop();
    Speech.speak(dangerPayload.arMessage, { language: 'ar-SA', rate: prefs.speechRate });
  }, [dangerPayload, prefs.vibrationDanger, prefs.speechRate]);

  const onDangerBack = useCallback(() => {
    Speech.stop();
    setDangerPayload(null);
    manualSuppressRef.current = true;
    safeStreakRef.current = 0;
    dangerSoundPlayedRef.current = false;
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View style={styles.topBar}>
        <Pressable
          onPress={() => {
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.navigate('Welcome');
          }}
          hitSlop={12}
          style={styles.topIcon}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <MaterialCommunityIcons name="chevron-left" size={28} color={COLORS.teal} />
        </Pressable>
        <Text style={styles.time}>{clock}</Text>
        <View style={styles.topRight}>
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
          <Pressable
            style={[styles.aiPill, aiTestEnabled && styles.aiPillOn]}
            onPress={toggleAiTest}
            accessibilityRole="button"
            accessibilityLabel={aiTestEnabled ? 'Stop AI test' : 'Start phase 3 AI test'}
          >
            <MaterialCommunityIcons
              name="brain"
              size={15}
              color={aiTestEnabled ? COLORS.btnText : COLORS.teal}
            />
            <Text style={[styles.aiPillText, aiTestEnabled && styles.aiPillTextOn]}>
              AI test
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.visionArea}>
        {showCamera ? (
          <>
            <Pressable
              style={styles.cameraTouchable}
              onPress={onCameraPress}
              accessibilityRole="imagebutton"
              accessibilityLabel="Camera preview. Tap for feedback."
            >
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing={facing}
                enableTorch={torch || (prefs.lowLight && aiTestEnabled)}
                mode="picture"
              />
              <DetectionOverlay detections={detections} />
              {tapFlash ? <View style={styles.tapFlash} pointerEvents="none" /> : null}
            </Pressable>

            <Pressable
              style={styles.flipBtn}
              onPress={toggleFacing}
              accessibilityRole="button"
              accessibilityLabel="Switch camera front or back"
            >
              <MaterialCommunityIcons
                name="camera-flip-outline"
                size={22}
                color={COLORS.white}
              />
            </Pressable>

            <Pressable
              style={styles.torchBtn}
              onPress={() => {
                setTorch((t) => !t);
                if (Platform.OS !== 'web') {
                  Haptics.selectionAsync().catch(() => {});
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={torch ? 'Turn off torch' : 'Turn on torch'}
            >
              <MaterialCommunityIcons
                name={torch ? 'flashlight' : 'flashlight-off'}
                size={24}
                color={COLORS.white}
              />
            </Pressable>
          </>
        ) : (
          <View style={styles.placeholder}>
            <MaterialCommunityIcons name="camera-off-outline" size={48} color={COLORS.grey} />
            <Text style={styles.placeholderTitle}>
              {Platform.OS === 'web'
                ? 'Camera runs on a phone with Expo Go'
                : 'Camera access is needed'}
            </Text>
            {Platform.OS !== 'web' ? (
              <Pressable style={styles.allowBtn} onPress={requestPermission}>
                <Text style={styles.allowBtnText}>Allow camera</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>

      <LinearGradient
        colors={['#DC2626', '#EA580C', '#EAB308', '#22C55E']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.riskStrip}
      />

      <View style={styles.alertCard}>
        <MaterialCommunityIcons
          name="alert-circle-outline"
          size={22}
          color={aiTestEnabled ? COLORS.teal : COLORS.danger}
        />
        <View style={styles.alertTextCol}>
          {aiTestEnabled ? (
            <>
              {inferenceError ? (
                <>
                  <Text style={styles.alertTitle}>Inference issue</Text>
                  <Text style={styles.inferenceErr} numberOfLines={6}>
                    {inferenceError}
                  </Text>
                </>
              ) : (
                <>
                  {sceneHint ? (
                    <Text style={styles.sceneHint} numberOfLines={1}>
                      Scene (ImageNet): {sceneHint}
                    </Text>
                  ) : null}
                  {detections.length > 0 ? (
                    <>
                      <Text style={styles.alertTitle}>
                        {detections[0].name.replace(/_/g, ' ')} ·{' '}
                        {Math.round((detections[0].confidence || 0) * 100)}%
                        {detections[0].distance_m != null
                          ? ` · ~${detections[0].distance_m}m`
                          : ''}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.alertTitle}>AI test · no objects in frame</Text>
                  )}
                  {geminiDarija ? (
                    <Text style={styles.darijaPrimary} numberOfLines={4}>
                      {geminiDarija}
                    </Text>
                  ) : null}
                  {geminiFocus ? (
                    <Text style={styles.geminiMeta} numberOfLines={1}>
                      Focus: {geminiFocus}
                    </Text>
                  ) : null}
                  {geminiRisk && geminiRisk !== 'ok' ? (
                    <View style={styles.riskPillRow}>
                      <View
                        style={[
                          styles.riskPill,
                          geminiRisk === 'danger' && styles.riskPillDanger,
                          geminiRisk === 'caution' && styles.riskPillCaution,
                          geminiRisk === 'unknown' && styles.riskPillUnknown,
                        ]}
                      >
                        <Text style={styles.riskPillText}>{String(geminiRisk).toUpperCase()}</Text>
                      </View>
                    </View>
                  ) : null}
                  {geminiText && String(geminiText).trim() !== String(geminiDarija || '').trim() ? (
                    <Text style={styles.geminiText} numberOfLines={4}>
                      {geminiText}
                    </Text>
                  ) : !geminiDarija && geminiText ? (
                    <Text style={styles.geminiText} numberOfLines={6}>
                      {geminiText}
                    </Text>
                  ) : null}
                  {geminiError ? (
                    <Text style={styles.geminiErr} numberOfLines={3}>
                      {geminiError}
                    </Text>
                  ) : null}
                  <Text style={styles.inferenceMeta}>
                    {pipelineMs != null
                      ? `${Math.round(pipelineMs)} ms (pipeline) · `
                      : inferenceMs != null
                        ? `${Math.round(inferenceMs)} ms · `
                        : ''}
                    {detections.length} object{detections.length === 1 ? '' : 's'}
                  </Text>
                </>
              )}
            </>
          ) : (
            <>
              <Text style={styles.alertTitle}>Person detected ahead</Text>
              <View style={styles.badgeRow}>
                <View style={styles.dangerBadge}>
                  <Text style={styles.dangerBadgeText}>0.6m — DANGER</Text>
                </View>
              </View>
              <Text style={styles.alertAr} accessibilityLabel="Arabic alert">
                شخص قدامك — انتبه ولا تتحرك
              </Text>
            </>
          )}
        </View>
      </View>

      <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable
          style={styles.navItem}
          onPress={() => setVolumeOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Volume"
        >
          <MaterialCommunityIcons name="volume-high" size={26} color={COLORS.tealBright} />
          <Text style={styles.navLabel}>Volume</Text>
        </Pressable>

        <Pressable
          style={styles.centerFab}
          onPress={openSceneQuery}
          accessibilityRole="button"
          accessibilityLabel="Open scene query — ask about your surroundings"
        >
          <MaterialCommunityIcons name="chart-box-outline" size={30} color={COLORS.btnText} />
        </Pressable>

        <Pressable
          style={styles.navItem}
          onPress={() => navigation.navigate('Settings')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <MaterialCommunityIcons name="cog-outline" size={26} color={COLORS.tealBright} />
          <Text style={styles.navLabel}>Settings</Text>
        </Pressable>
      </View>

      <DangerAlertModal
        visible={!!dangerPayload}
        displayLabel={dangerPayload?.displayLabel}
        distanceM={dangerPayload?.distanceM}
        arMessage={dangerPayload?.arMessage}
        onBack={onDangerBack}
      />

      <Modal
        visible={volumeOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setVolumeOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setVolumeOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Alert volume</Text>
            <Text style={styles.modalHint}>
              Used for voice alerts and beeps ({Math.round(alertVolume * 100)}%)
            </Text>
            <Slider
              style={styles.modalSlider}
              minimumValue={0}
              maximumValue={1}
              value={alertVolume}
              onValueChange={setAlertVolume}
              onSlidingComplete={persistVolume}
              minimumTrackTintColor={COLORS.teal}
              maximumTrackTintColor={COLORS.borderMuted}
              thumbTintColor={COLORS.teal}
            />
            <View style={styles.modalEnds}>
              <Text style={styles.endLabel}>Low</Text>
              <Text style={styles.endLabel}>High</Text>
            </View>
            <Pressable style={styles.modalDone} onPress={() => setVolumeOpen(false)}>
              <Text style={styles.modalDoneText}>Done</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: LAYOUT.screenPaddingH,
    paddingVertical: 8,
    gap: 8,
  },
  topIcon: {
    padding: 4,
    marginRight: 4,
  },
  time: {
    flex: 1,
    color: COLORS.white,
    fontSize: 15,
    fontFamily: FONTS.en.semibold,
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: COLORS.teal,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: 'transparent',
  },
  aiPillOn: {
    backgroundColor: COLORS.teal,
    borderColor: COLORS.teal,
  },
  aiPillText: {
    color: COLORS.teal,
    fontSize: 11,
    fontFamily: FONTS.en.extrabold,
    letterSpacing: 0.3,
  },
  aiPillTextOn: {
    color: COLORS.btnText,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22C55E',
  },
  liveText: {
    color: '#22C55E',
    fontSize: 12,
    fontFamily: FONTS.en.extrabold,
    letterSpacing: 0.5,
  },
  visionArea: {
    flex: 1,
    marginHorizontal: LAYOUT.screenPaddingH,
    marginVertical: 8,
    borderRadius: LAYOUT.cardRadius,
    backgroundColor: '#070A0F',
    overflow: 'hidden',
  },
  cameraTouchable: {
    flex: 1,
  },
  tapFlash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  flipBtn: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  torchBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  placeholderTitle: {
    color: COLORS.grey,
    fontSize: 15,
    textAlign: 'center',
    fontFamily: FONTS.en.regular,
  },
  allowBtn: {
    marginTop: 8,
    backgroundColor: COLORS.teal,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  allowBtnText: {
    color: COLORS.btnText,
    fontFamily: FONTS.en.extrabold,
    fontSize: 16,
  },
  riskStrip: {
    height: 6,
    marginHorizontal: LAYOUT.screenPaddingH,
    borderRadius: 3,
    marginBottom: 10,
  },
  alertCard: {
    flexDirection: 'row',
    marginHorizontal: LAYOUT.screenPaddingH,
    padding: 14,
    borderRadius: LAYOUT.cardRadius,
    borderWidth: 1,
    borderColor: COLORS.teal,
    backgroundColor: COLORS.bgElevated,
    gap: 12,
    marginBottom: 8,
  },
  alertTextCol: {
    flex: 1,
  },
  alertTitle: {
    color: COLORS.white,
    fontSize: 16,
    fontFamily: FONTS.en.bold,
    marginBottom: 6,
  },
  inferenceMeta: {
    color: COLORS.grey,
    fontSize: 13,
    marginBottom: 4,
    fontFamily: FONTS.en.regular,
  },
  inferenceErr: {
    color: '#FCA5A5',
    fontSize: 12,
    marginTop: 4,
    fontFamily: FONTS.en.regular,
  },
  sceneHint: {
    color: COLORS.tealBright,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  darijaPrimary: {
    color: COLORS.white,
    fontSize: 15,
    lineHeight: 24,
    marginTop: 4,
    fontFamily: FONTS.ar.regular,
    writingDirection: 'rtl',
  },
  geminiText: {
    color: COLORS.grey,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
    fontFamily: FONTS.en.regular,
  },
  geminiErr: {
    color: '#FBBF24',
    fontSize: 11,
    marginTop: 4,
    fontFamily: FONTS.en.regular,
  },
  geminiMeta: {
    color: COLORS.grey,
    fontSize: 12,
    marginTop: 4,
    fontFamily: FONTS.en.medium,
  },
  riskPillRow: {
    marginTop: 6,
  },
  riskPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
  },
  riskPillCaution: {
    backgroundColor: 'rgba(234, 88, 12, 0.25)',
  },
  riskPillDanger: {
    backgroundColor: 'rgba(220, 38, 38, 0.3)',
  },
  riskPillUnknown: {
    backgroundColor: 'rgba(148, 163, 184, 0.25)',
  },
  riskPillText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: '800',
    fontFamily: FONTS.en.extrabold,
  },
  badgeRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  dangerBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  dangerBadgeText: {
    color: '#FCA5A5',
    fontSize: 12,
    fontFamily: FONTS.en.extrabold,
  },
  alertAr: {
    color: COLORS.tealBright,
    fontSize: 14,
    lineHeight: 22,
    writingDirection: 'rtl',
    fontFamily: FONTS.ar.regular,
  },
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    paddingTop: 12,
    paddingHorizontal: LAYOUT.screenPaddingH,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderMuted,
  },
  navItem: {
    alignItems: 'center',
    gap: 4,
    minWidth: 72,
  },
  navLabel: {
    color: COLORS.tealBright,
    fontSize: 12,
    fontFamily: FONTS.en.semibold,
  },
  centerFab: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.teal,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: COLORS.teal,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    padding: 20,
  },
  modalCard: {
    backgroundColor: COLORS.bgElevated,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.borderMuted,
  },
  modalTitle: {
    color: COLORS.white,
    fontSize: 20,
    fontFamily: FONTS.en.extrabold,
    marginBottom: 6,
  },
  modalHint: {
    color: COLORS.grey,
    fontSize: 14,
    marginBottom: 16,
    fontFamily: FONTS.en.regular,
  },
  modalSlider: {
    width: '100%',
    height: 44,
  },
  modalEnds: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -4,
    marginBottom: 16,
  },
  endLabel: {
    color: COLORS.grey,
    fontSize: 12,
    fontFamily: FONTS.en.regular,
  },
  modalDone: {
    alignSelf: 'flex-end',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  modalDoneText: {
    color: COLORS.teal,
    fontSize: 17,
    fontFamily: FONTS.en.semibold,
  },
});
