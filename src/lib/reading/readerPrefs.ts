// Reader display preferences (font size, line height, theme) — the reader-
// customization gap flagged in the 2026-11-06 commercial-readiness audit
// (plans/bindle.md: "Pocket/Instapaper/Readwise all let the reader adjust
// font size/family/line-height/theme. Bindle's WebView reader ... has a
// single fixed 18px style with zero user controls.").
//
// Purely a local, on-device preference — same `expo-secure-store` pattern
// this app already uses for other device-local flags (`bindle.onboarding
// .seen.v1` in app/index.tsx, `bindle.paywall.shown.v1` in connect.tsx).
// Never sent to or read from `bindle-core`.

import * as SecureStore from 'expo-secure-store';

export type ReaderFontSize = 'small' | 'medium' | 'large' | 'xlarge';
export type ReaderLineHeight = 'compact' | 'normal' | 'relaxed';
export type ReaderTheme = 'system' | 'light' | 'dark' | 'sepia';

export type ReaderPrefs = {
  fontSize: ReaderFontSize;
  lineHeight: ReaderLineHeight;
  theme: ReaderTheme;
};

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  fontSize: 'medium',
  lineHeight: 'normal',
  theme: 'system',
};

const READER_PREFS_KEY = 'bindle.reader.prefs.v1';

const FONT_SIZE_PX: Record<ReaderFontSize, number> = {
  small: 15,
  medium: 18, // matches the previous fixed 18px, so "medium" is a true no-op default
  large: 21,
  xlarge: 25,
};

const LINE_HEIGHT_VALUE: Record<ReaderLineHeight, number> = {
  compact: 1.35,
  normal: 1.6, // matches the previous fixed 1.6 line-height
  relaxed: 1.9,
};

const FONT_SIZES: ReaderFontSize[] = ['small', 'medium', 'large', 'xlarge'];
const LINE_HEIGHTS: ReaderLineHeight[] = ['compact', 'normal', 'relaxed'];
const THEMES: ReaderTheme[] = ['system', 'light', 'dark', 'sepia'];

export function fontSizePx(size: ReaderFontSize): number {
  return FONT_SIZE_PX[size];
}

export function lineHeightValue(lineHeight: ReaderLineHeight): number {
  return LINE_HEIGHT_VALUE[lineHeight];
}

export type ReaderPalette = {
  bg: string;
  fg: string;
  muted: string;
  highlightBg: string;
};

/** Resolves the reader's content color palette. "system" follows the device's
 * own light/dark setting (same as the rest of the app); "light"/"dark" force
 * a choice independent of the device setting; "sepia" is the warm, paper-like
 * tone every competitor reader also ships. Deliberately independent of the
 * app chrome's own theme (`useTheme()`) — only the WebView article content
 * adopts this, matching the real competitors' behavior of a reader-only theme
 * switch that doesn't repaint the rest of the app. */
export function resolveReaderPalette(theme: ReaderTheme, systemDark: boolean): ReaderPalette {
  const effective = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  if (effective === 'dark') {
    return { bg: '#0B0B0B', fg: '#F5F5F5', muted: '#A3A3A3', highlightBg: '#3A3A3A' };
  }
  if (effective === 'sepia') {
    return { bg: '#F6ECD9', fg: '#3C2F22', muted: '#8A7A5C', highlightBg: '#E3D5B8' };
  }
  return { bg: '#FFFFFF', fg: '#111111', muted: '#6B6B6B', highlightBg: '#E5E5E5' };
}

/** Loads the reader's saved display preferences, falling back to sane
 * defaults on first run or a corrupt/missing value. */
export async function loadReaderPrefs(): Promise<ReaderPrefs> {
  try {
    const raw = await SecureStore.getItemAsync(READER_PREFS_KEY);
    if (!raw) return DEFAULT_READER_PREFS;
    const parsed = JSON.parse(raw) as Partial<ReaderPrefs>;
    return {
      fontSize:
        parsed.fontSize && FONT_SIZES.includes(parsed.fontSize)
          ? parsed.fontSize
          : DEFAULT_READER_PREFS.fontSize,
      lineHeight:
        parsed.lineHeight && LINE_HEIGHTS.includes(parsed.lineHeight)
          ? parsed.lineHeight
          : DEFAULT_READER_PREFS.lineHeight,
      theme: parsed.theme && THEMES.includes(parsed.theme) ? parsed.theme : DEFAULT_READER_PREFS.theme,
    };
  } catch {
    return DEFAULT_READER_PREFS;
  }
}

export async function saveReaderPrefs(prefs: ReaderPrefs): Promise<void> {
  try {
    await SecureStore.setItemAsync(READER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort — losing a display preference is not worth surfacing to the UI.
  }
}
