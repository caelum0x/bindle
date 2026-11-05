import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View, Text, Pressable, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuthStore } from '../../lib/auth/authStore';
import { useTheme } from '../../lib/useTheme';
import { radius, spacing, typography } from '../../lib/theme';
import { FilterChips } from '../../components/FilterChips';
import { EntryCard } from '../../components/EntryCard';
import { EmptyState } from '../../components/EmptyState';
import type { EntryFilter, Entry } from '../../lib/api/types';
import { flushPendingActions, listEntries, toggleArchive, toggleStar } from '../../lib/entriesRepository';
import { flushPendingAnnotations } from '../../lib/annotationsRepository';
import { getErrorMessage } from '../../lib/errors';

export default function Entries() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const client = useAuthStore((s) => s.client);
  const params = useLocalSearchParams<{ tag?: string; tagLabel?: string }>();

  const [filter, setFilter] = useState<EntryFilter>('unread');
  const [tag, setTag] = useState<string | null>(null);
  const [tagLabel, setTagLabel] = useState<string | null>(null);
  const [items, setItems] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Arriving from the Tags screen with ?tag=slug&tagLabel=Name — switch straight to
  // "All" so a tag filter never hides archived/starred matches, and adopt the tag.
  useEffect(() => {
    if (params.tag) {
      setTag(params.tag);
      setTagLabel(params.tagLabel ?? params.tag);
      setFilter('all');
    }
  }, [params.tag, params.tagLabel]);

  const clearTag = useCallback(() => {
    setTag(null);
    setTagLabel(null);
    router.setParams({ tag: '', tagLabel: '' });
  }, []);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!client) return;
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        const result = await listEntries(client, filter, tag ?? undefined);
        setItems(result.items);
        setOffline(result.fromCache);
        if (!result.fromCache) {
          flushPendingActions(client).catch(() => {});
          flushPendingAnnotations(client).catch(() => {});
        }
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Something went wrong.'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [client, filter, tag]
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Real app-foreground trigger (not just navigation focus): catches the
  // case where the user backgrounds Bindle while already sitting on this
  // tab — e.g. to share a link into the extension from Safari — and comes
  // straight back without ever re-triggering `useFocusEffect` above. Reloads
  // silently so a link saved via the share extension (see
  // `sync/pendingShareSaves.ts`) is drained into the real offline cache and
  // reflected here without the user having to pull-to-refresh.
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current !== 'active' && nextState === 'active') {
        load({ silent: true });
      }
      appStateRef.current = nextState;
    });
    return () => subscription.remove();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load({ silent: true });
  };

  const onToggleStar = async (entry: Entry) => {
    if (!client) return;
    setItems((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, is_starred: entry.is_starred ? 0 : 1 } : e))
    );
    await toggleStar(client, entry);
  };

  const onToggleArchive = async (entry: Entry) => {
    if (!client) return;
    setItems((prev) => prev.filter((e) => e.id !== entry.id || filter === 'all'));
    await toggleArchive(client, entry);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
      <View style={styles.header} accessibilityLabel="Bindle">
        <Feather name="bookmark" size={22} color={c.text} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {offline ? (
            <Text style={[typography.tiny, { color: c.textFaint }]}>OFFLINE · SHOWING SAVED COPY</Text>
          ) : null}
          <Pressable
            testID="entries-open-search"
            onPress={() => router.push('/search')}
            accessibilityLabel="Search your bindle"
            hitSlop={8}
          >
            <Feather name="search" size={20} color={c.textMuted} />
          </Pressable>
          <Pressable
            testID="entries-open-tags"
            onPress={() => router.push('/tags')}
            accessibilityLabel="Browse tags"
            hitSlop={8}
          >
            <Feather name="tag" size={20} color={c.textMuted} />
          </Pressable>
        </View>
      </View>
      <View style={{ marginTop: spacing.sm, marginBottom: spacing.md }}>
        <FilterChips value={filter} onChange={setFilter} />
      </View>
      {tag ? (
        <View style={[styles.tagRow, { paddingHorizontal: spacing.md }]}>
          <View style={[styles.tagPill, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
            <Feather name="tag" size={12} color={c.textMuted} />
            <Text style={[typography.caption, { color: c.textMuted }]} numberOfLines={1}>
              {tagLabel}
            </Text>
            <Pressable testID="entries-clear-tag" onPress={clearTag} hitSlop={8}>
              <Feather name="x" size={14} color={c.textMuted} />
            </Pressable>
          </View>
        </View>
      ) : null}

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
  tagRow: {
    marginBottom: spacing.md,
  },
  tagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
