import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { useIdTokenAuthRequest } from 'expo-auth-session/providers/google';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../lib/auth/authStore';
import { useTheme } from '../lib/useTheme';
import { radius, spacing, typography } from '../lib/theme';
import { getErrorMessage } from '../lib/errors';
import { usePremium } from '../premium/premium-context';
import { requestMagicLink } from '../lib/api/bindleClient';
import { BindleApiError } from '../lib/api/types';
import {
  GOOGLE_ANDROID_CLIENT_ID,
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_WEB_CLIENT_ID,
  isGoogleSignInConfigured,
} from '../lib/auth/oauthConfig';

// Required once per app for `expo-auth-session`'s browser-based flow to
// correctly hand control back to the app on completion (no-op on the native
// Google Sign-In path this screen actually uses, but harmless either way).
WebBrowser.maybeCompleteAuthSession();

/** Set once the paywall has been shown after a first successful sign-up, so
 * signing back in later doesn't re-show it every time — the packaging rule
 * is "show it to every free account right after the value moment", not
 * "nag on every sign-in". */
const PAYWALL_SHOWN_KEY = 'bindle.paywall.shown.v1';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Mode = 'signup' | 'signin';

/** Apple's own SDK rejects with this code when the user dismisses the native
 * sign-in sheet — not a real failure, so it should never surface an error. */
const isAppleSignInCancellation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'ERR_REQUEST_CANCELED';

export default function Connect() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const signUp = useAuthStore((s) => s.signUp);
  const signIn = useAuthStore((s) => s.signIn);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const signInWithApple = useAuthStore((s) => s.signInWithApple);
  const { isPremium } = usePremium();

  const [mode, setMode] = useState<Mode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Set once a correct password gets a `mfaRequired` response: the account
  // has TOTP enabled, so the next submit should send the 6-digit code
  // instead of re-sending the password step.
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaCode, setMfaCode] = useState('');

  const [magicLinkMode, setMagicLinkMode] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  // `useIdTokenAuthRequest` calls `invariantClientId` synchronously during
  // render (inside a `useMemo`) and THROWS if the platform's client id is
  // undefined — it has no "disabled" mode. Real client ids aren't configured
  // yet (OWNER BLOCKER, see oauthConfig.ts), so passing `undefined` here
  // crashes this entire screen on every single launch, for every user,
  // before anyone can even sign up. A harmless, never-dispatched placeholder
  // keeps the hook from throwing; `onPressGoogle` below already refuses to
  // call `promptGoogleAsync()` unless `isGoogleSignInConfigured` is true, so
  // this placeholder is never actually used to attempt a real sign-in.
  const [, googleResponse, promptGoogleAsync] = useIdTokenAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID || 'not-configured',
    androidClientId: GOOGLE_ANDROID_CLIENT_ID || 'not-configured',
    webClientId: GOOGLE_WEB_CLIENT_ID || 'not-configured',
  });

  const modeAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    modeAnim.setValue(0);
    const anim = Animated.timing(modeAnim, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [mode, modeAnim]);
  const modeAnimatedStyle = {
    opacity: modeAnim,
    transform: [{ translateY: modeAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
  };

  const switchMode = (next: Mode) => {
    setError(null);
    setMfaStep(false);
    setMfaCode('');
    setMagicLinkMode(false);
    setMagicLinkSent(false);
    setMode(next);
  };

  /** Shared landing step after ANY successful sign-up/sign-in (password,
   * Google, Apple, or magic link) — same value-moment paywall rule applies
   * no matter which auth method got the account signed in. */
  const afterAuthSuccess = async (): Promise<void> => {
    router.replace('/(tabs)/entries');
    const alreadyShown = await SecureStore.getItemAsync(PAYWALL_SHOWN_KEY);
    if (!alreadyShown) {
      await SecureStore.setItemAsync(PAYWALL_SHOWN_KEY, '1');
      if (!isPremium) router.push('/paywall?source=connect');
    }
  };

  useEffect(() => {
    if (!googleResponse) return;
    if (googleResponse.type === 'success' && googleResponse.params.id_token) {
      (async () => {
        setError(null);
        setSubmitting(true);
        try {
          await signInWithGoogle(googleResponse.params.id_token);
          await afterAuthSuccess();
        } catch (err: unknown) {
          setError(getErrorMessage(err, 'Google sign-in failed.'));
        } finally {
          setSubmitting(false);
        }
      })();
    } else if (googleResponse.type === 'error') {
      setError('Google sign-in failed.');
    }
    // afterAuthSuccess/signInWithGoogle are stable store/helper references; only re-run on a new response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleResponse]);

  const onPressGoogle = () => {
    if (!isGoogleSignInConfigured) {
      setError('Google sign-in is not set up yet.');
      return;
    }
    setError(null);
    promptGoogleAsync();
  };

  const onPressApple = async () => {
    setError(null);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
      });
      if (!credential.identityToken) {
        setError('Apple did not return a sign-in token.');
        return;
      }
      setSubmitting(true);
      await signInWithApple(credential.identityToken);
      await afterAuthSuccess();
    } catch (err: unknown) {
      if (isAppleSignInCancellation(err)) return;
      setError(getErrorMessage(err, 'Apple sign-in failed.'));
    } finally {
      setSubmitting(false);
    }
  };

  const onRequestMagicLink = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await requestMagicLink(trimmedEmail);
      setMagicLinkSent(true);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not send your sign-in link.'));
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = async () => {
    if (mfaStep) {
      if (!/^\d{6}$/.test(mfaCode.trim())) {
        setError('Enter the 6-digit code from your authenticator app.');
        return;
      }
      setError(null);
      setSubmitting(true);
      try {
        await signIn(email.trim().toLowerCase(), password, mfaCode.trim());
        await afterAuthSuccess();
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Incorrect verification code.'));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (mode === 'signup' && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'signup') {
        await signUp(trimmedEmail, password);
      } else {
        await signIn(trimmedEmail, password);
      }
      await afterAuthSuccess();
    } catch (err: unknown) {
      if (err instanceof BindleApiError && err.mfaRequired) {
        setMfaStep(true);
        setError(null);
        return;
      }
      setError(
        getErrorMessage(
          err,
          mode === 'signup' ? 'Could not create your account.' : 'Could not sign in.'
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top + spacing.xl,
          paddingBottom: spacing.xxl,
          paddingHorizontal: spacing.lg,
        }}
      >
        <View style={{ alignItems: 'center' }}>
          <View style={[styles.iconWrap, { backgroundColor: c.surfaceAlt }]}>
            <Feather name="bookmark" size={32} color={c.text} />
          </View>
          <Text style={[typography.title, { color: c.text, marginTop: spacing.lg, textAlign: 'center' }]}>
            {mfaStep ? 'Enter your code' : mode === 'signup' ? 'Create your account' : 'Welcome back'}
          </Text>
          <Text style={[typography.body, { color: c.textMuted, marginTop: spacing.xs, textAlign: 'center' }]}>
            {mfaStep
              ? 'Open your authenticator app and enter the 6-digit code.'
              : mode === 'signup'
                ? 'Save anything, read it anywhere. No server to set up.'
                : 'Sign in to pick up where you left off.'}
          </Text>
        </View>

        {!mfaStep ? (
          <View style={[styles.tabRow, { borderColor: c.border }]}>
            <ModeTab c={c} label="Sign up" active={mode === 'signup'} onPress={() => switchMode('signup')} />
            <ModeTab c={c} label="Sign in" active={mode === 'signin'} onPress={() => switchMode('signin')} />
          </View>
        ) : null}

        <Animated.View style={modeAnimatedStyle}>
          {mfaStep ? (
            <View style={{ marginTop: spacing.xl }}>
              <Text style={[typography.caption, { color: c.textMuted, marginBottom: spacing.xs }]}>Verification code</Text>
              <TextInput
                testID="field-mfa-code"
                accessibilityLabel="Verification code"
                value={mfaCode}
                onChangeText={(v) => {
                  setMfaCode(v);
                  setError(null);
                }}
                placeholder="123456"
                placeholderTextColor={c.textFaint}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
                returnKeyType="go"
                onSubmitEditing={onSubmit}
                style={[styles.input, { color: c.text, backgroundColor: c.surface, borderColor: error ? c.danger : c.border }]}
              />
            </View>
          ) : magicLinkMode ? (
            <View style={{ marginTop: spacing.xl }}>
              <Text style={[typography.caption, { color: c.textMuted, marginBottom: spacing.xs }]}>Email</Text>
              <TextInput
                testID="field-email-magiclink"
                accessibilityLabel="Email"
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  setError(null);
                }}
                placeholder="you@example.com"
                placeholderTextColor={c.textFaint}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                editable={!magicLinkSent}
                returnKeyType="go"
                onSubmitEditing={onRequestMagicLink}
                style={[styles.input, { color: c.text, backgroundColor: c.surface, borderColor: error ? c.danger : c.border }]}
              />
              {magicLinkSent ? (
                <View style={[styles.errorBanner, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
                  <Feather name="mail" size={16} color={c.textMuted} />
                  <Text style={[typography.caption, { color: c.textMuted, flex: 1, lineHeight: 18 }]}>
                    Check your email for a sign-in link.
                  </Text>
                </View>
              ) : null}
            </View>
          ) : (
            <>
              <View style={{ marginTop: spacing.xl }}>
                <Text style={[typography.caption, { color: c.textMuted, marginBottom: spacing.xs }]}>Email</Text>
                <TextInput
                  testID="field-email"
                  accessibilityLabel="Email"
                  value={email}
                  onChangeText={(v) => {
                    setEmail(v);
                    setError(null);
                  }}
                  placeholder="you@example.com"
                  placeholderTextColor={c.textFaint}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  style={[styles.input, { color: c.text, backgroundColor: c.surface, borderColor: error ? c.danger : c.border }]}
                />
              </View>
              <View style={{ marginTop: spacing.md }}>
                <Text style={[typography.caption, { color: c.textMuted, marginBottom: spacing.xs }]}>Password</Text>
                <TextInput
                  testID="field-password"
                  accessibilityLabel="Password"
                  value={password}
                  onChangeText={(v) => {
                    setPassword(v);
                    setError(null);
                  }}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="go"
                  onSubmitEditing={onSubmit}
                  placeholderTextColor={c.textFaint}
                  style={[styles.input, { color: c.text, backgroundColor: c.surface, borderColor: error ? c.danger : c.border }]}
                />
              </View>
            </>
          )}

          {error ? (
            <View style={[styles.errorBanner, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
              <Feather name="alert-circle" size={16} color={c.danger} />
              <Text style={[typography.caption, { color: c.danger, flex: 1, lineHeight: 18 }]}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            testID="connect-submit"
            onPress={magicLinkMode ? onRequestMagicLink : onSubmit}
            disabled={submitting || (magicLinkMode && magicLinkSent)}
            style={({ pressed }) => [
              styles.cta,
              {
                backgroundColor: submitting || (magicLinkMode && magicLinkSent) ? c.surfaceAlt : c.accent,
                marginTop: spacing.xl,
                opacity: pressed && !submitting ? 0.85 : 1,
              },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={c.background} />
            ) : (
              <Text style={[typography.heading, { color: magicLinkMode && magicLinkSent ? c.textMuted : c.background }]}>
                {mfaStep
                  ? 'Verify'
                  : magicLinkMode
                    ? magicLinkSent
                      ? 'Link sent'
                      : 'Send sign-in link'
                    : mode === 'signup'
                      ? 'Create account'
                      : 'Sign in'}
              </Text>
            )}
          </Pressable>

          {!mfaStep ? (
            <Pressable
              testID="connect-toggle-magiclink"
              onPress={() => {
                setError(null);
                setMagicLinkSent(false);
                setMagicLinkMode((v) => !v);
              }}
              style={{ marginTop: spacing.md, alignItems: 'center' }}
            >
              <Text style={[typography.caption, { color: c.textMuted }]}>
                {magicLinkMode ? 'Use a password instead' : 'Sign in with an email link instead'}
              </Text>
            </Pressable>
          ) : null}

          {!mfaStep && !magicLinkMode ? (
            <>
              <View style={styles.dividerRow}>
                <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
                <Text style={[typography.caption, { color: c.textFaint }]}>or</Text>
                <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
              </View>

              {appleAvailable ? (
                <Pressable
                  testID="connect-apple"
                  onPress={onPressApple}
                  disabled={submitting}
                  style={({ pressed }) => [
                    styles.socialButton,
                    { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1, marginTop: spacing.md },
                  ]}
                  accessibilityLabel="Continue with Apple"
                >
                  <Ionicons name="logo-apple" size={20} color={c.text} />
                  <Text style={[typography.body, { color: c.text, fontWeight: '600' }]}>Continue with Apple</Text>
                </Pressable>
              ) : null}

              <Pressable
                testID="connect-google"
                onPress={onPressGoogle}
                disabled={submitting}
                style={({ pressed }) => [
                  styles.socialButton,
                  { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1, marginTop: spacing.md },
                ]}
                accessibilityLabel="Continue with Google"
              >
                <Ionicons name="logo-google" size={20} color={c.text} />
                <Text style={[typography.body, { color: c.text, fontWeight: '600' }]}>Continue with Google</Text>
              </Pressable>
            </>
          ) : null}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

type Colors = ReturnType<typeof useTheme>['c'];

function ModeTab(props: { c: Colors; label: string; active: boolean; onPress: () => void }) {
  const { c, label, active, onPress } = props;
  return (
    <Pressable
      testID={`connect-tab-${label.toLowerCase().replace(' ', '-')}`}
      onPress={onPress}
      style={[styles.tab, active ? { backgroundColor: c.surfaceAlt } : null]}
    >
      <Text style={[typography.body, { color: active ? c.text : c.textFaint, fontWeight: active ? '600' : '400' }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabRow: {
    flexDirection: 'row',
    marginTop: spacing.xl,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
  },
  cta: {
    paddingVertical: 16,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1,
  },
});
