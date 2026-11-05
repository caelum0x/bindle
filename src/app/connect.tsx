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
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../lib/auth/authStore';
import { useTheme } from '../lib/useTheme';
import { radius, spacing, typography } from '../lib/theme';
import { getErrorMessage } from '../lib/errors';
import { usePremium } from '../premium/premium-context';

/** Set once the paywall has been shown after a first successful sign-up, so
 * signing back in later doesn't re-show it every time — the packaging rule
 * is "show it to every free account right after the value moment", not
 * "nag on every sign-in". */
const PAYWALL_SHOWN_KEY = 'bindle.paywall.shown.v1';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Mode = 'signup' | 'signin';

export default function Connect() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const signUp = useAuthStore((s) => s.signUp);
  const signIn = useAuthStore((s) => s.signIn);
  const { isPremium } = usePremium();

  const [mode, setMode] = useState<Mode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    setMode(next);
  };

  const onSubmit = async () => {
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
      router.replace('/(tabs)/entries');

      // The value moment: the account that was just created/signed into is
      // about to show its own saved articles. Premium's whole pitch
      // (unlimited bulk import, formatted export) is maximally relevant
      // right here, so it is shown to every free account once, not only
      // when one bumps into a specific limit. Pushed on top of the entries
      // list (not a replace) so dismissing it either way lands on a fully
      // working app.
      const alreadyShown = await SecureStore.getItemAsync(PAYWALL_SHOWN_KEY);
      if (!alreadyShown) {
        await SecureStore.setItemAsync(PAYWALL_SHOWN_KEY, '1');
        if (!isPremium) router.push('/paywall?source=connect');
      }
    } catch (err: unknown) {
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
            {mode === 'signup' ? 'Create your account' : 'Welcome back'}
          </Text>
          <Text style={[typography.body, { color: c.textMuted, marginTop: spacing.xs, textAlign: 'center' }]}>
            {mode === 'signup'
              ? 'Save anything, read it anywhere. No server to set up.'
              : 'Sign in to pick up where you left off.'}
          </Text>
        </View>

        <View style={[styles.tabRow, { borderColor: c.border }]}>
          <ModeTab c={c} label="Sign up" active={mode === 'signup'} onPress={() => switchMode('signup')} />
          <ModeTab c={c} label="Sign in" active={mode === 'signin'} onPress={() => switchMode('signin')} />
        </View>

        <Animated.View style={modeAnimatedStyle}>
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

          {error ? (
            <View style={[styles.errorBanner, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
              <Feather name="alert-circle" size={16} color={c.danger} />
              <Text style={[typography.caption, { color: c.danger, flex: 1, lineHeight: 18 }]}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            testID="connect-submit"
            onPress={onSubmit}
            disabled={submitting}
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: submitting ? c.surfaceAlt : c.accent, marginTop: spacing.xl, opacity: pressed && !submitting ? 0.85 : 1 },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={c.background} />
            ) : (
              <Text style={[typography.heading, { color: c.background }]}>
                {mode === 'signup' ? 'Create account' : 'Sign in'}
              </Text>
            )}
          </Pressable>
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
});
