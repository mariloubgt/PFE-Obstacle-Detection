import { Platform } from 'react-native';

/**
 * iOS: allow mic + speaker (TTS alerts) without blocking recognition.
 */
export function configureSpeechRecognitionAudioIOS(module) {
  if (Platform.OS !== 'ios' || !module?.setCategoryIOS) return;
  try {
    module.setCategoryIOS({
      category: 'playAndRecord',
      categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
      mode: 'spokenAudio',
    });
    module.setAudioSessionActiveIOS?.(true, { notifyOthersOnDeactivation: true });
  } catch {
    /* ignore */
  }
}
