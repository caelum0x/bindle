import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  ActivityIndicator,
  Pressable,
  StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../lib/auth/authStore';
import { useTheme } from '../lib/useTheme';
import { radius, spacing, typography } from '../lib/theme';
import { IconButton } from '../components/IconButton';
import { EntryCard } from '../components/EntryCard';
import { EmptyState } from '../components/EmptyState';
import { searchEntries, toggleArchive, toggleStar } from '../lib/entriesRepository';
import { snippetFor } from '../lib/search';
import type { WallabagEntry } from '../lib/api/types';
import { getErrorMessage } from '../lib/errors';

const DEBOUNCE_MS = 350;

/** Full-text search across every saved article (title + body), not just the
 * currently-loaded Entries list — see `entriesRepository.searchEntries` for the
 * real page-walking/offline-fallback logic this screen drives. */
export default function Search() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const client = useAuthStore((s) => s.client);

  const [query, setQuery] = useState('');
  const [searchedFor, setSearchedFor] = useState('');
  const [items, setItems] = useState<WallabagEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setItems([]);
      setError(null);
      setLoading(false);
      setSearchedFor('');
      return;
    }
    if (!client) return;
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await searchEntries(client, trimmed);
        setItems(result.items);
        setOffline(result.fromCache);
        setError(null);
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Search failed.'));
      } finally {
        setSearchedFor(trimmed);
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, client]);

  const onToggleStar = async (entry: WallabagEntry) => {
    if (!client) return;
    setItems((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, is_starred: entry.is_starred ? 0 : 1 } : e))
    );
    await toggleStar(client, entry);
  };

  const onToggleArchive = async (entry: WallabagEntry) => {
    if (!client) return;
    setItems((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, is_archived: entry.is_archived ? 0 : 1 } : e))
    );
    await toggleArchive(client, entry);
  };

  const trimmed = query.trim();

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
      <View style={styles.header}>
        <IconButton
          testID="search-back"
          name="arrow-left"
          accessibilityLabel="Back"
          onPress={() => router.back()}
        />
        <View style={[styles.inputWrap, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
          <Feather name="search" size={16} color={c.textFaint} />
          <TextInput
            testID="search-input"
            value={query}
            onChangeText={setQuery}
            placeholder="Search your bindle"
            placeholderTextColor={c.textFaint}
            style={[typography.body, { color: c.text, flex: 1 }]}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Pressable testID="search-clear" onPress={() => setQuery('')} hitSlop={8}>
              <Feather name="x" size={16} color={c.textFaint} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {offline && trimmed ? (
        <Text
          style={[
            typography.tiny,
            { color: c.textFaint, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
          ]}
        >
          OFFLINE · SEARCHED SAVED COPIES ONLY
        </Text>
      ) : null}

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.text} />
        </View>
      ) : error ? (
        <EmptyState icon="alert-triangle" title="Search failed" subtitle={error} />
      ) : !trimmed ? (
        <EmptyState
          icon="search"
          title="Search your bindle"
          subtitle="Searches titles and full article text across everything you've saved."
        />
      ) : items.length === 0 ? (
        <EmptyState icon="inbox" title="No matches" subtitle={`Nothing found for "${searchedFor}".`} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(e) => String(e.id)}
          contentContainerStyle={{
            paddingHorizontal: spacing.md,
            paddingTop: spacing.sm,
            paddingBottom: spacing.xxl,
            gap: spacing.sm,
          }}
          renderItem={({ item }) => {
            const snippet = snippetFor(item.content, searchedFor);
            return (
              <View>
                <EntryCard
                  entry={item}
                  onPress={() => router.push(`/entry/${item.id}`)}
                  onToggleStar={() => onToggleStar(item)}
                  onToggleArchive={() => onToggleArchive(item)}
                />
                {snippet ? (
                  <Text
                    style={[
                      typography.caption,
                      { color: c.textMuted, paddingHorizontal: spacing.sm, marginTop: spacing.xs },
                    ]}
                    numberOfLines={2}
                  >
                    {snippet}
                  </Text>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    height: 40,
  },
});
