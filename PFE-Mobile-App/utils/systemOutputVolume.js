import { NativeModules, Platform } from 'react-native';

/**
 * Single source of truth for:
 * - real device output level (same stream as side buttons)
 * - level to restore after volume-key “describe” shortcut
 */
export const alertOutputState = {
  /** 0–1 — always matches what user set in Settings / slider (not a stale getVolume snapshot). */
  baseline01: 0.8,
};

function clamp01(v) {
  const n = typeof v === 'number' && !Number.isNaN(v) ? v : 0.8;
  return Math.min(1, Math.max(0, n));
}

/**
 * Push level to system + update baseline used when hardware keys are restored.
 * @param {number} volume01
 */
export async function applyAlertVolumeToSystemOutput(volume01) {
  const v = clamp01(volume01);
  alertOutputState.baseline01 = v;

  if (Platform.OS === 'web') return;
  if (!NativeModules.VolumeManager) return;

  try {
    // eslint-disable-next-line global-require
    const mod = require('react-native-volume-manager');
    if (Platform.OS === 'ios' && typeof mod.enable === 'function') {
      await Promise.resolve(mod.enable(true, true)).catch(() => {});
    }
    if (typeof mod.setVolume !== 'function') return;
    await mod.setVolume(v, {
      playSound: false,
      type: 'music',
      showUI: false,
    });
  } catch {
    /* ignore */
  }
}

/**
 * Slider dragging: smooth updates without waiting on AsyncStorage.
 * Same as apply — baseline stays aligned while sliding.
 */
export function stageAlertVolumeLive(volume01) {
  return applyAlertVolumeToSystemOutput(volume01);
}
