import { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../lib/auth/authStore';
import { useTheme } from '../../lib/useTheme';
import { spacing, typography } from '../../lib/theme';
import { FilterChips } from '../../components/FilterChips';
import { EntryCard } from '../../components/EntryCard';
import { EmptyState } from '../../components/EmptyState';
import type { EntryFilter, WallabagEntry } from '../../lib/api/types';
import { flushPendingActions, listEntries, toggleArchive, toggleStar } from '../../lib/entriesRepository';
import { getErrorMessage } from '../../lib/errors';

export default function Entries() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const client = useAuthStore((s) => s.client);

  const [filter, setFilter] = useState<EntryFilter>('unread');
  const [items, setItems] = useState<WallabagEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!client) return;
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        const result = await listEntries(client, filter);
        setItems(result.items);
        setOffline(result.fromCache);
        if (!result.fromCache) {
          flushPendingActions(client).catch(() => {});
        }
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Something went wrong.'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [client, filter]
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load({ silent: true });
  };

  const onToggleStar = async (entry: WallabagEntry) => {
    if (!client) return;
    setItems((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, is_starred: entry.is_starred ? 0 : 1 } : e))
    );
    await toggleStar(client, entry);
  };

  const onToggleArchive = async (entry: WallabagEntry) => {
    if (!client) return;
    setItems((prev) => prev.filter((e) => e.id !== entry.id || filter === 'all'));
    await toggleArchive(client, entry);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Text style={[typography.title, { color: c.text }]}>Bindle</Text>
        {offline ? (
          <Text style={[typography.tiny, { color: c.textFaint }]}>OFFLINE · SHOWING SAVED COPY</Text>
        ) : null}
      </View>
      <View style={{ marginTop: spacing.sm, marginBottom: spacing.md }}>
        <FilterChips value={filter} onChange={setFilter} />
      </View>

      {error ? (
        <EmptyState icon="alert-triangle" title="Couldn't load your bindle" subtitle={error} />
      ) : !loading && items.length === 0 ? (
        <EmptyState
          icon="inbox"
          title={filter === 'unread' ? 'All caught up' : 'Nothing here yet'}
          subtitle={
            filter === 'unread'
              ? 'Save a link from the Add tab to start your bindle.'
              : 'Entries you save will show up here.'
          }
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(e) => String(e.id)}
          contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.text} />}
          renderItem={({ item }) => (
            <EntryCard
              entry={item}
              onPress={() => router.push(`/entry/${item.id}`)}
              onToggleStar={() => onToggleStar(item)}
              onToggleArchive={() => onToggleArchive(item)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
