import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '../lib/auth/authStore';
import { useTheme } from '../lib/useTheme';
import { spacing, typography, radius } from '../lib/theme';
import { IconButton } from '../components/IconButton';
import { EmptyState } from '../components/EmptyState';

/** Real account identity — nothing cached or guessed, since this screen only
 * makes sense while actually signed in. */
export default function Account() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
      <View style={styles.header} accessibilityLabel="Account">
        <IconButton
          testID="account-back"
          name="arrow-left"
          accessibilityLabel="Back"
          onPress={() => router.back()}
        />
        <Feather name="user" size={18} color={c.text} />
        <View style={{ width: 40 }} />
      </View>

      {!user ? (
        <EmptyState icon="alert-triangle" title="Not signed in" />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
          <Section title="Signed in as" c={c}>
            <Row label="Email" value={user.email} c={c} />
            <Row label="Account created" value={formatDate(user.createdAt)} c={c} last />
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

function formatDate(epochMs: number): string {
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return '—';
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
