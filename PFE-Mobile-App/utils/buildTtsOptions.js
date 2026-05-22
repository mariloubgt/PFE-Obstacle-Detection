import { DEFAULTS } from './appSettings';
import { ttsVolumeOptions } from './ttsVolumeOptions';

/**
 * Options for expo-speech using saved alert volume + speech rate.
 * @param {number} [alertVolume01]
 * @param {number} [speechRate]
 */
export function buildTtsOptions(alertVolume01, speechRate) {
  const rate =
    typeof speechRate === 'number' && !Number.isNaN(speechRate)
      ? speechRate
      : DEFAULTS.speechRate;
  return {
    language: 'en-US',
    rate,
    pitch: 1.0,
    ...ttsVolumeOptions(alertVolume01),
  };
}
