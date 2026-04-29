import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
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
import { predictImage } from '../services/predict';
import { COLORS } from '../constants/theme';
import { FONTS } from '../constants/typography';
import { loadInferenceApiUrl } from '../utils/inferenceApiUrl';
import { loadAlertVolume, saveAlertVolume } from '../utils/alertVolumeStorage';
import { smoothDetectionDistances } from '../utils/smoothDetectionDistances';
import { loadAppPreferences } from '../utils/appSettings';
import { useDescribeEnvironmentHotword } from '../hooks/useDescribeEnvironmentHotword';

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

const FRAME_MS = 650;
const SPEAK_MIN_GAP_MS = 2600;
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

export default function MainNavigationScreen({ navigation }) {
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const [facing, setFacing] = useState('back');
  const [torch, setTorch] = useState(false);
  const [tapFlash, setTapFlash] = useState(false);

  // UI States
  const [clock, setClock] = useState('00:00');
  const [aiTestEnabled, setAiTestEnabled] = useState(false);
  const [detections, setDetections] = useState([]);
  const [inferenceMs, setInferenceMs] = useState(null);
  const [pipelineMs, setPipelineMs] = useState(null);
  /** English context for UI + voice (Gemini focus or scene label). */
  const [voiceContextHint, setVoiceContextHint] = useState(null);
  const [inferenceError, setInferenceError] = useState(null);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [alertVolume, setAlertVolume] = useState(0.8);
  const [dangerPayload, setDangerPayload] = useState(null);
  /** Hands-free: say "describe environment" on main screen (dev build + permissions). */
  const [listenCommands, setListenCommands] = useState(false);

  const inFlightRef = useRef(false);
  const aiTestRef = useRef(false);
  const smoothStateRef = useRef({});
  const lastTtsKeyRef = useRef('');
  const lastSpeakAtRef = useRef(0);
  const lastSpokenSceneTextRef = useRef('');
  const lastSceneSpeakAtRef = useRef(0);
  /** Lock TTS + overlay on one obstacle until another is clearly closer */
  const primaryLockRef = useRef(null);
  const manualSuppressRef = useRef(false);
  const alertVolumeRef = useRef(alertVolume);
  const predictOptsRef = useRef({
    hfovDeg: 56,
    depthScale: 1,
    useGemini: false,
  });

  const refreshPredictOpts = useCallback(() => {
    void loadAppPreferences().then((p) => {
      predictOptsRef.current = {
        hfovDeg: p.cameraHfovDeg,
        depthScale: p.depthScale,
        useGemini: p.internetGemini,
      };
    });
  }, []);

  useEffect(() => {
    refreshPredictOpts();
  }, [refreshPredictOpts]);

  useFocusEffect(
    useCallback(() => {
      refreshPredictOpts();
    }, [refreshPredictOpts])
  );

  // --- Clock ---
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  // --- Volume ---
  useEffect(() => {
    loadAlertVolume().then(v => { if (v != null) setAlertVolume(v); });
  }, []);

  useEffect(() => {
    alertVolumeRef.current = alertVolume;
  }, [alertVolume]);

  const persistVolume = (v) => {
    setAlertVolume(v);
    void saveAlertVolume(v);
  };

  useEffect(() => {
    aiTestRef.current = aiTestEnabled;
  }, [aiTestEnabled]);

  const onDescribeEnvironmentCommand = useCallback(async () => {
    const api = await loadInferenceApiUrl();
    if (!api) {
      Speech.stop();
      Speech.speak('Set the inference server address in Settings.', {
        language: 'en-US',
        rate: 0.92,
      });
      return;
    }
    if (!cameraRef.current) return;

    for (let i = 0; i < 40 && inFlightRef.current; i++) {
      await new Promise((r) => setTimeout(r, 80));
    }
    if (inFlightRef.current) return;

    const po = predictOptsRef.current;
    if (!po.useGemini) {
      Speech.stop();
      Speech.speak('Enable Internet and Gemini in Settings for environment description.', {
        language: 'en-US',
        rate: 0.92,
      });
      return;
    }

    inFlightRef.current = true;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.28,
        skipProcessing: true,
      });
      const data = await predictImage(api, photo.uri, {
        hfovDeg: po.hfovDeg,
        depthScale: po.depthScale,
        useGemini: true,
        detailed: true,
      });
      const darija = typeof data?.gemini?.darija === 'string' ? data.gemini.darija.trim() : '';
      const gemErr = data?.gemini?.error;
      const toSpeak = darija
        || (gemErr ? `Could not describe the scene. ${gemErr}` : 'No description available.');
      Speech.stop();
      const isArabic = /[\u0600-\u06FF]/.test(toSpeak);
      const vol = alertVolumeRef.current;
      Speech.speak(toSpeak, {
        language: isArabic ? 'ar-SA' : 'en-US',
        rate: 0.92,
        ...(Platform.OS === 'ios' && {
          volume: Math.min(1, Math.max(0.15, vol)),
        }),
      });
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useDescribeEnvironmentHotword({
    enabled: listenCommands,
    isFocused,
    onPhraseMatched: onDescribeEnvironmentCommand,
  });

  /** TTS: English — scene from Gemini `focus` or ImageNet label; obstacle in plain English. */
  const speakEnglishNav = useCallback((data, smoothedDets) => {
    if (!smoothedDets.length) return;
    const now = Date.now();

    const sorted = [...smoothedDets].sort(
      (a, b) => (a.distance_m ?? 99) - (b.distance_m ?? 99)
    );
    const d0 = sorted[0];
    const dist = Math.round((d0.distance_m || 0) * 2) / 2;
    const label = englishLabelForClass(d0.name);
    const labelSent =
      label.charAt(0).toUpperCase() + label.slice(1);
    const unit = dist === 1 ? 'meter' : 'meters';

    const focus =
      typeof data?.gemini?.focus === 'string' && data.gemini.focus.trim()
        ? data.gemini.focus.trim()
        : null;
    const sceneLabel =
      typeof data?.scene?.top5?.[0]?.label === 'string' &&
      data.scene.top5[0].label.trim()
        ? data.scene.top5[0].label.trim()
        : null;
    const sceneRaw = focus || sceneLabel;
    const sceneEnglish = clipSceneForSpeech(sceneRaw);

    const obstaclePart = `${labelSent} at ${dist} ${unit}.`;
    const msg = obstaclePart;

    if (now - lastSpeakAtRef.current < SPEAK_MIN_GAP_MS) return;

    const obKey = `${label}|${dist}`;
    if (obKey === lastTtsKeyRef.current) return;
    
    lastTtsKeyRef.current = obKey;
    lastSpeakAtRef.current = now;
    Speech.stop();
    const vol = alertVolumeRef.current;
    Speech.speak(msg, {
      language: 'en-US',
      rate: 0.9,
      pitch: 1.0,
      ...(Platform.OS === 'ios' && {
        volume: Math.min(1, Math.max(0.15, vol)),
      }),
    });
  }, []);

  const onCameraTap = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    setTapFlash(true);
    setTimeout(() => setTapFlash(false), 280);
  }, []);

  const toggleFacing = useCallback(() => {
    setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
    setTorch(false);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  }, []);

  // --- AI Loop (non-overlapping frames + smoothed distances) ---
  const runFrame = useCallback(async () => {
    if (!aiTestRef.current || !cameraRef.current || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const api = await loadInferenceApiUrl();
      if (!api) return;
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.22,
        skipProcessing: true,
      });
      const po = predictOptsRef.current;
      const data = await predictImage(api, photo.uri, {
        hfovDeg: po.hfovDeg,
        depthScale: po.depthScale,
        useGemini: po.useGemini,
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
      speakEnglishNav(data, primaryOnly);
    } catch (e) {
      if (aiTestRef.current) setInferenceError(e.message);
    } finally {
      inFlightRef.current = false;
    }
  }, [speakEnglishNav]);

  useEffect(() => {
    let interval = null;
    if (aiTestEnabled) {
      smoothStateRef.current = {};
      lastTtsKeyRef.current = '';
      lastSpokenSceneTextRef.current = '';
      lastSceneSpeakAtRef.current = 0;
      primaryLockRef.current = null;
      runFrame();
      interval = setInterval(runFrame, FRAME_MS);
    } else {
      Speech.stop();
      lastTtsKeyRef.current = '';
      smoothStateRef.current = {};
      setDetections([]);
      setInferenceMs(null);
      setVoiceContextHint(null);
      setInferenceError(null);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [aiTestEnabled, runFrame]);

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
            <MaterialCommunityIcons name="camera-off-outline" size={48} color={COLORS.grey} />
            <Text style={styles.placeholderTitle}>Camera access required</Text>
            <TouchableOpacity style={styles.allowBtn} onPress={requestPermission}>
                <Text style={styles.allowBtnText}>Allow Camera</Text>
            </TouchableOpacity>
        </View>
      );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* TOP NAVIGATION BAR */}
      <View style={styles.topBar}>
        <Pressable onPress={handleGoBack} style={styles.topIcon}>
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
            onPress={() => setAiTestEnabled(!aiTestEnabled)}
          >
            <MaterialCommunityIcons name="brain" size={15} color={aiTestEnabled ? COLORS.btnText : COLORS.teal} />
            <Text style={[styles.aiPillText, aiTestEnabled && styles.aiPillTextOn]}>AI test</Text>
          </Pressable>
          <Pressable
            style={[styles.aiPill, listenCommands && styles.aiPillOn]}
            onPress={() => setListenCommands(!listenCommands)}
            accessibilityRole="button"
            accessibilityLabel={
              listenCommands
                ? 'Stop listening for describe environment'
                : 'Listen for describe environment command'
            }
          >
            <MaterialCommunityIcons
              name="microphone-message"
              size={15}
              color={listenCommands ? COLORS.btnText : COLORS.teal}
            />
            <Text style={[styles.aiPillText, listenCommands && styles.aiPillTextOn]}>Voice</Text>
          </Pressable>
        </View>
      </View>

      {/* VISION AREA — flip / torch restored for front camera */}
      <View style={styles.visionArea}>
        <Pressable style={styles.cameraTouchable} onPress={onCameraTap}>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            enableTorch={facing === 'back' && torch}
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
          <MaterialCommunityIcons name="camera-flip-outline" size={22} color={COLORS.white} />
        </Pressable>

        <Pressable
          style={styles.torchBtn}
          onPress={() => {
            if (facing !== 'back') {
              setFacing('back');
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
            color={COLORS.white}
          />
        </Pressable>
      </View>

      <LinearGradient colors={['#DC2626', '#EA580C', '#EAB308', '#22C55E']} start={{x:0,y:0}} end={{x:1,y:0}} style={styles.riskStrip} />

      {/* ALERT CARD — closest obstacle, scene/context (Gemini / scene model), pipeline stats */}
      <View style={styles.alertCard}>
        <MaterialCommunityIcons
          name={aiTestEnabled ? 'brain' : 'alert-circle-outline'}
          size={22}
          color={aiTestEnabled ? COLORS.teal : COLORS.grey}
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
              <Text style={styles.alertSub}>Enable "AI Test" to start detection</Text>
              {listenCommands ? (
                <Text style={styles.voiceHint}>
                  Voice is on — say &quot;describe environment&quot; (English) for a spoken scene summary. Use a development build after installing native speech support.
                </Text>
              ) : null}
            </>
          )}
        </View>
      </View>

      {/* BOTTOM NAV */}
      <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 15) }]}>
        <Pressable style={styles.navItem} onPress={() => setVolumeOpen(true)}>
          <MaterialCommunityIcons name="volume-high" size={26} color={COLORS.tealBright} />
          <Text style={styles.navLabel}>Volume</Text>
        </Pressable>

        <Pressable style={styles.centerFab} onPress={() => navigation.navigate('SceneQuery')}>
          <MaterialCommunityIcons name="chart-box-outline" size={30} color={COLORS.btnText} />
        </Pressable>

        <Pressable style={styles.navItem} onPress={() => navigation.navigate('Settings')}>
          <MaterialCommunityIcons name="cog-outline" size={26} color={COLORS.tealBright} />
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
               onValueChange={persistVolume} 
               minimumTrackTintColor={COLORS.teal}
               maximumTrackTintColor={COLORS.borderMuted}
            />
            <TouchableOpacity style={styles.modalDone} onPress={() => setVolumeOpen(false)}>
              <Text style={styles.modalDoneText}>DONE</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <DangerAlertModal visible={!!dangerPayload} onBack={onDangerBack} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, height: 60 },
  time: { color: 'white', fontSize: 18, fontWeight: '700', letterSpacing: -0.5 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  livePill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#EF4444' },
  liveText: { color: 'white', fontSize: 11, fontWeight: '800' },
  aiPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, gap: 6, borderWidth: 1, borderColor: 'rgba(20,184,166,0.3)' },
  aiPillOn: { backgroundColor: COLORS.teal, borderColor: COLORS.teal },
  aiPillText: { color: COLORS.teal, fontSize: 12, fontWeight: '700' },
  aiPillTextOn: { color: COLORS.btnText },
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
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 24,
    alignItems: 'flex-start',
    gap: 15,
  },
  alertCardIcon: { marginTop: 2 },
  cardSectionLabel: {
    color: COLORS.grey,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 10,
    marginBottom: 2,
    fontFamily: FONTS.en.semibold,
  },
  cardSectionLabelFirst: { marginTop: 0 },
  alertTitle: { color: 'white', fontSize: 17, fontWeight: '700' },
  alertSub: { color: COLORS.grey, fontSize: 13 },
  voiceHint: { color: COLORS.tealBright, fontSize: 12, marginTop: 10, lineHeight: 18 },
  voiceContextHint: {
    color: COLORS.tealBright,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
    lineHeight: 20,
    fontFamily: FONTS.en.regular,
  },
  sceneDistanceLine: {
    color: COLORS.white,
    fontSize: 13,
    marginTop: 8,
    fontFamily: FONTS.en.medium,
  },
  sceneDistanceEm: {
    color: COLORS.tealBright,
    fontWeight: '800',
    fontFamily: FONTS.en.extrabold,
  },
  inferenceMeta: { color: COLORS.grey, fontSize: 11, marginTop: 2, lineHeight: 16 },
  inferenceErr: { color: COLORS.danger, fontSize: 12 },
  bottomNav: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.95)', paddingVertical: 10, borderTopLeftRadius: 30, borderTopRightRadius: 30 },
  navItem: { alignItems: 'center', gap: 4 },
  navLabel: { color: COLORS.grey, fontSize: 10, fontWeight: '600' },
  centerFab: { width: 64, height: 64, borderRadius: 32, backgroundColor: COLORS.teal, justifyContent: 'center', alignItems: 'center', elevation: 8, shadowColor: COLORS.teal, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '80%', backgroundColor: '#1E293B', padding: 25, borderRadius: 30, alignItems: 'center' },
  modalTitle: { color: 'white', fontSize: 20, fontWeight: 'bold', marginBottom: 20 },
  modalDone: { marginTop: 20, backgroundColor: COLORS.teal, paddingHorizontal: 30, paddingVertical: 12, borderRadius: 15 },
  modalDoneText: { color: COLORS.btnText, fontWeight: 'bold' },
  placeholder: { flex: 1, backgroundColor: 'black', justifyContent: 'center', alignItems: 'center', padding: 40 },
  placeholderTitle: { color: 'white', fontSize: 18, marginVertical: 20, textAlign: 'center' },
  allowBtn: { backgroundColor: COLORS.teal, paddingHorizontal: 25, paddingVertical: 15, borderRadius: 15 },
  allowBtnText: { color: 'white', fontWeight: 'bold' }
});
