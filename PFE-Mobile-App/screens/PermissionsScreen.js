import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../components/ScreenHeader';
import { COLORS } from '../constants/theme';

function PermissionRow({ icon, title, description, value, onValueChange }) {
  return (
    <View style={styles.rowCard}>
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons name={icon} size={26} color={COLORS.tealBright} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDesc}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: COLORS.borderMuted, true: '#134E4A' }}
        thumbColor={value ? COLORS.teal : '#CBD5E1'}
        ios_backgroundColor={COLORS.borderMuted}
      />
    </View>
  );
}

export default function PermissionsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [camera, setCamera] = useState(true);
  const [voiceCmd, setVoiceCmd] = useState(true);
  const [audioAlerts, setAudioAlerts] = useState(true);
  const [internet, setInternet] = useState(false);

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
          Explained in plain language — no technical terms
        </Text>

        <View style={styles.list}>
          <PermissionRow
            icon="monitor"
            title="Live Camera Feed"
            description="See obstacles in front of you in real time."
            value={camera}
            onValueChange={setCamera}
          />
          <PermissionRow
            icon="microphone"
            title="Voice Commands in Daridja"
            description="Speak to control the app hands-free."
            value={voiceCmd}
            onValueChange={setVoiceCmd}
          />
          <PermissionRow
            icon="surround-sound"
            title="Audio Alerts in Daridja"
            description="Hear warnings about people and objects nearby."
            value={audioAlerts}
            onValueChange={setAudioAlerts}
          />
          <PermissionRow
            icon="information-outline"
            title="Internet (Gemini AI only)"
            description="Used only when you ask the assistant a question."
            value={internet}
            onValueChange={setInternet}
          />
        </View>
      </ScrollView>

      <Pressable
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        onPress={() => navigation.navigate('LanguageVoice')}
        accessibilityRole="button"
        accessibilityLabel="Continue"
      >
        <Text style={styles.primaryBtnText}>Continue</Text>
        <MaterialCommunityIcons name="arrow-right" size={22} color={COLORS.btnText} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingHorizontal: 20,
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
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    color: COLORS.tealBright,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  list: {
    gap: 14,
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.teal,
    borderRadius: 14,
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
    fontWeight: '700',
    marginBottom: 4,
  },
  rowDesc: {
    color: COLORS.grey,
    fontSize: 13,
    lineHeight: 18,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.teal,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 12,
  },
  pressed: { opacity: 0.92 },
  primaryBtnText: {
    color: COLORS.btnText,
    fontSize: 17,
    fontWeight: '800',
  },
});
