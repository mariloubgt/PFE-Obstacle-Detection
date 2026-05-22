import { NativeModules, Platform } from 'react-native';

/**
 * Single source of truth for alert loudness preference (0–1).
 * On iOS we do NOT call VolumeManager.setVolume — it hijacks MPVolumeView and breaks TTS routing.
 */
export const alertOutputState = {
  baseline01: 0.8,
};

function clamp01(v) {
  const n = typeof v === 'number' && !Number.isNaN(v) ? v : 0.8;
  return Math.min(1, Math.max(0, n));
}

/**
 * Store alert volume preference. User adjusts real loudness with iPhone side buttons.
 * @param {number} volume01
 */
export async function applyAlertVolumeToSystemOutput(volume01) {
  alertOutputState.baseline01 = clamp01(volume01);

  if (Platform.OS === 'web') return;
  if (Platform.OS === 'ios') return;

  if (!NativeModules.VolumeManager) return;

  try {
    const mod = require('react-native-volume-manager');
    if (typeof mod.setVolume !== 'function') return;
    await mod.setVolume(alertOutputState.baseline01, {
      playSound: false,
      type: 'music',
      showUI: false,
    });
  } catch {
    /* ignore */
  }
}

export function stageAlertVolumeLive(volume01) {
  return applyAlertVolumeToSystemOutput(volume01);
}
