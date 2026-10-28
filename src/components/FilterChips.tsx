import { ScrollView, Pressable, Text, StyleSheet } from 'react-native';
import { useTheme } from '../lib/useTheme';
import { radius, spacing, typography } from '../lib/theme';
import type { EntryFilter } from '../lib/api/types';

const FILTERS: { key: EntryFilter; label: string }[] = [
  { key: 'unread', label: 'Unread' },
  { key: 'starred', label: 'Starred' },
  { key: 'archived', label: 'Archived' },
  { key: 'all', label: 'All' },
];

export function FilterChips({
  value,
  onChange,
}: {
  value: EntryFilter;
  onChange: (f: EntryFilter) => void;
}) {
  const { c } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: spacing.md, gap: spacing.sm }}
    >
      {FILTERS.map((f) => {
        const selected = f.key === value;
        return (
          <Pressable
            key={f.key}
            onPress={() => onChange(f.key)}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? c.accent : c.surfaceAlt,
                borderColor: selected ? c.accent : c.border,
              },
            ]}
          >
            <Text
              style={[
                typography.caption,
                { color: selected ? c.background : c.textMuted },
              ]}
            >
              {f.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
