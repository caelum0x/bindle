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
  Linking,
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
import { checkServerReachable, normalizeServerUrl } from '../lib/api/wallabagClient';
import { usePremium } from '../premium/premium-context';

/** Set once the paywall has been shown after a first successful connect, so
 * reconnecting later (e.g. after Settings > Disconnect) doesn't re-show it
 * every time — the packaging rule is "show it to every free account right
 * after the value moment", not "nag on every sign-in". */
const PAYWALL_SHOWN_KEY = 'bindle.paywall.shown.v1';

type StepIndex = 0 | 1 | 2;
const STEP_COUNT = 3;

/** Turns whatever the user typed into something `fetch` can use: adds a scheme
 * if they left it off (the overwhelmingly common first-run mistake) and drops
 * a trailing slash so it matches what the client sends later. */
function normalizeUrlInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return normalizeServerUrl(withScheme);
}

export default function Connect() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const connect = useAuthStore((s) => s.connect);
  const { isPremium } = usePremium();

  const [step, setStep] = useState<StepIndex>(0);

  const [serverUrl, setServerUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [serverUrlError, setServerUrlError] = useState<string | null>(null);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

  const [checkingServer, setCheckingServer] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Purposeful motion for the step hand-off: a short fade + settle-in each
  // time `step` changes, so moving from "Your server" -> "API access" ->
  // "Sign in" reads as one continuous flow advancing forward, not three
  // screens being swapped instantly. Native-driver only, no extra dependency.
  const stepAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    stepAnim.setValue(0);
    const anim = Animated.timing(stepAnim, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [step, stepAnim]);
  const stepAnimatedStyle = {
    opacity: stepAnim,
    transform: [
      { translateY: stepAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
    ],
  };

  const goBack = () => {
    setServerUrlError(null);
    setCredentialsError(null);
    setSignInError(null);
    setStep((s) => (s > 0 ? ((s - 1) as StepIndex) : s));
  };

  const onContinueServerUrl = async () => {
    const normalized = normalizeUrlInput(serverUrl);
    if (!normalized) {
      setServerUrlError('Enter your server address first.');
      return;
    }
    try {
      // eslint-disable-next-line no-new
      new URL(normalized);
    } catch {
      setServerUrlError("That doesn't look like a valid address.");
      return;
    }
    setServerUrlError(null);
    setServerUrl(normalized);
    setCheckingServer(true);
    const result = await checkServerReachable(normalized);
    setCheckingServer(false);
    if (result === 'unreachable') {
      setServerUrlError('Could not reach that address. Check the URL and your connection, then try again.');
      return;
    }
    setStep(1);
  };

  const onContinueCredentials = () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      setCredentialsError('Enter both the Client ID and Client secret from your server.');
      return;
    }
    setCredentialsError(null);
    setStep(2);
  };

  const onConnect = async () => {
    if (!username.trim() || !password) {
      setSignInError('Enter your username and password.');
      return;
    }
    setSignInError(null);
    setConnecting(true);
    try {
      await connect({
        serverUrl,
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        username: username.trim(),
        password,
      });
      router.replace('/(tabs)/entries');

      // The value moment: the user just watched their own saved articles
      // connect. Premium's whole pitch (unlimited bulk import, richer export
      // formats) is maximally relevant right here, so it is shown to every
      // free account once, not only when one bumps into a specific limit.
      // Pushed on top of the entries list (not a replace) so dismissing it
      // either way lands on a fully working app.
      const alreadyShown = await SecureStore.getItemAsync(PAYWALL_SHOWN_KEY);
      if (!alreadyShown) {
        await SecureStore.setItemAsync(PAYWALL_SHOWN_KEY, '1');
        if (!isPremium) router.push('/paywall?source=connect');
      }
    } catch (err: unknown) {
      setSignInError(getErrorMessage(err, 'Could not connect. Check your details and try again.'));
    } finally {
      setConnecting(false);
    }
  };

  const openDeveloperPage = () => {
    const base = normalizeUrlInput(serverUrl);
    if (base) Linking.openURL(`${base}/developer`);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top + spacing.md,
          paddingBottom: spacing.xxl,
          paddingHorizontal: spacing.lg,
        }}
      >
        <View style={styles.topRow}>
          {step > 0 ? (
            <Pressable
              testID="connect-back"
              onPress={goBack}
              accessibilityLabel="Back"
              hitSlop={12}
              style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.5 : 1 }]}
            >
              <Feather name="chevron-left" size={24} color={c.text} />
            </Pressable>
          ) : (
            <View style={styles.backButton} />
          )}
          <View style={styles.dots}>
            {Array.from({ length: STEP_COUNT }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  { backgroundColor: i === step ? c.text : c.border, width: i === step ? 18 : 6 },
                ]}
              />
            ))}
          </View>
          <View style={styles.backButton} />
        </View>

        <Animated.View style={stepAnimatedStyle}>
          {step === 0 ? (
            <ServerStep
              c={c}
              serverUrl={serverUrl}
              onChange={(v) => {
                setServerUrl(v);
                setServerUrlError(null);
              }}
              error={serverUrlError}
              checking={checkingServer}
              onContinue={onContinueServerUrl}
            />
          ) : null}

          {step === 1 ? (
            <CredentialsStep
              c={c}
              clientId={clientId}
              clientSecret={clientSecret}
              onChangeClientId={(v) => {
                setClientId(v);
                setCredentialsError(null);
              }}
              onChangeClientSecret={(v) => {
                setClientSecret(v);
                setCredentialsError(null);
              }}
              error={credentialsError}
              onOpenDeveloperPage={openDeveloperPage}
              onContinue={onContinueCredentials}
            />
          ) : null}

          {step === 2 ? (
            <SignInStep
              c={c}
              username={username}
              password={password}
              onChangeUsername={(v) => {
                setUsername(v);
                setSignInError(null);
              }}
              onChangePassword={(v) => {
                setPassword(v);
                setSignInError(null);
              }}
              error={signInError}
              connecting={connecting}
              onConnect={onConnect}
            />
          ) : null}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

type Colors = ReturnType<typeof useTheme>['c'];

function StepHeader(props: { c: Colors; icon: keyof typeof Feather.glyphMap; title: string; body: string }) {
  const { c, icon, title, body } = props;
  return (
    <View style={{ alignItems: 'center', marginTop: spacing.lg }}>
      <View style={[styles.iconWrap, { backgroundColor: c.surfaceAlt }]}>
        <Feather name={icon} size={32} color={c.text} />
      </View>
      <Text style={[typography.title, { color: c.text, marginTop: spacing.lg, textAlign: 'center' }]}>
        {title}
      </Text>
      <Text style={[typography.body, { color: c.textMuted, marginTop: spacing.xs, textAlign: 'center' }]}>
        {body}
      </Text>
    </View>
  );
}

function ErrorBanner(props: { c: Colors; message: string }) {
  const { c, message } = props;
  return (
    <View style={[styles.errorBanner, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
      <Feather name="alert-circle" size={16} color={c.danger} />
      <Text style={[typography.caption, { color: c.danger, flex: 1, lineHeight: 18 }]}>{message}</Text>
    </View>
  );
}

function CtaButton(props: { c: Colors; label: string; onPress: () => void; disabled?: boolean; loading?: boolean; testID?: string }) {
  const { c, label, onPress, disabled, loading, testID } = props;
  const inactive = !!disabled || !!loading;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.cta,
        { backgroundColor: inactive ? c.surfaceAlt : c.accent, marginTop: spacing.xl, opacity: pressed && !inactive ? 0.85 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={c.background} />
      ) : (
        <Text style={[typography.heading, { color: inactive ? c.textFaint : c.background }]}>{label}</Text>
      )}
    </Pressable>
  );
}

function ServerStep(props: {
  c: Colors;
  serverUrl: string;
  onChange: (v: string) => void;
  error: string | null;
  checking: boolean;
  onContinue: () => void;
}) {
  const { c, serverUrl, onChange, error, checking, onContinue } = props;
  return (
    <View>
      <StepHeader
        c={c}
        icon="server"
        title="Your server"
        body="Bindle connects to the self-hosted Wallabag server you already have."
      />
      <View style={{ marginTop: spacing.xl }}>
        <Text style={[typography.caption, { color: c.textMuted, marginBottom: spacing.xs }]}>Server URL</Text>
        <TextInput
          testID="field-server-url"
          accessibilityLabel="Server URL"
          value={serverUrl}
          onChangeText={onChange}
          placeholder="wallabag.example.com"
          placeholderTextColor={c.textFaint}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="go"
          onSubmitEditing={onContinue}
          style={[styles.input, { color: c.text, backgroundColor: c.surface, borderColor: error ? c.danger : c.border }]}
        />
      </View>
      {error ? <ErrorBanner c={c} message={error} /> : null}
      <CtaButton
        testID="connect-continue-server"
        c={c}
        label={checking ? 'Checking…' : 'Continue'}
        onPress={onContinue}
        loading={checking}
        disabled={!serverUrl.trim()}
      />
    </View>
  );
}

function CredentialsStep(props: {
  c: Colors;
  clientId: string;
  clientSecret: string;
  onChangeClientId: (v: string) => void;
  onChangeClientSecret: (v: string) => void;
  error: string | null;
  onOpenDeveloperPage: () => void;
  onContinue: () => void;
}) {
  const { c, clientId, clientSecret, onChangeClientId, onChangeClientSecret, error, onOpenDeveloperPage, onContinue } = props;
  return (
    <View>
      <StepHeader
        c={c}
        icon="key"
        title="API access"
        body="Create a client on your server so Bindle can sign in on your behalf."
      />

      <View style={[styles.guideBox, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
        <GuideStep c={c} number={1} text="Open your server's developer page" />
        <GuideStep c={c} number={2} text='Tap "Create a new client"' />
        <GuideStep c={c} number={3} text="Copy the Client ID and secret it shows you" />
        <Pressable
          testID="connect-open-developer-page"
          onPress={onOpenDeveloperPage}
          style={({ pressed }) => [
            styles.secondaryButton,
            { borderColor: c.border, backgroundColor: c.surface, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Feather name="external-link" size={14} color={c.text} />
          <Text style={[typography.caption, { color: c.text }]}>Open developer page</Text>
        </Pressable>
      </View>

      <View style={{ marginTop: spacing.lg }}>
        <Text style={[typography.caption, { color: c.textMuted, marginBottom: spacing.xs }]}>Client ID</Text>
        <TextInput
          testID="field-client-id"
          accessibilityLabel="Client ID"
          value={clientId}
          onChangeText={onChangeClientId}
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={c.textFaint}
          style={[styles.input, { color: c.text, backgroundColor: c.surface, borderColor: error ? c.danger : c.border }]}
        />
      </View>
      <View style={{ marginTop: spacing.md }}>
        <Text style={[typography.caption, { color: c.textMuted, marginBottom: spacing.xs }]}>Client secret</Text>
        <TextInput
          testID="field-client-secret"
          accessibilityLabel="Client secret"
          value={clientSecret}
          onChangeText={onChangeClientSecret}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={onContinue}
          placeholderTextColor={c.textFaint}
          style={[styles.input, { color: c.text, backgroundColor: c.surface, borderColor: error ? c.danger : c.border }]}
        />
      </View>

      {error ? <ErrorBanner c={c} message={error} /> : null}
      <CtaButton testID="connect-continue-credentials" c={c} label="Continue" onPress={onContinue} />
    </View>
  );
}

function GuideStep(props: { c: Colors; number: number; text: string }) {
  const { c, number, text } = props;
  return (
    <View style={styles.guideRow}>
      <View style={[styles.guideNumber, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[typography.caption, { color: c.text }]}>{number}</Text>
      </View>
      <Text style={[typography.body, { color: c.text, flex: 1 }]}>{text}</Text>
    </View>
  );
}

function SignInStep(props: {
  c: Colors;
  username: string;
  password: string;
  onChangeUsername: (v: string) => void;
  onChangePassword: (v: string) => void;
  error: string | null;
  connecting: boolean;
  onConnect: () => void;
}) {
  const { c, username, password, onChangeUsername, onChangePassword, error, connecting, onConnect } = props;
  return (
    <View>
      <StepHeader
        c={c}
        icon="user"
        title="Sign in"
        body="Use the same username and password you use on your server's web page."
      />
      <View style={{ marginTop: spacing.xl }}>
        <Text style={[typography.caption, { color: c.textMuted, marginBottom: spacing.xs }]}>Username</Text>
        <TextInput
          testID="field-username"
          accessibilityLabel="Username"
          value={username}
          onChangeText={onChangeUsername}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          placeholderTextColor={c.textFaint}
          style={[styles.input, { color: c.text, backgroundColor: c.surface, borderColor: error ? c.danger : c.border }]}
        />
      </View>
      <View style={{ marginTop: spacing.md }}>
        <Text style={[typography.caption, { color: c.textMuted, marginBottom: spacing.xs }]}>Password</Text>
        <TextInput
          testID="field-password"
          accessibilityLabel="Password"
          value={password}
          onChangeText={onChangePassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={onConnect}
          placeholderTextColor={c.textFaint}
          style={[styles.input, { color: c.text, backgroundColor: c.surface, borderColor: error ? c.danger : c.border }]}
        />
      </View>

      {error ? <ErrorBanner c={c} message={error} /> : null}
      <CtaButton
        testID="connect-submit"
        c={c}
        label={connecting ? 'Connecting…' : 'Connect'}
        onPress={onConnect}
        loading={connecting}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 32,
    height: 32,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  dots: { flexDirection: 'row', gap: spacing.sm },
  dot: { height: 6, borderRadius: radius.pill },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
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
  guideBox: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
  },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  guideNumber: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: 10,
    marginTop: spacing.xs,
  },
});
