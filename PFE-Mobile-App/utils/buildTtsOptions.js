import { DEFAULTS } from './appSettings';
import { normalizeSpeechRate } from './speakAlert';
import { ttsVolumeOptions } from './ttsVolumeOptions';

/**
 * Options for expo-speech using saved alert volume + speech rate.
 * @param {number} [alertVolume01]
 * @param {number} [speechRate]
 * @param {{ urgent?: boolean }} [opts] — louder, higher pitch for obstacle warnings
 */
export function buildTtsOptions(alertVolume01, speechRate, opts = {}) {
  const urgent = opts?.urgent === true;
  const raw =
    typeof speechRate === 'number' && !Number.isNaN(speechRate)
      ? speechRate
      : DEFAULTS.speechRate;
  let rate = normalizeSpeechRate(raw);
  if (urgent) {
    rate = Math.min(1.0, rate + 0.12);
  }
  return {
    language: 'en-US',
    rate,
    pitch: urgent ? 1.5 : 1.0,
    ...ttsVolumeOptions(alertVolume01, { urgent }),
  };
}
