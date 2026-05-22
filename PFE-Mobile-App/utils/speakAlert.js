import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as Speech from 'expo-speech';
import { AppState, NativeModules, Platform } from 'react-native';

let audioModeReady = false;
let audioPrepPromise = null;
let appStateSub = null;
let speaking = false;
let runGeneration = 0;
/** @type {Promise<void> | null} */
let loopPromise = null;
/** @type {{ line: string, speechOptions: object } | null} */
let pendingLatest = null;
const speechListeners = new Set();

async function forceSpeakerRouteIOS() {
  if (Platform.OS !== 'ios') return;
  const mod = NativeModules.SpeechAudioModule;
  if (mod?.prepareForSpeech) {
    await mod.prepareForSpeech();
  } else if (__DEV__) {
    console.warn(
      '[speakAlert] SpeechAudioModule missing — rebuild: npm run ios -- --device'
    );
  }
}

function setSpeaking(next) {
  if (speaking === next) return;
  speaking = next;
  speechListeners.forEach((fn) => {
    try {
      fn(next);
    } catch {
      /* ignore */
    }
  });
}

export function subscribeSpeechActive(listener) {
  speechListeners.add(listener);
  listener(speaking);
  return () => speechListeners.delete(listener);
}

export function isSpeechActive() {
  return speaking;
}

export async function prepareSpeechAudio(force = false) {
  if (Platform.OS === 'web') return;
  if (audioModeReady && !force) return;
  if (audioPrepPromise && !force) return audioPrepPromise;

  audioPrepPromise = (async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      await forceSpeakerRouteIOS();
      audioModeReady = true;
    } catch (e) {
      if (__DEV__) console.warn('[prepareSpeechAudio]', e);
    } finally {
      audioPrepPromise = null;
    }
  })();

  return audioPrepPromise;
}

export function clipForSpeech(text, max) {
  if (!text || typeof text !== 'string') return '';
  const t = text.trim().replace(/\s+/g, ' ');
  if (!max || t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const body = lastSpace > max * 0.55 ? cut.slice(0, lastSpace) : cut;
  return `${body.trim()}…`;
}

export function normalizeSpeechRate(rate) {
  const n = typeof rate === 'number' && !Number.isNaN(rate) ? rate : 0.95;
  const user = Math.min(1, Math.max(0.55, n));
  return 0.92 + ((user - 0.55) / 0.45) * 0.08;
}

function speakLineNow(line, ttsOptions) {
  return new Promise((resolve) => {
    Speech.speak(line, {
      ...ttsOptions,
      language: ttsOptions.language ?? 'en-US',
      rate: normalizeSpeechRate(ttsOptions.rate),
      onStart: () => {
        setSpeaking(true);
        if (typeof ttsOptions.onStart === 'function') ttsOptions.onStart();
      },
      onDone: () => {
        setSpeaking(false);
        if (typeof ttsOptions.onDone === 'function') ttsOptions.onDone();
        resolve();
      },
      onStopped: () => {
        setSpeaking(false);
        if (typeof ttsOptions.onStopped === 'function') ttsOptions.onStopped();
        resolve();
      },
      onError: (err) => {
        setSpeaking(false);
        if (__DEV__) console.warn('[speakAlert] error', err);
        if (typeof ttsOptions.onError === 'function') ttsOptions.onError(err);
        resolve();
      },
    });
  });
}

async function runSpeechLoop(gen) {
  while (gen === runGeneration) {
    const next = pendingLatest;
    pendingLatest = null;
    if (!next) break;
    if (__DEV__) console.log('[speakAlert]', next.line.slice(0, 120));
    await speakLineNow(next.line, next.speechOptions);
  }
}

function kickSpeechLoop() {
  if (loopPromise) return;
  const gen = runGeneration;
  loopPromise = runSpeechLoop(gen).finally(() => {
    loopPromise = null;
    if (pendingLatest && gen === runGeneration) {
      kickSpeechLoop();
    }
  });
}

/**
 * @param {string} text
 * @param {import('expo-speech').SpeechOptions & {
 *   interrupt?: boolean;
 *   latest?: boolean;
 *   maxChars?: number;
 * }} [options]
 */
export function speakAlert(text, options = {}) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return;

  const { interrupt = false, latest = false, maxChars, ...ttsOptions } = options;
  const line = maxChars ? clipForSpeech(raw, maxChars) : raw;
  if (!line) return;

  if (!audioModeReady) {
    void prepareSpeechAudio();
  }

  const item = { line, speechOptions: ttsOptions };

  if (interrupt) {
    runGeneration += 1;
    Speech.stop();
    setSpeaking(false);
    loopPromise = null;
    pendingLatest = item;
    kickSpeechLoop();
    return;
  }

  if (speaking) {
    if (latest) {
      pendingLatest = item;
    }
    return;
  }

  if (pendingLatest && !latest) {
    return;
  }

  pendingLatest = item;
  kickSpeechLoop();
}

export function initSpeechAudio() {
  void prepareSpeechAudio();
  if (appStateSub) return;
  appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void prepareSpeechAudio(true);
    }
  });
}

export function stopSpeech() {
  runGeneration += 1;
  Speech.stop();
  pendingLatest = null;
  loopPromise = null;
  setSpeaking(false);
}
