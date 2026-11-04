import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../lib/auth/authStore';
import { useTheme } from '../lib/useTheme';
import { radius, spacing, typography } from '../lib/theme';
import { IconButton } from '../components/IconButton';
import { bulkSaveLinks } from '../lib/entriesRepository';
import { looksLikeUrl } from '../lib/url';
import { getErrorMessage } from '../lib/errors';
import type { BulkSaveResult } from '../lib/api/types';
import { usePremium } from '../premium/premium-context';
import { FREE_MAX_BULK_IMPORT, clampBulkImport } from '../premium/limits';

/** Batch save: paste any number of links, one per line, and send them to the
 * server in a single real `POST /api/entries/lists` call — not one save per
 * line, the actual bulk endpoint Wallabag exposes for this. */
export default function Import() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const client = useAuthStore((s) => s.client);
  const { isPremium } = usePremium();

  const [text, setText] = useState('');
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<BulkSaveResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const urls = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => looksLikeUrl(line));

  const { allowed: importable, overflow } = clampBulkImport(urls, isPremium);

  const onImport = async () => {
    if (!client || importable.length === 0) return;
    setImporting(true);
    setError(null);
    setResults(null);
    try {
      const saved = await bulkSaveLinks(client, importable);
      setResults(saved);
      setText('');
      if (overflow > 0) {
        Alert.alert(
          'Free limit reached',
          `Imported the first ${FREE_MAX_BULK_IMPORT} links. ${overflow} more need Premium for unlimited bulk import.`,
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Go Premium', onPress: () => router.push('/paywall?source=import') },
          ]
        );
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not import those links.'));
    } finally {
      setImporting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={{ paddingTop: insets.top, flex: 1 }}>
        <View style={styles.header}>
          <IconButton
            testID="import-back"
            name="arrow-left"
            accessibilityLabel="Back"
            onPress={() => router.back()}
          />
          <Text style={[typography.heading, { color: c.text }]}>Import links</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}>
          <Text style={[typography.body, { color: c.textMuted, marginTop: spacing.xs }]}>
            Paste one link per line. Bindle saves all of them in a single request.
          </Text>

          <TextInput
            testID="import-input"
            value={text}
            onChangeText={setText}
            placeholder={'https://example.com/a\nhttps://example.com/b'}
            placeholderTextColor={c.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            style={[
              styles.input,
              { color: c.text, backgroundColor: c.surface, borderColor: c.border },
            ]}
          />

          <Text style={[typography.caption, { color: c.textFaint, marginTop: spacing.xs }]}>
            {urls.length} valid link{urls.length === 1 ? '' : 's'} detected
          </Text>
          {overflow > 0 ? (
            <Pressable onPress={() => router.push('/paywall?source=import')} hitSlop={4}>
              <Text style={[typography.caption, { color: c.text, marginTop: spacing.xs }]}>
                Free imports {FREE_MAX_BULK_IMPORT} at a time — Go Premium for all {urls.length}.
              </Text>
            </Pressable>
          ) : null}

          {error ? (
            <Text style={[typography.caption, { color: c.danger, marginTop: spacing.sm }]}>{error}</Text>
          ) : null}

          <Pressable
            testID="import-submit"
            onPress={onImport}
            disabled={importable.length === 0 || importing}
            style={[
              styles.cta,
              { backgroundColor: importable.length > 0 && !importing ? c.accent : c.surfaceAlt, marginTop: spacing.lg },
            ]}
          >
            {importing ? (
              <ActivityIndicator color={c.background} />
            ) : (
              <Text style={[typography.heading, { color: importable.length > 0 ? c.background : c.textFaint }]}>
                Import {importable.length > 0 ? importable.length : ''} link{importable.length === 1 ? '' : 's'}
              </Text>
            )}
          </Pressable>

          {results ? (
            <View style={{ marginTop: spacing.lg, gap: spacing.xs }}>
              {results.map((r) => (
                <View
                  key={r.url}
                  style={[styles.resultRow, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
                >
                  <Feather
                    name={r.entry ? 'check-circle' : 'x-circle'}
                    size={14}
                    color={r.entry ? c.text : c.danger}
                  />
                  <Text style={[typography.caption, { color: c.textMuted, flex: 1 }]} numberOfLines={1}>
                    {r.url}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
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
  input: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 15,
    minHeight: 140,
    textAlignVertical: 'top',
  },
  cta: {
    paddingVertical: 16,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
});
