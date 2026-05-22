/** iOS custom permission requester may return status: 1 without a `granted` field. */
export function isSpeechPermissionGranted(p) {
  if (!p) return false;
  if (p.granted === true) return true;
  if (p.status === 'granted') return true;
  if (p.status === 1) return true;
  return false;
}

/**
 * Request mic + speech recognition (iOS) via expo-speech-recognition.
 */
export async function ensureSpeechRecognitionPermissions(module) {
  if (!module?.requestPermissionsAsync) {
    return { granted: false, status: 'unavailable' };
  }

  let p =
    typeof module.getPermissionsAsync === 'function'
      ? await module.getPermissionsAsync()
      : null;

  if (!isSpeechPermissionGranted(p)) {
    p = await module.requestPermissionsAsync();
  }

  if (
    !isSpeechPermissionGranted(p) &&
    typeof module.requestMicrophonePermissionsAsync === 'function'
  ) {
    const mic = await module.requestMicrophonePermissionsAsync();
    if (isSpeechPermissionGranted(mic)) {
      p = mic;
    } else if (typeof module.getPermissionsAsync === 'function') {
      p = await module.getPermissionsAsync();
    }
  }

  if (
    !isSpeechPermissionGranted(p) &&
    typeof module.requestSpeechRecognizerPermissionsAsync === 'function'
  ) {
    const speech = await module.requestSpeechRecognizerPermissionsAsync();
    if (isSpeechPermissionGranted(speech)) {
      p = speech;
    } else if (typeof module.getPermissionsAsync === 'function') {
      p = await module.getPermissionsAsync();
    }
  }

  const granted = isSpeechPermissionGranted(p);
  return { ...(p || {}), granted, status: granted ? 'granted' : p?.status ?? 'denied' };
}

import { loadSpeechRecognitionPackage } from './loadSpeechRecognition';

export function getSpeechRecognitionModule() {
  return loadSpeechRecognitionPackage().pkg?.ExpoSpeechRecognitionModule ?? null;
}
