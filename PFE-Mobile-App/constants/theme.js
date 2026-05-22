/** App appearance — persisted in Settings / onboarding. */
export const APPEARANCE = {
  /** Dark UI — default VisionAid look */
  night_shift: 'night_shift',
  /** Light UI — high-contrast daytime / bright environments */
  white_shift: 'white_shift',
};

/**
 * Full palette for one appearance. Keys mirror legacy COLORS usage:
 * `text` replaces former misuse of `white` for typography on screens.
 * Use `overlayIcon` for controls drawn on top of the camera preview.
 *
 * @param {'night_shift'|'white_shift'} appearance
 */
export function createTheme(appearance) {
  if (appearance === APPEARANCE.white_shift) {
    return {
      bg: '#F1F5F9',
      bgElevated: '#FFFFFF',
      teal: '#0F766E',
      tealBright: '#0D9488',
      text: '#0F172A',
      white: '#0F172A',
      grey: '#64748B',
      greyDark: '#475569',
      borderMuted: '#CBD5E1',
      btnText: '#FFFFFF',
      danger: '#DC2626',
      orange: '#EA580C',
      wall: '#0D9488',
      overlayIcon: '#FFFFFF',
      statusBarStyle: 'dark',
      headerBackCircle: 'rgba(13, 148, 136, 0.14)',
      detectionBoxFill: 'rgba(13, 148, 136, 0.14)',
      detectionLabelBg: 'rgba(15, 23, 42, 0.9)',
      navBarBg: 'rgba(248, 250, 252, 0.97)',
      switchTrackOff: 'rgba(13, 148, 136, 0.22)',
      geminiSwitchTrackOn: '#134E4A',
      messageBubbleAssistant: '#E2E8F0',
      messageBubbleUser: '#CCFBF1',
      overlayScrim: 'rgba(241, 245, 249, 0.94)',
      alertCardBg: 'rgba(15, 23, 42, 0.06)',
      topBarText: '#0F172A',
    };
  }

  return {
    bg: '#0D1117',
    bgElevated: '#151E32',
    teal: '#66D2B1',
    tealBright: '#7FE8CC',
    text: '#F8FAFC',
    white: '#F8FAFC',
    grey: '#94A3B8',
    greyDark: '#475569',
    borderMuted: '#334155',
    btnText: '#0B1220',
    danger: '#EF4444',
    orange: '#F97316',
    wall: '#66D2B1',
    overlayIcon: '#FFFFFF',
    statusBarStyle: 'light',
    headerBackCircle: 'rgba(102, 210, 177, 0.12)',
    detectionBoxFill: 'rgba(102, 210, 177, 0.1)',
    detectionLabelBg: 'rgba(13, 17, 23, 0.92)',
    navBarBg: 'rgba(15, 23, 42, 0.95)',
    switchTrackOff: 'rgba(102, 210, 177, 0.15)',
    geminiSwitchTrackOn: '#134E4A',
    messageBubbleAssistant: '#1E293B',
    messageBubbleUser: '#134E4A',
    overlayScrim: 'rgba(15, 23, 42, 0.92)',
    alertCardBg: 'rgba(255, 255, 255, 0.05)',
    topBarText: '#FFFFFF',
  };
}

/** Default export for gradual migration — matches night_shift */
export const COLORS = createTheme(APPEARANCE.night_shift);

/** Tuned for iPhone 14 Plus width (~428pt): shared gutters and radii. */
export const LAYOUT = {
  screenPaddingH: 24,
  cardRadius: 16,
  buttonRadius: 16,
  logoBoxHeight: 112,
  logoBoxMaxWidth: 112,
  appNameBlockMinHeight: 48,
};
