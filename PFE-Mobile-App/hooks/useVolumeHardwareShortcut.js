import { useCallback, useEffect, useRef } from 'react';
import { AppState, NativeModules, Platform } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

import { loadAlertVolume } from '../utils/alertVolumeStorage';
import { alertOutputState, applyAlertVolumeToSystemOutput } from '../utils/systemOutputVolume';

/** Ignore volume-key describe briefly after a screen gains focus (avoids launch spam). */
const FOCUS_GRACE_MS = 3500;

/** Cooldown between hardware volume events (describe re-triggers). */
const DESCRIBE_COOLDOWN_MS = 900;

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
  const focusedAtRef = useRef(0);
  useEffect(() => {
    isFocusedRef.current = isFocused;
    if (isFocused) {
      focusedAtRef.current = Date.now();
    }
  }, [isFocused]);

  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const ignoreNextVolumeEventsRef = useRef(0);
  const nativeModRef = useRef(null);

  const restoreBaselineVolume = useCallback(() => {
    void applyAlertVolumeToSystemOutput(alertOutputState.baseline01);
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
      await refreshFromStorage();
      if (cancelled) return;

      const onVolume = () => {
        if (ignoreNextVolumeEventsRef.current > 0) {
          ignoreNextVolumeEventsRef.current -= 1;
          return;
        }
        if (!enabledRef.current || !isFocusedRef.current) return;
        if (Date.now() - focusedAtRef.current < FOCUS_GRACE_MS) return;
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
        if (Platform.OS === 'ios') {
          ignoreNextVolumeEventsRef.current += 2;
        }
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
