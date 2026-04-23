import { useCallback, useEffect, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import { Accelerometer } from 'expo-sensors';
import * as Speech from 'expo-speech';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LAYOUT } from '../constants/theme';
import { FONTS } from '../constants/typography';

const DANGER = {
  bg: '#1a0a0a',
  crimson: '#ff4d4d',
  crimsonMuted: 'rgba(255, 77, 77, 0.25)',
  textMuted: 'rgba(252, 165, 165, 0.7)',
  ring1: 'rgba(255, 77, 77, 0.9)',
  ring2: 'rgba(180, 30, 30, 0.5)',
  ring3: 'rgba(120, 20, 20, 0.4)',
  instructionBox: 'rgba(30, 10, 10, 0.85)',
};

const SHAKE_ACCEL = 1.65;
const SHAKE_COOLDOWN_MS = 1200;

export default function DangerAlertModal({ visible, displayLabel, distanceM, arMessage, onBack }) {
  const insets = useSafeAreaInsets();
  const lastShakeAt = useRef(0);
  const lastMagnitude = useRef(0);

  const runRepeat = useCallback(() => {
    const now = Date.now();
    if (now - lastShakeAt.current < SHAKE_COOLDOWN_MS) return;
    lastShakeAt.current = now;
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
    Speech.stop();
    Speech.speak(arMessage, {
      language: 'ar-SA',
      rate: 0.95,
    });
  }, [arMessage]);

  useEffect(() => {
    if (!visible) return;
    if (Platform.OS === 'web') return;

    let sub;
    Accelerometer.setUpdateInterval(200);

    lastMagnitude.current = 1;

    sub = Accelerometer.addListener((a) => {
      const m = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
      const delta = Math.abs(m - lastMagnitude.current);
      lastMagnitude.current = m;
      if (delta > SHAKE_ACCEL) {
        runRepeat();
      }
    });

    return () => {
      sub.remove();
    };
  }, [runRepeat, visible]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      presentationStyle="fullScreen"
    >
      <StatusBar style="light" />
      <View
        style={[
          styles.root,
          { paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 20) },
        ]}
      >
        <View style={styles.rings}>
          <View style={[styles.ring, styles.r3]}>
            <View style={[styles.ring, styles.r2]}>
              <View style={[styles.ring, styles.r1]}>
                <View style={styles.triangleBox}>
                  <MaterialCommunityIcons name="alert" size={56} color={DANGER.crimson} />
                </View>
              </View>
            </View>
          </View>
        </View>

        <Text style={styles.heading}>{String(displayLabel || 'OBSTACLE').toUpperCase()} DETECTED</Text>

        <View style={styles.distRow}>
          <Text style={styles.distNum}>{formatDistance(distanceM)}</Text>
          <Text style={styles.distUnit}>meters ahead</Text>
        </View>

        <Text style={styles.arLine} accessibilityLabel="Arabic warning">
          {arMessage}
        </Text>

        <View style={styles.instructionBox}>
          <Text style={styles.instructionTitle}>STOP • DO NOT MOVE FORWARD</Text>
          <Text style={styles.instructionSub}>Auto-clears when path is safe</Text>
        </View>

        <Text style={styles.shakeHint}>Shake phone to repeat warning</Text>

        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.92 }]}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to navigation"
        >
          <Text style={styles.backBtnText}>← Back to Navigation</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function formatDistance(m) {
  if (m == null || Number.isNaN(m)) return '—';
  return (Math.round(m * 10) / 10).toFixed(1);
}

const RING = 200;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: DANGER.bg,
    paddingHorizontal: LAYOUT.screenPaddingH,
    alignItems: 'center',
  },
  rings: {
    width: RING,
    height: RING,
    marginTop: 8,
    marginBottom: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  r3: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    backgroundColor: DANGER.ring3,
  },
  r2: {
    width: RING * 0.78,
    height: RING * 0.78,
    borderRadius: (RING * 0.78) / 2,
    backgroundColor: DANGER.ring2,
  },
  r1: {
    width: RING * 0.55,
    height: RING * 0.55,
    borderRadius: (RING * 0.55) / 2,
    backgroundColor: DANGER.bg,
    borderWidth: 3,
    borderColor: DANGER.ring1,
  },
  triangleBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    color: '#fff',
    fontSize: 18,
    fontFamily: FONTS.en.extrabold,
    letterSpacing: 1.2,
    textAlign: 'center',
    marginBottom: 16,
  },
  distRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 10,
  },
  distNum: {
    color: DANGER.crimson,
    fontSize: 64,
    lineHeight: 70,
    fontFamily: FONTS.en.extrabold,
  },
  distUnit: {
    color: '#fff',
    fontSize: 16,
    fontFamily: FONTS.en.regular,
    marginLeft: 10,
    marginBottom: 10,
  },
  arLine: {
    color: DANGER.crimson,
    fontSize: 20,
    lineHeight: 30,
    textAlign: 'center',
    marginBottom: 32,
    fontFamily: FONTS.ar.regular,
    writingDirection: 'rtl',
  },
  instructionBox: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: DANGER.instructionBox,
    borderRadius: LAYOUT.cardRadius,
    paddingVertical: 18,
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  instructionTitle: {
    color: '#fff',
    fontSize: 16,
    fontFamily: FONTS.en.bold,
    textAlign: 'center',
    marginBottom: 8,
  },
  instructionSub: {
    color: DANGER.textMuted,
    fontSize: 14,
    fontFamily: FONTS.en.regular,
    textAlign: 'center',
  },
  shakeHint: {
    color: DANGER.textMuted,
    fontSize: 14,
    fontFamily: FONTS.en.regular,
    textAlign: 'center',
    marginBottom: 32,
  },
  backBtn: {
    width: '100%',
    maxWidth: 400,
    paddingVertical: 18,
    borderRadius: LAYOUT.buttonRadius,
    backgroundColor: DANGER.crimsonMuted,
    borderWidth: 1,
    borderColor: 'rgba(255, 77, 77, 0.65)',
    alignItems: 'center',
    minHeight: 56,
  },
  backBtnText: {
    color: '#FCA5A5',
    fontSize: 17,
    fontFamily: FONTS.en.semibold,
  },
});
