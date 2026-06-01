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

function speechAudioModule() {
  return NativeModules.SpeechAudioModule;
}

async function stopNativeUrgentSpeech() {
  const mod = speechAudioModule();
  if (!mod?.stopUrgentSpeech) return;
  try {
    await mod.stopUrgentSpeech();
  } catch {
    /* ignore */
  }
}

async function forceSpeakerRouteIOS() {
  if (Platform.OS !== 'ios') return;
  const mod = speechAudioModule();
  if (mod?.prepareForSpeech) {
    try {
      await mod.prepareForSpeech();
    } catch (e) {
      if (__DEV__) console.warn('[forceSpeakerRouteIOS]', e);
    }
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
      if (Platform.OS === 'ios') {
        // expo-av setAudioModeAsync uses Playback WITHOUT DefaultToSpeaker → quiet earpiece.
        // Native module forces loud speaker output.
        await forceSpeakerRouteIOS();
      } else {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          interruptionModeIOS: InterruptionModeIOS.DoNotMix,
          interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
      }
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

/** Split long descriptions into sentence chunks for smoother iOS TTS. */
export function splitSpeechChunks(text, maxLen = 200) {
  const t = String(text || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!t) return [];
  if (t.length <= maxLen) return [t];

  const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length <= 1) return [clipForSpeech(t, maxLen)];

  const chunks = [];
  let buf = '';
  for (const part of parts) {
    const candidate = buf ? `${buf} ${part}` : part;
    if (candidate.length <= maxLen) {
      buf = candidate;
      continue;
    }
    if (buf) chunks.push(buf);
    buf = part.length <= maxLen ? part : clipForSpeech(part, maxLen);
  }
  if (buf) chunks.push(buf);
  return chunks.length ? chunks : [clipForSpeech(t, maxLen)];
}

export function normalizeSpeechRate(rate) {
  const n = typeof rate === 'number' && !Number.isNaN(rate) ? rate : 0.95;
  const user = Math.min(1, Math.max(0.55, n));
  return 0.9 + ((user - 0.55) / 0.45) * 0.06;
}

function speakLineNow(line, ttsOptions) {
  return new Promise((resolve) => {
    Speech.speak(line, {
      ...ttsOptions,
      language: ttsOptions.language ?? 'en-US',
      rate: normalizeSpeechRate(ttsOptions.rate),
      onStart: () => {
        setSpeaking(true);
      },
      onDone: () => {
        setSpeaking(false);
        resolve({ status: 'done' });
      },
      onStopped: () => {
        setSpeaking(false);
        resolve({ status: 'stopped' });
      },
      onError: (err) => {
        setSpeaking(false);
        if (__DEV__) console.warn('[speakAlert] error', err);
        resolve({ status: 'error', err });
      },
    });
  });
}

function linesForItem(item) {
  const { line, speechOptions } = item;
  const useChunks =
    speechOptions.sequential === true ||
    (speechOptions.sequential !== false && line.length > 180);
  return useChunks ? splitSpeechChunks(line) : [line];
}

async function runSpeechLoop(gen) {
  while (gen === runGeneration) {
    const next = pendingLatest;
    pendingLatest = null;
    if (!next) break;

    const {
      onStart,
      onDone,
      onStopped,
      onError,
      ...speechOptions
    } = next.speechOptions;

    const parts = linesForItem({ line: next.line, speechOptions });

    await prepareSpeechAudio(true);

    let started = false;
    let lastStatus = 'done';

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (gen !== runGeneration) {
        lastStatus = 'stopped';
        break;
      }
      if (__DEV__) console.log('[speakAlert]', part.slice(0, 120));
      if (!started) {
        started = true;
        onStart?.();
      }
      const result = await speakLineNow(part, speechOptions);
      lastStatus = result?.status || 'done';
      if (lastStatus === 'stopped' || lastStatus === 'error') break;
    }

    if (lastStatus === 'stopped') onStopped?.();
    else if (lastStatus === 'error') onError?.(new Error('TTS failed'));
    else onDone?.();
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
 *   sequential?: boolean;
 *   maxChars?: number;
 * }} [options]
 */
export function speakAlert(text, options = {}) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return;

  const { interrupt = false, latest = false, sequential, maxChars, ...ttsOptions } = options;
  const line = maxChars ? clipForSpeech(raw, maxChars) : raw;
  if (!line) return;

  const item = {
    line,
    speechOptions: { ...ttsOptions, sequential },
  };

  if (interrupt) {
    runGeneration += 1;
    Speech.stop();
    void stopNativeUrgentSpeech();
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

/** Wait until playback finishes (describe / alerts). */
export function speakAlertAsync(text, options = {}) {
  return new Promise((resolve) => {
    const raw = typeof text === 'string' ? text.trim() : '';
    if (!raw) {
      resolve();
      return;
    }
    const { onDone, onStopped, onError, ...rest } = options;
    speakAlert(text, {
      ...rest,
      interrupt: rest.interrupt !== false,
      sequential: rest.sequential !== false,
      onDone: () => {
        onDone?.();
        resolve();
      },
      onStopped: () => {
        onStopped?.();
        resolve();
      },
      onError: (e) => {
        onError?.(e);
        resolve();
      },
    });
  });
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
  void stopNativeUrgentSpeech();
  pendingLatest = null;
  loopPromise = null;
  setSpeaking(false);
}
