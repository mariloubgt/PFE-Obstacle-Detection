import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { useIsFocused } from '@react-navigation/native';
import { postNavigationGuidance } from '../services/navigationGuidanceApi';
import { loadInferenceApiUrl } from '../utils/inferenceApiUrl';
import { ttsVolumeOptions } from '../utils/ttsVolumeOptions';

const ACTIVATE_COOLDOWN_MS = 3800;
const STOP_COOLDOWN_MS = 2000;
const AFTER_SPEECH_LISTEN_DELAY_MS = 2400;

function tryLoadSpeechRecognitionNative() {
  try {
    // eslint-disable-next-line global-require
    return require('expo-speech-recognition');
  } catch {
    return null;
  }
}

function normText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesActivateNavigation(text) {
  const n = normText(text);
  if (!/\bnavigation\b/.test(n)) return false;
  return /\b(activate|start|starts|starting|enable|enabled|begin|beginning|turn on|turn-on)\b/.test(
    n
  );
}

export function matchesStopNavigation(text) {
  const n = normText(text);
  if (!/\bnavigation\b/.test(n)) return false;
  return /\b(stop|stops|stopping|deactivate|end|cancel|quit|disable|disabled|off|turn off)\b/.test(
    n
  );
}

function volFromRef(alertVolumeRef) {
  return ttsVolumeOptions(alertVolumeRef?.current ?? 0.85);
}

/**
 * @param {{
 *   enabled: boolean,
 *   cameraRef: import('react').RefObject<any>,
 *   alertVolumeRef: import('react').MutableRefObject<number>,
 *   aiInFlightRef: import('react').MutableRefObject<boolean>,
 *   suspendAiFrameRef: import('react').MutableRefObject<boolean>,
 *   navIntervalMs: number,
 *   predictOptsRef: import('react').MutableRefObject<{ hfovDeg: number, depthScale: number }>,
 * }} p
 */
export function useVoiceNavigationSession({
  enabled,
  cameraRef,
  alertVolumeRef,
  aiInFlightRef,
  suspendAiFrameRef,
  navIntervalMs,
  predictOptsRef,
}) {
  const isFocused = useIsFocused();

  /** true while user asked for looping guidance */
  const navRunningRef = useRef(false);

  /** STT mic session active */
  const sessionActiveRef = useRef(false);
  /** 'activate' listens for activate navigation; 'stop_phrase' listens for stop while nav runs */
  const listenKindRef = useRef('activate');

  const timerIdsRef = useRef([]);
  const intervalIdRef = useRef(null);

  const lastSpeakKeyRef = useRef('');
  const lastActivateAtRef = useRef(0);
  const lastStopAtRef = useRef(0);

  const pushTimer = (id) => {
    timerIdsRef.current.push(id);
  };

  const clearTimers = () => {
    timerIdsRef.current.forEach(clearTimeout);
    timerIdsRef.current = [];
  };

  const clearGuideInterval = () => {
    if (intervalIdRef.current != null) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
    navRunningRef.current = false;
    suspendAiFrameRef.current = false;
    listenKindRef.current = 'activate';
  };

  useEffect(() => {
    if (!enabled || !isFocused || Platform.OS === 'web') {
      clearGuideInterval();
      return undefined;
    }

    const speechApi = tryLoadSpeechRecognitionNative();
    if (!speechApi) return undefined;

    const { ExpoSpeechRecognitionModule, addSpeechRecognitionListener } = speechApi;

    if (
      !ExpoSpeechRecognitionModule?.start ||
      typeof addSpeechRecognitionListener !== 'function'
    ) {
      return undefined;
    }

    let cancelled = false;

    const resumePreview = () => {
      try {
        cameraRef.current?.resumePreview?.();
      } catch {
        /* ignore */
      }
    };

    const pausePreview = () => {
      try {
        cameraRef.current?.pausePreview?.();
      } catch {
        /* ignore */
      }
    };

    function abortRecognition() {
      sessionActiveRef.current = false;
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        try {
          ExpoSpeechRecognitionModule.stop();
        } catch {
          /* ignore */
        }
      }
      resumePreview();
    }

    async function navigationTickAsync() {
      if (cancelled || !navRunningRef.current) return;
      const api = await loadInferenceApiUrl();
      if (!api || !cameraRef.current) return;

      for (let i = 0; i < 55 && aiInFlightRef.current; i++) {
        await new Promise((r) => setTimeout(r, 70));
      }
      if (!navRunningRef.current || cancelled) return;

      suspendAiFrameRef.current = true;
      try {
        const po = predictOptsRef?.current ?? { hfovDeg: 56, depthScale: 1 };
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.2,
          skipProcessing: true,
        });

        const data = await postNavigationGuidance(api, photo.uri, {
          hfovDeg: po.hfovDeg,
          depthScale: po.depthScale,
        });

        const line =
          typeof data?.instruction_en === 'string' ? data.instruction_en.trim() : '';

        if (line && line !== lastSpeakKeyRef.current) {
          lastSpeakKeyRef.current = line;
          Speech.stop();
          Speech.speak(line, {
            language: 'en-US',
            rate: 0.92,
            ...volFromRef(alertVolumeRef),
          });
        }
      } catch {
        /* next tick */
      } finally {
        suspendAiFrameRef.current = false;
      }
    }

    function queueListenDelayed() {
      if (cancelled) return;
      pushTimer(setTimeout(() => startListenSession(), AFTER_SPEECH_LISTEN_DELAY_MS));
    }

    function startListenSession() {
      if (cancelled || !enabled || sessionActiveRef.current) return;

      listenKindRef.current = navRunningRef.current ? 'stop_phrase' : 'activate';
      sessionActiveRef.current = true;
      Speech.stop();
      pausePreview();

      const cue =
        listenKindRef.current === 'activate'
          ? 'Listening. Say activate navigation.'
          : 'Listening for stop navigation.';

      Speech.speak(cue, {
        language: 'en-US',
        rate: 0.9,
        ...volFromRef(alertVolumeRef),
      });

      const delayMs = Platform.OS === 'ios' ? 1550 : 850;
      pushTimer(
        setTimeout(() => {
          if (cancelled || !sessionActiveRef.current) return;
          try {
            ExpoSpeechRecognitionModule.start({
              lang: 'en-US',
              interimResults: true,
              contextualStrings:
                listenKindRef.current === 'activate'
                  ? ['activate navigation', 'start navigation']
                  : ['stop navigation', 'deactivate navigation'],
              continuous: Platform.OS !== 'ios',
            });
          } catch {
            abortRecognition();
          }
        }, delayMs)
      );
    }

    const subs = [
      addSpeechRecognitionListener('result', (ev) => {
        if (!sessionActiveRef.current || cancelled) return;
        const results = ev?.results || [];
        const text = results.map((r) => r.transcript).join(' ');
        const now = Date.now();

        if (!navRunningRef.current) {
          if (!matchesActivateNavigation(text)) return;
          if (now - lastActivateAtRef.current < ACTIVATE_COOLDOWN_MS) return;
          lastActivateAtRef.current = now;

          abortRecognition();
          navRunningRef.current = true;
          lastSpeakKeyRef.current = '';
          Speech.stop();
          Speech.speak('Voice navigation on.', {
            language: 'en-US',
            rate: 0.92,
            ...volFromRef(alertVolumeRef),
          });

          void navigationTickAsync();
          intervalIdRef.current = setInterval(
            () => void navigationTickAsync(),
            Math.max(3000, navIntervalMs)
          );

          queueListenDelayed();
          return;
        }

        if (!matchesStopNavigation(text)) return;
        if (now - lastStopAtRef.current < STOP_COOLDOWN_MS) return;
        lastStopAtRef.current = now;

        clearGuideInterval();
        abortRecognition();

        Speech.stop();
        Speech.speak('Voice navigation stopped.', {
          language: 'en-US',
          rate: 0.92,
          ...volFromRef(alertVolumeRef),
        });

        queueListenDelayed();
      }),

      addSpeechRecognitionListener('error', (e) => {
        if (e?.error === 'aborted') return;
        sessionActiveRef.current = false;
        resumePreview();
        if (!cancelled && enabled)
          pushTimer(setTimeout(() => startListenSession(), 1800));
      }),

      addSpeechRecognitionListener('end', () => {
        sessionActiveRef.current = false;
        resumePreview();
        if (cancelled || !enabled) return;
        if (navRunningRef.current && intervalIdRef.current) {
          pushTimer(setTimeout(() => startListenSession(), 900));
          return;
        }
        pushTimer(setTimeout(() => startListenSession(), 700));
      }),
    ];


    async function bootstrapPermissions() {
      let p =
        ExpoSpeechRecognitionModule.getPermissionsAsync &&
        (await ExpoSpeechRecognitionModule.getPermissionsAsync());

      if (p?.status !== 'granted') {
        p = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      }

      if (cancelled || p?.status !== 'granted') return;

      navRunningRef.current = false;
      listenKindRef.current = 'activate';
      clearGuideInterval();
      startListenSession();
    }

    void bootstrapPermissions();

    return () => {
      cancelled = true;
      clearTimers();
      clearGuideInterval();
      subs.forEach((s) => {
        try {
          s.remove();
        } catch {
          /* ignore */
        }
      });
      Speech.stop();

      abortRecognition();

      resumePreview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isFocused, navIntervalMs]);
}
