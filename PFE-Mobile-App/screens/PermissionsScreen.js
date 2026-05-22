import { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ExpoCamera from 'expo-camera';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../components/ScreenHeader';
import { COLORS, LAYOUT } from '../constants/theme';
import { FONTS } from '../constants/typography';
import { loadInternetGemini, saveInternetGemini } from '../utils/appSettings';

function tryLoadSpeechRecognition() {
  try {
    return require('expo-speech-recognition');
  } catch {
    return null;
  }
}

function PermissionRow({ icon, title, description, value, onValueChange, busy }) {
  return (
    <View style={styles.rowCard}>
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons name={icon} size={26} color={COLORS.tealBright} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDesc}>{description}</Text>
      </View>
      {busy ? (
        <ActivityIndicator color={COLORS.teal} />
      ) : (
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: COLORS.borderMuted, true: '#134E4A' }}
          thumbColor={value ? COLORS.teal : '#CBD5E1'}
          ios_backgroundColor={COLORS.borderMuted}
        />
      )}
    </View>
  );
}

export default function PermissionsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [camera, setCamera] = useState(false);
  const [voiceCmd, setVoiceCmd] = useState(false);
  const [audioAlerts, setAudioAlerts] = useState(true);
  const [internet, setInternet] = useState(false);
  const [busyKey, setBusyKey] = useState(null);

  const refreshStatus = useCallback(async () => {
    const camGet =
      ExpoCamera.getCameraPermissionsAsync ||
      ExpoCamera.getPermissionsAsync ||
      ExpoCamera.Camera?.getCameraPermissionsAsync;
    if (camGet) {
      const cam = await camGet();
      setCamera(Boolean(cam?.granted));
    }

    const SR = tryLoadSpeechRecognition();
    if (SR?.getPermissionsAsync) {
      const mic = await SR.getPermissionsAsync();
      setVoiceCmd(Boolean(mic?.granted));
    }

    setInternet(await loadInternetGemini());
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const requestCamera = useCallback(async (enable) => {
    setBusyKey('camera');
    try {
      if (!enable) {
        setCamera(false);
        return;
      }
      const req =
        ExpoCamera.requestCameraPermissionsAsync ||
        ExpoCamera.requestPermissionsAsync ||
        ExpoCamera.Camera?.requestCameraPermissionsAsync;
      if (!req) {
        Alert.alert('Camera', 'Camera permission API is not available in this build.');
        return;
      }
      const res = await req();
      setCamera(Boolean(res?.granted));
      if (!res?.granted) {
        Alert.alert('Camera required', 'Allow camera access in Settings to detect obstacles.');
      }
    } finally {
      setBusyKey(null);
    }
  }, []);

  const requestVoice = useCallback(async (enable) => {
    setBusyKey('voice');
    try {
      if (!enable) {
        setVoiceCmd(false);
        return;
      }
      const SR = tryLoadSpeechRecognition();
      if (!SR?.requestPermissionsAsync) {
        Alert.alert(
          'Voice commands',
          'Speech recognition needs a dev client build with expo-speech-recognition. You can still use on-screen buttons.'
        );
        return;
      }
      const res = await SR.requestPermissionsAsync();
      setVoiceCmd(Boolean(res?.granted));
      if (!res?.granted) {
        Alert.alert('Microphone', 'Allow microphone access for hands-free phrases.');
      }
    } finally {
      setBusyKey(null);
    }
  }, []);

  const onContinue = useCallback(async () => {
    setBusyKey('continue');
    try {
      if (!camera) await requestCamera(true);
      if (!voiceCmd) await requestVoice(true);
      await saveInternetGemini(internet);
      navigation.navigate('LanguageVoice');
    } finally {
      setBusyKey(null);
    }
  }, [camera, voiceCmd, internet, navigation, requestCamera, requestVoice]);

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top,
          paddingBottom: Math.max(insets.bottom, 16),
        },
      ]}
    >
      <StatusBar style="light" />
      <ScreenHeader onBack={() => navigation.goBack()} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>App Permissions</Text>
        <Text style={styles.subtitle}>
          Turn on what you need — toggles request real iOS permissions
        </Text>

        <View style={styles.list}>
          <PermissionRow
            icon="camera"
            title="Live Camera Feed"
            description="Detects obstacles and distances in real time."
            value={camera}
            busy={busyKey === 'camera'}
            onValueChange={(v) => void requestCamera(v)}
          />
          <PermissionRow
            icon="microphone"
            title="Voice Commands in English"
            description="Hands-free phrase and speech recognition (dev build)."
            value={voiceCmd}
            busy={busyKey === 'voice'}
            onValueChange={(v) => void requestVoice(v)}
          />
          <PermissionRow
            icon="surround-sound"
            title="Audio Alerts in English"
            description="Spoken warnings and alert volume — no extra permission."
            value={audioAlerts}
            onValueChange={setAudioAlerts}
          />
          <PermissionRow
            icon="cloud-outline"
            title="Internet (Gemini on PC server)"
            description="Sends frames to your PC for optional Gemini enrichment."
            value={internet}
            onValueChange={async (v) => setInternet(await saveInternetGemini(v))}
          />
        </View>
      </ScrollView>

      <Pressable
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        onPress={() => void onContinue()}
        disabled={busyKey === 'continue'}
        accessibilityRole="button"
        accessibilityLabel="Continue"
      >
        {busyKey === 'continue' ? (
          <ActivityIndicator color={COLORS.btnText} />
        ) : (
          <>
            <Text style={styles.primaryBtnText}>Continue</Text>
            <MaterialCommunityIcons name="arrow-right" size={22} color={COLORS.btnText} />
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingHorizontal: LAYOUT.screenPaddingH,
  },
  scrollView: {
    flex: 1,
  },
  scroll: {
    paddingTop: 8,
    paddingBottom: 16,
    flexGrow: 1,
  },
  title: {
    color: COLORS.white,
    fontSize: 26,
    fontFamily: FONTS.en.extrabold,
    marginBottom: 8,
  },
  subtitle: {
    color: COLORS.tealBright,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
    fontFamily: FONTS.en.regular,
  },
  list: {
    gap: 14,
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderMuted,
    borderRadius: LAYOUT.cardRadius,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: COLORS.bgElevated,
    gap: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(45, 212, 191, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    color: COLORS.white,
    fontSize: 16,
    fontFamily: FONTS.en.bold,
    marginBottom: 4,
  },
  rowDesc: {
    color: COLORS.grey,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONTS.en.regular,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.teal,
    borderRadius: LAYOUT.buttonRadius,
    paddingVertical: 16,
    minHeight: 56,
    marginTop: 12,
  },
  pressed: { opacity: 0.92 },
  primaryBtnText: {
    color: COLORS.btnText,
    fontSize: 17,
    fontFamily: FONTS.en.extrabold,
  },
});
