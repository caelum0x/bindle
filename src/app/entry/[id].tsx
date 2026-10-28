import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../lib/auth/authStore';
import { useTheme } from '../../lib/useTheme';
import { spacing, typography } from '../../lib/theme';
import { IconButton } from '../../components/IconButton';
import { EmptyState } from '../../components/EmptyState';
import { loadEntry, removeEntry, toggleArchive, toggleStar } from '../../lib/entriesRepository';
import type { WallabagEntry } from '../../lib/api/types';
import { getErrorMessage } from '../../lib/errors';

function buildHtml(entry: WallabagEntry, dark: boolean): string {
  const bg = dark ? '#0B0B0B' : '#FFFFFF';
  const fg = dark ? '#F5F5F5' : '#111111';
  const muted = dark ? '#A3A3A3' : '#6B6B6B';
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  body { background:${bg}; color:${fg}; font-family:-apple-system,Roboto,sans-serif;
         font-size:18px; line-height:1.6; padding:20px 20px 64px; margin:0; }
  h1,h2,h3 { line-height:1.3; }
  a { color:${fg}; text-decoration: underline; }
  img, video, iframe { max-width:100%; height:auto; border-radius:12px; }
  figure { margin: 16px 0; }
  .bindle-meta { color:${muted}; font-size:13px; margin-bottom: 20px; }
  .bindle-title { font-size: 26px; font-weight: 700; margin-bottom: 8px; }
  blockquote { border-left: 3px solid ${muted}; margin-left:0; padding-left:14px; color:${muted}; }
  pre, code { white-space: pre-wrap; }
</style>
</head>
<body>
  <div class="bindle-title">${escapeHtml(entry.title || '(untitled)')}</div>
  <div class="bindle-meta">${entry.domain_name ?? ''}</div>
  ${entry.content ?? '<p>No content was saved for this article.</p>'}
</body>
</html>`;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default function EntryDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const entryId = Number(id);
  const { c, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const client = useAuthStore((s) => s.client);

  const [entry, setEntry] = useState<WallabagEntry | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    loadEntry(client, entryId)
      .then(({ entry, fromCache }) => {
        setEntry(entry);
        setOffline(fromCache);
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Could not load this article.')))
      .finally(() => setLoading(false));
  }, [client, entryId]);

  const onToggleStar = async () => {
    if (!client || !entry) return;
    setEntry({ ...entry, is_starred: entry.is_starred ? 0 : 1 });
    await toggleStar(client, entry);
  };

  const onToggleArchive = async () => {
    if (!client || !entry) return;
    const next = entry.is_archived ? 0 : 1;
    setEntry({ ...entry, is_archived: next });
    await toggleArchive(client, entry);
  };

  const onDelete = () => {
    if (!client || !entry) return;
    Alert.alert('Delete article', 'Remove this from your bindle for good?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await removeEntry(client, entry.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
      <View style={styles.header}>
        <IconButton
          testID="detail-back"
          name="arrow-left"
          accessibilityLabel="Back"
          onPress={() => router.back()}
        />
        {offline ? (
          <Text style={[typography.tiny, { color: c.textFaint }]}>OFFLINE COPY</Text>
        ) : (
          <View />
        )}
        <View style={{ flexDirection: 'row' }}>
          <IconButton
            testID="detail-star"
            name="star"
            accessibilityLabel="Toggle starred"
            active={!!entry?.is_starred}
            onPress={onToggleStar}
          />
          <IconButton
            testID="detail-archive"
            name={entry?.is_archived ? 'rotate-ccw' : 'archive'}
            accessibilityLabel="Toggle archived"
            onPress={onToggleArchive}
          />
          <IconButton
            testID="detail-delete"
            name="trash-2"
            accessibilityLabel="Delete"
            danger
            onPress={onDelete}
          />
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.text} />
        </View>
      ) : error || !entry ? (
        <EmptyState icon="alert-triangle" title="Couldn't open this article" subtitle={error ?? undefined} />
      ) : (
        <WebView
          originWhitelist={['*']}
          source={{ html: buildHtml(entry, dark) }}
          style={{ backgroundColor: c.background }}
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
});
