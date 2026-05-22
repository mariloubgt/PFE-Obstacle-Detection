import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../components/ScreenHeader';
import { LAYOUT } from '../constants/theme';
import { FONTS } from '../constants/typography';
import { useThemeColors } from '../contexts/ThemeContext';
import { saveAlertVolume, syncStoredAlertVolumeToSystem } from '../utils/alertVolumeStorage';
import { applyAlertVolumeToSystemOutput } from '../utils/systemOutputVolume';
import { loadSpeechRate, saveSpeechRate } from '../utils/appSettings';
import { buildTtsOptions } from '../utils/buildTtsOptions';
import { speakAlert } from '../utils/speakAlert';

export default function LanguageVoiceScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = useMemo(() => createLanguageVoiceStyles(colors), [colors]);
  const [speechRate, setSpeechRate] = useState(0.45);
  const [volume, setVolume] = useState(0.66);

  const reloadPrefs = useCallback(() => {
    syncStoredAlertVolumeToSystem().then((v) => setVolume(v));
    loadSpeechRate().then((r) => {
      if (r != null) setSpeechRate(r);
    });
  }, []);

  useEffect(() => {
    reloadPrefs();
  }, [reloadPrefs]);

  useFocusEffect(
    useCallback(() => {
      reloadPrefs();
    }, [reloadPrefs])
  );

  const onAlertVolumeComplete = useCallback(async (v) => {
    const saved = await saveAlertVolume(v);
    setVolume(saved);
  }, []);

  const speechLabel = useMemo(() => {
    if (speechRate < 0.25) return 'Slow';
    if (speechRate < 0.45) return 'Slow+';
    if (speechRate < 0.7) return 'Medium';
    return 'Fast';
  }, [speechRate]);

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

      <Text style={styles.title}>Voice Settings</Text>
      <Text style={styles.subtitle}>The app now runs in English only</Text>

      <View style={styles.sliderBlock}>
        <View style={styles.sliderHeader}>
          <Text style={styles.sliderLabel}>Speech Rate</Text>
          <Text style={styles.sliderHint}>{speechLabel}</Text>
        </View>
        <Slider
          style={styles.slider}
          minimumValue={0.55}
          maximumValue={1}
          value={speechRate}
          onValueChange={setSpeechRate}
          onSlidingComplete={async (v) => {
            setSpeechRate(await saveSpeechRate(v));
          }}
          minimumTrackTintColor={colors.teal}
          maximumTrackTintColor={colors.borderMuted}
          thumbTintColor={colors.teal}
        />
        <View style={styles.sliderEnds}>
          <Text style={styles.endLabel}>Slow</Text>
          <Text style={styles.endLabel}>Fast</Text>
        </View>
      </View>

      <View style={styles.sliderBlock}>
        <View style={styles.sliderHeader}>
          <Text style={styles.sliderLabel}>Alert Volume</Text>
          <Text style={styles.sliderHint}>{Math.round(volume * 100)}%</Text>
        </View>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={1}
          value={volume}
          onValueChange={(v) => {
            setVolume(v);
            void applyAlertVolumeToSystemOutput(v);
          }}
          onSlidingComplete={onAlertVolumeComplete}
          minimumTrackTintColor={colors.teal}
          maximumTrackTintColor={colors.borderMuted}
          thumbTintColor={colors.teal}
        />
        <View style={styles.sliderEnds}>
          <Text style={styles.endLabel}>Low</Text>
          <Text style={styles.endLabel}>High</Text>
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [styles.testVoiceBtn, pressed && styles.pressed]}
        onPress={() => {
          speakAlert(
            'This is how navigation alerts will sound at your current settings.',
            buildTtsOptions(volume, speechRate)
          );
        }}
        accessibilityRole="button"
        accessibilityLabel="Test voice settings"
      >
        <MaterialCommunityIcons name="volume-high" size={20} color={colors.teal} />
        <Text style={styles.testVoiceText}>Test voice</Text>
      </Pressable>

      <View style={{ flex: 1 }} />

      <Pressable
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        onPress={() => navigation.navigate('Main')}
        accessibilityRole="button"
        accessibilityLabel="Start navigation"
      >
        <Text style={styles.primaryBtnText}>Start</Text>
        <MaterialCommunityIcons name="arrow-right" size={22} color={colors.btnText} />
      </Pressable>
    </View>
  );
}

function createLanguageVoiceStyles(colors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
      paddingHorizontal: LAYOUT.screenPaddingH,
      paddingTop: 8,
    },
    title: {
      color: colors.white,
      fontSize: 26,
      fontFamily: FONTS.en.extrabold,
      marginBottom: 8,
    },
    subtitle: {
      color: colors.tealBright,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 22,
      fontFamily: FONTS.en.regular,
    },
    sliderBlock: {
      marginBottom: 22,
    },
    sliderHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    sliderLabel: {
      color: colors.white,
      fontSize: 16,
      fontFamily: FONTS.en.bold,
    },
    sliderHint: {
      color: colors.tealBright,
      fontSize: 14,
      fontFamily: FONTS.en.semibold,
    },
    slider: {
      width: '100%',
      height: 40,
    },
    sliderEnds: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: -4,
    },
    endLabel: {
      color: colors.grey,
      fontSize: 12,
      fontFamily: FONTS.en.regular,
    },
    testVoiceBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      borderRadius: LAYOUT.buttonRadius,
      borderWidth: 1,
      borderColor: colors.teal,
      marginBottom: 16,
    },
    testVoiceText: {
      color: colors.teal,
      fontSize: 15,
      fontFamily: FONTS.en.semibold,
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.teal,
      borderRadius: LAYOUT.buttonRadius,
      paddingVertical: 16,
      minHeight: 56,
    },
    pressed: { opacity: 0.92 },
    primaryBtnText: {
      color: colors.btnText,
      fontSize: 17,
      fontFamily: FONTS.en.extrabold,
    },
  });
}
