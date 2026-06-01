import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AI_LAB_PREDICT_OPTS_KEY,
  AI_LAB_URL_PRESETS_KEY,
} from '../constants/storageKeys';
import { isSimulatorDevice } from './isSimulator';

export const DEFAULT_LAB_PREDICT_OPTS = {
  useGroq: true,
  useGemini: false,
  groqMode: 'navigate',
  detailed: true,
};

const BUILTIN_PRESETS = [
  { id: 'sim', label: 'Simulator (this Mac)', url: 'http://127.0.0.1:8787' },
  { id: 'lan-hint', label: 'LAN — use Test connection', url: '' },
];

export async function loadUrlPresets() {
  try {
    const raw = await AsyncStorage.getItem(AI_LAB_URL_PRESETS_KEY);
    const custom = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(custom)) return [...BUILTIN_PRESETS];
    return [...BUILTIN_PRESETS, ...custom];
  } catch {
    return [...BUILTIN_PRESETS];
  }
}

export async function saveCustomPresets(customOnly) {
  const list = Array.isArray(customOnly) ? customOnly : [];
  try {
    await AsyncStorage.setItem(AI_LAB_URL_PRESETS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}

export async function addUrlPreset(label, url) {
  const trimmed = (url || '').trim().replace(/\/$/, '');
  if (!trimmed.startsWith('http')) return loadUrlPresets();
  const raw = await AsyncStorage.getItem(AI_LAB_URL_PRESETS_KEY);
  const custom = raw ? JSON.parse(raw) : [];
  const next = Array.isArray(custom) ? custom : [];
  next.push({
    id: `p-${Date.now()}`,
    label: (label || trimmed).slice(0, 40),
    url: trimmed,
  });
  await saveCustomPresets(next);
  return loadUrlPresets();
}

export async function removeCustomPreset(id) {
  const raw = await AsyncStorage.getItem(AI_LAB_URL_PRESETS_KEY);
  const custom = raw ? JSON.parse(raw) : [];
  const next = (Array.isArray(custom) ? custom : []).filter((p) => p.id !== id);
  await saveCustomPresets(next);
  return loadUrlPresets();
}

export async function loadLabPredictOpts() {
  try {
    const raw = await AsyncStorage.getItem(AI_LAB_PREDICT_OPTS_KEY);
    if (!raw) return { ...DEFAULT_LAB_PREDICT_OPTS };
    const o = JSON.parse(raw);
    return {
      useGroq: o.useGroq !== false,
      useGemini: Boolean(o.useGemini),
      groqMode: o.groqMode === 'navigate' ? 'navigate' : 'describe',
      detailed: o.detailed !== false,
    };
  } catch {
    return { ...DEFAULT_LAB_PREDICT_OPTS };
  }
}

export async function saveLabPredictOpts(opts) {
  const x = {
    useGroq: opts.useGroq !== false,
    useGemini: Boolean(opts.useGemini),
    groqMode: opts.groqMode === 'navigate' ? 'navigate' : 'describe',
    detailed: opts.detailed !== false,
  };
  try {
    await AsyncStorage.setItem(AI_LAB_PREDICT_OPTS_KEY, JSON.stringify(x));
  } catch {
    /* ignore */
  }
  return x;
}

/**
 * Merge app prefs with AI lab predict overrides (lab wins for AI flags).
 */
export async function getPredictOptionsForRequest(appPrefs) {
  const lab = await loadLabPredictOpts();
  return {
    hfovDeg: appPrefs.cameraHfovDeg,
    depthScale: appPrefs.depthScale,
    useGemini: lab.useGemini,
    useGroq: lab.useGroq,
    groqMode: lab.groqMode,
    detailed: lab.detailed,
  };
}

export function suggestedLocalUrl() {
  return isSimulatorDevice()
    ? 'http://127.0.0.1:8787'
    : 'http://192.168.0.15:8787';
}
