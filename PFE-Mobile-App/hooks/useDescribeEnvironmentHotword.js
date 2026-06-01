import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { useIsFocused } from '@react-navigation/native';

import { buildTtsOptions } from '../utils/buildTtsOptions';
import { configureSpeechRecognitionAudioIOS } from '../utils/configureSpeechRecognitionAudio';
import { ensureIosLoudSpeakerRoute } from '../utils/systemOutputVolume';
import { loadSpeechRecognitionPackage } from '../utils/loadSpeechRecognition';
import {
  ensureSpeechRecognitionPermissions,
  isSpeechPermissionGranted,
} from '../utils/speechRecognitionPermissions';
import { getSpeechRecognitionNativeStatus } from '../utils/speechRecognitionNativeStatus';
import {
  abortSpeechRecognition,
  releaseSpeechRecognition,
  takeSpeechRecognition,
} from '../utils/speechRecognitionSession';
import {
  isSpeechActive,
  stopSpeech,
  subscribeSpeechActive,
} from '../utils/speakAlert';

const OWNER_ID = 'scene-query';

const PHRASE_COOLDOWN_MS = 3200;
const STOP_COOLDOWN_MS = 800;
/** Tap-to-listen sessions close after this (autoListen keeps the mic open). */
const LISTEN_WINDOW_MS = 12000;
const RESTART_AFTER_TTS_MS = 1800;
const RESTART_AFTER_END_MS = 900;

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesDescribe(text) {
  const n = normalize(text);
  if (/\bdescribe\b/.test(n) && /\b(environment|scene)\b/.test(n)) return true;
  if (/\b(start|begin)\b/.test(n) && /\b(description|describe|describing)\b/.test(n)) {
    return true;
  }
  if (n === 'describe' || n === 'description') return true;
  return false;
}

export function matchesStopNavigation(text) {
  const n = normalize(text);
  return /\b(stop|deactivate|end|disable|cancel)\b/.test(n) && /\bnavigation\b/.test(n);
}

export function matchesActivateNavigation(text) {
  const n = normalize(text);
  return /\b(activate|start|begin|enable)\b/.test(n) && /\bnavigation\b/.test(n);
}

/** "stop" → leave scene chat and return to main navigation (obstacle detection stays off). */
export function matchesGoToObstacle(text) {
  const n = normalize(text);
  if (matchesStopNavigation(text)) return false;
  if (!/\bstop\b/.test(n)) return false;
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length <= 3) return true;
  if (words[0] === 'stop' || words[words.length - 1] === 'stop') return true;
  return false;
}

export function matchesEndSession(text) {
  const n = normalize(text);
  if (/\b(end|close|finish|reset|clear|new)\b/.test(n) && /\bsession\b/.test(n)) return true;
  if (/\b(end|close|finish)\b/.test(n) && /\b(description|describe|describing)\b/.test(n)) {
    return true;
  }
  return false;
}

/**
 * Hands-free voice commands.
 * autoListen=true → mic stays open; no tap. Pauses during describe/TTS, then listens again.
 */
export function useDescribeEnvironmentHotword({
  enabled,
  autoListen = false,
  cameraRef,
  alertVolumeRef,
  getTtsOpts,
  onPhraseMatched,
  onActivateNavigation,
  onStopNavigation,
  onGoToObstacle,
  onEndSession,
  onListeningChange,
  onVoiceStatusChange,
  onVoiceDetailChange,
}) {
  const isFocused = useIsFocused();
  const onMatchedRef = useRef(onPhraseMatched);
  const onActivateNavRef = useRef(onActivateNavigation);
  const onStopNavRef = useRef(onStopNavigation);
  const onGoToObstacleRef = useRef(onGoToObstacle);
  const onEndSessionRef = useRef(onEndSession);
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
    onGoToObstacleRef.current = onGoToObstacle;
  }, [onGoToObstacle]);
  useEffect(() => {
    onEndSessionRef.current = onEndSession;
  }, [onEndSession]);

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
    let lastStopAt = 0;
    let sessionActive = false;
    let listenWindowTimer = null;
    let permissionsDeniedAnnounced = false;
    let permissionsReady = false;
    let actionInFlight = false;
    let restartTimer = null;

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

    const clearRestartTimer = () => {
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
    };

    const scheduleRestart = (delayMs = RESTART_AFTER_END_MS) => {
      if (!autoListen || cancelled || !enabled || !isFocused) return;
      clearRestartTimer();
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (!cancelled && !actionInFlight) startRecognition();
      }, delayMs);
    };

    const restorePlaybackAfterListen = () => {
      void ensureIosLoudSpeakerRoute();
    };

    const stopSession = ({ resumePreview = true } = {}) => {
      sessionActive = false;
      clearListenWindow();
      setListening(false);
      if (!cancelled && enabled && isFocused) setVoiceStatus(autoListen ? 'ready' : 'ready');
      if (resumePreview) resumePreviewSafely();
      abortSpeechRecognition(ExpoSpeechRecognitionModule, OWNER_ID);
      restorePlaybackAfterListen();
    };

    const waitForSpeechThenRestart = () => {
      if (!autoListen) return;
      if (isSpeechActive()) {
        const unsub = subscribeSpeechActive((active) => {
          if (!active) {
            unsub();
            scheduleRestart(RESTART_AFTER_TTS_MS);
          }
        });
        return;
      }
      scheduleRestart(RESTART_AFTER_TTS_MS);
    };

    const runAction = async (action) => {
      actionInFlight = true;
      stopSession({ resumePreview: true });

      let fn = null;
      if (action === 'describe') fn = onMatchedRef.current;
      else if (action === 'activateNav') fn = onActivateNavRef.current;
      else if (action === 'stopNav') fn = onStopNavRef.current;
      else if (action === 'goObstacle') fn = onGoToObstacleRef.current;
      else if (action === 'endSession') fn = onEndSessionRef.current;

      try {
        if (action === 'describe') {
          resumePreviewSafely();
          await new Promise((r) => setTimeout(r, 400));
        } else if (action === 'goObstacle' || action === 'stopNav' || action === 'activateNav') {
          stopSpeech();
        }
        await Promise.resolve(fn && fn());
      } catch {
        /* ignore */
      } finally {
        actionInFlight = false;
        if (action === 'describe') {
          resumePreviewSafely();
          waitForSpeechThenRestart();
        } else if (action === 'goObstacle' || action === 'stopNav' || action === 'activateNav') {
          /* screen may change — hook cleanup handles mic */
        } else if (autoListen) {
          waitForSpeechThenRestart();
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
        actionInFlight ||
        !ExpoSpeechRecognitionModule?.start
      ) {
        return;
      }

      takeSpeechRecognition(ExpoSpeechRecognitionModule, OWNER_ID);
      sessionActive = true;
      setListening(true);
      setVoiceStatus('listening');
      Speech.stop();
      if (!autoListen) {
        pausePreviewSafely();
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      clearListenWindow();
      if (!autoListen) {
        listenWindowTimer = setTimeout(() => {
          if (sessionActive) stopSession();
        }, LISTEN_WINDOW_MS);
      }

      const startTimer = setTimeout(() => {
        if (cancelled || !sessionActive) return;
        configureSpeechRecognitionAudioIOS(ExpoSpeechRecognitionModule);
        ExpoSpeechRecognitionModule.start({
          lang: 'en-US',
          interimResults: true,
          contextualStrings: [
            'describe',
            'describe environment',
            'describe scene',
            'start description',
            'stop',
            'stop description',
            'activate navigation',
            'start navigation',
            'stop navigation',
            'end session',
            'end description',
          ],
          continuous: autoListen,
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
      if (autoListen) {
        scheduleRestart(900);
      }
    }

    subs.push(
      addSpeechRecognitionListener('result', (ev) => {
        if (!sessionActive || cancelled || actionInFlight) return;
        const results = ev?.results || [];
        const text = results.map((r) => r.transcript).join(' ');

        let action = null;
        if (matchesStopNavigation(text)) action = 'stopNav';
        else if (matchesGoToObstacle(text)) action = 'goObstacle';
        else if (matchesEndSession(text)) action = 'endSession';
        else if (matchesDescribe(text)) action = 'describe';
        else if (matchesActivateNavigation(text)) action = 'activateNav';
        if (!action) return;

        const now = Date.now();
        const cooldown = action === 'goObstacle' || action === 'stopNav' ? STOP_COOLDOWN_MS : PHRASE_COOLDOWN_MS;
        const lastAt = action === 'goObstacle' || action === 'stopNav' ? lastStopAt : lastFireAt;
        if (now - lastAt < cooldown) return;
        if (action === 'goObstacle' || action === 'stopNav') lastStopAt = now;
        else lastFireAt = now;

        void runAction(action);
      })
    );

    subs.push(
      addSpeechRecognitionListener('error', (e) => {
        if (e?.error === 'aborted') return;
        stopSession();
        if (e?.error !== 'no-speech' && e?.error !== 'speech-timeout') {
          if (!autoListen) {
            Speech.stop();
            Speech.speak('Could not hear a command. Tap the voice bar and try again.', volOpts());
          }
        }
        if (autoListen) scheduleRestart(1200);
      })
    );

    subs.push(
      addSpeechRecognitionListener('end', () => {
        sessionActive = false;
        setListening(false);
        restorePlaybackAfterListen();
        resumePreviewSafely();
        if (!cancelled && enabled && isFocused && !actionInFlight && autoListen) {
          setVoiceStatus('ready');
          scheduleRestart(RESTART_AFTER_END_MS);
        } else if (!cancelled && enabled && isFocused) {
          setVoiceStatus('ready');
        }
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
      clearRestartTimer();
      stopSession();
      releaseSpeechRecognition(OWNER_ID);
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
  }, [enabled, isFocused, autoListen]);

  const requestVoiceListen = useCallback(() => {
    requestListenRef.current();
  }, []);

  return { requestVoiceListen };
}
