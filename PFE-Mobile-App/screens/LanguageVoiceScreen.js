import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../components/ScreenHeader';
import { COLORS } from '../constants/theme';
import { loadAlertVolume, saveAlertVolume } from '../utils/alertVolumeStorage';

export default function LanguageVoiceScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [lang, setLang] = useState('dz');
  const [speechRate, setSpeechRate] = useState(0.45);
  const [volume, setVolume] = useState(0.66);

  useEffect(() => {
    loadAlertVolume().then((v) => {
      if (v != null) setVolume(v);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAlertVolume().then((v) => {
        if (v != null) setVolume(v);
      });
    }, [])
  );

  const onAlertVolumeComplete = useCallback(async (v) => {
    const saved = await saveAlertVolume(v);
    setVolume(saved);
  }, []);

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

      <Text style={styles.title}>Language & Voice</Text>
      <Text style={styles.subtitle}>Set once — you’ll never need to change this</Text>

      <View style={styles.langRow}>
        <Pressable
          onPress={() => setLang('dz')}
          style={[styles.langCard, lang === 'dz' && styles.langCardActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: lang === 'dz' }}
        >
          {lang === 'dz' ? (
            <MaterialCommunityIcons name="check-circle" size={22} color={COLORS.teal} />
          ) : (
            <View style={styles.radioOuter} />
          )}
          <Text style={styles.langCode}>DZ</Text>
          <Text style={styles.langAr}>دارجة</Text>
          <Text style={styles.langEn}>Algerian Daridja</Text>
        </Pressable>

        <Pressable
          onPress={() => setLang('fr')}
          style={[styles.langCard, lang === 'fr' && styles.langCardActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: lang === 'fr' }}
        >
          {lang === 'fr' ? (
            <MaterialCommunityIcons name="check-circle" size={22} color={COLORS.teal} />
          ) : (
            <View style={styles.radioOuter} />
          )}
          <Text style={styles.langCode}>FR</Text>
          <Text style={styles.langFr}>Français</Text>
          <Text style={styles.langEn}>French</Text>
        </Pressable>
      </View>

      <View style={styles.sliderBlock}>
        <View style={styles.sliderHeader}>
          <Text style={styles.sliderLabel}>Speech Rate</Text>
          <Text style={styles.sliderHint}>Slow+</Text>
        </View>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={1}
          value={speechRate}
          onValueChange={setSpeechRate}
          minimumTrackTintColor={COLORS.teal}
          maximumTrackTintColor={COLORS.borderMuted}
          thumbTintColor={COLORS.teal}
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
          onValueChange={setVolume}
          onSlidingComplete={onAlertVolumeComplete}
          minimumTrackTintColor={COLORS.teal}
          maximumTrackTintColor={COLORS.borderMuted}
          thumbTintColor={COLORS.teal}
        />
        <View style={styles.sliderEnds}>
          <Text style={styles.endLabel}>Low</Text>
          <Text style={styles.endLabel}>High</Text>
        </View>
      </View>

      <View style={{ flex: 1 }} />

      <Pressable
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        onPress={() => navigation.navigate('Main')}
        accessibilityRole="button"
        accessibilityLabel="Start VisionAid"
      >
        <Text style={styles.primaryBtnText}>Start VisionAid</Text>
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
    paddingTop: 8,
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
    marginBottom: 22,
  },
  langRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 28,
  },
  langCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.borderMuted,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    backgroundColor: COLORS.bgElevated,
    gap: 6,
  },
  langCardActive: {
    borderColor: COLORS.teal,
    borderWidth: 2,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.greyDark,
  },
  langCode: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: '800',
  },
  langAr: {
    color: COLORS.tealBright,
    fontSize: 16,
    writingDirection: 'rtl',
  },
  langFr: {
    color: COLORS.tealBright,
    fontSize: 16,
  },
  langEn: {
    color: COLORS.grey,
    fontSize: 12,
    textAlign: 'center',
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
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
  },
  sliderHint: {
    color: COLORS.tealBright,
    fontSize: 14,
    fontWeight: '600',
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
    color: COLORS.grey,
    fontSize: 12,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.teal,
    borderRadius: 14,
    paddingVertical: 16,
  },
  pressed: { opacity: 0.92 },
  primaryBtnText: {
    color: COLORS.btnText,
    fontSize: 17,
    fontWeight: '800',
  },
});
