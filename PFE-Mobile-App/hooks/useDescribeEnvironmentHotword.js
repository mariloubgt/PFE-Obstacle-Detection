import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { useIsFocused } from '@react-navigation/native';

import { buildTtsOptions } from '../utils/buildTtsOptions';
import { configureSpeechRecognitionAudioIOS } from '../utils/configureSpeechRecognitionAudio';
import { loadSpeechRecognitionPackage } from '../utils/loadSpeechRecognition';
import {
  ensureSpeechRecognitionPermissions,
  isSpeechPermissionGranted,
} from '../utils/speechRecognitionPermissions';
import { getSpeechRecognitionNativeStatus } from '../utils/speechRecognitionNativeStatus';

const PHRASE_COOLDOWN_MS = 4500;
/** Max time to wait for a command phrase per session */
const LISTEN_WINDOW_MS = 10000;

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
 * Hands-free commands — listens only when you call requestVoiceListen() (e.g. tap the banner).
 * Fires only on: describe environment | activate navigation | stop navigation.
 */
export function useDescribeEnvironmentHotword({
  enabled,
  cameraRef,
  alertVolumeRef,
  getTtsOpts,
  onPhraseMatched,
  onActivateNavigation,
  onStopNavigation,
  onListeningChange,
  onVoiceStatusChange,
  onVoiceDetailChange,
}) {
  const isFocused = useIsFocused();
  const onMatchedRef = useRef(onPhraseMatched);
  const onActivateNavRef = useRef(onActivateNavigation);
  const onStopNavRef = useRef(onStopNavigation);
  const getTtsOptsRef = useRef(getTtsOpts);
  const requestListenRef = useRef(() => {});

  const setVoiceStatus = useCallback((status) => {
    try {
      onVoiceStatusChange?.(status);
    } catch {
      /* ignore */
    }
  }, [onVoiceStatusChange]);

  useEffect(() => {
    getTtsOptsRef.current = getTtsOpts;
  }, [getTtsOpts]);
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
    const setListening = (active) => {
      try {
        onListeningChange?.(active);
      } catch {
        /* ignore */
      }
    };

    if (!enabled || Platform.OS === 'web') {
      setVoiceStatus('off');
      setListening(false);
      requestListenRef.current = () => {};
      return undefined;
    }

    if (!isFocused) {
      setVoiceStatus('paused');
      setListening(false);
      requestListenRef.current = () => {};
      return undefined;
    }

    const nativeStatus = getSpeechRecognitionNativeStatus();
    if (!nativeStatus.ok) {
      console.warn('[Voice] unavailable:', nativeStatus.reason);
      try {
        onVoiceDetailChange?.(nativeStatus.reason);
      } catch {
        /* ignore */
      }
      setVoiceStatus('unavailable');
      requestListenRef.current = () => {};
      return undefined;
    }

    try {
      onVoiceDetailChange?.(null);
    } catch {
      /* ignore */
    }

    const speechApi = loadSpeechRecognitionPackage().pkg;
    if (!speechApi) {
      setVoiceStatus('unavailable');
      requestListenRef.current = () => {};
      return undefined;
    }

    const { ExpoSpeechRecognitionModule, addSpeechRecognitionListener } = speechApi;

    if (
      !ExpoSpeechRecognitionModule?.start ||
      typeof addSpeechRecognitionListener !== 'function'
    ) {
      setVoiceStatus('unavailable');
      requestListenRef.current = () => {};
      return undefined;
    }

    let cancelled = false;
    const timers = [];
    const subs = [];
    let lastFireAt = 0;
    let sessionActive = false;
    let listenWindowTimer = null;
    let permissionsDeniedAnnounced = false;
    let permissionsReady = false;

    const volOpts = () =>
      typeof getTtsOptsRef.current === 'function'
        ? getTtsOptsRef.current()
        : buildTtsOptions(alertVolumeRef?.current ?? 0.85);

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

    const clearListenWindow = () => {
      if (listenWindowTimer) {
        clearTimeout(listenWindowTimer);
        listenWindowTimer = null;
      }
    };

    const stopSession = () => {
      sessionActive = false;
      clearListenWindow();
      setListening(false);
      if (!cancelled && enabled && isFocused) setVoiceStatus('ready');
      resumePreviewSafely();
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        try {
          ExpoSpeechRecognitionModule.stop();
        } catch {
          /* ignore */
        }
      }
    };

    const startRecognition = () => {
      if (
        cancelled ||
        !enabled ||
        !isFocused ||
        !permissionsReady ||
        sessionActive ||
        !ExpoSpeechRecognitionModule?.start
      ) {
        return;
      }

      sessionActive = true;
      setListening(true);
      setVoiceStatus('listening');
      Speech.stop();
      pausePreviewSafely();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      clearListenWindow();
      listenWindowTimer = setTimeout(() => {
        if (sessionActive) stopSession();
      }, LISTEN_WINDOW_MS);

      const startTimer = setTimeout(() => {
        if (cancelled || !sessionActive) return;
        configureSpeechRecognitionAudioIOS(ExpoSpeechRecognitionModule);
        ExpoSpeechRecognitionModule.start({
          lang: 'en-US',
          interimResults: true,
          contextualStrings: [
            'describe environment',
            'describe the environment',
            'activate navigation',
            'start navigation',
            'stop navigation',
            'deactivate navigation',
          ],
          continuous: false,
          requiresOnDeviceRecognition: false,
          iosVoiceProcessingEnabled: Platform.OS === 'ios',
        });
      }, Platform.OS === 'ios' ? 350 : 200);
      timers.push(startTimer);
    };

    requestListenRef.current = () => {
      if (!permissionsReady) {
        void bootstrapPermissions().then(() => {
          if (permissionsReady) startRecognition();
        });
        return;
      }
      startRecognition();
    };

    async function bootstrapPermissions() {
      if (cancelled || !enabled || !isFocused) return;

      const p = await ensureSpeechRecognitionPermissions(ExpoSpeechRecognitionModule);

      if (cancelled || !isSpeechPermissionGranted(p)) {
        setVoiceStatus('denied');
        if (!permissionsDeniedAnnounced && !cancelled) {
          permissionsDeniedAnnounced = true;
          Speech.stop();
          Speech.speak(
            'Voice commands need microphone and speech recognition. Check VisionAid in iPhone Settings.',
            volOpts()
          );
        }
        return;
      }

      configureSpeechRecognitionAudioIOS(ExpoSpeechRecognitionModule);
      permissionsReady = true;
      setVoiceStatus('ready');
    }

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

        stopSession();
        Speech.stop();

        let fn = null;
        if (action === 'describe') fn = onMatchedRef.current;
        else if (action === 'activateNav') fn = onActivateNavRef.current;
        else if (action === 'stopNav') fn = onStopNavRef.current;

        Promise.resolve(fn && fn()).catch(() => {});
      })
    );

    subs.push(
      addSpeechRecognitionListener('error', (e) => {
        if (e?.error === 'aborted') return;
        stopSession();
        if (e?.error !== 'no-speech' && e?.error !== 'speech-timeout') {
          Speech.stop();
          Speech.speak('Could not hear a command. Tap the voice bar and try again.', volOpts());
        }
      })
    );

    subs.push(
      addSpeechRecognitionListener('end', () => {
        if (sessionActive) stopSession();
      })
    );

    subs.push(
      addSpeechRecognitionListener('start', () => {
        if (!cancelled && sessionActive) {
          setListening(true);
          setVoiceStatus('listening');
        }
      })
    );

    setVoiceStatus('starting');
    void bootstrapPermissions();

    return () => {
      cancelled = true;
      requestListenRef.current = () => {};
      stopSession();
      setVoiceStatus('off');
      timers.forEach(clearTimeout);
      subs.forEach((s) => {
        try {
          s.remove();
        } catch {
          /* ignore */
        }
      });
      Speech.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isFocused]);

  const requestVoiceListen = useCallback(() => {
    requestListenRef.current();
  }, []);

  return { requestVoiceListen };
}
