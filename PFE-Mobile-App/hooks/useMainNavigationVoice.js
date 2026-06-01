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
import { stopSpeech } from '../utils/speakAlert';
import {
  matchesActivateNavigation,
  matchesDescribe,
  matchesStopNavigation,
} from './useDescribeEnvironmentHotword';

const OWNER_ID = 'main-navigation';
const PHRASE_COOLDOWN_MS = 2800;
const COMMAND_COOLDOWN_MS = 900;
const STOP_COOLDOWN_MS = 1200;
const RESTART_AFTER_END_MS = 900;
const RESTART_AFTER_TTS_MS = 1100;

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** @returns {'describe'|'chat'|null} */
export function matchesOpenSceneChat(text) {
  if (matchesDescribe(text)) return 'describe';
  const n = normalize(text);
  if (/\b(scene chat|open chat|chat query|scene query|open scene|go to chat)\b/.test(n)) {
    return 'chat';
  }
  if (n === 'chat') return 'chat';
  return null;
}

export function matchesStartDetection(text) {
  if (matchesStopDetection(text)) return false;
  const n = normalize(text);
  if (matchesActivateNavigation(text)) return true;
  if (n === 'detection' || n === 'detect') return true;
  if (/\b(obstacle detection|start detection|detection on)\b/.test(n)) return true;
  if (/\b(start|on|enable|activate|begin)\b/.test(n) && /\b(detection|detect|obstacle)\b/.test(n)) {
    return true;
  }
  return false;
}

export function matchesStopDetection(text) {
  const n = normalize(text);
  if (matchesStopNavigation(text)) return true;
  if (/\b(stop|off|disable|deactivate|end)\b/.test(n) && /\b(detection|detect|obstacle)\b/.test(n)) {
    return true;
  }
  if (n === 'stop' || n === 'stop.') return true;
  return false;
}

/**
 * Hands-free on Main while obstacle detection is OFF.
 * Mic is released when detection runs so the camera + TTS audio session stays stable.
 */
export function useMainNavigationVoice({
  enabled,
  autoListen = true,
  getTtsOpts,
  onOpenSceneChat,
  onOpenSceneDescribe,
  onStartDetection,
  onStopDetection,
  onVoiceStatusChange,
}) {
  const isFocused = useIsFocused();
  const onOpenSceneChatRef = useRef(onOpenSceneChat);
  const onOpenSceneDescribeRef = useRef(onOpenSceneDescribe);
  const onStartDetectionRef = useRef(onStartDetection);
  const onStopDetectionRef = useRef(onStopDetection);

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
    onOpenSceneChatRef.current = onOpenSceneChat;
  }, [onOpenSceneChat]);
  useEffect(() => {
    onOpenSceneDescribeRef.current = onOpenSceneDescribe;
  }, [onOpenSceneDescribe]);
  useEffect(() => {
    onStartDetectionRef.current = onStartDetection;
  }, [onStartDetection]);
  useEffect(() => {
    onStopDetectionRef.current = onStopDetection;
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
    let lastFireAt = 0;
    let lastCommandAt = 0;
    let lastStopAt = 0;
    let sessionActive = false;
    let permissionsReady = false;
    let actionInFlight = false;
    let restartTimer = null;

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

    const stopSession = () => {
      sessionActive = false;
      if (!cancelled && enabled && isFocused) setVoiceStatus('ready');
      abortSpeechRecognition(ExpoSpeechRecognitionModule, OWNER_ID);
      void ensureIosLoudSpeakerRoute();
    };

    const runAction = async (action) => {
      actionInFlight = true;
      stopSession();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      try {
        if (action === 'openChat') {
          onOpenSceneChatRef.current?.();
        } else if (action === 'openDescribe') {
          onOpenSceneDescribeRef.current?.();
        } else if (action === 'startDetection') {
          stopSpeech();
          await Promise.resolve(onStartDetectionRef.current?.());
        } else if (action === 'stopDetection') {
          stopSpeech();
          await Promise.resolve(onStopDetectionRef.current?.());
        }
      } catch {
        /* ignore */
      } finally {
        actionInFlight = false;
        if (action !== 'openChat' && action !== 'openDescribe') {
          scheduleRestart(RESTART_AFTER_TTS_MS);
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
      setVoiceStatus('listening');

      const startTimer = setTimeout(() => {
        if (cancelled || !sessionActive) return;
        configureSpeechRecognitionAudioIOS(ExpoSpeechRecognitionModule);
        ExpoSpeechRecognitionModule.start({
          lang: 'en-US',
          interimResults: true,
          contextualStrings: [
            'stop',
            'stop detection',
            'detection',
            'start detection',
            'scene chat',
            'open chat',
            'describe',
            'describe scene',
            'activate navigation',
          ],
          continuous: autoListen,
          requiresOnDeviceRecognition: false,
          iosVoiceProcessingEnabled: Platform.OS === 'ios',
        });
      }, Platform.OS === 'ios' ? 350 : 220);
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
      if (autoListen) scheduleRestart(700);
    }

    subs.push(
      addSpeechRecognitionListener('result', (ev) => {
        if (cancelled || !sessionActive || actionInFlight) return;
        const results = ev?.results || [];
        const text = results.map((r) => r.transcript).join(' ');
        if (!text.trim()) return;

        let action = null;
        if (matchesStopDetection(text)) {
          action = 'stopDetection';
        } else if (matchesStartDetection(text)) {
          action = 'startDetection';
        } else {
          const open = matchesOpenSceneChat(text);
          if (open === 'describe') action = 'openDescribe';
          else if (open === 'chat') action = 'openChat';
        }
        if (!action) return;

        const now = Date.now();
        if (action === 'stopDetection') {
          if (now - lastStopAt < STOP_COOLDOWN_MS) return;
          lastStopAt = now;
        }

        const isNav = action === 'startDetection' || action === 'stopDetection';
        const cooldown = isNav ? COMMAND_COOLDOWN_MS : PHRASE_COOLDOWN_MS;
        const lastAt = isNav ? lastCommandAt : lastFireAt;
        if (now - lastAt < cooldown) return;
        if (isNav) lastCommandAt = now;
        else lastFireAt = now;

        void runAction(action);
      })
    );

    subs.push(
      addSpeechRecognitionListener('error', (e) => {
        if (e?.error === 'aborted') return;
        stopSession();
        scheduleRestart(1500);
      })
    );

    subs.push(
      addSpeechRecognitionListener('end', () => {
        sessionActive = false;
        releaseSpeechRecognition(OWNER_ID);
        void ensureIosLoudSpeakerRoute();
        if (!cancelled && enabled && isFocused && !actionInFlight && autoListen) {
          setVoiceStatus('ready');
          scheduleRestart(RESTART_AFTER_END_MS);
        }
      })
    );

    subs.push(
      addSpeechRecognitionListener('start', () => {
        if (!cancelled && sessionActive) setVoiceStatus('listening');
      })
    );

    setVoiceStatus('starting');
    void bootstrapPermissions();

    return () => {
      cancelled = true;
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
    };
  }, [enabled, isFocused, autoListen, setVoiceStatus]);
}
