import AsyncStorage from '@react-native-async-storage/async-storage';
import { ALERT_VOLUME_KEY } from '../constants/storageKeys';

/** @returns {Promise<number|null>} stored 0–1 or null if missing/invalid */
export async function loadAlertVolume() {
  try {
    const raw = await AsyncStorage.getItem(ALERT_VOLUME_KEY);
    if (raw == null) return null;
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return null;
    return Math.min(1, Math.max(0, n));
  } catch {
    return null;
  }
}

/** Persists 0–1 and returns the saved value */
export async function saveAlertVolume(value) {
  let v = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(v)) v = 0.66;
  v = Math.min(1, Math.max(0, v));
  try {
    await AsyncStorage.setItem(ALERT_VOLUME_KEY, String(v));
  } catch {
    /* ignore */
  }
  return v;
}
