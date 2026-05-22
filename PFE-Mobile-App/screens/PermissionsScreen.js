import { useCallback, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Audio } from 'expo-av';
import * as ExpoCamera from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../components/ScreenHeader';
import { LAYOUT } from '../constants/theme';
import { FONTS } from '../constants/typography';
import { useThemeColors } from '../contexts/ThemeContext';
import { loadInternetGemini, saveInternetGemini } from '../utils/appSettings';

async function getCameraPermissionState() {
  const get =
    ExpoCamera.getCameraPermissionsAsync ||
    ExpoCamera.getPermissionsAsync ||
    ExpoCamera.Camera?.getCameraPermissionsAsync ||
    ExpoCamera.Camera?.getPermissionsAsync;
  if (!get) return null;
  try {
    return await get();
  } catch {
    return null;
  }
}

async function requestCameraPermissionState() {
  const req =
    ExpoCamera.requestCameraPermissionsAsync ||
    ExpoCamera.requestPermissionsAsync ||
    ExpoCamera.Camera?.requestCameraPermissionsAsync ||
    ExpoCamera.Camera?.requestPermissionsAsync;
  if (!req) return null;
  try {
    return await req();
  } catch {
    return null;
  }
}

export default function PermissionsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          flex: 1,
          backgroundColor: colors.bg,
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
          color: colors.text,
          fontSize: 26,
          fontFamily: FONTS.en.extrabold,
          marginBottom: 8,
        },
        subtitle: {
          color: colors.tealBright,
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
          alignItems: 'flex-start',
          borderWidth: 1,
          borderColor: colors.borderMuted,
          borderRadius: LAYOUT.cardRadius,
          paddingVertical: 12,
          paddingHorizontal: 12,
          backgroundColor: colors.bgElevated,
          gap: 12,
        },
        rowSwitchCard: {
          alignItems: 'center',
        },
        rowSwitchText: {
          flex: 1,
          paddingRight: 4,
        },
        iconWrap: {
          width: 44,
          height: 44,
          borderRadius: 12,
          backgroundColor: 'rgba(45, 212, 191, 0.12)',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 2,
        },
        rowText: {
          flex: 1,
        },
        rowTitle: {
          color: colors.text,
          fontSize: 16,
          fontFamily: FONTS.en.bold,
          marginBottom: 4,
        },
        rowDesc: {
          color: colors.grey,
          fontSize: 13,
          lineHeight: 18,
          fontFamily: FONTS.en.regular,
          marginBottom: 10,
        },
        badge: {
          alignSelf: 'flex-start',
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 8,
          marginBottom: 10,
        },
        badgeOk: {
          backgroundColor: 'rgba(34, 197, 94, 0.18)',
        },
        badgeOff: {
          backgroundColor: 'rgba(248, 113, 113, 0.12)',
        },
        badgeText: {
          fontSize: 12,
          fontFamily: FONTS.en.semibold,
        },
        badgeTextOk: {
          color: '#86EFAC',
        },
        badgeTextOff: {
          color: '#FCA5A5',
        },
        rowActions: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
        },
        linkBtn: {
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: 10,
          backgroundColor: colors.teal,
        },
        linkBtnText: {
          color: colors.btnText,
          fontSize: 14,
          fontFamily: FONTS.en.bold,
        },
        linkBtnSecondary: {
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: colors.teal,
        },
        linkBtnSecondaryText: {
          color: colors.teal,
          fontSize: 14,
          fontFamily: FONTS.en.semibold,
        },
        pressed: { opacity: 0.92 },
        primaryBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: colors.teal,
          borderRadius: LAYOUT.buttonRadius,
          paddingVertical: 16,
          minHeight: 56,
          marginTop: 12,
        },
        primaryBtnText: {
          color: colors.btnText,
          fontSize: 17,
          fontFamily: FONTS.en.extrabold,
        },
        footerHint: {
          color: colors.grey,
          fontSize: 12,
          marginTop: 10,
          textAlign: 'center',
          fontFamily: FONTS.en.regular,
        },
      }),
    [colors]
  );

  function StatusBadge({ granted }) {
    return (
      <View style={[styles.badge, granted ? styles.badgeOk : styles.badgeOff]}>
        <Text style={[styles.badgeText, granted ? styles.badgeTextOk : styles.badgeTextOff]}>
          {granted ? 'Allowed' : 'Not allowed'}
        </Text>
      </View>
    );
  }

  const [cam, setCam] = useState(null);
  const [mic, setMic] = useState(null);
  const [internetGemini, setInternetGemini] = useState(false);

  const refreshAll = useCallback(async () => {
    const [c, m, gem] = await Promise.all([
      getCameraPermissionState(),
      Audio.getPermissionsAsync().catch(() => null),
      loadInternetGemini(),
    ]);
    setCam(c);
    setMic(m);
    setInternetGemini(gem);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll])
  );

  const openSettings = useCallback(() => {
    Linking.openSettings().catch(() => {});
  }, []);

  const onToggleGemini = useCallback(async (b) => {
    setInternetGemini(await saveInternetGemini(b));
  }, []);

  const camGranted = cam?.granted === true;
  const micGranted = mic?.granted === true;

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
      <StatusBar style={colors.statusBarStyle} />
      <ScreenHeader onBack={() => navigation.goBack()} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>App Permissions</Text>
        <Text style={styles.subtitle}>
          Real status from your phone — links open system Settings when needed.
        </Text>

        <View style={styles.list}>
          <View style={styles.rowCard}>
            <View style={styles.iconWrap}>
              <MaterialCommunityIcons name="camera-outline" size={26} color={colors.tealBright} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Camera</Text>
              <Text style={styles.rowDesc}>Required for obstacle detection and scene descriptions.</Text>
              <StatusBadge granted={camGranted} />
              <View style={styles.rowActions}>
                {!camGranted ? (
                  <Pressable
                    style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]}
                    onPress={async () => setCam(await requestCameraPermissionState())}
                  >
                    <Text style={styles.linkBtnText}>Ask iOS / Android</Text>
                  </Pressable>
                ) : null}
                <Pressable style={({ pressed }) => [styles.linkBtnSecondary, pressed && styles.pressed]} onPress={openSettings}>
                  <Text style={styles.linkBtnSecondaryText}>Open Settings</Text>
                </Pressable>
              </View>
            </View>
          </View>

          <View style={styles.rowCard}>
            <View style={styles.iconWrap}>
              <MaterialCommunityIcons name="microphone-outline" size={26} color={colors.tealBright} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Microphone</Text>
              <Text style={styles.rowDesc}>Used for voice commands and hands-free phrases.</Text>
              <StatusBadge granted={micGranted} />
              <View style={styles.rowActions}>
                {!micGranted ? (
                  <Pressable
                    style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]}
                    onPress={async () => {
                      try {
                        const r = await Audio.requestPermissionsAsync();
                        setMic(r);
                      } catch {
                        setMic(await Audio.getPermissionsAsync().catch(() => null));
                      }
                    }}
                  >
                    <Text style={styles.linkBtnText}>Ask iOS / Android</Text>
                  </Pressable>
                ) : null}
                <Pressable style={({ pressed }) => [styles.linkBtnSecondary, pressed && styles.pressed]} onPress={openSettings}>
                  <Text style={styles.linkBtnSecondaryText}>Open Settings</Text>
                </Pressable>
              </View>
            </View>
          </View>

          <View style={styles.rowCard}>
            <View style={styles.iconWrap}>
              <MaterialCommunityIcons name="surround-sound" size={26} color={colors.tealBright} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Spoken alerts</Text>
              <Text style={styles.rowDesc}>
                Uses the device text-to-speech engine (no extra permission). Adjust loudness under Alert volume in Settings.
              </Text>
            </View>
          </View>

          <View style={[styles.rowCard, styles.rowSwitchCard]}>
            <View style={styles.iconWrap}>
              <MaterialCommunityIcons name="cloud-outline" size={26} color={colors.tealBright} />
            </View>
            <View style={[styles.rowText, styles.rowSwitchText]}>
              <Text style={styles.rowTitle}>Internet · Gemini on server</Text>
              <Text style={styles.rowDesc}>
                Same toggle as Settings → Voice. Sends use_gemini with inference when your PC has a key configured.
              </Text>
            </View>
            <Switch
              value={internetGemini}
              onValueChange={onToggleGemini}
              trackColor={{ false: colors.borderMuted, true: colors.geminiSwitchTrackOn }}
              thumbColor={internetGemini ? colors.teal : '#CBD5E1'}
              ios_backgroundColor={colors.borderMuted}
            />
          </View>
        </View>
      </ScrollView>

      <Pressable
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        onPress={() => navigation.navigate('LanguageVoice')}
        accessibilityRole="button"
        accessibilityLabel="Continue"
      >
        <Text style={styles.primaryBtnText}>Continue</Text>
        <MaterialCommunityIcons name="arrow-right" size={22} color={colors.btnText} />
      </Pressable>
      {Platform.OS === 'ios' ? (
        <Text style={styles.footerHint}>If a permission stays off, enable it under Settings → VisionAid.</Text>
      ) : null}
    </View>
  );
}
