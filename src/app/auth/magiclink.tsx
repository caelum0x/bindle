import { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../lib/auth/authStore';
import { useTheme } from '../../lib/useTheme';
import { radius, spacing, typography } from '../../lib/theme';
import { getErrorMessage } from '../../lib/errors';

/**
 * Lands here when the user taps the sign-in link from their email:
 * `bindle://auth/magiclink?token=...` (the scheme + path the server's
 * `MAGIC_LINK_APP_SCHEME` builds, see bindle-core's `config.ts`). Exchanges
 * the token for a real session once, then routes on — no form, nothing to
 * type, matching the one-tap promise a magic link makes.
 */
export default function MagicLinkLanding() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const signInWithMagicLinkToken = useAuthStore((s) => s.signInWithMagicLinkToken);

  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    if (!token) {
      setError('That sign-in link is missing its token.');
      return;
    }
    (async () => {
      try {
        await signInWithMagicLinkToken(token);
        router.replace('/(tabs)/entries');
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'That sign-in link is invalid or has expired.'));
      }
    })();
  }, [token, signInWithMagicLinkToken]);

  return (
    <View style={[styles.container, { backgroundColor: c.background, paddingTop: insets.top }]}>
      {error ? (
        <>
          <View style={[styles.iconWrap, { backgroundColor: c.surfaceAlt }]}>
            <Feather name="alert-circle" size={28} color={c.danger} />
          </View>
          <Text style={[typography.heading, { color: c.text, marginTop: spacing.lg, textAlign: 'center' }]}>
            Could not sign you in
          </Text>
          <Text style={[typography.body, { color: c.textMuted, marginTop: spacing.xs, textAlign: 'center' }]}>
            {error}
          </Text>
          <Pressable
            testID="magiclink-back-to-connect"
            onPress={() => router.replace('/connect')}
            style={[styles.cta, { backgroundColor: c.accent, marginTop: spacing.xl }]}
          >
            <Text style={[typography.heading, { color: c.background }]}>Back to sign in</Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator color={c.text} />
          <Text style={[typography.body, { color: c.textMuted, marginTop: spacing.md }]}>Signing you in…</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cta: {
    paddingVertical: 16,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    alignItems: 'center',
  },
});
