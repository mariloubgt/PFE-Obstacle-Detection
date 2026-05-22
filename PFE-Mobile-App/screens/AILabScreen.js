import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../components/ScreenHeader';
import { COLORS, LAYOUT } from '../constants/theme';
import { FONTS } from '../constants/typography';
import { probeServer, updateLabConfig, resetLabConfig } from '../services/labApi';
import { loadInferenceApiUrl, saveInferenceApiUrl } from '../utils/inferenceApiUrl';
import {
  addUrlPreset,
  loadLabPredictOpts,
  loadUrlPresets,
  removeCustomPreset,
  saveLabPredictOpts,
  suggestedLocalUrl,
} from '../utils/aiLabSettings';
import { isSimulatorDevice } from '../utils/isSimulator';

function Row({ title, subtitle, children, last }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export default function AILabScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [apiUrl, setApiUrl] = useState('');
  const [presets, setPresets] = useState([]);
  const [labOpts, setLabOpts] = useState({
    useGroq: true,
    useGemini: false,
    groqMode: 'describe',
    detailed: true,
  });
  const [probe, setProbe] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [groqModel, setGroqModel] = useState('');
  const [presetLabel, setPresetLabel] = useState('');

  const refresh = useCallback(async () => {
    const url = await loadInferenceApiUrl();
    setApiUrl(url || suggestedLocalUrl());
    setPresets(await loadUrlPresets());
    setLabOpts(await loadLabPredictOpts());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const onSaveUrl = useCallback(async () => {
    await saveInferenceApiUrl(apiUrl);
    setMsg('URL saved for the whole app.');
    setTimeout(() => setMsg(null), 2500);
  }, [apiUrl]);

  const onProbe = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      await saveInferenceApiUrl(apiUrl);
      const r = await probeServer(apiUrl.trim());
      setProbe(r);
      const lan = r.lab?.urls?.lan || r.health?.urls?.lan;
      if (lan) {
        setMsg(`Server OK. LAN URL: ${lan}`);
      } else {
        setMsg('Server OK.');
      }
      const eff = r.lab?.effective;
      if (eff?.groq_model) setGroqModel(eff.groq_model);
    } catch (e) {
      setProbe(null);
      setMsg(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [apiUrl]);

  const applyLanUrl = useCallback(() => {
    const lan = probe?.lab?.urls?.lan || probe?.health?.urls?.lan;
    if (lan) {
      setApiUrl(lan);
      void saveInferenceApiUrl(lan);
      setMsg(`Using ${lan}`);
    }
  }, [probe]);

  const onApplyServer = useCallback(async () => {
    setBusy(true);
    try {
      await saveInferenceApiUrl(apiUrl);
      const r = await updateLabConfig(apiUrl.trim(), {
        groq_model: groqModel.trim() || undefined,
        enable_groq: labOpts.useGroq,
        enable_gemini: labOpts.useGemini,
      });
      setProbe({ health: { ok: true }, lab: r.lab });
      setMsg('Server lab config updated (no restart needed).');
    } catch (e) {
      setMsg(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [apiUrl, groqModel, labOpts]);

  const onResetServer = useCallback(async () => {
    try {
      await resetLabConfig(apiUrl.trim());
      await onProbe();
      setMsg('Server overrides reset.');
    } catch (e) {
      setMsg(e.message || String(e));
    }
  }, [apiUrl, onProbe]);

  const setOpt = useCallback(async (patch) => {
    const next = await saveLabPredictOpts({ ...labOpts, ...patch });
    setLabOpts(next);
  }, [labOpts]);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="light" />
      <ScreenHeader
        title="AI Lab"
        subtitle="Test models & server URL anytime"
        onBack={() => navigation.goBack()}
        circularBack
      />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>
          Point the app at your PC inference server, switch Groq/Gemini/YOLO settings, and test
          without rebuilding the app. {isSimulatorDevice() ? 'Simulator: use 127.0.0.1.' : 'Phone: use your Mac LAN IP.'}
        </Text>

        <Text style={styles.section}>Server URL</Text>
        <TextInput
          style={styles.input}
          value={apiUrl}
          onChangeText={setApiUrl}
          placeholder="http://127.0.0.1:8787"
          placeholderTextColor={COLORS.greyDark}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={styles.btnRow}>
          <Pressable style={styles.btn} onPress={() => void onSaveUrl()}>
            <Text style={styles.btnText}>Save</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={() => void onProbe()} disabled={busy}>
            {busy ? <ActivityIndicator color={COLORS.btnText} size="small" /> : (
              <Text style={styles.btnTextDark}>Test & load config</Text>
            )}
          </Pressable>
        </View>
        {probe?.lab?.urls?.lan ? (
          <Pressable style={styles.lanBtn} onPress={applyLanUrl}>
            <Text style={styles.lanBtnText}>Use server LAN URL: {probe.lab.urls.lan}</Text>
          </Pressable>
        ) : null}

        <Text style={styles.section}>Saved presets</Text>
        {presets.map((p) => (
          <Pressable
            key={p.id}
            style={styles.presetRow}
            onPress={() => {
              if (p.url) {
                setApiUrl(p.url);
                void saveInferenceApiUrl(p.url);
              }
            }}
            onLongPress={() => {
              if (p.id.startsWith('p-')) {
                Alert.alert('Remove preset?', p.label, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () => void removeCustomPreset(p.id).then(setPresets),
                  },
                ]);
              }
            }}
          >
            <Text style={styles.presetLabel}>{p.label}</Text>
            <Text style={styles.presetUrl} numberOfLines={1}>
              {p.url || 'Run Test to discover LAN URL'}
            </Text>
          </Pressable>
        ))}
        <View style={styles.addPreset}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Preset name (optional)"
            placeholderTextColor={COLORS.greyDark}
            value={presetLabel}
            onChangeText={setPresetLabel}
          />
          <Pressable
            style={styles.btn}
            onPress={() =>
              void addUrlPreset(presetLabel, apiUrl).then((list) => {
                setPresets(list);
                setPresetLabel('');
                setMsg('Preset saved.');
              })
            }
          >
            <Text style={styles.btnText}>+</Text>
          </Pressable>
        </View>

        <Text style={styles.section}>App → server (each /predict)</Text>
        <View style={styles.card}>
          <Row title="Use Groq (Llama)" subtitle="Scene + navigation AI">
            <Switch
              value={labOpts.useGroq}
              onValueChange={(v) => void setOpt({ useGroq: v })}
              trackColor={{ false: COLORS.borderMuted, true: COLORS.teal }}
              thumbColor={COLORS.white}
            />
          </Row>
          <Row title="Use Gemini" subtitle="Needs GEMINI_API_KEY on PC">
            <Switch
              value={labOpts.useGemini}
              onValueChange={(v) => void setOpt({ useGemini: v })}
              trackColor={{ false: COLORS.borderMuted, true: COLORS.teal }}
              thumbColor={COLORS.white}
            />
          </Row>
          <Row title="Groq mode" subtitle={labOpts.groqMode === 'navigate' ? 'Navigation' : 'Describe'}>
            <Pressable
              onPress={() =>
                void setOpt({
                  groqMode: labOpts.groqMode === 'navigate' ? 'describe' : 'navigate',
                })
              }
            >
              <Text style={styles.chip}>{labOpts.groqMode}</Text>
            </Pressable>
          </Row>
          <Row title="Detailed describe" subtitle="Longer scene text" last>
            <Switch
              value={labOpts.detailed}
              onValueChange={(v) => void setOpt({ detailed: v })}
              trackColor={{ false: COLORS.borderMuted, true: COLORS.teal }}
              thumbColor={COLORS.white}
            />
          </Row>
        </View>

        <Text style={styles.section}>Server runtime (no restart)</Text>
        <TextInput
          style={styles.input}
          value={groqModel}
          onChangeText={setGroqModel}
          placeholder="Groq model id"
          placeholderTextColor={COLORS.greyDark}
          autoCapitalize="none"
        />
        <View style={styles.btnRow}>
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={() => void onApplyServer()} disabled={busy}>
            <Text style={styles.btnTextDark}>Apply on server</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => void onResetServer()}>
            <Text style={styles.btnText}>Reset server</Text>
          </Pressable>
        </View>

        {probe?.lab?.effective ? (
          <View style={styles.configBox}>
            <Text style={styles.configLine}>YOLO: {probe.lab.effective.yolo_weights}</Text>
            <Text style={styles.configLine}>
              conf {probe.lab.effective.yolo_conf} · imgsz {probe.lab.effective.yolo_imgsz}
            </Text>
            <Text style={styles.configLine}>Groq: {probe.lab.effective.groq_model}</Text>
            <Text style={styles.configLine}>
              Groq {probe.lab.effective.enable_groq ? 'on' : 'off'} · Gemini{' '}
              {probe.lab.effective.enable_gemini ? 'on' : 'off'}
            </Text>
          </View>
        ) : null}

        {msg ? <Text style={styles.msg}>{msg}</Text> : null}

        <Text style={styles.section}>Try in app</Text>
        <Pressable
          style={styles.navBtn}
          onPress={() => navigation.navigate('SceneQuery')}
        >
          <MaterialCommunityIcons name="image-text" size={22} color={COLORS.teal} />
          <Text style={styles.navBtnText}>Scene description</Text>
        </Pressable>
        <Pressable style={styles.navBtn} onPress={() => navigation.navigate('Main')}>
          <MaterialCommunityIcons name="camera" size={22} color={COLORS.teal} />
          <Text style={styles.navBtnText}>Live navigation + YOLO</Text>
        </Pressable>

        <Text style={styles.hint}>
          Start the PC server:{' '}
          <Text style={styles.mono}>bash scripts/ai-lab-start.sh</Text>
          {'\n'}
          Change YOLO weights in <Text style={styles.mono}>.env</Text> (YOLO_WEIGHTS=…) then restart
          the server, or use POST /lab/reload-yolo from API docs.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: LAYOUT.screenPaddingH },
  scroll: { paddingBottom: 32 },
  lead: { color: COLORS.grey, fontSize: 14, lineHeight: 20, marginBottom: 16, fontFamily: FONTS.en.regular },
  section: {
    color: COLORS.teal,
    fontSize: 12,
    fontFamily: FONTS.en.extrabold,
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderMuted,
    borderRadius: 12,
    padding: 12,
    color: COLORS.white,
    fontSize: 15,
    marginBottom: 10,
    fontFamily: FONTS.en.regular,
  },
  btnRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.teal,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: COLORS.teal, borderColor: COLORS.teal },
  btnText: { color: COLORS.teal, fontFamily: FONTS.en.semibold },
  btnTextDark: { color: COLORS.btnText, fontFamily: FONTS.en.extrabold },
  lanBtn: { marginBottom: 12, padding: 10, backgroundColor: 'rgba(102,210,177,0.12)', borderRadius: 10 },
  lanBtnText: { color: COLORS.tealBright, fontSize: 13, fontFamily: FONTS.en.semibold },
  presetRow: {
    padding: 12,
    backgroundColor: COLORS.bgElevated,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.borderMuted,
  },
  presetLabel: { color: COLORS.white, fontFamily: FONTS.en.semibold, fontSize: 15 },
  presetUrl: { color: COLORS.grey, fontSize: 12, marginTop: 4, fontFamily: FONTS.en.regular },
  addPreset: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 12 },
  card: {
    backgroundColor: COLORS.bgElevated,
    borderRadius: LAYOUT.cardRadius,
    borderWidth: 1,
    borderColor: COLORS.borderMuted,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    gap: 12,
  },
  rowLast: { paddingBottom: 16 },
  rowText: { flex: 1 },
  rowTitle: { color: COLORS.white, fontSize: 15, fontFamily: FONTS.en.semibold },
  rowSub: { color: COLORS.grey, fontSize: 12, marginTop: 2, fontFamily: FONTS.en.regular },
  chip: {
    color: COLORS.teal,
    fontFamily: FONTS.en.bold,
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(102,210,177,0.15)',
    borderRadius: 8,
  },
  configBox: {
    backgroundColor: COLORS.bgElevated,
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.borderMuted,
  },
  configLine: { color: COLORS.grey, fontSize: 12, fontFamily: FONTS.en.regular, marginBottom: 4 },
  msg: { color: COLORS.tealBright, fontSize: 13, marginBottom: 12, fontFamily: FONTS.en.regular },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    backgroundColor: COLORS.bgElevated,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.borderMuted,
  },
  navBtnText: { color: COLORS.white, fontSize: 16, fontFamily: FONTS.en.semibold },
  hint: { color: COLORS.grey, fontSize: 12, lineHeight: 18, marginTop: 12, fontFamily: FONTS.en.regular },
  mono: { fontFamily: 'Menlo', color: COLORS.tealBright },
});
