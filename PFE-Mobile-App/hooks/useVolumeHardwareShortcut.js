import { useCallback, useEffect, useRef } from 'react';
import { NativeModules } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

/** Separate cooldown when describing — avoids interrupting Gemini / duplicate captures */
const DESCRIBE_COOLDOWN_MS = 2200;
const NAV_COOLDOWN_MS = 1000;

/**
 * Physical volume hardware: describe scene, open Scene Query, or off (settings).
 * Requires `react-native-volume-manager`; no-ops in Expo Go without the native module.
 */
export function useVolumeHardwareShortcut(navigation, options = {}) {
  const {
    enabled = true,
    action = 'none',
    onDescribeEnvironment,
  } = options;
  const isFocused = useIsFocused();
  const lastFired = useRef(0);

  const fire = useCallback(() => {
    if (!enabled || !isFocused) return;
    const now = Date.now();
    const cooldown = action === 'describe' ? DESCRIBE_COOLDOWN_MS : NAV_COOLDOWN_MS;
    if (now - lastFired.current < cooldown) return;
    lastFired.current = now;

    if (action === 'describe' && typeof onDescribeEnvironment === 'function') {
      onDescribeEnvironment();
      return;
    }
    if (action === 'scene_query' && typeof navigation?.navigate === 'function') {
      navigation.navigate('SceneQuery');
    }
  }, [action, enabled, isFocused, navigation, onDescribeEnvironment]);

  useEffect(() => {
    if (action === 'none') return undefined;

    const volumeModule = NativeModules.VolumeManager;
    if (
      !volumeModule ||
      typeof volumeModule.addListener !== 'function' ||
      typeof volumeModule.removeListeners !== 'function'
    ) {
      return undefined;
    }
    let subscription;
    try {
      // eslint-disable-next-line global-require
      const { addVolumeListener } = require('react-native-volume-manager');
      subscription = addVolumeListener(() => {
        fire();
      });
    } catch {
      return undefined;
    }
    return () => {
      try {
        subscription?.remove?.();
      } catch {
        // ignore
      }
    };
  }, [fire, action]);
}
