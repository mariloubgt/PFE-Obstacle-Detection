import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../components/ScreenHeader';
import { fetchHealth } from '../services/predict';
import { APPEARANCE, LAYOUT } from '../constants/theme';
import { FONTS } from '../constants/typography';
import { useAppTheme, useThemeColors } from '../contexts/ThemeContext';
import { loadInferenceApiUrl, saveInferenceApiUrl } from '../utils/inferenceApiUrl';
import { loadAlertVolume, saveAlertVolume } from '../utils/alertVolumeStorage';
import { applyAlertVolumeToSystemOutput } from '../utils/systemOutputVolume';
import {
  loadSpeechRate,
  saveSpeechRate,
  loadVibrationDanger,
  saveVibrationDanger,
  loadDangerThresholdM,
  saveDangerThresholdM,
  loadAiFrameMs,
  saveAiFrameMs,
  loadLowLight,
  saveLowLight,
  loadInternetGemini,
  saveInternetGemini,
  loadCameraHfovDeg,
  saveCameraHfovDeg,
  loadDepthScale,
  saveDepthScale,
  DEFAULTS,
  loadVolumeHardwareAction,
  saveVolumeHardwareAction,
  loadHandsFreeDescribe,
  saveHandsFreeDescribe,
  loadYoloProfile,
  saveYoloProfile,
} from '../utils/appSettings';

const SPEECH_OPTIONS = [
  { label: 'Slow', value: 0.4 },
  { label: 'Normal', value: 0.6 },
  { label: 'Fast', value: 0.85 },
];

const YOLO_PROFILE_OPTIONS = [
  { value: 'auto', label: 'Auto (indoor + outdoor)' },
  { value: 'indoor', label: 'Indoor only (chairs, faster)' },
  { value: 'outdoor', label: 'Outdoor only (street)' },
];

const FRAME_PRESETS = [
  { label: '3 fps (fastest)', ms: 333 },
  { label: '2.5 fps (recommended)', ms: 400 },
  { label: '2 fps', ms: 500 },
  { label: '1.5 fps', ms: 666 },
  { label: '1 fps', ms: 1000 },
  { label: '0.5 fps', ms: 2000 },
  { label: '0.33 fps', ms: 3000 },
];

const VOLUME_HW_OPTIONS = [
  { value: 'none', label: 'Off' },
  { value: 'scene_query', label: 'Open scene chat' },
  { value: 'describe', label: 'Open scene chat + describe' },
];

function formatFrameValue(ms) {
  const f = 1000 / ms;
  const rounded = Math.abs(f - 1) < 0.08 ? 1 : Math.round(f * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} fps`;
}

function snapSpeechLabel(rate) {
  let best = SPEECH_OPTIONS[1];
  let d = 99;
  for (const o of SPEECH_OPTIONS) {
    const c = Math.abs(o.value - rate);
    if (c < d) {
      d = c;
      best = o;
    }
  }
  return best;
}

function snapFrameMs(ms) {
  let best = FRAME_PRESETS[0].ms;
  let d = 1e9;
  for (const p of FRAME_PRESETS) {
    const c = Math.abs(p.ms - ms);
    if (c < d) {
      d = c;
      best = p.ms;
    }
  }
  return best;
}

function volumeHardwareRowLabel(action) {
  const normalized = ['none', 'describe', 'scene_query'].includes(action)
    ? action
    : DEFAULTS.volumeHardwareAction;
  const hit = VOLUME_HW_OPTIONS.find((o) => o.value === normalized);
  return hit?.label ?? 'Describe environment';
}

const APPEARANCE_OPTIONS = [
  { value: APPEARANCE.night_shift, label: 'Night shift' },
  { value: APPEARANCE.white_shift, label: 'White shift' },
];

function InsetDivider({ styles }) {
  return <View style={styles.insetDivider} />;
}

function Section({ styles, label, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function ValueRow({ styles, title, subtitle, value, onPress, last }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.valueRow, pressed && styles.pressed, last && styles.valueRowLast]}
      accessibilityRole="button"
    >
      <View style={styles.valueRowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      <Text style={styles.valueRight}>{value}</Text>
    </Pressable>
  );
}

function ToggleRow({ styles, colors, title, subtitle, value, onValueChange, last }) {
  return (
    <View style={[styles.valueRow, last && styles.valueRowLast]}>
      <View style={styles.valueRowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.switchTrackOff, true: colors.teal }}
        thumbColor={Platform.OS === 'ios' ? '#FFFFFF' : colors.btnText}
        ios_backgroundColor={colors.switchTrackOff}
      />
    </View>
  );
}
export default function SettingsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [apiUrl, setApiUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState(null);

  const [vol, setVol] = useState(0.8);
  const [volOpen, setVolOpen] = useState(false);
  const [thr, setThr] = useState(0.8);
  const [thrOpen, setThrOpen] = useState(false);
  const [speech, setSpeech] = useState(0.6);
  const [speechOpen, setSpeechOpen] = useState(false);
  const [frameMs, setFrameMs] = useState(1000);
  const [frameOpen, setFrameOpen] = useState(false);
  const [yoloProfile, setYoloProfile] = useState('auto');
  const [yoloProfileOpen, setYoloProfileOpen] = useState(false);
  const [vib, setVib] = useState(true);
  const [lowLight, setLowLight] = useState(true);
  const [gem, setGem] = useState(false);
  const [hfovDeg, setHfovDeg] = useState(57);
  const [hfovOpen, setHfovOpen] = useState(false);
  const [depthScale, setDepthScale] = useState(1);
  const [depthOpen, setDepthOpen] = useState(false);
  const [volumeHw, setVolumeHw] = useState(DEFAULTS.volumeHardwareAction);
  const [volumeHwOpen, setVolumeHwOpen] = useState(false);
  const [handsFreePhrase, setHandsFreePhrase] = useState(DEFAULTS.handsFreeDescribe);
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  const colors = useThemeColors();
  const { appearance, setAppearance } = useAppTheme();
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);

  const loadAll = useCallback(async () => {
    setApiUrl(await loadInferenceApiUrl());
    setVol(await loadAlertVolume());
    setSpeech(await loadSpeechRate());
    setVib(await loadVibrationDanger());
    setThr(await loadDangerThresholdM());
    setFrameMs(snapFrameMs(await loadAiFrameMs()));
    setYoloProfile(await loadYoloProfile());
    setLowLight(await loadLowLight());
    setGem(await loadInternetGemini());
    setHfovDeg(await loadCameraHfovDeg());
    setDepthScale(await loadDepthScale());
    setVolumeHw(await loadVolumeHardwareAction());
    setHandsFreePhrase(await loadHandsFreeDescribe());
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll])
  );

  const onSaveUrl = useCallback(async () => {
    await saveInferenceApiUrl(apiUrl);
    setTestMsg('Saved.');
    setTimeout(() => setTestMsg(null), 2000);
  }, [apiUrl]);

  const onTestConnection = useCallback(async () => {
    setTestMsg(null);
    setTesting(true);
    try {
      await saveInferenceApiUrl(apiUrl);
      const h = await fetchHealth(apiUrl.trim());
      const groqReady = h.groq?.enabled && h.groq?.has_key;
      const geminiReady = h.gemini?.enabled && h.gemini?.ok;
      setTestMsg(
        h.ok
          ? `OK · YOLO loaded · Groq: ${groqReady ? 'ready' : 'set GROQ_API_KEY on PC'} · Gemini: ${
              geminiReady ? 'ready' : 'off or set GEMINI_API_KEY'
            }`
          : 'Unexpected response'
      );
    } catch (e) {
      setTestMsg(e.message || String(e));
    } finally {
      setTesting(false);
    }
  }, [apiUrl]);

  const speechLabel = snapSpeechLabel(speech).label;
  const appearanceLabel =
    appearance === APPEARANCE.white_shift ? 'White shift' : 'Night shift';

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) },
      ]}
    >
      <StatusBar style={colors.statusBarStyle} />
      <ScreenHeader
        title="Settings"
        subtitle="VisionAid v1.0.0 beta"
        onBack={() => navigation.goBack()}
        circularBack
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Section styles={styles} label="Display">
          <ValueRow
            styles={styles}
            title="Night shift / White shift"
            subtitle="Night shift — dark theme. White shift — bright theme for daytime."
            value={appearanceLabel}
            onPress={() => setAppearanceOpen(true)}
            last
          />
        </Section>

        <Section styles={styles} label="Audio">
          <ValueRow
            styles={styles}
            title="Alert Volume"
            subtitle="Sets phone output level — use 100% for loudest obstacle warnings"
            value={`${Math.round(vol * 100)}%`}
            onPress={() => setVolOpen(true)}
          />
          <InsetDivider styles={styles} />
          <ValueRow
            styles={styles}
            title="Speech Rate"
            subtitle="English TTS speed"
            value={speechLabel}
            onPress={() => setSpeechOpen(true)}
          />
          <InsetDivider styles={styles} />
          <ToggleRow
            styles={styles}
            colors={colors}
            title="Vibration on Danger"
            last
            value={vib}
            onValueChange={async (b) => setVib(await saveVibrationDanger(b))}
          />
        </Section>

        <Section styles={styles} label="Detection">
          <ValueRow
            styles={styles}
            title="Danger Threshold"
            subtitle="Trigger distance for red alert"
            value={`${thr.toFixed(1)}m`}
            onPress={() => setThrOpen(true)}
          />
          <InsetDivider styles={styles} />
          <ValueRow
            styles={styles}
            title="Frame Rate"
            subtitle="YOLO processing speed"
            value={formatFrameValue(frameMs)}
            onPress={() => setFrameOpen(true)}
          />
          <InsetDivider styles={styles} />
          <ValueRow
            styles={styles}
            title="Detection mode"
            subtitle="Indoor only = chairs, no false person"
            value={
              YOLO_PROFILE_OPTIONS.find((o) => o.value === yoloProfile)?.label || 'Auto'
            }
            onPress={() => setYoloProfileOpen(true)}
          />
          <InsetDivider styles={styles} />
          <ToggleRow
            styles={styles}
            colors={colors}
            title="Low-light Mode"
            subtitle="When AI navigation starts on rear camera, turn torch on (you can turn it off anytime)"
            last
            value={lowLight}
            onValueChange={async (b) => setLowLight(await saveLowLight(b))}
          />
        </Section>

        <Section styles={styles} label="Voice">
          <ValueRow
            styles={styles}
            title="Speech rate & alert volume"
            subtitle="English only · advanced sliders"
            value="Adjust"
            onPress={() => navigation.navigate('LanguageVoice')}
          />
          <InsetDivider styles={styles} />
          <ToggleRow
            styles={styles}
            colors={colors}
            title="Internet for Gemini"
            subtitle="Adds use_gemini on predict requests when your PC server supports it"
            last
            value={gem}
            onValueChange={async (b) => setGem(await saveInternetGemini(b))}
          />
        </Section>

        <Section styles={styles} label="Accessibility">
          <ValueRow
            styles={styles}
            title="Physical volume buttons"
            subtitle="Volume up/down opens scene chat (describe lives there only)"
            value={volumeHardwareRowLabel(volumeHw)}
            onPress={() => setVolumeHwOpen(true)}
          />
          <InsetDivider styles={styles} />
          <ToggleRow
            styles={styles}
            colors={colors}
            title="Hands-free phrase"
            subtitle="Main + Scene chat — detection, describe, scene chat. Stop detection: say stop or double-tap."
            value={handsFreePhrase}
            onValueChange={async (b) => setHandsFreePhrase(await saveHandsFreeDescribe(b))}
            last
          />
        </Section>

        <View style={styles.serverSection}>
          <Text style={styles.serverTitle}>Phase 3 — AI server (PC)</Text>
          <Text style={styles.serverHint}>
            Same Wi‑Fi as this phone. On your computer run:{' '}
            <Text style={styles.mono}>python api/inference_server.py</Text>
            {'\n'}
            Then paste your PC IP, e.g. http://192.168.0.15:8787
          </Text>
          <TextInput
            style={styles.input}
            value={apiUrl}
            onChangeText={setApiUrl}
            placeholder="http://192.168.x.x:8787"
            placeholderTextColor={colors.greyDark}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <View style={styles.rowBtns}>
            <Pressable style={styles.smallBtn} onPress={onSaveUrl}>
              <Text style={styles.smallBtnText}>Save URL</Text>
            </Pressable>
            <Pressable
              style={[styles.smallBtn, styles.smallBtnPrimary]}
              onPress={onTestConnection}
              disabled={testing}
            >
              {testing ? (
                <ActivityIndicator color={colors.btnText} size="small" />
              ) : (
                <Text style={styles.smallBtnTextDark}>Test connection</Text>
              )}
            </Pressable>
          </View>
          {testMsg ? <Text style={styles.testMsg}>{testMsg}</Text> : null}
          <Text style={[styles.serverHint, { marginTop: 14 }]}>
            Distance tuning: if the app always says obstacles are farther than reality, increase{' '}
            <Text style={styles.mono}>Camera HFOV</Text> slightly or lower{' '}
            <Text style={styles.mono}>Distance scale</Text>. If too close, do the opposite.
          </Text>
          <View style={[styles.card, { marginTop: 10 }]}>
            <ValueRow
              styles={styles}
              title="Camera horizontal FOV"
              subtitle="Degrees — typical phone 52–72"
              value={`${Math.round(hfovDeg)}°`}
              onPress={() => setHfovOpen(true)}
            />
            <InsetDivider styles={styles} />
            <ValueRow
              styles={styles}
              title="Distance scale"
              subtitle="Multiply depth (0.5–2). Default 1.0"
              value={`${depthScale.toFixed(2)}×`}
              onPress={() => setDepthOpen(true)}
              last
            />
          </View>
        </View>

        <View style={styles.card}>
          <Pressable
            style={({ pressed }) => [styles.navRow, pressed && styles.pressed]}
            onPress={() => navigation.navigate('AILab')}
          >
            <MaterialCommunityIcons name="flask-outline" size={22} color={colors.teal} />
            <Text style={styles.navRowText}>AI Lab — test models & server URL</Text>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.grey} />
          </Pressable>
          <InsetDivider styles={styles} />
          <Pressable
            style={({ pressed }) => [styles.navRow, styles.navRowLast, pressed && styles.pressed]}
            onPress={() => navigation.navigate('Permissions')}
          >
            <MaterialCommunityIcons name="shield-check-outline" size={22} color={colors.teal} />
            <Text style={styles.navRowText}>App permissions</Text>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.grey} />
          </Pressable>
        </View>

        <Text style={styles.hint}>
          On the navigation screen, use Physical volume buttons (above) instead of locating the Describe
          control. Hands-free listens for describe environment — turn off if preview should never pause.
          Use the Volume control below for obstacle alert loudness. “Internet for Gemini” tells the PC to run Gemini enrichment when the server has a key (same toggle exists under App permissions).
        </Text>
      </ScrollView>

      <Modal visible={volOpen} transparent animationType="fade" onRequestClose={() => setVolOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setVolOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Alert volume</Text>
            <Text style={styles.modalHint}>
              Sets the phone’s media/output level (same as the side volume buttons). Spoken guidance uses
              this level — {Math.round(vol * 100)}%
            </Text>
            <Slider
              style={styles.modalSlider}
              minimumValue={0}
              maximumValue={1}
              value={vol}
              onValueChange={(v) => {
                setVol(v);
                void applyAlertVolumeToSystemOutput(v);
              }}
              onSlidingComplete={async (v) => setVol(await saveAlertVolume(v))}
              minimumTrackTintColor={colors.teal}
              maximumTrackTintColor={colors.borderMuted}
              thumbTintColor={colors.teal}
            />
            <View style={styles.modalEnds}>
              <Text style={styles.endLabel}>0%</Text>
              <Text style={styles.endLabel}>100%</Text>
            </View>
            <Pressable style={styles.modalDone} onPress={() => setVolOpen(false)}>
              <Text style={styles.modalDoneText}>Done</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={thrOpen} transparent animationType="fade" onRequestClose={() => setThrOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setThrOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Danger threshold</Text>
            <Text style={styles.modalHint}>
              Red full-screen alert when an obstacle is within {thr.toFixed(1)}m
            </Text>
            <Slider
              style={styles.modalSlider}
              minimumValue={0.2}
              maximumValue={2}
              value={thr}
              onValueChange={setThr}
              onSlidingComplete={async (v) => setThr(await saveDangerThresholdM(v))}
              minimumTrackTintColor={colors.teal}
              maximumTrackTintColor={colors.borderMuted}
              thumbTintColor={colors.teal}
            />
            <View style={styles.modalEnds}>
              <Text style={styles.endLabel}>0.2m</Text>
              <Text style={styles.endLabel}>2m</Text>
            </View>
            <Pressable style={styles.modalDone} onPress={() => setThrOpen(false)}>
              <Text style={styles.modalDoneText}>Done</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={speechOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSpeechOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSpeechOpen(false)}>
          <View style={styles.pickerCard}>
            <Text style={styles.modalTitle}>Speech rate</Text>
            <Text style={styles.modalHint}>English TTS speed</Text>
            {SPEECH_OPTIONS.map((o) => (
              <Pressable
                key={o.label}
                style={({ pressed }) => [styles.pickerRow, pressed && styles.pressed]}
                onPress={async () => {
                  const v = await saveSpeechRate(o.value);
                  setSpeech(v);
                  setSpeechOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.pickerLabel,
                    o.value === snapSpeechLabel(speech).value && styles.pickerLabelOn,
                  ]}
                >
                  {o.label}
                </Text>
                {o.value === snapSpeechLabel(speech).value ? (
                  <MaterialCommunityIcons name="check" size={22} color={colors.teal} />
                ) : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={hfovOpen} transparent animationType="fade" onRequestClose={() => setHfovOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setHfovOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Camera horizontal FOV</Text>
            <Text style={styles.modalHint}>
              Sent to the PC for each frame. Wider FOV → farther distance estimates. Current:{' '}
              {Math.round(hfovDeg)}°
            </Text>
            <Slider
              style={styles.modalSlider}
              minimumValue={40}
              maximumValue={95}
              step={1}
              value={hfovDeg}
              onValueChange={setHfovDeg}
              onSlidingComplete={async (v) => setHfovDeg(await saveCameraHfovDeg(v))}
              minimumTrackTintColor={colors.teal}
              maximumTrackTintColor={colors.borderMuted}
              thumbTintColor={colors.teal}
            />
            <View style={styles.modalEnds}>
              <Text style={styles.endLabel}>40°</Text>
              <Text style={styles.endLabel}>95°</Text>
            </View>
            <Pressable style={styles.modalDone} onPress={() => setHfovOpen(false)}>
              <Text style={styles.modalDoneText}>Done</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={depthOpen} transparent animationType="fade" onRequestClose={() => setDepthOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setDepthOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Distance scale</Text>
            <Text style={styles.modalHint}>
              Applied on the server to every detection. Current: {depthScale.toFixed(2)}×
            </Text>
            <Slider
              style={styles.modalSlider}
              minimumValue={0.5}
              maximumValue={2}
              step={0.05}
              value={depthScale}
              onValueChange={setDepthScale}
              onSlidingComplete={async (v) => setDepthScale(await saveDepthScale(v))}
              minimumTrackTintColor={colors.teal}
              maximumTrackTintColor={colors.borderMuted}
              thumbTintColor={colors.teal}
            />
            <View style={styles.modalEnds}>
              <Text style={styles.endLabel}>0.5×</Text>
              <Text style={styles.endLabel}>2×</Text>
            </View>
            <Pressable style={styles.modalDone} onPress={() => setDepthOpen(false)}>
              <Text style={styles.modalDoneText}>Done</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={volumeHwOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setVolumeHwOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setVolumeHwOpen(false)}>
          <View style={styles.pickerCard}>
            <Text style={styles.modalTitle}>Physical volume buttons</Text>
            <Text style={styles.modalHint}>
              Volume up or down triggers your chosen action; the music/output level is restored so keys do
              not turn the sound up or down. For spoken alert loudness, use Alert volume in Settings.
            </Text>
            {VOLUME_HW_OPTIONS.map((o) => (
              <Pressable
                key={o.value}
                style={({ pressed }) => [styles.pickerRow, pressed && styles.pressed]}
                onPress={async () => {
                  const v = await saveVolumeHardwareAction(o.value);
                  setVolumeHw(v);
                  setVolumeHwOpen(false);
                }}
              >
                <Text style={[styles.pickerLabel, o.value === volumeHw && styles.pickerLabelOn]}>
                  {o.label}
                </Text>
                {o.value === volumeHw ? (
                  <MaterialCommunityIcons name="check" size={22} color={colors.teal} />
                ) : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={yoloProfileOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setYoloProfileOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setYoloProfileOpen(false)}>
          <View style={styles.pickerCard}>
            <Text style={styles.modalTitle}>Detection mode</Text>
            <Text style={styles.modalHint}>
              Use Indoor only inside buildings (chairs, exits). Auto uses both models.
            </Text>
            {YOLO_PROFILE_OPTIONS.map((o) => (
              <Pressable
                key={o.value}
                style={({ pressed }) => [styles.pickerRow, pressed && styles.pressed]}
                onPress={async () => {
                  const v = await saveYoloProfile(o.value);
                  setYoloProfile(v);
                  setYoloProfileOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.pickerLabel,
                    o.value === yoloProfile && styles.pickerLabelOn,
                  ]}
                >
                  {o.label}
                </Text>
                {o.value === yoloProfile ? (
                  <MaterialCommunityIcons name="check" size={22} color={colors.teal} />
                ) : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={frameOpen} transparent animationType="fade" onRequestClose={() => setFrameOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setFrameOpen(false)}>
          <View style={styles.pickerCard}>
            <Text style={styles.modalTitle}>Frame rate</Text>
            <Text style={styles.modalHint}>YOLO processing speed (may heat the device)</Text>
            {FRAME_PRESETS.map((p) => (
              <Pressable
                key={p.label}
                style={({ pressed }) => [styles.pickerRow, pressed && styles.pressed]}
                onPress={async () => {
                  const m = await saveAiFrameMs(p.ms);
                  setFrameMs(m);
                  setFrameOpen(false);
                }}
              >
                <Text
                  style={[styles.pickerLabel, p.ms === frameMs && styles.pickerLabelOn]}
                >
                  {p.label}
                </Text>
                {p.ms === frameMs ? (
                  <MaterialCommunityIcons name="check" size={22} color={colors.teal} />
                ) : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={appearanceOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAppearanceOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setAppearanceOpen(false)}>
          <View style={styles.pickerCard}>
            <Text style={styles.modalTitle}>Screen appearance</Text>
            <Text style={styles.modalHint}>Night shift (dark) or White shift (light)</Text>
            {APPEARANCE_OPTIONS.map((o) => (
              <Pressable
                key={o.value}
                style={({ pressed }) => [styles.pickerRow, pressed && styles.pressed]}
                onPress={async () => {
                  await setAppearance(o.value);
                  setAppearanceOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.pickerLabel,
                    o.value === appearance && styles.pickerLabelOn,
                  ]}
                >
                  {o.label}
                </Text>
                {o.value === appearance ? (
                  <MaterialCommunityIcons name="check" size={22} color={colors.teal} />
                ) : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function createSettingsStyles(colors) {
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: LAYOUT.screenPaddingH,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 32, gap: 4 },
  section: {
    marginTop: 12,
  },
  sectionLabel: {
    color: colors.teal,
    fontSize: 12,
    fontFamily: FONTS.en.extrabold,
    letterSpacing: 1.2,
    marginBottom: 8,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: LAYOUT.cardRadius,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    overflow: 'hidden',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
    minHeight: 64,
  },
  valueRowLast: {
    paddingBottom: 16,
  },
  valueRowText: { flex: 1, minWidth: 0 },
  rowTitle: {
    color: colors.text,
    fontSize: 16,
    fontFamily: FONTS.en.semibold,
  },
  rowSubtitle: {
    color: colors.grey,
    fontSize: 12,
    marginTop: 4,
    fontFamily: FONTS.en.regular,
  },
  valueRight: {
    color: colors.teal,
    fontSize: 15,
    fontFamily: FONTS.en.semibold,
  },
  pressed: { opacity: 0.88 },
  insetDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderMuted,
    marginLeft: 16,
    marginRight: 16,
  },
  serverSection: { marginTop: 20 },
  serverTitle: {
    color: colors.text,
    fontSize: 17,
    fontFamily: FONTS.en.extrabold,
    marginBottom: 8,
  },
  serverHint: {
    color: colors.grey,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 12,
    fontFamily: FONTS.en.regular,
  },
  mono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    color: colors.tealBright,
    fontSize: 12,
  },
  input: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    marginBottom: 12,
    fontFamily: FONTS.en.regular,
  },
  rowBtns: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  smallBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.teal,
    alignItems: 'center',
  },
  smallBtnPrimary: { backgroundColor: colors.teal, borderColor: colors.teal },
  smallBtnText: { color: colors.teal, fontWeight: '700', fontSize: 15, fontFamily: FONTS.en.semibold },
  smallBtnTextDark: { color: colors.btnText, fontWeight: '800', fontSize: 15, fontFamily: FONTS.en.extrabold },
  testMsg: { color: colors.tealBright, fontSize: 13, marginBottom: 8, fontFamily: FONTS.en.regular },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 14,
    gap: 12,
  },
  navRowLast: { paddingBottom: 18 },
  navRowText: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    fontFamily: FONTS.en.semibold,
  },
  hint: {
    color: colors.grey,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 20,
    paddingHorizontal: 4,
    fontFamily: FONTS.en.regular,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    padding: 20,
  },
  modalCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.borderMuted,
  },
  pickerCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: 16,
    padding: 16,
    paddingBottom: 8,
    borderWidth: 1,
    borderColor: colors.borderMuted,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 20,
    fontFamily: FONTS.en.extrabold,
    marginBottom: 6,
  },
  modalHint: {
    color: colors.grey,
    fontSize: 14,
    marginBottom: 16,
    fontFamily: FONTS.en.regular,
  },
  modalSlider: { width: '100%', height: 44 },
  modalEnds: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4, marginBottom: 16 },
  endLabel: { color: colors.grey, fontSize: 12, fontFamily: FONTS.en.regular },
  modalDone: { alignSelf: 'flex-end', paddingVertical: 10, paddingHorizontal: 16 },
  modalDoneText: { color: colors.teal, fontSize: 17, fontFamily: FONTS.en.semibold },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderMuted,
  },
  pickerLabel: { color: colors.text, fontSize: 16, fontFamily: FONTS.en.medium },
  pickerLabelOn: { color: colors.teal, fontFamily: FONTS.en.semibold },
});
}

