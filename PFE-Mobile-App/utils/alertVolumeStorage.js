import AsyncStorage from '@react-native-async-storage/async-storage';
import { ALERT_VOLUME_KEY } from '../constants/storageKeys';

const DEFAULT = 0.8;

function clamp01(n) {
  if (Number.isNaN(n)) return DEFAULT;
  return Math.min(1, Math.max(0, n));
}

/** @returns {Promise<number>} 0–1, default 0.8 (80%) */
export async function loadAlertVolume() {
  try {
    const v = await AsyncStorage.getItem(ALERT_VOLUME_KEY);
    if (v == null) return DEFAULT;
    return clamp01(parseFloat(v));
  } catch {
    return DEFAULT;
  }
}

export async function saveAlertVolume(v) {
  const x = clamp01(v);
  try {
    await AsyncStorage.setItem(ALERT_VOLUME_KEY, String(x));
  } catch {
    /* ignore */
  }
  return x;
}
