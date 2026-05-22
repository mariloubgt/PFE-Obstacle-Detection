import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import * as ExpoCamera from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import {
  InteractionManager,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Local Components & Utils
import DangerAlertModal from '../components/DangerAlertModal';
import DetectionOverlay from '../components/DetectionOverlay';
import { predictImage } from '../services/predict';
import { useThemeColors } from '../contexts/ThemeContext';
import { FONTS } from '../constants/typography';
import { loadInferenceApiUrl } from '../utils/inferenceApiUrl';
import { saveAlertVolume, syncStoredAlertVolumeToSystem } from '../utils/alertVolumeStorage';
import { applyAlertVolumeToSystemOutput } from '../utils/systemOutputVolume';
import { ttsVolumeOptions } from '../utils/ttsVolumeOptions';
import { smoothDetectionDistances } from '../utils/smoothDetectionDistances';
import { DEFAULTS, loadAppPreferences } from '../utils/appSettings';
import { useVolumeHardwareShortcut } from '../hooks/useVolumeHardwareShortcut';
import { useDescribeEnvironmentHotword } from '../hooks/useDescribeEnvironmentHotword';
import { triggerSceneDescribe } from './SceneQueryScreen';

const CameraComponent = ExpoCamera.Camera || ExpoCamera.default;
const CAMERA_TYPE = ExpoCamera.Camera?.Constants?.Type || ExpoCamera.Constants?.Type || { back: 'back', front: 'front' };
const FLASH_MODE = ExpoCamera.Camera?.Constants?.FlashMode || ExpoCamera.Constants?.FlashMode || { torch: 'torch', off: 'off' };

/** Natural English phrases for obstacle TTS (with article where it reads well). */
const ENGLISH_SPEECH_LABEL = {
  person: 'a person',
  bicycle: 'a bicycle',
  car: 'a car',
  motorcycle: 'a motorcycle',
  bus: 'a bus',
  truck: 'a truck',
  dog: 'a dog',
  bench: 'a bench',
  chair: 'a chair',
  stairs: 'stairs',
  curb: 'a curb',
  fire_hydrant: 'a fire hydrant',
  stop_sign: 'a stop sign',
  traffic_light: 'a traffic light',
  tree: 'a tree',
  pole: 'a pole',
  waste_container: 'a trash bin',
  crutch: 'a crutch',
};

function englishLabelForClass(name) {
  const k = String(name || 'object').toLowerCase().trim();
  if (ENGLISH_SPEECH_LABEL[k]) return ENGLISH_SPEECH_LABEL[k];
  const spaced = k.replace(/_/g, ' ');
  return `a ${spaced}`;
}

function normClass(name) {
  return String(name || '').toLowerCase().trim();
}

/**
 * Stay on one "primary" obstacle until it disappears or another is clearly closer (less jitter).
 * @param {Array} sortedDetections sorted by distance_m ascending
 * @param {{ current: { key: string } | null }} lockRef
 */
function pickLockedPrimary(sortedDetections, lockRef, hysteresisM = 0.45) {
  if (!sortedDetections.length) {
    lockRef.current = null;
    return null;
  }
  const cand = sortedDetections[0];
  const lock = lockRef.current;
  if (!lock) {
    lockRef.current = { key: normClass(cand.name) };
    return cand;
  }
  const lockedDet = sortedDetections.find((d) => normClass(d.name) === lock.key);
  if (!lockedDet) {
    lockRef.current = { key: normClass(cand.name) };
    return cand;
  }
  if (normClass(cand.name) === lock.key) {
    return cand;
  }
  const cd = cand.distance_m ?? 99;
  const ld = lockedDet.distance_m ?? 99;
  if (cd < ld - hysteresisM) {
    lockRef.current = { key: normClass(cand.name) };
    return cand;
  }
  return lockedDet;
}

const SPEAK_MIN_GAP_MS = 4000;
const NAV_GROQ_INTERVAL_MS = 4000;
/** Speak scene/caption again when text changes, at most every this many ms */
const SCENE_SPEAK_COOLDOWN_MS = 4500;
const MAX_SCENE_TTS_CHARS = 220;

function clipSceneForSpeech(text) {
  if (!text || typeof text !== 'string') return '';
  const t = text.trim();
  if (t.length <= MAX_SCENE_TTS_CHARS) return t;
  return `${t.slice(0, MAX_SCENE_TTS_CHARS - 3)}...`;
}

function formatMeters(m) {
  if (m == null || !Number.isFinite(m)) return null;
  return `${Number(m).toFixed(1)} m`;
}

function createMainNavigationStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, height: 60 },
    topIcon: { padding: 4 },
    time: { color: colors.topBarText, fontSize: 18, fontWeight: '700', letterSpacing: -0.5 },
    topRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    livePill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, gap: 6 },
    liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#EF4444' },
    liveText: { color: colors.topBarText, fontSize: 11, fontWeight: '800' },
    aiPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, gap: 6, borderWidth: 1, borderColor: 'rgba(20,184,166,0.3)' },
    aiPillOn: { backgroundColor: colors.teal, borderColor: colors.teal },
    aiPillText: { color: colors.teal, fontSize: 12, fontWeight: '700' },
    aiPillTextOn: { color: colors.btnText },
    aiPillPressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
    visionArea: { flex: 1, marginHorizontal: 15, marginVertical: 10, borderRadius: 30, overflow: 'hidden', backgroundColor: '#111' },
    cameraTouchable: { flex: 1 },
    tapFlash: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(255,255,255,0.22)',
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
    riskStrip: { height: 4, marginHorizontal: 25, borderRadius: 2 },
    alertCard: {
      flexDirection: 'row',
      margin: 20,
      padding: 20,
      backgroundColor: colors.alertCardBg,
      borderRadius: 24,
      alignItems: 'flex-start',
      gap: 15,
    },
    alertCardIcon: { marginTop: 2 },
    alertTextCol: { flex: 1, minWidth: 0 },
    cardSectionLabel: {
      color: colors.grey,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      marginTop: 10,
      marginBottom: 2,
      fontFamily: FONTS.en.semibold,
    },
    cardSectionLabelFirst: { marginTop: 0 },
    alertTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
    alertSub: { color: colors.grey, fontSize: 13 },
    voiceHint: { color: colors.tealBright, fontSize: 12, marginTop: 10, lineHeight: 18 },
    voiceContextHint: {
      color: colors.tealBright,
      fontSize: 14,
      fontWeight: '600',
      marginTop: 2,
      lineHeight: 20,
      fontFamily: FONTS.en.regular,
    },
    sceneDistanceLine: {
      color: colors.text,
      fontSize: 13,
      marginTop: 8,
      fontFamily: FONTS.en.medium,
    },
    sceneDistanceEm: {
      color: colors.tealBright,
      fontWeight: '800',
      fontFamily: FONTS.en.extrabold,
    },
    inferenceMeta: { color: colors.grey, fontSize: 11, marginTop: 2, lineHeight: 16 },
    inferenceErr: { color: colors.danger, fontSize: 12 },
    bottomNav: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center',
      backgroundColor: colors.navBarBg,
      paddingVertical: 10,
      borderTopLeftRadius: 30,
      borderTopRightRadius: 30,
      zIndex: 100,
      elevation: 24,
    },
    navItem: { alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 12 },
    navPressed: { opacity: 0.72 },
    navLabel: { color: colors.grey, fontSize: 10, fontWeight: '600' },
    centerFab: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.teal, justifyContent: 'center', alignItems: 'center', elevation: 8, shadowColor: colors.teal, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
    modalCard: { width: '80%', backgroundColor: colors.bgElevated, padding: 25, borderRadius: 30, alignItems: 'center' },
    modalTitle: { color: colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: 20 },
    modalDone: { marginTop: 20, backgroundColor: colors.teal, paddingHorizontal: 30, paddingVertical: 12, borderRadius: 15 },
    modalDoneText: { color: colors.btnText, fontWeight: 'bold' },
    placeholder: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center', padding: 40 },
    placeholderTitle: { color: colors.text, fontSize: 18, marginVertical: 20, textAlign: 'center' },
    allowBtn: { backgroundColor: colors.teal, paddingHorizontal: 25, paddingVertical: 15, borderRadius: 15 },
    allowBtnText: { color: colors.btnText, fontWeight: 'bold' },
  });
}

export default function MainNavigationScreen({ navigation }) {
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = useMemo(() => createMainNavigationStyles(colors), [colors]);
  const [permission, setPermission] = useState(null);
  const requestPermission = useCallback(async () => {
    const req =
      ExpoCamera.requestCameraPermissionsAsync ||
      ExpoCamera.requestPermissionsAsync ||
      ExpoCamera.Camera?.requestCameraPermissionsAsync ||
      ExpoCamera.Camera?.requestPermissionsAsync;
    if (!req) return;
    const res = await req();
    setPermission(res);
    return res;
  }, []);
  const cameraRef = useRef(null);
  const [facing, setFacing] = useState(CAMERA_TYPE.back);
  const [torch, setTorch] = useState(false);
  const [tapFlash, setTapFlash] = useState(false);

  // UI States
  const [clock, setClock] = useState('00:00');
  const [aiTestEnabled, setAiTestEnabled] = useState(false);
  const [detections, setDetections] = useState([]);
  const [inferenceMs, setInferenceMs] = useState(null);
  const [pipelineMs, setPipelineMs] = useState(null);
  /** English context for UI + voice (MobileNet label or scene). */
  const [voiceContextHint, setVoiceContextHint] = useState(null);
  const [inferenceError, setInferenceError] = useState(null);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [alertVolume, setAlertVolume] = useState(0.8);
  const [dangerPayload, setDangerPayload] = useState(null);
  /** YOLO loop interval — synced from Settings; changing while AI runs updates on next focus/refresh. */
  const [yoloIntervalMs, setYoloIntervalMs] = useState(DEFAULTS.aiFrameMs);
  const [volumeHardwareAction, setVolumeHardwareAction] = useState(
    DEFAULTS.volumeHardwareAction
  );
  const [handsFreeDescribe, setHandsFreeDescribe] = useState(DEFAULTS.handsFreeDescribe);

  useEffect(() => {
    const get =
      ExpoCamera.getCameraPermissionsAsync ||
      ExpoCamera.getPermissionsAsync ||
      ExpoCamera.Camera?.getCameraPermissionsAsync ||
      ExpoCamera.Camera?.getPermissionsAsync;
    if (!get) return;
    void get().then(setPermission).catch(() => {});
  }, []);

  const inFlightRef = useRef(false);
  const aiTestRef = useRef(false);
  const navInFlightRef = useRef(false);
  const lastNavGroqAtRef = useRef(0);
  const lastNavTextRef = useRef('');
  const lastNavSpokenAtRef = useRef(0);
  const lastEmergencyAtRef = useRef(0);
  const smoothStateRef = useRef({});
  const lastDangerHapticAtRef = useRef(0);
  const lastTtsKeyRef = useRef('');
  const lastSpeakAtRef = useRef(0);
  const lastSpokenSceneTextRef = useRef('');
  const lastSceneSpeakAtRef = useRef(0);
  /** Lock TTS + overlay on one obstacle until another is clearly closer */
  const primaryLockRef = useRef(null);
  const manualSuppressRef = useRef(false);
  const alertVolumeRef = useRef(alertVolume);
  /** Live prefs used inside async callbacks (always read `.current`, never stale closures). */
  const livePrefsRef = useRef({
    hfovDeg: DEFAULTS.cameraHfovDeg,
    depthScale: DEFAULTS.depthScale,
    useGemini: DEFAULTS.internetGemini,
    dangerThresholdM: DEFAULTS.dangerThresholdM,
    aiFrameMs: DEFAULTS.aiFrameMs,
    vibrationDanger: DEFAULTS.vibrationDanger,
    lowLight: DEFAULTS.lowLight,
    speechRate: DEFAULTS.speechRate,
  });

  const refreshPredictOpts = useCallback(() => {
    void loadAppPreferences().then((p) => {
      livePrefsRef.current = {
        hfovDeg: p.cameraHfovDeg,
        depthScale: p.depthScale,
        useGemini: p.internetGemini,
        dangerThresholdM: p.dangerThresholdM,
        aiFrameMs: p.aiFrameMs,
        vibrationDanger: p.vibrationDanger,
        lowLight: p.lowLight,
        speechRate: p.speechRate,
      };
      setYoloIntervalMs(p.aiFrameMs);
      setVolumeHardwareAction(p.volumeHardwareAction);
      setHandsFreeDescribe(p.handsFreeDescribe);
    });
  }, []);

  /** TTS options using saved speech rate + current alert volume. */
  const voiceSpeakOpts = useCallback((volumeOverride) => {
    const vol =
      volumeOverride != null ? volumeOverride : alertVolumeRef.current;
    const r = livePrefsRef.current.speechRate ?? DEFAULTS.speechRate;
    return {
      language: 'en-US',
      rate: Math.min(1, Math.max(0.22, r)),
      ...ttsVolumeOptions(vol),
    };
  }, []);

  useEffect(() => {
    refreshPredictOpts();
  }, [refreshPredictOpts]);

  // --- Volume: persist + drive real device output (same as side buttons) ---
  useEffect(() => {
    syncStoredAlertVolumeToSystem().then((v) => setAlertVolume(v));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshPredictOpts();
      void syncStoredAlertVolumeToSystem().then((v) => setAlertVolume(v));
    }, [refreshPredictOpts])
  );
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    alertVolumeRef.current = alertVolume;
  }, [alertVolume]);

  const onAlertVolumeSliderChange = useCallback((v) => {
    setAlertVolume(v);
    void applyAlertVolumeToSystemOutput(v);
  }, []);

  const onAlertVolumeSliderComplete = useCallback((v) => {
    setAlertVolume(v);
    void saveAlertVolume(v);
  }, []);

  useEffect(() => {
    aiTestRef.current = aiTestEnabled;
  }, [aiTestEnabled]);

  /** Low-light: turn torch on when AI navigation starts on rear camera (user can toggle off). */
  useEffect(() => {
    if (!aiTestEnabled) return;
    let cancelled = false;
    loadAppPreferences().then((p) => {
      if (cancelled || !aiTestRef.current) return;
      if (p.lowLight && facing === CAMERA_TYPE.back) {
        setTorch(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [aiTestEnabled, facing]);

  /** Voice command "activate navigation" → enable AI test (which now does navigation too). */
  const onActivateNavigation = useCallback(() => {
    if (aiTestRef.current) return;
    setAiTestEnabled(true);
    Speech.stop();
    Speech.speak('Navigation activated.', voiceSpeakOpts());
  }, [voiceSpeakOpts]);

  /** Voice command "stop navigation" → disable AI test. */
  const onStopNavigation = useCallback(() => {
    if (!aiTestRef.current) return;
    setAiTestEnabled(false);
    Speech.stop();
    Speech.speak('Navigation stopped.', voiceSpeakOpts());
  }, [voiceSpeakOpts]);

  /** Sound / volume key / hotword → open Scene Query then call describe directly.
   *  Uses a module-level callback so it works whether the screen is new or already focused. */
  const openSceneQueryWithDescribe = useCallback(() => {
    navigation.navigate('SceneQuery');
    InteractionManager.runAfterInteractions(() => {
      setTimeout(() => triggerSceneDescribe(), 150);
    });
  }, [navigation]);

  useVolumeHardwareShortcut(navigation, {
    enabled: !volumeOpen,
    action: volumeHardwareAction,
    onDescribeEnvironment: openSceneQueryWithDescribe,
  });

  useDescribeEnvironmentHotword({
    enabled: handsFreeDescribe && !volumeOpen,
    cameraRef,
    alertVolumeRef,
    onPhraseMatched: openSceneQueryWithDescribe,
    onActivateNavigation,
    onStopNavigation,
  });

  /** Spoken cue when toggling hands-free from Settings — avoid first mount */
  const announceHandsFreeInitialized = useRef(false);
  useEffect(() => {
    if (!announceHandsFreeInitialized.current) {
      announceHandsFreeInitialized.current = true;
      return;
    }
    Speech.stop();
    Speech.speak(
      handsFreeDescribe
        ? 'Hands-free phrase listening enabled.'
        : 'Hands-free phrase listening disabled.',
      voiceSpeakOpts()
    );
  }, [handsFreeDescribe, voiceSpeakOpts]);

  /** TTS: English obstacle line; prefers LLaVA guidance, then obstacle fallback. */
  const speakEnglishNav = useCallback((data, smoothedDets) => {
    if (!smoothedDets.length) return;
    const now = Date.now();

    const sorted = [...smoothedDets].sort(
      (a, b) => (a.distance_m ?? 99) - (b.distance_m ?? 99)
    );
    const d0 = sorted[0];
    const dist = Math.round((d0.distance_m || 0) * 2) / 2;
    const label = englishLabelForClass(d0.name);
    const labelSent = label.charAt(0).toUpperCase() + label.slice(1);
    const unit = dist === 1 ? 'meter' : 'meters';
    const obstaclePart = `${labelSent} at ${dist} ${unit}.`;

    const llavaGuidance =
      typeof data?.navigation?.guidance_en === 'string'
        ? data.navigation.guidance_en.trim()
        : '';
    const navGuidance = llavaGuidance;
    const msg = navGuidance
      ? clipSceneForSpeech(navGuidance)
      : obstaclePart;

    if (now - lastSpeakAtRef.current < SPEAK_MIN_GAP_MS) return;

    const obKey = navGuidance
      ? `nav|${msg}`
      : `${label}|${dist}`;
    if (obKey === lastTtsKeyRef.current) return;

    lastTtsKeyRef.current = obKey;
    lastSpeakAtRef.current = now;
    Speech.stop();
    Speech.speak(msg, {
      ...voiceSpeakOpts(),
      pitch: 1.0,
    });
  }, [voiceSpeakOpts]);

  const onCameraTap = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    setTapFlash(true);
    setTimeout(() => setTapFlash(false), 280);
  }, []);

  const toggleFacing = useCallback(() => {
    setFacing((prev) =>
      prev === CAMERA_TYPE.back
        ? CAMERA_TYPE.front
        : CAMERA_TYPE.back
    );
    setTorch(false);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  }, []);

  /** Emergency stop rule: any close obstacle <1.5m → speak immediately (with 4s cooldown). */
  const speakEmergencyIfNeeded = useCallback((primaryOnly) => {
    if (!aiTestRef.current) return false;
    const closest = primaryOnly[0];
    if (!closest || typeof closest.distance_m !== 'number') return false;
    if (closest.distance_m >= 1.5) return false;
    const now = Date.now();
    if (now - lastEmergencyAtRef.current < 6000) return false;
    lastEmergencyAtRef.current = now;

    const dist = Math.max(0.2, Math.round(closest.distance_m * 10) / 10);
    const label = englishLabelForClass(closest.name);
    const cx = ((closest.x1 ?? 0) + (closest.x2 ?? 1)) / 2;
    const side = cx < 1 / 3 ? 'on your left' : cx < 2 / 3 ? 'directly ahead' : 'on your right';
    const msg = `Stop. ${label.charAt(0).toUpperCase() + label.slice(1)} ${dist} meters ${side}.`;
    Speech.stop();
    Speech.speak(msg, {
      ...voiceSpeakOpts(),
      pitch: 1.05,
    });
    return true;
  }, [voiceSpeakOpts]);

  /** Fire Groq navigate call on its own timer, independent of YOLO loop. */
  const fireGroqNav = useCallback(async () => {
    if (!aiTestRef.current) return;
    if (navInFlightRef.current) return;
    if (!cameraRef.current) return;
    navInFlightRef.current = true;
    try {
      const api = await loadInferenceApiUrl();
      if (!api) return;
      // Take a fresh photo for Groq
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.3,
        skipProcessing: true,
      });
      if (!aiTestRef.current) return;
      const po = livePrefsRef.current;
      const data = await predictImage(api, photo.uri, {
        hfovDeg: po.hfovDeg,
        depthScale: po.depthScale,
        useGemini: po.useGemini,
        useGroq: true,
        groqMode: 'navigate',
      });
      if (!aiTestRef.current) return;
      const guidance =
        typeof data?.groq?.guidance_en === 'string' ? data.groq.guidance_en.trim() : '';
      if (!guidance) return;
      const now = Date.now();
      const isNew = guidance !== lastNavTextRef.current;
      const tooLongSilent = now - lastNavSpokenAtRef.current > 12000;
      // Speak if guidance changed OR 12s without speaking
      if (!isNew && !tooLongSilent) return;
      lastNavTextRef.current = guidance;
      lastNavSpokenAtRef.current = now;
      Speech.stop();
      Speech.speak(guidance, voiceSpeakOpts());
    } catch {
      // ignore — nav is best-effort
    } finally {
      navInFlightRef.current = false;
    }
  }, [voiceSpeakOpts]);

  // --- AI Loop (non-overlapping frames + smoothed distances) ---
  const runFrame = useCallback(async () => {
    if (
      !aiTestRef.current ||
      !cameraRef.current ||
      inFlightRef.current
    )
      return;
    inFlightRef.current = true;
    try {
      const api = await loadInferenceApiUrl();
      if (!api) return;
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.22,
        skipProcessing: true,
      });
      const po = livePrefsRef.current;
      const data = await predictImage(api, photo.uri, {
        hfovDeg: po.hfovDeg,
        depthScale: po.depthScale,
        useGemini: po.useGemini,
        useGroq: false,
      });

      const valid = (data.detections || []).filter((d) => d.distance_m < 5.0);
      const smoothed = smoothDetectionDistances(valid, smoothStateRef);
      const sorted = [...smoothed].sort(
        (a, b) => (a.distance_m ?? 99) - (b.distance_m ?? 99)
      );
      const primary = pickLockedPrimary(sorted, primaryLockRef);
      const primaryOnly = primary ? [primary] : [];

      if (!aiTestRef.current) return;

      setDetections(primaryOnly);
      setInferenceMs(data.inference_ms ?? null);
      setPipelineMs(data.pipeline_ms ?? null);
      const ctx =
        (typeof data.gemini?.focus === 'string' && data.gemini.focus.trim()) ||
        (typeof data.scene?.top5?.[0]?.label === 'string' &&
          data.scene.top5[0].label.trim()) ||
        null;
      setVoiceContextHint(ctx);
      setInferenceError(null);

      speakEmergencyIfNeeded(primaryOnly);

      const thr = livePrefsRef.current.dangerThresholdM;
      const hysteresis = 0.28;
      const distP = primary?.distance_m;
      if (
        primary &&
        typeof distP === 'number' &&
        distP <= thr &&
        !manualSuppressRef.current
      ) {
        const disp = String(primary.name || 'obstacle').replace(/_/g, ' ');
        const label = englishLabelForClass(primary.name);
        const cap = label.charAt(0).toUpperCase() + label.slice(1);
        const alertMsg = `Stop. ${cap} ${distP.toFixed(1)} meters ahead.`;
        setDangerPayload({
          displayLabel: disp,
          distanceM: distP,
          alertMessage: alertMsg,
        });
        if (
          livePrefsRef.current.vibrationDanger &&
          Platform.OS !== 'web' &&
          Date.now() - lastDangerHapticAtRef.current > 2300
        ) {
          lastDangerHapticAtRef.current = Date.now();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        }
      } else if (!primary || typeof distP !== 'number' || distP > thr + hysteresis) {
        manualSuppressRef.current = false;
        setDangerPayload(null);
      }
    } catch (e) {
      if (aiTestRef.current) setInferenceError(e.message);
    } finally {
      inFlightRef.current = false;
    }
  }, [speakEmergencyIfNeeded]);

  useEffect(() => {
    let yoloInterval = null;
    let groqInterval = null;
    if (aiTestEnabled) {
      smoothStateRef.current = {};
      lastTtsKeyRef.current = '';
      lastSpokenSceneTextRef.current = '';
      lastSceneSpeakAtRef.current = 0;
      primaryLockRef.current = null;
      lastNavGroqAtRef.current = 0;
      lastNavTextRef.current = '';
      lastNavSpokenAtRef.current = 0;
      lastEmergencyAtRef.current = 0;
      // YOLO loop: fast, no Groq
      runFrame();
      yoloInterval = setInterval(runFrame, yoloIntervalMs);
      // Groq nav loop: separate, slower timer
      setTimeout(() => { void fireGroqNav(); }, 1500); // first call after 1.5s
      groqInterval = setInterval(() => { void fireGroqNav(); }, NAV_GROQ_INTERVAL_MS);
    } else {
      setDangerPayload(null);
      manualSuppressRef.current = false;
      Speech.stop();
      lastTtsKeyRef.current = '';
      smoothStateRef.current = {};
      setDetections([]);
      setInferenceMs(null);
      setVoiceContextHint(null);
      setInferenceError(null);
    }
    return () => {
      if (yoloInterval) clearInterval(yoloInterval);
      if (groqInterval) clearInterval(groqInterval);
    };
  }, [aiTestEnabled, runFrame, fireGroqNav, yoloIntervalMs]);

  const onDangerBack = useCallback(() => {
    setDangerPayload(null);
    manualSuppressRef.current = true;
  }, []);

  const handleGoBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('Welcome');
    }
  }, [navigation]);

  if (!permission?.granted) {
      return (
        <View style={styles.placeholder}>
            <MaterialCommunityIcons name="camera-off-outline" size={48} color={colors.grey} />
            <Text style={styles.placeholderTitle}>Camera access required</Text>
            <TouchableOpacity style={styles.allowBtn} onPress={requestPermission}>
                <Text style={styles.allowBtnText}>Allow Camera</Text>
            </TouchableOpacity>
        </View>
      );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style={colors.statusBarStyle} />

      {/* TOP NAVIGATION BAR */}
      <View style={styles.topBar}>
        <Pressable onPress={handleGoBack} style={styles.topIcon}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.teal} />
        </Pressable>
        <Text style={styles.time}>{clock}</Text>
        <View style={styles.topRight}>
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
          <Pressable 
            style={({ pressed }) => [
              styles.aiPill,
              aiTestEnabled && styles.aiPillOn,
              pressed && styles.aiPillPressed,
            ]}
            onPress={() => {
              if (Platform.OS !== 'web') {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              }
              const next = !aiTestEnabled;
              setAiTestEnabled(next);
              Speech.stop();
              Speech.speak(next ? 'Navigation activated.' : 'Navigation stopped.', voiceSpeakOpts());
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: aiTestEnabled }}
            accessibilityLabel={
              aiTestEnabled
                ? 'AI navigation active — tap to stop'
                : 'AI navigation off — tap to start, or say activate navigation'
            }
            accessibilityHint={
              aiTestEnabled
                ? 'Stops obstacle detection and Groq navigation guidance.'
                : 'Starts YOLO obstacle detection plus Groq detailed navigation instructions.'
            }
          >
            <MaterialCommunityIcons name="brain" size={15} color={aiTestEnabled ? colors.btnText : colors.teal} />
            <Text style={[styles.aiPillText, aiTestEnabled && styles.aiPillTextOn]}>AI test</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.aiPill, pressed && styles.aiPillPressed]}
            onPress={() => {
              if (Platform.OS !== 'web') {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              }
              openSceneQueryWithDescribe();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Describe environment scene summary"
            accessibilityHint="Opens Scene Query with a fresh scene description, same as the Sound tab."
          >
            <MaterialCommunityIcons name="microphone-outline" size={15} color={colors.teal} />
            <Text style={styles.aiPillText}>Describe</Text>
          </Pressable>
        </View>
      </View>

      {/* VISION AREA — flip / torch restored for front camera */}
      <View style={styles.visionArea}>
        <Pressable style={styles.cameraTouchable} onPress={onCameraTap}>
          <CameraComponent
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            type={facing}
            flashMode={
              facing === CAMERA_TYPE.back && torch
                ? FLASH_MODE.torch
                : FLASH_MODE.off
            }
            mode="picture"
          />
          <DetectionOverlay detections={detections} />
          {tapFlash ? <View style={styles.tapFlash} pointerEvents="none" /> : null}
        </Pressable>

        <Pressable
          style={styles.flipBtn}
          onPress={toggleFacing}
          accessibilityRole="button"
          accessibilityLabel="Switch front or back camera"
        >
          <MaterialCommunityIcons name="camera-flip-outline" size={22} color={colors.overlayIcon} />
        </Pressable>

        <Pressable
          style={styles.torchBtn}
          onPress={() => {
            if (facing !== CAMERA_TYPE.back) {
              setFacing(CAMERA_TYPE.back);
            }
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
            color={colors.overlayIcon}
          />
        </Pressable>
      </View>

      <LinearGradient colors={['#DC2626', '#EA580C', '#EAB308', '#22C55E']} start={{x:0,y:0}} end={{x:1,y:0}} style={styles.riskStrip} />

      {/* ALERT CARD — closest obstacle, scene/context (Gemini / scene model), pipeline stats */}
      <View style={styles.alertCard}>
        <MaterialCommunityIcons
          name={aiTestEnabled ? 'brain' : 'alert-circle-outline'}
          size={22}
          color={aiTestEnabled ? colors.teal : colors.grey}
          style={styles.alertCardIcon}
        />
        <View style={styles.alertTextCol}>
          {aiTestEnabled ? (
            <>
              {inferenceError ? (
                <Text style={styles.inferenceErr}>{inferenceError}</Text>
              ) : (
                <>
                  <Text style={[styles.cardSectionLabel, styles.cardSectionLabelFirst]}>Closest obstacle</Text>
                  <Text style={styles.alertTitle}>
                    {detections.length > 0
                      ? `${detections[0].name.replace(/_/g, ' ')} · ${
                          formatMeters(detections[0].distance_m) ?? '—'
                        }`
                      : 'Searching…'}
                  </Text>
                  {detections.length > 0 && formatMeters(detections[0].distance_m) ? (
                    <Text style={styles.sceneDistanceLine}>
                      Estimated distance (closest){' '}
                      <Text style={styles.sceneDistanceEm}>{formatMeters(detections[0].distance_m)}</Text>
                    </Text>
                  ) : null}
                  <Text style={styles.cardSectionLabel}>Pipeline</Text>
                  <Text style={styles.inferenceMeta}>
                    {Math.round(pipelineMs || 0)} ms total
                    {inferenceMs != null ? ` · YOLO ${Math.round(inferenceMs)} ms` : ''}
                    {' · '}
                    {detections.length} {detections.length === 1 ? 'object' : 'objects'} tracked
                    {detections.length > 0 && formatMeters(detections[0].distance_m)
                      ? ` · closest ${formatMeters(detections[0].distance_m)}`
                      : ''}
                  </Text>
                </>
              )}
            </>
          ) : (
            <>
              <Text style={styles.alertTitle}>AI System Idle</Text>
              <Text style={styles.alertSub}>
                Tap Sound to open scene description and automatically hear a new summary. Go back and
                tap Sound again anytime. Long-press Sound for alert volume.
              </Text>
            </>
          )}
        </View>
      </View>

      {/* BOTTOM NAV */}
      <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 15) }]}>
        <Pressable
          style={({ pressed }) => [styles.navItem, pressed && styles.navPressed]}
          hitSlop={{ top: 14, bottom: 14, left: 16, right: 16 }}
          onPress={() => {
            if (Platform.OS !== 'web') {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            }
            openSceneQueryWithDescribe();
          }}
          onLongPress={() => {
            if (Platform.OS !== 'web') {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            }
            setVolumeOpen(true);
          }}
          delayLongPress={3000}
          accessibilityRole="button"
          accessibilityLabel="Scene description — opens Scene Query"
          accessibilityHint="Opens Scene Query and reads a scene description. Press and hold to open alert volume slider."
        >
          <MaterialCommunityIcons name="volume-high" size={26} color={colors.tealBright} />
          <Text style={styles.navLabel}>Sound</Text>
        </Pressable>

        <Pressable
          style={styles.centerFab}
          onPress={() => navigation.navigate('SceneQuery')}
          accessibilityRole="button"
          accessibilityLabel="Scene descriptions"
          accessibilityHint="Opens the scene description chat. Use Describe scene for a fresh summary."
        >
          <MaterialCommunityIcons name="chart-box-outline" size={30} color={colors.btnText} />
        </Pressable>

        <Pressable
          style={styles.navItem}
          onPress={() => navigation.navigate('Settings')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          accessibilityHint="Shortcuts for volume keys describe and hands-free phrase"
        >
          <MaterialCommunityIcons name="cog-outline" size={26} color={colors.tealBright} />
          <Text style={styles.navLabel}>Settings</Text>
        </Pressable>
      </View>

      {/* VOLUME MODAL */}
      <Modal visible={volumeOpen} transparent animationType="slide">
        <Pressable style={styles.modalBackdrop} onPress={() => setVolumeOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Alert Volume</Text>
            <Slider 
               style={{width:'100%', height:40}} 
               value={alertVolume} 
               onValueChange={onAlertVolumeSliderChange}
               onSlidingComplete={onAlertVolumeSliderComplete}
               minimumValue={0}
               maximumValue={1}
               minimumTrackTintColor={colors.teal}
               maximumTrackTintColor={colors.borderMuted}
               thumbTintColor={colors.teal}
            />
            <TouchableOpacity style={styles.modalDone} onPress={() => setVolumeOpen(false)}>
              <Text style={styles.modalDoneText}>DONE</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <DangerAlertModal
        visible={!!dangerPayload}
        displayLabel={dangerPayload?.displayLabel}
        distanceM={dangerPayload?.distanceM}
        alertMessage={dangerPayload?.alertMessage ?? ''}
        onBack={onDangerBack}
      />
    </View>
  );
}
