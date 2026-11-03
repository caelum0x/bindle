import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text, close, type InitialProps } from 'expo-share-extension';
import { saveLink } from './lib/entriesRepository';
import { loadStoredClient } from './lib/auth/sharedAuth';
import { extractFirstUrl } from './lib/url';
import { getErrorMessage } from './lib/errors';
import type { WallabagEntry } from './lib/api/types';

type Stage = 'resolving' | 'saving' | 'saved' | 'needsAuth' | 'invalid' | 'error';

/**
 * Root component for Bindle's iOS Share Extension (registered as "shareExtension"
 * in `index.share.js`). This is the real "share any article from Safari/any app
 * directly into Bindle" flow the product plan has flagged as the single highest-
 * leverage missing feature — one tap in any app's share sheet saves the link,
 * without ever leaving the source app.
 *
 * Runs in a separate, memory-constrained native extension process (not the main
 * app), so it has its own minimal UI instead of mounting the full app/router —
 * but it calls the exact same `saveLink` repository function the Add screen's
 * paste-a-URL flow uses, reading the same shared-Keychain-group credentials via
 * `sharedAuth.ts`. No save logic is duplicated.
 */
export default function ShareExtension({ url, text }: InitialProps) {
  const [stage, setStage] = useState<Stage>('resolving');
  const [savedEntry, setSavedEntry] = useState<WallabagEntry | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const target = extractFirstUrl(url) ?? extractFirstUrl(text);
      if (!target) {
        if (!cancelled) setStage('invalid');
        return;
      }

      const stored = await loadStoredClient();
      if (cancelled) return;
      if (!stored) {
        setStage('needsAuth');
        return;
      }

      setStage('saving');
      try {
        const entry = await saveLink(stored.client, target);
        if (cancelled) return;
        setSavedEntry(entry);
        setStage('saved');
        setTimeout(() => {
          if (!cancelled) close();
        }, 1100);
      } catch (err: unknown) {
        if (cancelled) return;
        setErrorMessage(getErrorMessage(err, 'Could not save that link.'));
        setStage('error');
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [url, text]);

  return (
    <View style={styles.container}>
      {(stage === 'resolving' || stage === 'saving') && (
        <>
          <ActivityIndicator color="#111111" size="large" />
          <Text style={styles.label}>Saving to Bindle…</Text>
        </>
      )}

      {stage === 'saved' && (
        <>
          <Text style={styles.heading}>Saved</Text>
          <Text style={styles.label} numberOfLines={2}>
            {savedEntry?.title || savedEntry?.url}
          </Text>
        </>
      )}

      {stage === 'invalid' && (
        <>
          <Text style={styles.heading}>Nothing to save</Text>
          <Text style={styles.label}>Share a web link to save it to Bindle.</Text>
          <CloseButton />
        </>
      )}

      {stage === 'needsAuth' && (
        <>
          <Text style={styles.heading}>Connect Bindle first</Text>
          <Text style={styles.label}>
            Open Bindle and connect your Wallabag server, then share this link again.
          </Text>
          <CloseButton />
        </>
      )}

      {stage === 'error' && (
        <>
          <Text style={styles.heading}>Could not save</Text>
          <Text style={styles.label} numberOfLines={3}>
            {errorMessage}
          </Text>
          <CloseButton />
        </>
      )}
    </View>
  );
}

function CloseButton() {
  return (
    <Pressable style={styles.button} onPress={close} accessibilityLabel="Close">
      <Text style={styles.buttonLabel}>Close</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 10,
  },
  heading: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111111',
  },
  label: {
    fontSize: 14,
    color: '#555555',
    textAlign: 'center',
  },
  button: {
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 10,
    backgroundColor: '#111111',
  },
  buttonLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
