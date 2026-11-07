import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../lib/useTheme';
import { radius, spacing, typography } from '../lib/theme';
import type { ReaderFontSize, ReaderLineHeight, ReaderPrefs, ReaderTheme } from '../lib/reading/readerPrefs';

const FONT_SIZES: { key: ReaderFontSize; glyphSize: number }[] = [
  { key: 'small', glyphSize: 13 },
  { key: 'medium', glyphSize: 16 },
  { key: 'large', glyphSize: 19 },
  { key: 'xlarge', glyphSize: 22 },
];

const LINE_HEIGHTS: { key: ReaderLineHeight; label: string }[] = [
  { key: 'compact', label: 'Compact' },
  { key: 'normal', label: 'Normal' },
  { key: 'relaxed', label: 'Relaxed' },
];

const THEMES: { key: ReaderTheme; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'system', label: 'Auto', icon: 'smartphone' },
  { key: 'light', label: 'Light', icon: 'sun' },
  { key: 'dark', label: 'Dark', icon: 'moon' },
  { key: 'sepia', label: 'Sepia', icon: 'droplet' },
];

/** A small bottom sheet reachable from the reader's "Aa" header icon — font
 * size, line height, and a light/dark/sepia theme toggle for the article
 * content itself (the surrounding app chrome keeps following the device's
 * own theme, unaffected — see `readerPrefs.ts`'s header comment). Mirrors
 * this app's existing chip look (`FilterChips`) rather than introducing a
 * new control style. */
export function ReaderControls({
  visible,
  onClose,
  prefs,
  onChange,
}: {
  visible: boolean;
  onClose: () => void;
  prefs: ReaderPrefs;
  onChange: (next: ReaderPrefs) => void;
}) {
  const { c } = useTheme();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityLabel="Close reader display settings"
      />
      <View style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={[styles.handle, { backgroundColor: c.border }]} />

        <Text style={[typography.tiny, { color: c.textFaint }]}>TEXT SIZE</Text>
        <View style={styles.row}>
          {FONT_SIZES.map((opt) => {
            const selected = opt.key === prefs.fontSize;
            return (
              <Pressable
                key={opt.key}
                testID={`reader-font-size-${opt.key}`}
                onPress={() => onChange({ ...prefs, fontSize: opt.key })}
                accessibilityLabel={`Text size: ${opt.key}`}
                accessibilityState={{ selected }}
                style={[
                  styles.optionBox,
                  {
                    backgroundColor: selected ? c.accent : c.surfaceAlt,
                    borderColor: selected ? c.accent : c.border,
                  },
                ]}
              >
                <Text
                  style={{
                    fontSize: opt.glyphSize,
                    fontWeight: '700',
                    color: selected ? c.background : c.text,
                  }}
                >
                  A
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[typography.tiny, { color: c.textFaint, marginTop: spacing.lg }]}>LINE SPACING</Text>
        <View style={styles.row}>
          {LINE_HEIGHTS.map((opt) => {
            const selected = opt.key === prefs.lineHeight;
            return (
              <Pressable
                key={opt.key}
                testID={`reader-line-height-${opt.key}`}
                onPress={() => onChange({ ...prefs, lineHeight: opt.key })}
                accessibilityLabel={`Line spacing: ${opt.label}`}
                accessibilityState={{ selected }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? c.accent : c.surfaceAlt,
                    borderColor: selected ? c.accent : c.border,
                  },
                ]}
              >
                <Text style={[typography.caption, { color: selected ? c.background : c.textMuted }]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[typography.tiny, { color: c.textFaint, marginTop: spacing.lg }]}>THEME</Text>
        <View style={styles.row}>
          {THEMES.map((opt) => {
            const selected = opt.key === prefs.theme;
            return (
              <Pressable
                key={opt.key}
                testID={`reader-theme-${opt.key}`}
                onPress={() => onChange({ ...prefs, theme: opt.key })}
                accessibilityLabel={`Theme: ${opt.label}`}
                accessibilityState={{ selected }}
                style={[
                  styles.themeOption,
                  {
                    backgroundColor: selected ? c.accent : c.surfaceAlt,
                    borderColor: selected ? c.accent : c.border,
                  },
                ]}
              >
                <Feather name={opt.icon} size={18} color={selected ? c.background : c.textMuted} />
                <Text
                  style={[
                    typography.tiny,
                    { color: selected ? c.background : c.textMuted, marginTop: 4 },
                  ]}
                >
                  {opt.label.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  optionBox: {
    flex: 1,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  chip: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  themeOption: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
  },
});
