import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

const PHRASE_RE = /describe\s+(the\s+)?environment/;
const COOLDOWN_MS = 9000;
const RESTART_DELAY_MS = 500;

function normalizeTranscript(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesDescribeEnvironment(text) {
  if (!text) return false;
  const n = normalizeTranscript(text);
  if (PHRASE_RE.test(n)) return true;
  if (n.includes('describe') && n.includes('environment')) return true;
  return false;
}

async function waitUntilNotSpeaking(maxMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const speaking = await Speech.isSpeakingAsync();
      if (!speaking) return;
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 280));
  }
}

/**
 * Continuous speech recognition (when supported) for the phrase "describe environment".
 * On Android 12 and below, restarts after each `end` event.
 *
 * @param {object} p
 * @param {boolean} p.enabled User toggle — must be true to listen.
 * @param {boolean} p.isFocused Screen focused — pauses when false.
 * @param {() => Promise<void>} p.onPhraseMatched Fire after a match; typically capture frame + API + TTS.
 */
export function useDescribeEnvironmentHotword({ enabled, isFocused, onPhraseMatched }) {
  const onPhraseMatchedRef = useRef(onPhraseMatched);
  const enabledRef = useRef(enabled);
  const isFocusedRef = useRef(isFocused);
  const lastFireRef = useRef(0);
  const pausedRef = useRef(false);
  const inFlightRef = useRef(false);
  const restartTimerRef = useRef(null);

  useEffect(() => {
    onPhraseMatchedRef.current = onPhraseMatched;
  }, [onPhraseMatched]);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);

  const androidApi = Platform.OS === 'android' ? Platform.Version : 100;
  const preferContinuous = Platform.OS === 'ios' || androidApi >= 33;

  const clearRestartTimer = () => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  const startRecognition = useCallback(() => {
    if (Platform.OS === 'web') return;
    if (!enabledRef.current || !isFocusedRef.current || pausedRef.current) return;
    try {
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: preferContinuous,
        contextualStrings: ['describe environment', 'describe the environment'],
        iosVoiceProcessingEnabled: true,
      });
    } catch {
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        if (enabledRef.current && isFocusedRef.current && !pausedRef.current) {
          try {
            ExpoSpeechRecognitionModule.start({
              lang: 'en-US',
              interimResults: true,
              continuous: preferContinuous,
              contextualStrings: ['describe environment', 'describe the environment'],
              iosVoiceProcessingEnabled: true,
            });
          } catch {
            // still failing — e.g. Expo Go
          }
        }
      }, RESTART_DELAY_MS * 3);
    }
  }, [preferContinuous]);

  const stopRecognition = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // ignore
    }
  }, []);

  useSpeechRecognitionEvent('result', (ev) => {
    if (!enabledRef.current || pausedRef.current || !isFocusedRef.current) return;
    const transcripts = (ev.results || []).map((r) => r.transcript).filter(Boolean);
    const combined = transcripts.join(' ');
    if (!matchesDescribeEnvironment(combined)) return;
    const now = Date.now();
    if (now - lastFireRef.current < COOLDOWN_MS) return;
    if (inFlightRef.current) return;

    lastFireRef.current = now;
    inFlightRef.current = true;
    pausedRef.current = true;
    clearRestartTimer();
    stopRecognition();

    void (async () => {
      try {
        await onPhraseMatchedRef.current?.();
      } catch (e) {
        console.warn('[DescribeEnvironmentHotword]', e);
      } finally {
        inFlightRef.current = false;
        try {
          await waitUntilNotSpeaking();
        } catch {
          // ignore
        }
        pausedRef.current = false;
        if (enabledRef.current && isFocusedRef.current) {
          startRecognition();
        }
      }
    })();
  });

  const scheduleRestart = useCallback(() => {
    clearRestartTimer();
    if (!enabledRef.current || !isFocusedRef.current || pausedRef.current) return;
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      if (enabledRef.current && isFocusedRef.current && !pausedRef.current) {
        startRecognition();
      }
    }, RESTART_DELAY_MS);
  }, [startRecognition]);

  useSpeechRecognitionEvent('error', () => {
    if (!enabledRef.current || !isFocusedRef.current || pausedRef.current) return;
    scheduleRestart();
  });

  useSpeechRecognitionEvent('end', () => {
    if (!enabledRef.current || !isFocusedRef.current || pausedRef.current) return;
    if (preferContinuous) return;
    scheduleRestart();
  });

  useEffect(() => {
    if (Platform.OS === 'web') {
      return undefined;
    }

    if (!enabled || !isFocused) {
      clearRestartTimer();
      stopRecognition();
      pausedRef.current = false;
      return undefined;
    }

    let cancelled = false;
    void (async () => {
      try {
        const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (cancelled || !enabledRef.current || !isFocusedRef.current) return;
        if (!perm.granted) return;
      } catch {
        return;
      }
      startRecognition();
    })();

    return () => {
      cancelled = true;
      clearRestartTimer();
      stopRecognition();
      pausedRef.current = false;
    };
  }, [enabled, isFocused, startRecognition, stopRecognition]);
}
