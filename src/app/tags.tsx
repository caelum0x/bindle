import { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../lib/auth/authStore';
import { useTheme } from '../lib/useTheme';
import { radius, spacing, typography } from '../lib/theme';
import { IconButton } from '../components/IconButton';
import { EmptyState } from '../components/EmptyState';
import { deleteTagGlobally, listTags } from '../lib/entriesRepository';
import type { WallabagTag } from '../lib/api/types';
import { getErrorMessage } from '../lib/errors';

export default function Tags() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const client = useAuthStore((s) => s.client);

  const [tags, setTags] = useState<WallabagTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!client) return;
      setLoading(true);
      setError(null);
      listTags(client)
        .then((result) => {
          setTags(result.items);
          setOffline(result.fromCache);
        })
        .catch((err: unknown) => setError(getErrorMessage(err, 'Could not load tags.')))
        .finally(() => setLoading(false));
    }, [client])
  );

  const openTag = (tagItem: WallabagTag) => {
    router.push({
      pathname: '/(tabs)/entries',
      params: { tag: tagItem.slug || tagItem.label, tagLabel: tagItem.label },
    });
  };

  const onDeleteTag = (tagItem: WallabagTag) => {
    if (!client) return;
    Alert.alert(
      'Delete tag',
      `Remove "${tagItem.label}" from every saved article? This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTagGlobally(client, tagItem);
              setTags((prev) => prev.filter((t) => t.id !== tagItem.id));
            } catch (err: unknown) {
              Alert.alert('Could not delete tag', getErrorMessage(err, 'Check your connection and try again.'));
            }
          },
        },
      ]
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
      <View style={styles.header}>
        <IconButton
          testID="tags-back"
          name="arrow-left"
          accessibilityLabel="Back"
          onPress={() => router.back()}
        />
        <Text style={[typography.heading, { color: c.text }]}>Tags</Text>
        <View style={{ width: 40 }} />
      </View>
      {offline ? (
        <Text style={[typography.tiny, { color: c.textFaint, paddingHorizontal: spacing.lg }]}>
          OFFLINE · FROM SAVED ENTRIES
        </Text>
      ) : null}

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.text} />
        </View>
      ) : error ? (
        <EmptyState icon="alert-triangle" title="Couldn't load tags" subtitle={error} />
      ) : tags.length === 0 ? (
        <EmptyState
          icon="tag"
          title="No tags yet"
          subtitle="Add a tag to any saved article and it will show up here."
        />
      ) : (
        <FlatList
          data={tags}
          keyExtractor={(t) => String(t.id)}
          contentContainerStyle={{ paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm }}
          renderItem={({ item }) => (
            <View style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Pressable
                testID={`tag-row-${item.id}`}
                onPress={() => openTag(item)}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
              >
                <Feather name="tag" size={16} color={c.textMuted} />
                <Text style={[typography.body, { color: c.text, flex: 1 }]} numberOfLines={1}>
                  {item.label}
                </Text>
                <Feather name="chevron-right" size={16} color={c.textFaint} />
              </Pressable>
              <Pressable
                testID={`tag-delete-${item.id}`}
                onPress={() => onDeleteTag(item)}
                accessibilityLabel={`Delete tag ${item.label}`}
                hitSlop={8}
                style={{ paddingLeft: spacing.sm }}
              >
                <Feather name="trash-2" size={16} color={c.danger} />
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
});
