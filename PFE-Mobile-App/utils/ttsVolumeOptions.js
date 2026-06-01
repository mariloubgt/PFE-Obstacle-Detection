import { Platform } from 'react-native';

/**
 * Clamp saved alert volume (0–1) for TTS.
 * @param {number} [v]
 * @returns {number}
 */
export function clampAlertVolume01(v) {
  const n = typeof v === 'number' && !Number.isNaN(v) ? v : 1;
  return Math.min(1, Math.max(0, n));
}

/**
 * Map alert slider → expo-speech volume. Keeps alerts loud even below 100%.
 * @param {number} [alertVolume01]
 * @param {{ urgent?: boolean }} [opts]
 */
export function ttsVolumeOptions(alertVolume01, opts = {}) {
  if (Platform.OS === 'web') return {};
  if (opts.urgent) {
    return { volume: 1 };
  }
  const v = clampAlertVolume01(alertVolume01);
  // Floor 0.88 so alerts stay audible; slider still scales up to 1.0.
  const speechVol = 0.88 + v * 0.12;
  return { volume: Math.min(1, speechVol) };
}
