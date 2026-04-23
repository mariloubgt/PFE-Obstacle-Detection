import { useCallback, useEffect, useRef } from 'react';
import { NativeModules } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

const COOLDOWN_MS = 1000;

/**
 * Opens Scene Query when the user presses physical volume up/down (any volume change event).
 * Requires `react-native-volume-manager` in a custom dev build or production build.
 * In Expo Go, `NativeModules.VolumeManager` is missing — this hook no-ops safely.
 *
 * @param {object} [options]
 * @param {boolean} [options.enabled] When false (e.g. volume modal open), ignores hardware volume.
 */
export function useVolumeSceneQueryTrigger(navigation, options = {}) {
  const { enabled = true } = options;
  const isFocused = useIsFocused();
  const lastFired = useRef(0);

  const openSceneQuery = useCallback(() => {
    if (!enabled || !isFocused) return;
    const now = Date.now();
    if (now - lastFired.current < COOLDOWN_MS) return;
    lastFired.current = now;
    if (typeof navigation?.navigate === 'function') {
      navigation.navigate('SceneQuery');
    }
  }, [enabled, isFocused, navigation]);

  useEffect(() => {
    if (!NativeModules.VolumeManager) {
      return;
    }
    let subscription;
    try {
      // eslint-disable-next-line global-require
      const { addVolumeListener } = require('react-native-volume-manager');
      subscription = addVolumeListener(() => {
        openSceneQuery();
      });
    } catch {
      return;
    }
    return () => {
      try {
        subscription?.remove?.();
      } catch {
        // ignore
      }
    };
  }, [openSceneQuery]);
}
