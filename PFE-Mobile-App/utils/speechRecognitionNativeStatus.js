import { loadSpeechRecognitionPackage } from './loadSpeechRecognition';

/**
 * Check whether expo-speech-recognition native code is in this app build.
 */
export function getSpeechRecognitionNativeStatus() {
  const { pkg, error } = loadSpeechRecognitionPackage();
  if (pkg) {
    const mod = pkg.ExpoSpeechRecognitionModule;
    const listen = pkg.addSpeechRecognitionListener;
    if (!mod?.start) {
      return { ok: false, reason: 'ExpoSpeechRecognitionModule.start missing' };
    }
    if (typeof listen !== 'function') {
      return { ok: false, reason: 'addSpeechRecognitionListener missing' };
    }
    return { ok: true, reason: null };
  }

  const msg = error?.message || String(error || 'unknown');
  if (/Cannot find native module/i.test(msg)) {
    return {
      ok: false,
      reason:
        'speech module missing — run: npx expo run:ios --device (open VisionAid icon, not Expo Go)',
    };
  }
  return { ok: false, reason: msg };
}
