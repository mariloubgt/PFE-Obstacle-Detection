import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SPEECH_RATE_KEY,
  VIBRATION_DANGER_KEY,
  DANGER_THRESHOLD_M_KEY,
  AI_FRAME_MS_KEY,
  LOW_LIGHT_KEY,
  PRIMARY_LANG_KEY,
  INTERNET_GEMINI_KEY,
} from '../constants/storageKeys';

export const DEFAULTS = {
  speechRate: 0.6,
  vibrationDanger: true,
  dangerThresholdM: 0.8,
  aiFrameMs: 1000,
  lowLight: true,
  primaryLang: 'dz',
  internetGemini: false,
};

function parseBool(v, d) {
  if (v == null) return d;
  return v === '1' || v === 'true';
}

function parseNum(v, d, min, max) {
  if (v == null) return d;
  const n = parseFloat(v);
  if (Number.isNaN(n)) return d;
  return Math.min(max, Math.max(min, n));
}

function parseIntMs(v, d) {
  if (v == null) return d;
  const n = parseInt(String(v), 10);
  if (Number.isNaN(n)) return d;
  return Math.min(10000, Math.max(250, n));
}

export async function loadSpeechRate() {
  try {
    const v = await AsyncStorage.getItem(SPEECH_RATE_KEY);
    return parseNum(v, DEFAULTS.speechRate, 0.25, 1);
  } catch {
    return DEFAULTS.speechRate;
  }
}

export async function saveSpeechRate(r) {
  const x = parseNum(String(r), DEFAULTS.speechRate, 0.25, 1);
  try {
    await AsyncStorage.setItem(SPEECH_RATE_KEY, String(x));
  } catch {
    /* ignore */
  }
  return x;
}

export async function loadVibrationDanger() {
  try {
    const v = await AsyncStorage.getItem(VIBRATION_DANGER_KEY);
    return parseBool(v, DEFAULTS.vibrationDanger);
  } catch {
    return DEFAULTS.vibrationDanger;
  }
}

export async function saveVibrationDanger(b) {
  const x = Boolean(b);
  try {
    await AsyncStorage.setItem(VIBRATION_DANGER_KEY, x ? '1' : '0');
  } catch {
    /* ignore */
  }
  return x;
}

export async function loadDangerThresholdM() {
  try {
    const v = await AsyncStorage.getItem(DANGER_THRESHOLD_M_KEY);
    return parseNum(v, DEFAULTS.dangerThresholdM, 0.2, 3);
  } catch {
    return DEFAULTS.dangerThresholdM;
  }
}

export async function saveDangerThresholdM(m) {
  const x = parseNum(String(m), DEFAULTS.dangerThresholdM, 0.2, 3);
  try {
    await AsyncStorage.setItem(DANGER_THRESHOLD_M_KEY, String(x));
  } catch {
    /* ignore */
  }
  return x;
}

export async function loadAiFrameMs() {
  try {
    const v = await AsyncStorage.getItem(AI_FRAME_MS_KEY);
    return parseIntMs(v, DEFAULTS.aiFrameMs);
  } catch {
    return DEFAULTS.aiFrameMs;
  }
}

export async function saveAiFrameMs(ms) {
  const x = parseIntMs(String(ms), DEFAULTS.aiFrameMs);
  try {
    await AsyncStorage.setItem(AI_FRAME_MS_KEY, String(x));
  } catch {
    /* ignore */
  }
  return x;
}

export async function loadLowLight() {
  try {
    const v = await AsyncStorage.getItem(LOW_LIGHT_KEY);
    return parseBool(v, DEFAULTS.lowLight);
  } catch {
    return DEFAULTS.lowLight;
  }
}

export async function saveLowLight(b) {
  const x = Boolean(b);
  try {
    await AsyncStorage.setItem(LOW_LIGHT_KEY, x ? '1' : '0');
  } catch {
    /* ignore */
  }
  return x;
}

export async function loadPrimaryLang() {
  try {
    const v = await AsyncStorage.getItem(PRIMARY_LANG_KEY);
    if (v === 'fr' || v === 'dz') return v;
    return DEFAULTS.primaryLang;
  } catch {
    return DEFAULTS.primaryLang;
  }
}

export async function savePrimaryLang(lang) {
  const x = lang === 'fr' ? 'fr' : 'dz';
  try {
    await AsyncStorage.setItem(PRIMARY_LANG_KEY, x);
  } catch {
    /* ignore */
  }
  return x;
}

export async function loadInternetGemini() {
  try {
    const v = await AsyncStorage.getItem(INTERNET_GEMINI_KEY);
    return parseBool(v, DEFAULTS.internetGemini);
  } catch {
    return DEFAULTS.internetGemini;
  }
}

export async function saveInternetGemini(b) {
  const x = Boolean(b);
  try {
    await AsyncStorage.setItem(INTERNET_GEMINI_KEY, x ? '1' : '0');
  } catch {
    /* ignore */
  }
  return x;
}

/** Batch-load for the live / inference screen. */
export async function loadAppPreferences() {
  const [
    speechRate,
    vibrationDanger,
    dangerThresholdM,
    aiFrameMs,
    lowLight,
    primaryLang,
    internetGemini,
  ] = await Promise.all([
    loadSpeechRate(),
    loadVibrationDanger(),
    loadDangerThresholdM(),
    loadAiFrameMs(),
    loadLowLight(),
    loadPrimaryLang(),
    loadInternetGemini(),
  ]);
  return {
    speechRate,
    vibrationDanger,
    dangerThresholdM,
    aiFrameMs,
    lowLight,
    primaryLang,
    internetGemini,
  };
}
