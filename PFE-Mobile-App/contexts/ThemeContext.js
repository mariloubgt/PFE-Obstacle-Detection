import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createTheme } from '../constants/theme';
import { loadAppearanceMode, saveAppearanceMode } from '../utils/appSettings';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [appearance, setAppearanceState] = useState(null);

  useEffect(() => {
    void loadAppearanceMode().then(setAppearanceState);
  }, []);

  const colors = useMemo(
    () => createTheme(appearance ?? 'night_shift'),
    [appearance]
  );

  const setAppearance = useCallback(async (mode) => {
    const saved = await saveAppearanceMode(mode);
    setAppearanceState(saved);
    return saved;
  }, []);

  const value = useMemo(
    () => ({
      appearance: appearance ?? 'night_shift',
      colors,
      setAppearance,
      ready: appearance != null,
    }),
    [appearance, colors, setAppearance]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useAppTheme must be used within ThemeProvider');
  }
  return ctx;
}

/** Shorthand for screens that only need the palette */
export function useThemeColors() {
  return useAppTheme().colors;
}
