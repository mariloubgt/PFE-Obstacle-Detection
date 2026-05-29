import { requireNativeModule } from 'expo';
import { NativeModules, Platform } from 'react-native';

function normalizeSpeechPkg(raw) {
  const mod = raw?.ExpoSpeechRecognitionModule;
  if (!mod?.start) {
    return null;
  }
  const listener =
    typeof raw?.addSpeechRecognitionListener === 'function'
      ? raw.addSpeechRecognitionListener
      : typeof mod.addListener === 'function'
        ? mod.addListener.bind(mod)
        : null;
  if (typeof listener !== 'function') {
    return null;
  }
  return {
    ExpoSpeechRecognitionModule: mod,
    addSpeechRecognitionListener: listener,
  };
}

/**
 * Load speech recognition with fallbacks (Expo 49 + dev client).
 */
export function loadSpeechRecognitionPackage() {
  let lastError = null;

  try {
    // eslint-disable-next-line global-require
    const pkg = require('expo-speech-recognition');
    const normalized = normalizeSpeechPkg(pkg);
    if (normalized) {
      return { pkg: normalized, error: null };
    }
    lastError = new Error(
      'Package loaded but speech listeners are missing (rebuild native app)',
    );
  } catch (e) {
    lastError = e;
  }

  if (Platform.OS !== 'web') {
    try {
      const mod = requireNativeModule('ExpoSpeechRecognition');
      const normalized = normalizeSpeechPkg({ ExpoSpeechRecognitionModule: mod });
      if (normalized) {
        return { pkg: normalized, error: null };
      }
    } catch (e) {
      lastError = e;
    }

    const legacy = NativeModules?.ExpoSpeechRecognition;
    const normalized = normalizeSpeechPkg({ ExpoSpeechRecognitionModule: legacy });
    if (normalized) {
      return { pkg: normalized, error: null };
    }
  }

  return { pkg: null, error: lastError };
}
