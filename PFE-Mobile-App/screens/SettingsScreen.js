import { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../components/ScreenHeader';
import { fetchHealth } from '../services/predict';
import { COLORS } from '../constants/theme';
import { loadInferenceApiUrl, saveInferenceApiUrl } from '../utils/inferenceApiUrl';

function Row({ icon, label, onPress }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <MaterialCommunityIcons name={icon} size={22} color={COLORS.tealBright} />
      <Text style={styles.rowLabel}>{label}</Text>
      <MaterialCommunityIcons name="chevron-right" size={22} color={COLORS.grey} />
    </Pressable>
  );
}

export default function SettingsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [apiUrl, setApiUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState(null);

  useEffect(() => {
    loadInferenceApiUrl().then(setApiUrl);
  }, []);

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
      setTestMsg(
        h.ok
          ? `OK · model: ${h.model_path || 'loaded'}${
              h.gemini_configured != null
                ? h.gemini_configured
                  ? ' · Gemini: on (server key)'
                  : ' · Gemini: set GEMINI_API_KEY on PC for AI test'
                : ''
            }`
          : 'Unexpected response'
      );
    } catch (e) {
      setTestMsg(e.message || String(e));
    } finally {
      setTesting(false);
    }
  }, [apiUrl]);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }]}>
      <StatusBar style="light" />
      <ScreenHeader title="Settings" onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionTitle}>Phase 3 — AI server (PC)</Text>
        <Text style={styles.sectionHint}>
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
          placeholderTextColor={COLORS.greyDark}
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
              <ActivityIndicator color={COLORS.btnText} size="small" />
            ) : (
              <Text style={styles.smallBtnTextDark}>Test connection</Text>
            )}
          </Pressable>
        </View>
        {testMsg ? <Text style={styles.testMsg}>{testMsg}</Text> : null}

        <View style={styles.card}>
          <Row
            icon="translate"
            label="Language & voice"
            onPress={() => navigation.navigate('LanguageVoice')}
          />
          <View style={styles.divider} />
          <Row
            icon="shield-check-outline"
            label="App permissions"
            onPress={() => navigation.navigate('Permissions')}
          />
        </View>

        <Text style={styles.hint}>
          Use the volume button on the live screen for alert loudness. Turn on “AI test” on the live
          screen to send camera frames to your PC model.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingHorizontal: 16,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  sectionTitle: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 8,
  },
  sectionHint: {
    color: COLORS.grey,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 12,
  },
  mono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    color: COLORS.tealBright,
    fontSize: 12,
  },
  input: {
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderMuted,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: COLORS.white,
    fontSize: 15,
    marginBottom: 12,
  },
  rowBtns: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  smallBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.teal,
    alignItems: 'center',
  },
  smallBtnPrimary: {
    backgroundColor: COLORS.teal,
    borderColor: COLORS.teal,
  },
  smallBtnText: {
    color: COLORS.teal,
    fontWeight: '700',
    fontSize: 15,
  },
  smallBtnTextDark: {
    color: COLORS.btnText,
    fontWeight: '800',
    fontSize: 15,
  },
  testMsg: {
    color: COLORS.tealBright,
    fontSize: 13,
    marginBottom: 16,
  },
  card: {
    backgroundColor: COLORS.bgElevated,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderMuted,
    marginTop: 8,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 14,
    gap: 12,
  },
  rowPressed: {
    opacity: 0.85,
  },
  rowLabel: {
    flex: 1,
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.borderMuted,
    marginLeft: 48,
  },
  hint: {
    color: COLORS.grey,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 20,
    paddingHorizontal: 4,
  },
});
