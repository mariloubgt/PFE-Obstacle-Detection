import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { useIsFocused } from '@react-navigation/native';

import { ttsVolumeOptions } from '../utils/ttsVolumeOptions';

const PHRASE_COOLDOWN_MS = 4500;
const RESTART_AFTER_DESCRIBE_MS = 5200;

/**
 * Load expo-speech-recognition lazily — top-level import throws if native ExpoSpeechRecognition
 * is missing (Expo Go, or dev client built before pods). Must not crash the bundle.
 */
function tryLoadSpeechRecognitionNative() {
  try {
    // eslint-disable-next-line global-require
    return require('expo-speech-recognition');
  } catch {
    return null;
  }
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesDescribe(text) {
  const n = normalize(text);
  return /\bdescribe\b/.test(n) && /\benvironment\b/.test(n);
}

function matchesActivateNav(text) {
  const n = normalize(text);
  return /\b(activate|start|begin|enable)\b/.test(n) && /\bnavigation\b/.test(n);
}

function matchesStopNav(text) {
  const n = normalize(text);
  return /\b(stop|deactivate|end|disable|cancel)\b/.test(n) && /\bnavigation\b/.test(n);
}

/**
 * Hands-free "describe … environment" → fires callback once per cooldown.
 * Pauses camera preview while recognition runs; resumes when recognition stops / after describe.
 *
 * Disabled on web. No-op if native module is unavailable (rebuild dev client with pods).
 */
export function useDescribeEnvironmentHotword({
  enabled,
  cameraRef,
  alertVolumeRef,
  onPhraseMatched,
  onActivateNavigation,
  onStopNavigation,
}) {
  const isFocused = useIsFocused();
  const onMatchedRef = useRef(onPhraseMatched);
  const onActivateNavRef = useRef(onActivateNavigation);
  const onStopNavRef = useRef(onStopNavigation);
  useEffect(() => {
    onMatchedRef.current = onPhraseMatched;
  }, [onPhraseMatched]);
  useEffect(() => {
    onActivateNavRef.current = onActivateNavigation;
  }, [onActivateNavigation]);
  useEffect(() => {
    onStopNavRef.current = onStopNavigation;
  }, [onStopNavigation]);

  useEffect(() => {
    /** Do not require native STT unless the feature is active (avoids crashing / errors in Expo Go). */
    if (!enabled || !isFocused || Platform.OS === 'web') {
      return undefined;
    }

    const speechApi = tryLoadSpeechRecognitionNative();
    if (!speechApi) {
      return undefined;
    }

    const { ExpoSpeechRecognitionModule, addSpeechRecognitionListener } = speechApi;

    if (
      !ExpoSpeechRecognitionModule?.start ||
      typeof addSpeechRecognitionListener !== 'function'
    ) {
      return undefined;
    }

    let cancelled = false;
    /** @type {ReturnType<typeof setTimeout>[] } */
    const timers = [];
    /** @type {Array<{ remove: () => void }>} */
    const subs = [];
    let lastFireAt = 0;
    /** listening session active (waiting for transcripts) */
    let sessionActive = false;

    const volOpts = () => ttsVolumeOptions(alertVolumeRef?.current ?? 0.85);

    const resumePreviewSafely = () => {
      try {
        cameraRef.current?.resumePreview?.();
      } catch {
        /* ignore */
      }
    };

    const pausePreviewSafely = () => {
      try {
        cameraRef.current?.pausePreview?.();
      } catch {
        /* ignore */
      }
    };

    async function bootstrap() {
      if (
        cancelled ||
        !enabled ||
        !isFocused ||
        Platform.OS === 'web' ||
        !ExpoSpeechRecognitionModule?.start ||
        typeof ExpoSpeechRecognitionModule.requestPermissionsAsync !== 'function'
      ) {
        return;
      }

      let p =
        ExpoSpeechRecognitionModule.getPermissionsAsync &&
        (await ExpoSpeechRecognitionModule.getPermissionsAsync());

      if (p?.status !== 'granted') {
        p = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      }

      if (cancelled || p?.status !== 'granted') return;

      const startRecognition = () => {
        if (
          cancelled ||
          !enabled ||
          !isFocused ||
          !ExpoSpeechRecognitionModule?.start
        )
          return;
        sessionActive = true;
        Speech.stop();
        pausePreviewSafely();
        Speech.speak(
          'Listening. Say describe environment, activate navigation, or stop navigation.',
          {
            language: 'en-US',
            rate: 0.92,
            ...volOpts(),
          }
        );

        const delayMs = Platform.OS === 'ios' ? 1900 : 1100;
        const startTimer = setTimeout(() => {
          if (cancelled || !sessionActive) return;
          ExpoSpeechRecognitionModule.start({
            lang: 'en-US',
            interimResults: true,
            contextualStrings: [
              'describe environment',
              'activate navigation',
              'start navigation',
              'stop navigation',
              'deactivate navigation',
            ],
            continuous: Platform.OS !== 'ios',
          });
        }, delayMs);
        timers.push(startTimer);
      };

      subs.push(
        addSpeechRecognitionListener('result', (ev) => {
          if (!sessionActive || cancelled) return;
          const results = ev?.results || [];
          const text = results.map((r) => r.transcript).join(' ');

          let action = null;
          if (matchesDescribe(text)) action = 'describe';
          else if (matchesStopNav(text)) action = 'stopNav';
          else if (matchesActivateNav(text)) action = 'activateNav';
          if (!action) return;

          const now = Date.now();
          if (now - lastFireAt < PHRASE_COOLDOWN_MS) return;
          lastFireAt = now;

          sessionActive = false;
          Speech.stop();

          try {
            ExpoSpeechRecognitionModule.abort();
          } catch {
            try {
              ExpoSpeechRecognitionModule.stop();
            } catch {
              /* ignore */
            }
          }

          resumePreviewSafely();

          let fn = null;
          if (action === 'describe') fn = onMatchedRef.current;
          else if (action === 'activateNav') fn = onActivateNavRef.current;
          else if (action === 'stopNav') fn = onStopNavRef.current;

          Promise.resolve(fn && fn())
            .catch(() => {})
            .finally(() => {
              if (cancelled) return;
              const delay =
                action === 'describe' ? RESTART_AFTER_DESCRIBE_MS : 1500;
              const t = setTimeout(() => {
                startRecognition();
              }, delay);
              timers.push(t);
            });
        })
      );

      subs.push(
        addSpeechRecognitionListener('error', (e) => {
          if (e?.error === 'aborted') return;

          sessionActive = false;
          resumePreviewSafely();

          if (e?.error !== 'no-speech' && e?.error !== 'speech-timeout') {
            Speech.stop();
            Speech.speak('Speech recognition paused. Try again shortly.', {
              language: 'en-US',
              rate: 0.92,
              ...volOpts(),
            });
          }

          if (
            !cancelled &&
            enabled &&
            isFocused &&
            e?.error !== 'no-speech' &&
            e?.error !== 'speech-timeout'
          ) {
            timers.push(setTimeout(() => startRecognition(), 2600));
          }
        })
      );

      subs.push(
        addSpeechRecognitionListener('end', () => {
          sessionActive = false;
          resumePreviewSafely();
          if (!cancelled && enabled && isFocused && Platform.OS === 'ios')
            timers.push(setTimeout(() => startRecognition(), 900));
        })
      );

      startRecognition();
    }

    if (enabled && isFocused && Platform.OS !== 'web') {
      void bootstrap();
    }

    return () => {
      cancelled = true;
      sessionActive = false;
      timers.forEach(clearTimeout);
      subs.forEach((s) => {
        try {
          s.remove();
        } catch {
          /* ignore */
        }
      });

      Speech.stop();
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        try {
          ExpoSpeechRecognitionModule.stop();
        } catch {
          /* ignore */
        }
      }
      resumePreviewSafely();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isFocused]);
}
