import { useEffect, useRef, useState, type ComponentProps, type ComponentType, type Ref } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuthStore } from '../../lib/auth/authStore';
import { useTheme } from '../../lib/useTheme';
import { radius, spacing, typography } from '../../lib/theme';
import { IconButton } from '../../components/IconButton';
import { EmptyState } from '../../components/EmptyState';
import { ReaderControls } from '../../components/ReaderControls';
import {
  addTagToEntry,
  exportEntryToFile,
  loadEntry,
  markReadProgress,
  reloadEntryContent,
  removeEntry,
  removeTagFromEntry,
  toggleArchive,
  toggleStar,
} from '../../lib/entriesRepository';
import {
  createHighlight,
  deleteHighlight,
  loadAnnotations,
} from '../../lib/annotationsRepository';
import { buildHighlightScript } from '../../lib/annotations/highlightScript';
import { buildReadingProgressScript } from '../../lib/reading/progressScript';
import {
  DEFAULT_READER_PREFS,
  fontSizePx,
  lineHeightValue,
  loadReaderPrefs,
  resolveReaderPalette,
  saveReaderPrefs,
  type ReaderPrefs,
} from '../../lib/reading/readerPrefs';
import type { EntryExportFormat, Annotation, Entry } from '../../lib/api/types';
import { getErrorMessage } from '../../lib/errors';
import { usePremium } from '../../premium/premium-context';
import { isExportFormatPremium } from '../../premium/limits';

type WebViewToRNMessage =
  | { type: 'createHighlight'; quote: string; ranges: Annotation['ranges'] }
  | { type: 'deleteHighlightRequest'; id: string }
  | { type: 'readingProgress'; progress: number };

// react-native-webview's shipped types resolve (under plain `tsc`, which can't follow
// its .ios.d.ts/.android.d.ts platform-specific forwardRef typings the way Metro does
// at bundle time) to a plain, non-ref-forwarding FunctionComponent type — so passing a
// real `ref` fails type-checking even though it works at runtime on every platform.
// This single cast bridges that known upstream typing gap; every other prop below is
// still checked against the library's real prop types.
type WebViewHandle = { injectJavaScript: (script: string) => void };
const RefCapableWebView = WebView as unknown as ComponentType<
  ComponentProps<typeof WebView> & { ref?: Ref<WebViewHandle> }
>;

function buildHtml(entry: Entry, prefs: ReaderPrefs, systemDark: boolean): string {
  const { bg, fg, muted, highlightBg } = resolveReaderPalette(prefs.theme, systemDark);
  const fontSize = fontSizePx(prefs.fontSize);
  const lineHeight = lineHeightValue(prefs.lineHeight);
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  body { background:${bg}; color:${fg}; font-family:-apple-system,Roboto,sans-serif;
         font-size:${fontSize}px; line-height:${lineHeight}; padding:20px 20px 64px; margin:0; }
  h1,h2,h3 { line-height:1.3; }
  a { color:${fg}; text-decoration: underline; }
  img, video, iframe { max-width:100%; height:auto; border-radius:12px; }
  figure { margin: 16px 0; }
  .bindle-meta { color:${muted}; font-size:13px; margin-bottom: 20px; }
  .bindle-title { font-size: ${Math.round(fontSize * 1.45)}px; font-weight: 700; margin-bottom: 8px; }
  blockquote { border-left: 3px solid ${muted}; margin-left:0; padding-left:14px; color:${muted}; }
  pre, code { white-space: pre-wrap; }
  mark.bindle-highlight { background:${highlightBg}; color:${fg}; border-radius:2px; }
</style>
</head>
<body>
  <div class="bindle-title">${escapeHtml(entry.title || '(untitled)')}</div>
  <div class="bindle-meta">${entry.domain_name ?? ''}</div>
  <div id="bindle-content">${entry.content ?? '<p>No content was saved for this article.</p>'}</div>
</body>
</html>`;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default function EntryDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const entryId = id;
  const { c, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const client = useAuthStore((s) => s.client);
  const { isPremium } = usePremium();

  const [entry, setEntry] = useState<Entry | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTag, setNewTag] = useState('');
  const [tagBusy, setTagBusy] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [refreshingContent, setRefreshingContent] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [readerPrefs, setReaderPrefs] = useState<ReaderPrefs>(DEFAULT_READER_PREFS);
  const [readerControlsVisible, setReaderControlsVisible] = useState(false);
  const webViewRef = useRef<WebViewHandle>(null);

  useEffect(() => {
    loadReaderPrefs().then(setReaderPrefs);
  }, []);

  const onChangeReaderPrefs = (next: ReaderPrefs) => {
    setReaderPrefs(next);
    void saveReaderPrefs(next);
  };

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

  useEffect(() => {
    if (!client) return;
    loadAnnotations(client, entryId)
      .then(({ items }) => setAnnotations(items))
      .catch(() => {
        // No highlights yet, or server/offline fetch failed — reader still works.
      });
  }, [client, entryId]);

  const renderHighlightsInWebView = () => {
    const payload = JSON.stringify(JSON.stringify(annotations));
    webViewRef.current?.injectJavaScript(
      `window.bindleRenderHighlights && window.bindleRenderHighlights(${payload});true;`
    );
  };

  useEffect(() => {
    renderHighlightsInWebView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations]);

  const onWebViewMessage = async (event: WebViewMessageEvent) => {
    if (!client || !entry) return;
    let message: WebViewToRNMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as WebViewToRNMessage;
    } catch {
      return;
    }
    if (message.type === 'readingProgress') {
      setEntry((prev) => (prev ? { ...prev, read_progress: message.progress } : prev));
      await markReadProgress(entry.id, message.progress);
      return;
    }
    if (message.type === 'createHighlight') {
      const created = await createHighlight(client, entry.id, message.quote, message.ranges);
      setAnnotations((prev) => [...prev, created]);
    } else if (message.type === 'deleteHighlightRequest') {
      Alert.alert('Remove highlight', 'Delete this saved highlight?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteHighlight(client, message.id);
              setAnnotations((prev) => prev.filter((a) => a.id !== message.id));
            } catch (err: unknown) {
              Alert.alert(
                'Could not remove highlight',
                getErrorMessage(err, 'Check your connection and try again.')
              );
            }
          },
        },
      ]);
    }
  };

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
          try {
            await removeEntry(client, entry.id);
            router.back();
          } catch (err: unknown) {
            Alert.alert('Could not delete', getErrorMessage(err, 'Check your connection and try again.'));
          }
        },
      },
    ]);
  };

  const onRefreshContent = async () => {
    if (!client || !entry) return;
    setRefreshingContent(true);
    try {
      const { entry: refreshed, refreshed: didRefresh } = await reloadEntryContent(client, entry.id);
      if (refreshed) setEntry(refreshed);
      if (!didRefresh) {
        Alert.alert('Nothing to refresh', 'The server could not fetch a newer version of this article.');
      }
    } catch (err: unknown) {
      Alert.alert('Could not refresh', getErrorMessage(err, 'Check your connection and try again.'));
    } finally {
      setRefreshingContent(false);
    }
  };

  const onExport = () => {
    if (!entry) return;
    Alert.alert('Export article', 'Choose a format', [
      { text: 'Cancel', style: 'cancel' },
      { text: isPremium ? 'Formatted (HTML)' : 'Formatted (Premium)', onPress: () => onExportFormat('html') },
      { text: 'Plain text', onPress: () => onExportFormat('txt') },
    ]);
  };

  const onExportFormat = (format: EntryExportFormat) => {
    if (!isPremium && isExportFormatPremium(format)) {
      router.push('/paywall?source=export');
      return;
    }
    void runExport(format);
  };

  const runExport = async (format: EntryExportFormat) => {
    if (!client || !entry) return;
    setExporting(true);
    try {
      await exportEntryToFile(client, entry, format);
    } catch (err: unknown) {
      Alert.alert('Could not export', getErrorMessage(err, 'Check your connection and try again.'));
    } finally {
      setExporting(false);
    }
  };

  const onAddTag = async () => {
    const label = newTag.trim();
    if (!client || !entry || !label) return;
    setTagBusy(true);
    setTagError(null);
    try {
      const updated = await addTagToEntry(client, entry, label);
      setEntry(updated);
      setNewTag('');
    } catch (err: unknown) {
      setTagError(getErrorMessage(err, 'Could not add that tag.'));
    } finally {
      setTagBusy(false);
    }
  };

  const onRemoveTag = async (tagId: string) => {
    if (!client || !entry) return;
    setTagBusy(true);
    setTagError(null);
    try {
      const updated = await removeTagFromEntry(client, entry, tagId);
      setEntry(updated);
    } catch (err: unknown) {
      setTagError(getErrorMessage(err, 'Could not remove that tag.'));
    } finally {
      setTagBusy(false);
    }
  };

  const readerPalette = resolveReaderPalette(readerPrefs.theme, dark);

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
            testID="detail-reader-settings"
            name="type"
            accessibilityLabel="Reader display settings"
            onPress={() => setReaderControlsVisible(true)}
            disabled={!entry}
          />
          <IconButton
            testID="detail-refresh"
            name="refresh-cw"
            accessibilityLabel="Refresh article content"
            onPress={onRefreshContent}
            disabled={refreshingContent || !entry}
          />
          <IconButton
            testID="detail-export"
            name="share"
            accessibilityLabel="Export article"
            onPress={onExport}
            disabled={exporting || !entry}
          />
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

      {entry ? (
        <View style={[styles.tagsSection, { borderBottomColor: c.border }]}>
          <View style={styles.tagsWrap}>
            {entry.tags.map((t) => (
              <View key={t.id} style={[styles.tagChip, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
                <Text style={[typography.tiny, { color: c.textMuted }]}>{t.label.toUpperCase()}</Text>
                <Pressable
                  testID={`detail-remove-tag-${t.id}`}
                  onPress={() => onRemoveTag(t.id)}
                  disabled={tagBusy}
                  hitSlop={6}
                >
                  <Feather name="x" size={11} color={c.textMuted} />
                </Pressable>
              </View>
            ))}
            <View style={[styles.tagInputRow, { borderColor: c.border }]}>
              <TextInput
                testID="detail-add-tag-input"
                value={newTag}
                onChangeText={setNewTag}
                onSubmitEditing={onAddTag}
                placeholder="Add tag"
                placeholderTextColor={c.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                style={[typography.tiny, { color: c.text, minWidth: 64 }]}
              />
              {newTag.trim() ? (
                <Pressable testID="detail-add-tag-submit" onPress={onAddTag} disabled={tagBusy} hitSlop={6}>
                  <Feather name="plus" size={14} color={c.textMuted} />
                </Pressable>
              ) : null}
            </View>
          </View>
          {tagError ? (
            <Text style={[typography.caption, { color: c.danger, marginTop: spacing.xs }]}>{tagError}</Text>
          ) : null}
        </View>
      ) : null}

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.text} />
        </View>
      ) : error || !entry ? (
        <EmptyState icon="alert-triangle" title="Couldn't open this article" subtitle={error ?? undefined} />
      ) : (
        <>
          <RefCapableWebView
            ref={webViewRef}
            originWhitelist={['*']}
            source={{ html: buildHtml(entry, readerPrefs, dark) }}
            style={{ backgroundColor: c.background, flex: 1 }}
            injectedJavaScript={
              buildHighlightScript(dark, {
                markBg: readerPalette.highlightBg,
                markFg: readerPalette.fg,
                btnBg: readerPalette.fg,
                btnFg: readerPalette.bg,
              }) + buildReadingProgressScript(entry.read_progress ?? 0)
            }
            onMessage={onWebViewMessage}
            onLoadEnd={renderHighlightsInWebView}
          />
          <View style={[styles.progressTrack, { backgroundColor: c.border }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: c.text, width: `${Math.round((entry.read_progress ?? 0) * 100)}%` },
              ]}
            />
          </View>
        </>
      )}

      <ReaderControls
        visible={readerControlsVisible}
        onClose={() => setReaderControlsVisible(false)}
        prefs={readerPrefs}
        onChange={onChangeReaderPrefs}
      />
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
  tagsSection: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
  },
  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  tagInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  progressTrack: {
    height: 2,
    width: '100%',
  },
  progressFill: {
    height: 2,
  },
});
