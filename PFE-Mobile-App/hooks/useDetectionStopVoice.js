import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useIsFocused } from '@react-navigation/native';

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
import { isSpeechActive, stopSpeech, subscribeSpeechActive } from '../utils/speakAlert';
import { matchesStopNavigation } from './useDescribeEnvironmentHotword';

const OWNER_ID = 'main-detection-stop';
const STOP_COOLDOWN_MS = 1400;
const RESTART_AFTER_END_MS = 600;
const RESTART_AFTER_TTS_MS = 900;
const RESTART_AFTER_CAPTURE_MS = 400;

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Only exact stop phrases — ignores "Person ahead" alert echo. */
function matchesStopOnly(text) {
  const n = normalize(text);
  if (matchesStopNavigation(text)) return true;
  return n === 'stop' || n === 'stop.' || n === 'stop detection' || n === 'stop obstacle';
}

/**
 * While Obstacle D runs: listen only for "stop".
 * Mic pauses during TTS and while the camera captures a frame.
 */
export function useDetectionStopVoice({
  enabled,
  captureBusyRef,
  onStopDetection,
  onVoiceStatusChange,
}) {
  const isFocused = useIsFocused();
  const onStopRef = useRef(onStopDetection);

  const setVoiceStatus = useCallback(
    (status) => {
      try {
        onVoiceStatusChange?.(status);
      } catch {
        /* ignore */
      }
    },
    [onVoiceStatusChange]
  );

  useEffect(() => {
    onStopRef.current = onStopDetection;
  }, [onStopDetection]);

  useEffect(() => {
    if (!enabled || Platform.OS === 'web') {
      setVoiceStatus('off');
      return undefined;
    }

    if (!isFocused) {
      setVoiceStatus('paused');
      return undefined;
    }

    const nativeStatus = getSpeechRecognitionNativeStatus();
    if (!nativeStatus.ok) {
      setVoiceStatus('unavailable');
      return undefined;
    }

    const speechApi = loadSpeechRecognitionPackage().pkg;
    if (!speechApi) {
      setVoiceStatus('unavailable');
      return undefined;
    }

    const { ExpoSpeechRecognitionModule, addSpeechRecognitionListener } = speechApi;
    if (
      !ExpoSpeechRecognitionModule?.start ||
      typeof addSpeechRecognitionListener !== 'function'
    ) {
      setVoiceStatus('unavailable');
      return undefined;
    }

    let cancelled = false;
    const timers = [];
    const subs = [];
    let lastStopAt = 0;
    let sessionActive = false;
    let permissionsReady = false;
    let actionInFlight = false;
    let restartTimer = null;

    const captureBusy = () => captureBusyRef?.current === true;

    const clearRestartTimer = () => {
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
    };

    const canListen = () =>
      !cancelled &&
      enabled &&
      isFocused &&
      permissionsReady &&
      !actionInFlight &&
      !captureBusy() &&
      !isSpeechActive();

    const scheduleRestart = (delayMs = RESTART_AFTER_END_MS) => {
      if (cancelled || !enabled || !isFocused) return;
      clearRestartTimer();
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (canListen()) startRecognition();
      }, delayMs);
    };

    const stopSession = () => {
      sessionActive = false;
      if (!cancelled && enabled && isFocused) {
        setVoiceStatus(captureBusy() || isSpeechActive() ? 'paused' : 'ready');
      }
      abortSpeechRecognition(ExpoSpeechRecognitionModule, OWNER_ID);
      void ensureIosLoudSpeakerRoute();
    };

    const runStop = async () => {
      actionInFlight = true;
      stopSession();
      stopSpeech();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      try {
        await Promise.resolve(onStopRef.current?.());
      } catch {
        /* ignore */
      } finally {
        actionInFlight = false;
      }
    };

    const startRecognition = () => {
      if (!canListen() || sessionActive || !ExpoSpeechRecognitionModule?.start) return;

      takeSpeechRecognition(ExpoSpeechRecognitionModule, OWNER_ID);
      sessionActive = true;
      setVoiceStatus('listening');

      const startTimer = setTimeout(() => {
        if (cancelled || !sessionActive || !canListen()) {
          sessionActive = false;
          return;
        }
        configureSpeechRecognitionAudioIOS(ExpoSpeechRecognitionModule);
        ExpoSpeechRecognitionModule.start({
          lang: 'en-US',
          interimResults: true,
          contextualStrings: ['stop', 'stop detection', 'stop obstacle', 'stop navigation'],
          continuous: true,
          requiresOnDeviceRecognition: false,
          iosVoiceProcessingEnabled: Platform.OS === 'ios',
        });
      }, Platform.OS === 'ios' ? 280 : 180);
      timers.push(startTimer);
    };

    async function bootstrapPermissions() {
      if (cancelled || !enabled || !isFocused) return;
      const p = await ensureSpeechRecognitionPermissions(ExpoSpeechRecognitionModule);
      if (cancelled || !isSpeechPermissionGranted(p)) {
        setVoiceStatus('denied');
        return;
      }
      permissionsReady = true;
      setVoiceStatus('ready');
      scheduleRestart(500);
    }

    subs.push(
      addSpeechRecognitionListener('result', (ev) => {
        if (cancelled || !sessionActive || actionInFlight) return;
        const text = (ev?.results || []).map((r) => r.transcript).join(' ');
        if (!matchesStopOnly(text)) return;
        const now = Date.now();
        if (now - lastStopAt < STOP_COOLDOWN_MS) return;
        lastStopAt = now;
        void runStop();
      })
    );

    subs.push(
      addSpeechRecognitionListener('error', (e) => {
        if (e?.error === 'aborted') return;
        stopSession();
        scheduleRestart(1200);
      })
    );

    subs.push(
      addSpeechRecognitionListener('end', () => {
        sessionActive = false;
        releaseSpeechRecognition(OWNER_ID);
        if (!cancelled && enabled && isFocused && !actionInFlight) {
          setVoiceStatus(captureBusy() || isSpeechActive() ? 'paused' : 'ready');
          scheduleRestart(RESTART_AFTER_END_MS);
        }
      })
    );

    subs.push(
      addSpeechRecognitionListener('start', () => {
        if (!cancelled && sessionActive) setVoiceStatus('listening');
      })
    );

    const unsubTts = subscribeSpeechActive((active) => {
      if (active && sessionActive) {
        stopSession();
        return;
      }
      if (!active && !cancelled && enabled && isFocused && !actionInFlight) {
        scheduleRestart(RESTART_AFTER_TTS_MS);
      }
    });

    let capturePoll = null;
    if (captureBusyRef) {
      let wasBusy = captureBusyRef.current === true;
      capturePoll = setInterval(() => {
        const busy = captureBusyRef.current === true;
        if (busy && sessionActive) stopSession();
        if (wasBusy && !busy && !cancelled && enabled && isFocused && !actionInFlight) {
          scheduleRestart(RESTART_AFTER_CAPTURE_MS);
        }
        wasBusy = busy;
      }, 120);
    }

    setVoiceStatus('starting');
    void bootstrapPermissions();

    return () => {
      cancelled = true;
      clearRestartTimer();
      if (capturePoll) clearInterval(capturePoll);
      unsubTts();
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
    };
  }, [enabled, isFocused, captureBusyRef, setVoiceStatus]);
}
