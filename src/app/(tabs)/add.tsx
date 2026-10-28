import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '../../lib/auth/authStore';
import { useTheme } from '../../lib/useTheme';
import { radius, spacing, typography } from '../../lib/theme';
import { saveLink } from '../../lib/entriesRepository';
import { getErrorMessage } from '../../lib/errors';

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\/\S+\.\S+/i.test(value.trim());
}

export default function Add() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const client = useAuthStore((s) => s.client);

  const [url, setUrl] = useState('');
  const [clipboardSuggestion, setClipboardSuggestion] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedTitle, setSavedTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Clipboard.getStringAsync().then((text) => {
      if (looksLikeUrl(text)) setClipboardSuggestion(text.trim());
    });
  }, []);

  const save = async (target: string) => {
    if (!client || !looksLikeUrl(target)) {
      setError('That doesn’t look like a web link.');
      return;
    }
    setError(null);
    setSavedTitle(null);
    setSaving(true);
    try {
      const entry = await saveLink(client, target.trim());
      setSavedTitle(entry.title || entry.url);
      setUrl('');
      setClipboardSuggestion(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not save that link.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={{ paddingTop: insets.top + spacing.xl, paddingHorizontal: spacing.lg, flex: 1 }}>
        <Feather name="plus-circle" size={28} color={c.text} />
        <Text style={[typography.title, { color: c.text, marginTop: spacing.md }]}>Add to your bindle</Text>
        <Text style={[typography.body, { color: c.textMuted, marginTop: spacing.xs }]}>
          Paste a link. Bindle fetches and stores the full article.
        </Text>

        <TextInput
          value={url}
          onChangeText={setUrl}
          accessibilityLabel="Link URL"
          testID="add-url-input"
          placeholder="https://..."
          placeholderTextColor={c.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={[styles.input, { color: c.text, backgroundColor: c.surface, borderColor: c.border }]}
        />

        {clipboardSuggestion && clipboardSuggestion !== url ? (
          <Pressable
            onPress={() => setUrl(clipboardSuggestion)}
            style={[styles.suggestion, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
          >
            <Feather name="clipboard" size={14} color={c.textMuted} />
            <Text style={[typography.caption, { color: c.textMuted, flex: 1 }]} numberOfLines={1}>
              Use link from clipboard: {clipboardSuggestion}
            </Text>
          </Pressable>
        ) : null}

        {error ? <Text style={[typography.caption, { color: c.danger, marginTop: spacing.sm }]}>{error}</Text> : null}
        {savedTitle ? (
          <View style={[styles.saved, { backgroundColor: c.surfaceAlt }]}>
            <Feather name="check-circle" size={16} color={c.text} />
            <Text style={[typography.caption, { color: c.text, flex: 1 }]} numberOfLines={2}>
              Saved: {savedTitle}
            </Text>
          </View>
        ) : null}

        <Pressable
          testID="add-save-button"
          onPress={() => save(url)}
          disabled={!url || saving}
          style={[styles.cta, { backgroundColor: url && !saving ? c.accent : c.surfaceAlt, marginTop: spacing.lg }]}
        >
          {saving ? (
            <ActivityIndicator color={c.background} />
          ) : (
            <Text style={[typography.heading, { color: url ? c.background : c.textFaint }]}>Save</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  input: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 16,
  },
  suggestion: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  saved: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  cta: {
    paddingVertical: 16,
    borderRadius: radius.md,
    alignItems: 'center',
  },
});
