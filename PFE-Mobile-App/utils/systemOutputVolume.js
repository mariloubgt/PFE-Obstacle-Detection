import { NativeModules, Platform } from 'react-native';

/** Single source of truth for alert loudness preference (0–1). */
export const alertOutputState = {
  baseline01: 1,
};

function clamp01(v) {
  const n = typeof v === 'number' && !Number.isNaN(v) ? v : 1;
  return Math.min(1, Math.max(0, n));
}

/** Route TTS to the loud speaker (expo-av alone leaves iOS on the quiet earpiece). */
async function ensureIosLoudSpeakerRoute() {
  if (Platform.OS !== 'ios') return;
  const mod = NativeModules.SpeechAudioModule;
  if (!mod?.prepareForSpeech) return;
  try {
    await mod.prepareForSpeech();
  } catch {
    /* ignore */
  }
}

/**
 * Apply alert volume to device output (side-button stream on iOS/Android).
 * @param {number} volume01
 * @param {{ forceMax?: boolean }} [opts]
 */
export async function applyAlertVolumeToSystemOutput(volume01, opts = {}) {
  const forceMax = opts?.forceMax === true;
  alertOutputState.baseline01 = forceMax ? 1 : clamp01(volume01);

  if (Platform.OS === 'web') return;
  await ensureIosLoudSpeakerRoute();
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

export async function applyMaxAlertVolumeForUrgent() {
  return applyAlertVolumeToSystemOutput(1, { forceMax: true });
}

export { ensureIosLoudSpeakerRoute };
