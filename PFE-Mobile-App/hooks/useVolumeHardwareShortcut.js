import { useCallback, useEffect, useRef } from 'react';
import { AppState, NativeModules, Platform } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

import { loadAlertVolume } from '../utils/alertVolumeStorage';
import { alertOutputState, applyAlertVolumeToSystemOutput } from '../utils/systemOutputVolume';

/** Cooldown between hardware volume events (describe re-triggers). */
const DESCRIBE_COOLDOWN_MS = 100;

/**
 * Physical volume buttons → scene describe. Restores level to {@link alertOutputState.baseline01}
 * (Settings / Alert volume), not a stale getVolume snapshot.
 */
export function useVolumeHardwareShortcut(navigation, options = {}) {
  const {
    enabled = true,
    action = 'none',
    onDescribeEnvironment,
  } = options;

  const isFocused = useIsFocused();
  const lastFiredRef = useRef(0);
  const onDescribeRef = useRef(onDescribeEnvironment);
  useEffect(() => {
    onDescribeRef.current = onDescribeEnvironment;
  }, [onDescribeEnvironment]);

  const isFocusedRef = useRef(isFocused);
  useEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);

  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const ignoreNextVolumeEventsRef = useRef(0);
  const nativeModRef = useRef(null);

  const restoreBaselineVolume = useCallback(() => {
    const mod = nativeModRef.current;
    if (!mod || typeof mod.setVolume !== 'function') return;
    const v = alertOutputState.baseline01;
    const clamped = Math.min(1, Math.max(0, v));
    // Programmatic setVolume often emits 1–2 extra KVO callbacks on iOS.
    ignoreNextVolumeEventsRef.current += 2;
    void Promise.resolve(
      mod.setVolume(clamped, {
        playSound: false,
        type: 'music',
        showUI: false,
      })
    ).catch(() => {});
  }, []);

  useEffect(() => {
    if (action === 'none') {
      try {
        // eslint-disable-next-line global-require
        const mod = require('react-native-volume-manager');
        void mod.showNativeVolumeUI?.({ enabled: true });
      } catch {
        /* ignore */
      }
      return undefined;
    }

    if (!NativeModules.VolumeManager) return undefined;

    let mod;
    try {
      // eslint-disable-next-line global-require
      mod = require('react-native-volume-manager');
    } catch {
      return undefined;
    }

    nativeModRef.current = mod;
    let subscription;
    let appStateSub;
    let cancelled = false;

    const refreshFromStorage = async () => {
      try {
        const stored = await loadAlertVolume();
        await applyAlertVolumeToSystemOutput(stored);
      } catch {
        /* ignore */
      }
    };

    const run = async () => {
      await mod.showNativeVolumeUI?.({ enabled: false });
      if (Platform.OS === 'ios' && typeof mod.enable === 'function') {
        await Promise.resolve(mod.enable(true, true)).catch(() => {});
      }
      await refreshFromStorage();
      if (cancelled) return;

      const onVolume = () => {
        if (ignoreNextVolumeEventsRef.current > 0) {
          ignoreNextVolumeEventsRef.current -= 1;
          return;
        }
        if (!enabledRef.current || !isFocusedRef.current) return;
        const now = Date.now();
        if (now - lastFiredRef.current < DESCRIBE_COOLDOWN_MS) return;
        lastFiredRef.current = now;

        if (action === 'describe') {
          const fn = onDescribeRef.current;
          if (typeof fn === 'function') fn();
        } else if (action === 'scene_query') {
          const fn = onDescribeRef.current;
          if (typeof fn === 'function') fn();
          else navigation?.navigate?.('SceneQuery');
        }

        restoreBaselineVolume();
      };

      subscription = mod.addVolumeListener(onVolume);
    };

    void run();

    appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshFromStorage();
      }
    });

    return () => {
      cancelled = true;
      subscription?.remove?.();
      appStateSub?.remove?.();
      nativeModRef.current = null;
      try {
        void mod.showNativeVolumeUI?.({ enabled: true });
      } catch {
        /* ignore */
      }
    };
  }, [action, navigation, restoreBaselineVolume]);

  /** When returning from Settings / other screens, re-apply saved level so it matches the slider. */
  useEffect(() => {
    if (action === 'none' || !isFocused) return undefined;
    void loadAlertVolume()
      .then((v) => applyAlertVolumeToSystemOutput(v))
      .catch(() => {});
    return undefined;
  }, [isFocused, action]);

  return null;
}
