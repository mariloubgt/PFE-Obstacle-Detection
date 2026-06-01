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
import {
  predictNavigationYolo,
  predictNavigationGroq,
} from '../services/predict';
import { useThemeColors } from '../contexts/ThemeContext';
import { FONTS } from '../constants/typography';
import { loadInferenceApiUrl } from '../utils/inferenceApiUrl';
import { saveAlertVolume, syncStoredAlertVolumeToSystem } from '../utils/alertVolumeStorage';
import { applyAlertVolumeToSystemOutput } from '../utils/systemOutputVolume';
import { buildTtsOptions } from '../utils/buildTtsOptions';
import { speakAlert, prepareSpeechAudio, isSpeechActive } from '../utils/speakAlert';
import { smoothDetectionDistances } from '../utils/smoothDetectionDistances';
import { pickCloseThreat } from '../utils/evaluateCloseThreat';
import {
  rankNavDetections,
  pickNavPrimary,
  confirmPersonThreat,
  normNavClass,
} from '../utils/navDetectionRanking';
import { isSimulatorDevice } from '../utils/isSimulator';
import { DEFAULTS, loadAppPreferences } from '../utils/appSettings';
import { getPredictOptionsForRequest } from '../utils/aiLabSettings';
import { useVolumeHardwareShortcut } from '../hooks/useVolumeHardwareShortcut';
import { useDetectionStopVoice } from '../hooks/useDetectionStopVoice';
import { useMainNavigationVoice } from '../hooks/useMainNavigationVoice';

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
  exit: 'an exit',
  fireextinguisher: 'a fire extinguisher',
  fire_extinguisher: 'a fire extinguisher',
  printer: 'a printer',
  screen: 'a screen',
  trashbin: 'a trash bin',
  clock: 'a clock',
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

const SPEAK_MIN_GAP_MS = 1200;
const NAV_MIN_CONF = 0.35;
const NAV_PERSON_MIN_CONF = 0.55;
const NAV_SPEAK_MAX_M = 6.0;
const NAV_VALID_MAX_M = 8.0;

function isValidNavDetection(d) {
  const dist = d?.distance_m;
  if (typeof dist !== 'number' || !Number.isFinite(dist)) return false;
  if (dist <= 0.12 || dist >= NAV_VALID_MAX_M) return false;
  const conf = d?.confidence ?? 0;
  const cls = normNavClass(d.name);
  if (cls === 'person' && conf < NAV_PERSON_MIN_CONF) return false;
  if (cls !== 'person' && conf < NAV_MIN_CONF) return false;
  const w = (d.x2 || 0) - (d.x1 || 0);
  const h = (d.y2 || 0) - (d.y1 || 0);
  if (w * h < 0.002 && conf < 0.45) return false;
  return true;
}

function sortByDistance(list) {
  return [...list].sort((a, b) => (a.distance_m ?? 99) - (b.distance_m ?? 99));
}

function formatMeters(m) {
  if (m == null || !Number.isFinite(m)) return null;
  return `${Number(m).toFixed(1)} m`;
}

export default function MainNavigationScreen({ navigation, route }) {
  const isFocused = useIsFocused();
  const isFocusedRef = useRef(isFocused);
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
  const [alertVolume, setAlertVolume] = useState(1);
  const [dangerPayload, setDangerPayload] = useState(null);
  const [volumeHardwareAction, setVolumeHardwareAction] = useState(
    DEFAULTS.volumeHardwareAction
  );
  const [handsFreeVoice, setHandsFreeVoice] = useState(DEFAULTS.handsFreeDescribe);
  const [mainVoiceStatus, setMainVoiceStatus] = useState('off');
  const [camMountError, setCamMountError] = useState(null);
  const isSimulator = isSimulatorDevice();

  useEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);

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
  const personThreatRef = useRef(null);
  const lastTtsKeyRef = useRef('');
  const lastSpeakAtRef = useRef(0);
  const hadObstacleRef = useRef(false);
  /** Lock TTS + overlay on one obstacle until another is clearly closer */
  const primaryLockRef = useRef(null);
  const lastPipelineMsRef = useRef(1500);
  const apiUrlRef = useRef(null);
  const groqInFlightRef = useRef(false);
  const groqSeqRef = useRef(0);
  const latestPrimaryRef = useRef([]);
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
      setHandsFreeVoice(p.handsFreeDescribe);
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
      if (route.params?.enableObstacle) {
        setAiTestEnabled(true);
        speakAlert('Obstacle detection on.', ttsOpts());
        navigation.setParams({ enableObstacle: undefined });
      }
    }, [refreshPredictOpts, route.params?.enableObstacle, navigation, ttsOpts])
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
    if (aiTestEnabled) {
      void prepareSpeechAudio(true);
    }
  }, [aiTestEnabled]);

  const openSceneChat = useCallback(
    (autoDescribe = false) => {
      inFlightRef.current = false;
      groqInFlightRef.current = false;
      navigation.navigate('SceneQuery', autoDescribe ? { autoDescribe: true } : undefined);
    },
    [navigation]
  );

  const setDetectionEnabled = useCallback(
    (on) => {
      setAiTestEnabled(on);
      aiTestRef.current = on;
      speakAlert(
        on
          ? 'Obstacle detection on. Say stop or double-tap the screen to stop.'
          : 'Obstacle detection off.',
        { ...ttsOpts(), interrupt: true }
      );
    },
    [ttsOpts]
  );

  useMainNavigationVoice({
    enabled: handsFreeVoice && isFocused && !aiTestEnabled,
    autoListen: true,
    getTtsOpts: ttsOpts,
    onOpenSceneChat: () => openSceneChat(false),
    onOpenSceneDescribe: () => openSceneChat(true),
    onStartDetection: () => setDetectionEnabled(true),
    onStopDetection: () => setDetectionEnabled(false),
    onVoiceStatusChange: setMainVoiceStatus,
  });

  useDetectionStopVoice({
    enabled: handsFreeVoice && isFocused && aiTestEnabled,
    captureBusyRef: inFlightRef,
    onStopDetection: () => setDetectionEnabled(false),
    onVoiceStatusChange: setMainVoiceStatus,
  });

  useVolumeHardwareShortcut(navigation, {
    enabled: !volumeOpen,
    action: volumeHardwareAction === 'none' ? 'none' : 'scene_query',
    onDescribeEnvironment: () => {
      openSceneChat(volumeHardwareAction === 'describe');
    },
  });

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
    const prevClass = (lastTtsKeyRef.current || '').split('|')[0];
    const classChanged = prevClass && prevClass !== String(d0.name);
    if (
      !classChanged &&
      obKey === lastTtsKeyRef.current &&
      now - lastSpeakAtRef.current < SPEAK_MIN_GAP_MS
    ) {
      return;
    }
    if ((d0.distance_m ?? 99) > NAV_SPEAK_MAX_M) return;

    const label = englishLabelForClass(d0.name);
    const cx = ((d0.x1 ?? 0) + (d0.x2 ?? 1)) / 2;
    const side = cx < 1 / 3 ? 'on your left' : cx < 2 / 3 ? 'directly ahead' : 'on your right';
    const unit = dist === 1 ? 'meter' : 'meters';
    const msg = `${label.charAt(0).toUpperCase() + label.slice(1)} ${dist} ${unit} ${side}.`;

    lastTtsKeyRef.current = obKey;
    lastSpeakAtRef.current = now;
    hadObstacleRef.current = true;
    speakAlert(msg, { ...ttsOpts(), interrupt: true });
  }, [ttsOpts]);

  /**
   * Groq + YOLO: instant YOLO stop when very close; Groq guidance for richer detection;
   * YOLO speech if Groq unavailable.
   */
  const speakNavigationVoice = useCallback((groq, primaryOnly, opts = {}) => {
    const yoloOnly = opts.yoloOnly === true;
    const guidance =
      typeof groq?.guidance_en === 'string' ? groq.guidance_en.trim() : '';
    const risk = typeof groq?.risk === 'string' ? groq.risk.toLowerCase() : 'ok';
    const hasValidYolo = primaryOnly.some(isValidNavDetection);
    const now = Date.now();
    const urgent = risk === 'danger' || risk === 'caution';
    const threshold = prefsRef.current.dangerThresholdM ?? DEFAULTS.dangerThresholdM;
    const closest = primaryOnly[0];

    if (
      closest &&
      isValidNavDetection(closest) &&
      (closest.distance_m ?? 99) < threshold &&
      now - lastEmergencyAtRef.current >= 3000
    ) {
      lastEmergencyAtRef.current = now;
      const distR = Math.max(0.2, Math.round((closest.distance_m || 0) * 10) / 10);
      const label = englishLabelForClass(closest.name);
      const cx = ((closest.x1 ?? 0) + (closest.x2 ?? 1)) / 2;
      const side =
        cx < 1 / 3 ? 'on your left' : cx < 2 / 3 ? 'directly ahead' : 'on your right';
      const msg = `Stop. ${label.charAt(0).toUpperCase() + label.slice(1)} ${distR} meters ${side}.`;
      lastTtsKeyRef.current = `stop|${closest.name}|${distR}`;
      lastSpeakAtRef.current = now;
      speakAlert(msg, { ...ttsOpts(), interrupt: true });
      return;
    }

    if (yoloOnly) {
      return;
    }

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

      const groqKey = `${risk}|${guidance.slice(0, 120)}`;
      if (
        groqKey === lastTtsKeyRef.current &&
        now - lastSpeakAtRef.current < SPEAK_MIN_GAP_MS
      ) {
        return;
      }

      if (isSpeechActive() && !urgent) {
        return;
      }

      lastTtsKeyRef.current = groqKey;
      lastSpeakAtRef.current = now;
      hadObstacleRef.current = true;
      speakAlert(guidance, {
        ...ttsOpts(),
        interrupt: urgent,
      });
      return;
    }

    if (!primaryOnly.length) {
      hadObstacleRef.current = false;
      lastTtsKeyRef.current = '';
      return;
    }

    speakYoloDetection(primaryOnly);
  }, [speakYoloDetection, ttsOpts]);

  const lastCameraTapAtRef = useRef(0);

  const onCameraTap = useCallback(() => {
    const now = Date.now();
    if (now - lastCameraTapAtRef.current < 500) {
      lastCameraTapAtRef.current = 0;
      if (aiTestEnabled) {
        if (Platform.OS !== 'web') {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        setDetectionEnabled(false);
        return;
      }
    }
    lastCameraTapAtRef.current = now;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    setTapFlash(true);
    setTimeout(() => setTapFlash(false), 280);
  }, [aiTestEnabled, setDetectionEnabled]);

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
      !isFocusedRef.current ||
      !cameraRef.current ||
      inFlightRef.current
    )
      return;
    inFlightRef.current = true;
    try {
      let api = apiUrlRef.current;
      if (!api) {
        api = await loadInferenceApiUrl();
        apiUrlRef.current = api;
      }
      if (!api || !isFocusedRef.current) return;
      const prefs = prefsRef.current;
      let photo;
      try {
        photo = await cameraRef.current.takePictureAsync({
          quality: prefs.lowLight ? 0.4 : 0.35,
          skipProcessing: true,
        });
      } catch (camErr) {
        if (__DEV__) console.warn('[runFrame] camera capture failed', camErr);
        return;
      }
      if (!photo?.uri || !isFocusedRef.current) return;
      const po = predictOptsRef.current;
      const navOpts = {
        hfovDeg: po.hfovDeg,
        depthScale: po.depthScale,
        yoloProfile: prefs.yoloProfile || 'auto',
      };

      const data = await predictNavigationYolo(api, photo.uri, navOpts);

      const valid = (data.detections || []).filter(isValidNavDetection);
      const instantRanked = rankNavDetections(sortByDistance(valid), isValidNavDetection);
      const smoothed = smoothDetectionDistances(valid, smoothStateRef);
      const smoothedRanked = rankNavDetections(sortByDistance(smoothed), isValidNavDetection);
      const primary = pickNavPrimary(smoothedRanked, primaryLockRef);
      const primaryOnly = primary ? [primary] : [];
      latestPrimaryRef.current = primaryOnly;
      const sorted = smoothedRanked;
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
      lastPipelineMsRef.current = data.inference_ms || 450;
      const ctx =
        (typeof data.groq?.guidance_en === 'string' && data.groq.guidance_en.trim()) ||
        (typeof data.groq?.scene === 'string' && data.groq.scene.trim()) ||
        null;
      setVoiceContextHint(ctx);
      setInferenceError(null);

      const threshold = prefs.dangerThresholdM ?? DEFAULTS.dangerThresholdM;
      if (!manualSuppressRef.current) {
        let rawThreat = pickCloseThreat(instantRanked, { dangerWithinMeters: threshold });
        rawThreat = confirmPersonThreat(rawThreat, personThreatRef);
        const groqRisk = (data.groq?.risk || '').toLowerCase();
        const groqGuide =
          typeof data.groq?.guidance_en === 'string' ? data.groq.guidance_en.trim() : '';
        if (
          !rawThreat &&
          groqRisk === 'danger' &&
          groqGuide &&
          !data.groq?.error?.includes('Cached')
        ) {
          rawThreat = {
            id: `groq-${Date.now()}`,
            displayLabel: 'OBSTACLE',
            distanceM: threshold,
            alertMessage: groqGuide,
            className: data.groq?.focus || 'obstacle',
          };
        }
        const threat = rawThreat;
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

      speakNavigationVoice(null, primaryOnly, { yoloOnly: true });

      if (po.useGroq !== false) {
        const seq = groqSeqRef.current + 1;
        groqSeqRef.current = seq;
        void (async () => {
          groqInFlightRef.current = true;
          try {
            const groqData = await predictNavigationGroq(
              api,
              photo.uri,
              data.detections,
              navOpts
            );
            if (!aiTestRef.current || seq !== groqSeqRef.current) return;
            setGroqMs(groqData.groq?.ms ?? null);
            const gCtx =
              (typeof groqData.groq?.guidance_en === 'string' &&
                groqData.groq.guidance_en.trim()) ||
              (typeof groqData.groq?.scene === 'string' && groqData.groq.scene.trim()) ||
              null;
            if (gCtx) setVoiceContextHint(gCtx);

            const groqRisk = (groqData.groq?.risk || '').toLowerCase();
            const groqGuide =
              typeof groqData.groq?.guidance_en === 'string'
                ? groqData.groq.guidance_en.trim()
                : '';
            if (
              !manualSuppressRef.current &&
              groqRisk === 'danger' &&
              groqGuide &&
              !groqData.groq?.error?.includes('Cached')
            ) {
              setDangerPayload({
                id: `groq-${Date.now()}`,
                displayLabel: 'OBSTACLE',
                distanceM: threshold,
                alertMessage: groqGuide,
                className: groqData.groq?.focus || 'obstacle',
              });
            }

            speakNavigationVoice(groqData.groq, latestPrimaryRef.current);
          } catch {
            speakNavigationVoice(null, latestPrimaryRef.current);
          } finally {
            groqInFlightRef.current = false;
          }
        })();
      } else {
        speakNavigationVoice(null, primaryOnly);
      }
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
      if (cancelled || !aiTestRef.current || !isFocusedRef.current) return;
      timer = setTimeout(() => {
        void tick();
      }, delayMs);
    };

    const tick = async () => {
      if (cancelled || !aiTestRef.current || !isFocusedRef.current) return;
      const t0 = Date.now();
      await runFrame();
      if (cancelled || !aiTestRef.current || !isFocusedRef.current) return;
      const elapsed = Date.now() - t0;
      const inferMs = lastPipelineMsRef.current
        ? Math.min(lastPipelineMsRef.current, 2500)
        : aiFrameMs;
      const targetGap = Math.max(aiFrameMs, Math.round(inferMs + 100));
      const wait = Math.max(120, targetGap - elapsed);
      scheduleNext(wait);
    };

    if (aiTestEnabled && isFocused) {
      void loadInferenceApiUrl().then((u) => {
        apiUrlRef.current = u;
      });
      smoothStateRef.current = {};
      personThreatRef.current = null;
      groqSeqRef.current = 0;
      lastTtsKeyRef.current = '';
      hadObstacleRef.current = false;
      primaryLockRef.current = null;
      lastEmergencyAtRef.current = 0;
      void tick();
    } else {
      Speech.stop();
      lastTtsKeyRef.current = '';
      smoothStateRef.current = {};
      personThreatRef.current = null;
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
  }, [aiTestEnabled, isFocused, aiFrameMs, runFrame]);

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
              setDetectionEnabled(!aiTestEnabled);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: aiTestEnabled }}
            accessibilityLabel={
              aiTestEnabled
                ? 'Obstacle detection active — tap to stop'
                : 'Obstacle detection off — tap to start'
            }
            accessibilityHint={
              aiTestEnabled
                ? 'Stops obstacle detection. You can also say stop or double-tap the screen.'
                : 'Starts YOLO obstacle detection on the live camera.'
            }
          >
            <MaterialCommunityIcons name="radar" size={15} color={aiTestEnabled ? colors.btnText : colors.teal} />
            <Text style={[styles.aiPillText, aiTestEnabled && styles.aiPillTextOn]}>Obstacle D</Text>
          </Pressable>
          {handsFreeVoice &&
          (mainVoiceStatus === 'listening' ||
            mainVoiceStatus === 'ready' ||
            mainVoiceStatus === 'starting') ? (
            <View style={styles.voicePill} accessibilityLabel={`Voice ${mainVoiceStatus}`}>
              <MaterialCommunityIcons
                name={mainVoiceStatus === 'listening' ? 'microphone' : 'microphone-outline'}
                size={12}
                color={colors.tealBright}
              />
              <Text style={styles.voicePillText}>
                {mainVoiceStatus === 'listening'
                  ? aiTestEnabled
                    ? 'Say stop'
                    : 'Listening'
                  : aiTestEnabled
                    ? 'Say stop'
                    : 'Voice on'}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* VISION AREA — flip / torch restored for front camera */}
      <View style={styles.visionArea}>
        <Pressable
          style={styles.cameraTouchable}
          onPress={onCameraTap}
          accessibilityRole="button"
          accessibilityLabel="Camera preview"
          accessibilityHint={
            aiTestEnabled
              ? 'Double tap anywhere to stop obstacle detection. Single tap for haptic feedback.'
              : 'Live camera for navigation.'
          }
        >
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
          name={aiTestEnabled ? 'radar' : 'alert-circle-outline'}
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
              <Text style={styles.alertTitle}>Obstacle detection off</Text>
              <Text style={styles.alertSub}>
                Say detection to start. While active: say stop or double-tap the screen to stop.
                Scene chat: say describe or scene chat. Volume buttons open scene description.
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
          onPress={() => setVolumeOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Alert volume"
          accessibilityHint="Adjust spoken alert loudness for obstacle warnings."
        >
          <MaterialCommunityIcons name="volume-high" size={26} color={colors.tealBright} />
          <Text style={styles.navLabel}>Volume</Text>
        </Pressable>

        <Pressable
          style={styles.centerFab}
          onPress={() => openSceneChat(false)}
          accessibilityRole="button"
          accessibilityLabel="Scene chat"
          accessibilityHint="Scene description chat — describe and voice commands live here only."
        >
          <MaterialCommunityIcons name="message-text-outline" size={28} color={colors.btnText} />
        </Pressable>

        <Pressable
          style={styles.navItem}
          onPress={() => navigation.navigate('Settings')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          accessibilityHint="App preferences and inference server URL."
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
  voicePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(20,184,166,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.35)',
  },
  voicePillText: { color: colors.tealBright, fontSize: 10, fontWeight: '700' },
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
