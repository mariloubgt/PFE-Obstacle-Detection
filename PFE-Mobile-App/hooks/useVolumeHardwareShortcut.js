import { useCallback, useEffect, useRef } from 'react';
import { NativeModules, Platform } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

/** Short so repeated volume presses feel like “every tap” (each still opens a new describe). */
const DESCRIBE_COOLDOWN_MS = 450;

/**
 * Physical volume buttons → describe scene (or open SceneQuery).
 * Uses a stable ref so the native subscription is created once and never torn down
 * on re-renders — only when `action` actually changes.
 */
export function useVolumeHardwareShortcut(navigation, options = {}) {
  const {
    enabled = true,
    action = 'none',
    onDescribeEnvironment,
  } = options;

  const isFocused = useIsFocused();
  const lastFiredRef = useRef(0);

  // Keep a stable ref to the latest callback so the subscription never needs
  // to be recreated when onDescribeEnvironment changes identity.
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

  // Stable handler — never changes identity.
  const handleVolume = useCallback(() => {
    if (!enabledRef.current || !isFocusedRef.current) return;
    const now = Date.now();
    if (now - lastFiredRef.current < DESCRIBE_COOLDOWN_MS) return;
    lastFiredRef.current = now;

    if (action === 'describe') {
      const fn = onDescribeRef.current;
      if (typeof fn === 'function') fn();
      return;
    }
    if (action === 'scene_query') {
      const fn = onDescribeRef.current;
      if (typeof fn === 'function') {
        fn();
        return;
      }
      navigation?.navigate?.('SceneQuery');
    }
  }, [action, navigation]); // only recreate when action/navigation change

  useEffect(() => {
    if (action === 'none') return undefined;
    if (!NativeModules.VolumeManager) return undefined;

    let subscription;
    try {
      // eslint-disable-next-line global-require
      const mod = require('react-native-volume-manager');
      // Activate iOS audio session so outputVolume KVO fires.
      if (Platform.OS === 'ios' && typeof mod.enable === 'function') {
        void Promise.resolve(mod.enable(true, true)).catch(() => {});
      }
      subscription = mod.addVolumeListener(handleVolume);
    } catch {
      return undefined;
    }

    return () => {
      try { subscription?.remove?.(); } catch { /* ignore */ }
    };
  }, [action, handleVolume]); // stable — only changes when action changes
}
