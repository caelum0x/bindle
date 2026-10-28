import { useState } from 'react';
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
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../lib/auth/authStore';
import { useTheme } from '../lib/useTheme';
import { radius, spacing, typography } from '../lib/theme';
import { getErrorMessage } from '../lib/errors';

export default function Connect() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const connect = useAuthStore((s) => s.connect);

  const [serverUrl, setServerUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = serverUrl && clientId && clientSecret && username && password && !loading;

  const onSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      await connect({ serverUrl, clientId, clientSecret, username, password });
      router.replace('/(tabs)/entries');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not connect. Check your details and try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.xl, paddingBottom: spacing.xxl, paddingHorizontal: spacing.lg }}
      >
        <Feather name="server" size={28} color={c.text} />
        <Text style={[typography.title, { color: c.text, marginTop: spacing.md }]}>Connect your server</Text>
        <Text style={[typography.body, { color: c.textMuted, marginTop: spacing.xs }]}>
          Enter your self-hosted Wallabag details.
        </Text>

        <Field testID="field-server-url" label="Server URL" value={serverUrl} onChangeText={setServerUrl} placeholder="https://wallabag.example.com" keyboardType="url" autoCapitalize="none" c={c} />
        <Field testID="field-client-id" label="Client ID" value={clientId} onChangeText={setClientId} autoCapitalize="none" c={c} />
        <Field testID="field-client-secret" label="Client secret" value={clientSecret} onChangeText={setClientSecret} secureTextEntry autoCapitalize="none" c={c} />
        <Field testID="field-username" label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" c={c} />
        <Field testID="field-password" label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" c={c} />

        {error ? (
          <Text style={[typography.caption, { color: c.danger, marginTop: spacing.sm }]}>{error}</Text>
        ) : null}

        <Pressable
          testID="connect-submit"
          onPress={onSubmit}
          disabled={!canSubmit}
          style={[
            styles.cta,
            { backgroundColor: canSubmit ? c.accent : c.surfaceAlt, marginTop: spacing.lg },
          ]}
        >
          {loading ? (
            <ActivityIndicator color={c.background} />
          ) : (
            <Text style={[typography.heading, { color: canSubmit ? c.background : c.textFaint }]}>
              Connect
            </Text>
          )}
        </Pressable>

        <Pressable onPress={() => setShowHelp((v) => !v)} style={{ marginTop: spacing.lg }}>
          <Text style={[typography.caption, { color: c.textMuted }]}>
            {showHelp ? 'Hide' : 'Where do I find my Client ID and secret?'}
          </Text>
        </Pressable>
        {showHelp ? (
          <View style={[styles.helpBox, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
            <Text style={[typography.caption, { color: c.textMuted, lineHeight: 19 }]}>
              On your Wallabag server, sign in on the web, open Developer → "Create a new
              client", and copy the Client ID and secret it generates. Use the same
              username and password you use to sign in on the web.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences';
  keyboardType?: 'default' | 'url';
  c: ReturnType<typeof useTheme>['c'];
  testID?: string;
}) {
  const { label, c, ...inputProps } = props;
  return (
    <View style={{ marginTop: spacing.lg }}>
      <Text style={[typography.caption, { color: c.textMuted, marginBottom: spacing.xs }]}>{label}</Text>
      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        placeholderTextColor={c.textFaint}
        style={[
          styles.input,
          { color: c.text, backgroundColor: c.surface, borderColor: c.border },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
  helpBox: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
});
