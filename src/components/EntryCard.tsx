import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../lib/useTheme';
import { radius, spacing, typography } from '../lib/theme';
import type { WallabagEntry } from '../lib/api/types';

function estimateMinutes(entry: WallabagEntry): number {
  if (entry.reading_time && entry.reading_time > 0) return entry.reading_time;
  const words = (entry.content ?? '').split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}

export function EntryCard({
  entry,
  onPress,
  onToggleStar,
  onToggleArchive,
}: {
  entry: WallabagEntry;
  onPress: () => void;
  onToggleStar: () => void;
  onToggleArchive: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      testID={`entry-card-${entry.id}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[typography.heading, { color: c.text }]} numberOfLines={2}>
          {entry.title || '(untitled)'}
        </Text>
        <Text style={[typography.caption, { color: c.textFaint, marginTop: spacing.xs }]} numberOfLines={1}>
          {entry.domain_name || hostOf(entry.url)} · {estimateMinutes(entry)} min
        </Text>
        {entry.tags.length > 0 && (
          <View style={styles.tagsRow}>
            {entry.tags.slice(0, 3).map((t) => (
              <View key={t.id} style={[styles.tag, { backgroundColor: c.surfaceAlt }]}>
                <Text style={[typography.tiny, { color: c.textMuted }]}>{t.label.toUpperCase()}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      <View style={styles.actions}>
        <Pressable
          testID={`entry-star-${entry.id}`}
          onPress={onToggleStar}
          accessibilityLabel="Toggle starred"
          hitSlop={8}
        >
          <Feather
            name="star"
            size={18}
            color={entry.is_starred ? c.text : c.textFaint}
            style={entry.is_starred ? undefined : styles.outline}
          />
        </Pressable>
        <Pressable
          testID={`entry-archive-${entry.id}`}
          onPress={onToggleArchive}
          accessibilityLabel="Toggle archived"
          hitSlop={8}
        >
          <Feather name={entry.is_archived ? 'rotate-ccw' : 'archive'} size={18} color={c.textFaint} />
        </Pressable>
      </View>
    </Pressable>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  tagsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  actions: {
    gap: spacing.md,
    alignItems: 'center',
    paddingTop: 2,
  },
  outline: {
    opacity: 0.6,
  },
});
