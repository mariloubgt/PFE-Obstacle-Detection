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
 * Map alert slider → expo-speech volume.
 * @param {number} [alertVolume01]
 */
export function ttsVolumeOptions(alertVolume01) {
  if (Platform.OS === 'web') return {};
  const v = clampAlertVolume01(alertVolume01);
  const speechVol = 0.88 + v * 0.12;
  return { volume: Math.min(1, speechVol) };
}
