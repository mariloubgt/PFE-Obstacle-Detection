import AsyncStorage from '@react-native-async-storage/async-storage';
import { INFERENCE_API_URL_KEY } from '../constants/storageKeys';

/** @returns {Promise<string>} trimmed URL or empty string */
export async function loadInferenceApiUrl() {
  try {
    const v = await AsyncStorage.getItem(INFERENCE_API_URL_KEY);
    return (v || '').trim();
  } catch {
    return '';
  }
}

export async function saveInferenceApiUrl(url) {
  const u = (url || '').trim();
  try {
    await AsyncStorage.setItem(INFERENCE_API_URL_KEY, u);
  } catch {
    /* ignore */
  }
  return u;
}
