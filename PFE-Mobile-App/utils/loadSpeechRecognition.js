import { requireNativeModule } from 'expo';
import { NativeModules, Platform } from 'react-native';

/**
 * Load speech recognition with fallbacks (Expo 49 + dev client).
 */
export function loadSpeechRecognitionPackage() {
  let lastError = null;

  try {
    // eslint-disable-next-line global-require
    const pkg = require('expo-speech-recognition');
    if (pkg?.ExpoSpeechRecognitionModule?.start) {
      return { pkg, error: null };
    }
    lastError = new Error('Package loaded but ExpoSpeechRecognitionModule.start is missing');
  } catch (e) {
    lastError = e;
  }

  if (Platform.OS !== 'web') {
    try {
      const mod = requireNativeModule('ExpoSpeechRecognition');
      if (mod?.start) {
        return {
          pkg: {
            ExpoSpeechRecognitionModule: mod,
            addSpeechRecognitionListener: mod.addListener?.bind(mod),
          },
          error: null,
        };
      }
    } catch (e) {
      lastError = e;
    }

    const legacy = NativeModules?.ExpoSpeechRecognition;
    if (legacy?.start) {
      return {
        pkg: {
          ExpoSpeechRecognitionModule: legacy,
          addSpeechRecognitionListener: legacy.addListener?.bind(legacy),
        },
        error: null,
      };
    }
  }

  return { pkg: null, error: lastError };
}
