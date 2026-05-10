import { Platform } from 'react-native';

/**
 * Clamp saved alert volume (0–1) for TTS.
 * @param {number} [v]
 * @returns {number}
 */
export function clampAlertVolume01(v) {
  const n = typeof v === 'number' && !Number.isNaN(v) ? v : 0.8;
  return Math.min(1, Math.max(0, n));
}

/**
 * Spread into expo-speech. Loudness is driven by system output volume
 * (see applyAlertVolumeToSystemOutput / saveAlertVolume). Utterance stays at full relative level.
 */
export function ttsVolumeOptions(_alertVolume01) {
  if (Platform.OS === 'web') return {};
  return { volume: 1 };
}
