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
  Linking,
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
import { predictNavigationFrame } from '../services/predict';
import { useThemeColors } from '../contexts/ThemeContext';
import { FONTS } from '../constants/typography';
import { loadInferenceApiUrl } from '../utils/inferenceApiUrl';
import { saveAlertVolume, syncStoredAlertVolumeToSystem } from '../utils/alertVolumeStorage';
import { applyAlertVolumeToSystemOutput } from '../utils/systemOutputVolume';
import { buildTtsOptions } from '../utils/buildTtsOptions';
import { speakAlert, stopSpeech, prepareSpeechAudio } from '../utils/speakAlert';
import { captureAndDescribeScene } from '../utils/describeSceneFromCamera';
import { smoothDetectionDistances } from '../utils/smoothDetectionDistances';
import { pickCloseThreat } from '../utils/evaluateCloseThreat';
import { isSimulatorDevice } from '../utils/isSimulator';
import { DEFAULTS, loadAppPreferences } from '../utils/appSettings';
import { getPredictOptionsForRequest } from '../utils/aiLabSettings';
import { useVolumeHardwareShortcut } from '../hooks/useVolumeHardwareShortcut';
import { useDescribeEnvironmentHotword } from '../hooks/useDescribeEnvironmentHotword';

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
  bus_stop: 'a bus stop',
  truck: 'a truck',
  dog: 'a dog',
  bench: 'a bench',
  chair: 'a chair',
  stairs: 'stairs',
  curb: 'a curb',
  fire_hydrant: 'a fire hydrant',
  stop_sign: 'a stop sign',
  traffic_light: 'a traffic light',
  street_light: 'a street light',
  tree: 'a tree',
  pole: 'a pole',
  waste_container: 'a trash bin',
  crutch: 'a crutch',
  spherical_roadblock: 'a roadblock',
  warning_column: 'a warning column',
  train: 'a train',
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
function pickLockedPrimary(sortedDetections, lockRef, hysteresisM = 0.55) {
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

const SPEAK_MIN_GAP_MS = 2800;
/** Ignore weak or distance-less YOLO hits (avoids false "exit/car" speech). */
const NAV_MIN_CONF = 0.35;

function isValidNavDetection(d) {
  const dist = d?.distance_m;
  if (typeof dist !== 'number' || !Number.isFinite(dist)) return false;
  if (dist <= 0.12 || dist >= 5.0) return false;
  const conf = d?.confidence;
  if (typeof conf === 'number' && conf < NAV_MIN_CONF) return false;
  return true;
}

function formatMeters(m) {
  if (m == null || !Number.isFinite(m)) return null;
  return `${Number(m).toFixed(1)} m`;
}

export default function MainNavigationScreen({ navigation }) {
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = useMemo(() => createMainNavStyles(colors), [colors]);
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
  const [detectionSummary, setDetectionSummary] = useState({ outdoor: 0, indoor: 0, route: 'fast' });
  const [inferenceMs, setInferenceMs] = useState(null);
  const [pipelineMs, setPipelineMs] = useState(null);
  const [groqMs, setGroqMs] = useState(null);
  /** English context for UI + voice (MobileNet label or scene). */
  const [voiceContextHint, setVoiceContextHint] = useState(null);
  const [inferenceError, setInferenceError] = useState(null);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [alertVolume, setAlertVolume] = useState(0.8);
  const [dangerPayload, setDangerPayload] = useState(null);
  const [volumeHardwareAction, setVolumeHardwareAction] = useState(
    DEFAULTS.volumeHardwareAction
  );
  const [handsFreeDescribe, setHandsFreeDescribe] = useState(DEFAULTS.handsFreeDescribe);
  const [voiceListening, setVoiceListening] = useState(false);
  /** off | paused | starting | unavailable | denied | ready | listening */
  const [voiceStatus, setVoiceStatus] = useState('off');
  const [voiceDetail, setVoiceDetail] = useState(null);
  const [camMountError, setCamMountError] = useState(null);
  const isSimulator = isSimulatorDevice();

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
  const lastEmergencyAtRef = useRef(0);
  const smoothStateRef = useRef({});
  const lastTtsKeyRef = useRef('');
  const lastSpeakAtRef = useRef(0);
  const hadObstacleRef = useRef(false);
  /** Lock TTS + overlay on one obstacle until another is clearly closer */
  const primaryLockRef = useRef(null);
  const lastPipelineMsRef = useRef(1500);
  const manualSuppressRef = useRef(false);
  const alertVolumeRef = useRef(alertVolume);
  const [aiFrameMs, setAiFrameMs] = useState(DEFAULTS.aiFrameMs);
  const prefsRef = useRef({ ...DEFAULTS });
  const predictOptsRef = useRef({
    hfovDeg: 56,
    depthScale: 1,
    useGemini: false,
  });

  const ttsOpts = useCallback(
    () => buildTtsOptions(alertVolumeRef.current, prefsRef.current.speechRate),
    []
  );

  const refreshPredictOpts = useCallback(() => {
    void loadAppPreferences().then(async (p) => {
      prefsRef.current = p;
      const po = await getPredictOptionsForRequest(p);
      predictOptsRef.current = po;
      setAiFrameMs(p.aiFrameMs);
      setVolumeHardwareAction(p.volumeHardwareAction);
      setHandsFreeDescribe(p.handsFreeDescribe);
    });
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
    if (!handsFreeDescribe) {
      setVoiceStatus('off');
    }
  }, [handsFreeDescribe]);

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
    if (aiTestEnabled) {
      void prepareSpeechAudio(true);
    }
  }, [aiTestEnabled]);

  /** Voice command "activate navigation" → enable AI test (which now does navigation too). */
  const onActivateNavigation = useCallback(() => {
    if (aiTestRef.current) return;
    setAiTestEnabled(true);
    speakAlert('Navigation activated.', ttsOpts());
  }, [ttsOpts]);

  /** Voice command "stop navigation" → disable AI test. */
  const onStopNavigation = useCallback(() => {
    if (!aiTestRef.current) return;
    setAiTestEnabled(false);
    speakAlert('Navigation stopped.', ttsOpts());
  }, [ttsOpts]);

  const describeInFlightRef = useRef(false);

  /** Groq describe on the live nav camera — stays on detection screen. */
  const runDescribeInPlace = useCallback(async () => {
    if (describeInFlightRef.current) return;
    describeInFlightRef.current = true;
    stopSpeech();
    try {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      }
      const res = await captureAndDescribeScene(cameraRef);
      if (!res.ok) {
        if (res.error) speakAlert(res.error, ttsOpts());
        return;
      }
      if (res.text && res.shouldSpeak) {
        speakAlert(res.text, ttsOpts());
      }
    } finally {
      describeInFlightRef.current = false;
    }
  }, [ttsOpts]);

  useVolumeHardwareShortcut(navigation, {
    enabled: !volumeOpen,
    action: volumeHardwareAction,
    onDescribeEnvironment: () => {
      if (volumeHardwareAction === 'scene_query') {
        navigation.navigate('SceneQuery');
        return;
      }
      void runDescribeInPlace();
    },
  });

  const { requestVoiceListen } = useDescribeEnvironmentHotword({
    enabled: handsFreeDescribe && !volumeOpen,
    cameraRef,
    alertVolumeRef,
    getTtsOpts: ttsOpts,
    onPhraseMatched: runDescribeInPlace,
    onActivateNavigation,
    onStopNavigation,
    onListeningChange: setVoiceListening,
    onVoiceStatusChange: setVoiceStatus,
    onVoiceDetailChange: setVoiceDetail,
  });

  const voiceBannerText = (() => {
    if (!handsFreeDescribe) return null;
    switch (voiceStatus) {
      case 'listening':
        return 'Listening — say: describe environment, activate navigation, or stop navigation';
      case 'ready':
        return 'Hands-free on — tap here, then say your command';
      case 'starting':
        return 'Hands-free on — tap here when ready to speak';
      case 'denied':
        return 'Voice blocked — tap here, then allow Microphone + Speech Recognition';
      case 'unavailable':
        return voiceDetail || 'Voice unavailable — reinstall from Xcode (▶ Run on iPhone)';
      case 'paused':
        return 'Voice paused — return to this screen';
      default:
        return 'Hands-free on — tap the bar to speak a command';
    }
  })();

  const voiceBannerTappable =
    handsFreeDescribe &&
    (voiceStatus === 'ready' ||
      voiceStatus === 'starting' ||
      voiceStatus === 'denied');

  const onVoiceBannerPress = useCallback(() => {
    if (voiceStatus === 'denied') {
      Linking.openSettings().catch(() => {});
      return;
    }
    requestVoiceListen();
  }, [voiceStatus, requestVoiceListen]);

  /** Spoken cue when toggling hands-free from Settings — avoid first mount */
  const announceHandsFreeInitialized = useRef(false);
  useEffect(() => {
    if (!announceHandsFreeInitialized.current) {
      announceHandsFreeInitialized.current = true;
      return;
    }
    speakAlert(
      handsFreeDescribe
        ? 'Hands-free commands enabled. Tap the voice bar, then say your command.'
        : 'Hands-free commands disabled.',
      ttsOpts()
    );
  }, [handsFreeDescribe]);

  /** TTS only when YOLO sees a validated obstacle (silent when path is clear). */
  const speakYoloDetection = useCallback((primaryOnly) => {
    if (!primaryOnly.length) {
      hadObstacleRef.current = false;
      lastTtsKeyRef.current = '';
      return;
    }

    const d0 = primaryOnly[0];
    if (!isValidNavDetection(d0)) return;

    const dist = Math.max(0.2, Math.round((d0.distance_m || 0) * 10) / 10);
    const obKey = `${d0.name}|${dist}`;

    const now = Date.now();
    if (obKey === lastTtsKeyRef.current && now - lastSpeakAtRef.current < SPEAK_MIN_GAP_MS) {
      return;
    }

    const label = englishLabelForClass(d0.name);
    const cx = ((d0.x1 ?? 0) + (d0.x2 ?? 1)) / 2;
    const side = cx < 1 / 3 ? 'on your left' : cx < 2 / 3 ? 'directly ahead' : 'on your right';
    const unit = dist === 1 ? 'meter' : 'meters';
    const msg = `${label.charAt(0).toUpperCase() + label.slice(1)} ${dist} ${unit} ${side}.`;

    lastTtsKeyRef.current = obKey;
    lastSpeakAtRef.current = now;
    hadObstacleRef.current = true;
    speakAlert(msg, { ...ttsOpts(), latest: true });
  }, [ttsOpts]);

  /** Groq speaks first; YOLO emergency/fallback only when Groq has no guidance. */
  const speakNavigationVoice = useCallback((groq, primaryOnly) => {
    const guidance =
      typeof groq?.guidance_en === 'string' ? groq.guidance_en.trim() : '';
    const risk = typeof groq?.risk === 'string' ? groq.risk.toLowerCase() : 'ok';
    const hasValidYolo = primaryOnly.some(isValidNavDetection);
    const now = Date.now();

    if (guidance) {
      if (
        risk === 'ok' &&
        /continue forward\.?$/i.test(guidance) &&
        !hasValidYolo
      ) {
        hadObstacleRef.current = false;
        lastTtsKeyRef.current = '';
        return;
      }

      const groqKey = `${risk}|${guidance.slice(0, 100)}`;
      if (
        groqKey === lastTtsKeyRef.current &&
        now - lastSpeakAtRef.current < SPEAK_MIN_GAP_MS
      ) {
        return;
      }

      lastTtsKeyRef.current = groqKey;
      lastSpeakAtRef.current = now;
      hadObstacleRef.current = true;
      speakAlert(guidance, {
        ...ttsOpts(),
        latest: true,
        interrupt: risk === 'danger' || risk === 'caution',
      });
      return;
    }

    const threshold = prefsRef.current.dangerThresholdM ?? DEFAULTS.dangerThresholdM;
    const closest = primaryOnly[0];
    if (
      closest &&
      isValidNavDetection(closest) &&
      closest.distance_m < threshold &&
      now - lastEmergencyAtRef.current >= 6000
    ) {
      lastEmergencyAtRef.current = now;
      const dist = Math.max(0.2, Math.round(closest.distance_m * 10) / 10);
      const label = englishLabelForClass(closest.name);
      const cx = ((closest.x1 ?? 0) + (closest.x2 ?? 1)) / 2;
      const side =
        cx < 1 / 3 ? 'on your left' : cx < 2 / 3 ? 'directly ahead' : 'on your right';
      const msg = `Stop. ${label.charAt(0).toUpperCase() + label.slice(1)} ${dist} meters ${side}.`;
      lastTtsKeyRef.current = `stop|${closest.name}|${dist}`;
      lastSpeakAtRef.current = now;
      speakAlert(msg, { ...ttsOpts(), pitch: 1.05, interrupt: true });
      return;
    }

    speakYoloDetection(primaryOnly);
  }, [speakYoloDetection, ttsOpts]);

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
      const prefs = prefsRef.current;
      const photo = await cameraRef.current.takePictureAsync({
        quality: prefs.lowLight ? 0.28 : 0.15,
        skipProcessing: true,
      });
      const po = predictOptsRef.current;
      const data = await predictNavigationFrame(api, photo.uri, {
        hfovDeg: po.hfovDeg,
        depthScale: po.depthScale,
      });

      const valid = (data.detections || []).filter(isValidNavDetection);
      const smoothed = smoothDetectionDistances(valid, smoothStateRef);
      const sorted = [...smoothed].sort(
        (a, b) => (a.distance_m ?? 99) - (b.distance_m ?? 99)
      );
      const primary = pickLockedPrimary(sorted, primaryLockRef);
      const primaryOnly = primary ? [primary] : [];
      const overlayDets = sorted.slice(0, 4);
      const outdoorN = sorted.filter((d) => d.model === 'outdoor').length;
      const indoorN = sorted.filter((d) => d.model === 'indoor').length;

      if (!aiTestRef.current) return;

      setDetections(overlayDets);
      setDetectionSummary({
        outdoor: outdoorN,
        indoor: indoorN,
        route: data?.yolo_route || 'fast',
      });
      setInferenceMs(data.inference_ms ?? null);
      setPipelineMs(data.pipeline_ms ?? null);
      setGroqMs(data.groq?.ms ?? null);
      if (data.pipeline_ms) {
        lastPipelineMsRef.current = data.pipeline_ms;
      }
      const ctx =
        (typeof data.groq?.guidance_en === 'string' && data.groq.guidance_en.trim()) ||
        (typeof data.groq?.scene === 'string' && data.groq.scene.trim()) ||
        null;
      setVoiceContextHint(ctx);
      setInferenceError(null);

      const threshold = prefs.dangerThresholdM ?? DEFAULTS.dangerThresholdM;
      if (!manualSuppressRef.current) {
        const threat = pickCloseThreat(smoothed, { dangerWithinMeters: threshold });
        if (threat) {
          setDangerPayload(threat);
          if (prefs.vibrationDanger && Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
              () => {}
            );
          }
        } else {
          setDangerPayload(null);
        }
      } else {
        const safe =
          primaryOnly.length === 0 ||
          (primaryOnly[0].distance_m ?? 99) > threshold + 0.35;
        if (safe) {
          manualSuppressRef.current = false;
          setDangerPayload(null);
        }
      }

      speakNavigationVoice(data.groq, primaryOnly);
    } catch (e) {
      if (aiTestRef.current) setInferenceError(e.message);
    } finally {
      inFlightRef.current = false;
    }
  }, [speakNavigationVoice]);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const scheduleNext = (delayMs) => {
      if (cancelled || !aiTestRef.current) return;
      timer = setTimeout(() => {
        void tick();
      }, delayMs);
    };

    const tick = async () => {
      if (cancelled || !aiTestRef.current) return;
      const t0 = Date.now();
      await runFrame();
      if (cancelled || !aiTestRef.current) return;
      const elapsed = Date.now() - t0;
      const targetGap = Math.max(
        aiFrameMs,
        Math.round(lastPipelineMsRef.current * 1.05)
      );
      const wait = Math.max(300, targetGap - elapsed);
      scheduleNext(wait);
    };

    if (aiTestEnabled) {
      smoothStateRef.current = {};
      lastTtsKeyRef.current = '';
      hadObstacleRef.current = false;
      primaryLockRef.current = null;
      lastEmergencyAtRef.current = 0;
      void tick();
    } else {
      Speech.stop();
      lastTtsKeyRef.current = '';
      smoothStateRef.current = {};
      setDetections([]);
      setDetectionSummary({ outdoor: 0, indoor: 0, route: 'fast' });
      setInferenceMs(null);
      setPipelineMs(null);
      setGroqMs(null);
      setVoiceContextHint(null);
      setInferenceError(null);
      setDangerPayload(null);
      manualSuppressRef.current = false;
    }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [aiTestEnabled, aiFrameMs, runFrame]);

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
              speakAlert(next ? 'Navigation activated.' : 'Navigation stopped.', ttsOpts());
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
              runDescribeInPlace();
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
          {isFocused ? (
            <CameraComponent
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              type={facing}
              ratio="16:9"
              flashMode={
                facing === CAMERA_TYPE.back && torch
                  ? FLASH_MODE.torch
                  : FLASH_MODE.off
              }
              onMountError={(e) =>
                setCamMountError(e?.message || 'Camera failed to start')
              }
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.cameraPaused]} />
          )}
          {voiceBannerText ? (
            <Pressable
              style={[
                styles.voiceListenBanner,
                (voiceStatus === 'denied' || voiceStatus === 'unavailable') &&
                  styles.voiceListenBannerWarn,
                voiceStatus === 'listening' && styles.voiceListenBannerActive,
              ]}
              onPress={voiceBannerTappable ? onVoiceBannerPress : undefined}
              disabled={!voiceBannerTappable}
              accessibilityRole="button"
              accessibilityLabel={
                voiceStatus === 'denied'
                  ? 'Open iPhone Settings to allow microphone and speech recognition'
                  : voiceBannerTappable
                    ? 'Start listening for voice command'
                    : voiceBannerText
              }
            >
              <MaterialCommunityIcons
                name={
                  voiceStatus === 'denied' || voiceStatus === 'unavailable'
                    ? 'microphone-off'
                    : voiceStatus === 'listening'
                      ? 'microphone'
                      : 'microphone-outline'
                }
                size={16}
                color={voiceStatus === 'denied' || voiceStatus === 'unavailable' ? '#FCA5A5' : '#A7F3D0'}
              />
              <Text
                style={[
                  styles.voiceListenBannerText,
                  (voiceStatus === 'denied' || voiceStatus === 'unavailable') &&
                    styles.voiceListenBannerTextWarn,
                ]}
              >
                {voiceBannerText}
              </Text>
            </Pressable>
          ) : null}
          {isFocused && isSimulator ? (
            <View style={styles.simBanner} pointerEvents="none">
              <Text style={styles.simBannerText}>
                Simulator: Features → Camera → pick a source (not None)
              </Text>
            </View>
          ) : null}
          {camMountError ? (
            <View style={styles.simBanner}>
              <Text style={styles.simBannerText}>{camMountError}</Text>
            </View>
          ) : null}
          <DetectionOverlay detections={detections} />
          {tapFlash ? <View style={styles.tapFlash} pointerEvents="none" /> : null}
        </Pressable>

        <Pressable
          style={styles.flipBtn}
          onPress={toggleFacing}
          accessibilityRole="button"
          accessibilityLabel="Switch front or back camera"
        >
          <MaterialCommunityIcons name="camera-flip-outline" size={22} color={colors.white} />
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
            color={colors.white}
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
                        } · ${detections[0].model === 'indoor' ? 'indoor' : detections[0].model === 'outdoor' ? 'outdoor' : 'yolo'}`
                      : 'Searching…'}
                  </Text>
                  {detections.length > 0 && formatMeters(detections[0].distance_m) ? (
                    <Text style={styles.sceneDistanceLine}>
                      Estimated distance (closest){' '}
                      <Text style={styles.sceneDistanceEm}>{formatMeters(detections[0].distance_m)}</Text>
                    </Text>
                  ) : null}
                  {voiceContextHint ? (
                    <>
                      <Text style={styles.cardSectionLabel}>Groq guidance</Text>
                      <Text style={styles.voiceContextHint}>{voiceContextHint}</Text>
                    </>
                  ) : null}
                  <Text style={styles.cardSectionLabel}>Pipeline</Text>
                  <Text style={styles.inferenceMeta}>
                    {Math.round(pipelineMs || 0)} ms total
                    {inferenceMs != null ? ` · YOLO ${Math.round(inferenceMs)} ms` : ''}
                    {groqMs != null && groqMs > 0 ? ` · Groq ${Math.round(groqMs)} ms` : ''}
                    {' · route '}
                    {detectionSummary.route}
                    {' · OUT '}
                    {detectionSummary.outdoor}
                    {' · IN '}
                    {detectionSummary.indoor}
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
                Tap AI test to start obstacle detection. Tap Sound when you want a spoken scene
                description — you stay on this camera view.
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
            runDescribeInPlace();
          }}
          onLongPress={() => {
            if (Platform.OS !== 'web') {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            }
            setVolumeOpen(true);
          }}
          delayLongPress={3000}
          accessibilityRole="button"
          accessibilityLabel="Scene description — speak summary from live camera"
          accessibilityHint="Reads a Groq scene description without leaving navigation. Press and hold for alert volume."
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
        alertMessage={dangerPayload?.alertMessage}
        onBack={onDangerBack}
      />
    </View>
  );
}

function createMainNavStyles(colors) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, height: 60 },
  time: { color: colors.topBarText, fontSize: 18, fontWeight: '700', letterSpacing: -0.5 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  livePill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.danger },
  liveText: { color: colors.overlayIcon, fontSize: 11, fontWeight: '800' },
  aiPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, gap: 6, borderWidth: 1, borderColor: 'rgba(20,184,166,0.3)' },
  aiPillOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  aiPillText: { color: colors.teal, fontSize: 12, fontWeight: '700' },
  aiPillTextOn: { color: colors.btnText },
  aiPillPressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  visionArea: { flex: 1, marginHorizontal: 15, marginVertical: 10, borderRadius: 30, overflow: 'hidden', backgroundColor: '#111' },
  cameraTouchable: { flex: 1 },
  cameraPaused: { backgroundColor: '#111' },
  voiceListenBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(6,78,59,0.92)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.55)',
    zIndex: 26,
  },
  voiceListenBannerWarn: {
    backgroundColor: 'rgba(127,29,29,0.92)',
    borderColor: 'rgba(248,113,113,0.55)',
  },
  voiceListenBannerActive: {
    backgroundColor: 'rgba(6,95,70,0.95)',
    borderColor: 'rgba(52,211,153,0.75)',
  },
  voiceListenBannerText: {
    flex: 1,
    color: '#A7F3D0',
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONTS.en.semibold,
  },
  voiceListenBannerTextWarn: {
    color: '#FECACA',
  },
  simBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: 'rgba(15,23,42,0.9)',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(20,184,166,0.5)',
    zIndex: 25,
  },
  simBannerText: {
    color: colors.tealBright,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    fontFamily: FONTS.en.regular,
  },
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
  allowBtnText: { color: colors.btnText, fontWeight: 'bold' }
});
}
