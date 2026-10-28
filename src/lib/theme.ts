// Bindle design tokens — monochrome "white/black glass" style, no color accents,
// symbol-first (vector icons only, never emoji). Matches the rest of this portfolio's
// minimal mobile design rule: simple, clean, modern, restrained.

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  danger: string;
  overlay: string;
}

export const colors: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    background: '#FAFAFA',
    surface: '#FFFFFF',
    surfaceAlt: '#F0F0F0',
    border: '#E2E2E2',
    text: '#111111',
    textMuted: '#6B6B6B',
    textFaint: '#A3A3A3',
    accent: '#111111',
    danger: '#B3261E',
    overlay: 'rgba(0,0,0,0.04)',
  },
  dark: {
    background: '#0B0B0B',
    surface: '#161616',
    surfaceAlt: '#1F1F1F',
    border: '#2A2A2A',
    text: '#F5F5F5',
    textMuted: '#A3A3A3',
    textFaint: '#6B6B6B',
    accent: '#F5F5F5',
    danger: '#FF6B61',
    overlay: 'rgba(255,255,255,0.06)',
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
};

export const typography = {
  title: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 20, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 22 },
  caption: { fontSize: 13, fontWeight: '500' as const },
  tiny: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.4 },
};
