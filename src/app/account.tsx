import { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '../lib/auth/authStore';
import { useTheme } from '../lib/useTheme';
import { spacing, typography, radius } from '../lib/theme';
import { IconButton } from '../components/IconButton';
import { EmptyState } from '../components/EmptyState';
import type { WallabagConfig, WallabagServerInfo, WallabagUser } from '../lib/api/types';
import { getErrorMessage } from '../lib/errors';

type AccountData = {
  user: WallabagUser;
  config: WallabagConfig;
  server: WallabagServerInfo;
};

/** Real, live account/server identity pulled straight from Wallabag's own
 * `/api/user`, `/api/config`, and `/api/info` — nothing cached or guessed,
 * since this screen only makes sense while actually connected. */
export default function Account() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const client = useAuthStore((s) => s.client);

  const [data, setData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    Promise.all([client.fetchUser(), client.fetchConfig(), client.fetchServerInfo()])
      .then(([user, config, server]) => setData({ user, config, server }))
      .catch((err: unknown) => setError(getErrorMessage(err, 'Could not load account info.')))
      .finally(() => setLoading(false));
  }, [client]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
      <View style={styles.header}>
        <IconButton
          testID="account-back"
          name="arrow-left"
          accessibilityLabel="Back"
          onPress={() => router.back()}
        />
        <Text style={[typography.heading, { color: c.text }]}>Account</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.text} />
        </View>
      ) : error || !data ? (
        <EmptyState icon="alert-triangle" title="Couldn't load account info" subtitle={error ?? undefined} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
          <Section title="Signed in as" c={c}>
            <Row label="Username" value={data.user.username} c={c} />
            <Row label="Name" value={data.user.name ?? '—'} c={c} />
            <Row label="Email" value={data.user.email} c={c} />
            <Row label="Account created" value={formatDate(data.user.created_at)} c={c} last />
          </Section>

          <Section title="Server" c={c}>
            <Row label="Application" value={data.server.appname} c={c} />
            <Row label="Version" value={data.server.version} c={c} />
            <Row
              label="Open registration"
              value={data.server.allowed_registration ? 'Enabled' : 'Disabled'}
              c={c}
              last
            />
          </Section>

          <Section title="Reading settings" c={c}>
            <Row label="Items per page" value={String(data.config.items_per_page)} c={c} />
            <Row label="Language" value={data.config.language} c={c} />
            <Row
              label="Reading speed"
              value={data.config.reading_speed != null ? `${data.config.reading_speed}` : '—'}
              c={c}
              last
            />
          </Section>
        </ScrollView>
      )}
    </View>
  );
}

function Section({ title, c, children }: { title: string; c: ReturnType<typeof useTheme>['c']; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={[typography.tiny, { color: c.textFaint, marginBottom: spacing.xs }]}>{title.toUpperCase()}</Text>
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>{children}</View>
    </View>
  );
}

function Row({
  label,
  value,
  c,
  last,
}: {
  label: string;
  value: string;
  c: ReturnType<typeof useTheme>['c'];
  last?: boolean;
}) {
  return (
    <View style={[styles.row, !last && { borderBottomWidth: 1, borderBottomColor: c.border }]}>
      <Text style={[typography.caption, { color: c.textMuted }]}>{label}</Text>
      <Text style={[typography.caption, { color: c.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
});
