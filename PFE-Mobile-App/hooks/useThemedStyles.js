import { useMemo } from 'react';
import { useThemeColors } from '../contexts/ThemeContext';

/** Build StyleSheet from the active palette; re-runs when Night/White shift changes. */
export function useThemedStyles(createStyles) {
  const colors = useThemeColors();
  return useMemo(() => createStyles(colors), [colors, createStyles]);
}
