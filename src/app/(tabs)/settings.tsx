import { useEffect, useState } from 'react';
import { View, Text, Pressable, Switch, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '../../lib/auth/authStore';
import { useTheme } from '../../lib/useTheme';
import { radius, spacing, typography } from '../../lib/theme';
import {
  isReminderScheduled,
  requestNotificationPermission,
  scheduleUnreadReminder,
  cancelUnreadReminder,
} from '../../lib/notifications/reminders';
import { clearCache } from '../../lib/db/database';
import { usePremium } from '../../premium/premium-context';

export default function Settings() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const { isPremium } = usePremium();

  const [reminderOn, setReminderOn] = useState(false);

  useEffect(() => {
    isReminderScheduled().then(setReminderOn);
  }, []);

  const onToggleReminder = async (value: boolean) => {
    if (value) {
      const granted = await requestNotificationPermission();
      if (!granted) return;
      await scheduleUnreadReminder(9, 0);
    } else {
      await cancelUnreadReminder();
    }
    setReminderOn(value);
  };

  const onSignOut = async () => {
    await clearCache();
    await signOut();
    router.replace('/connect');
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
      <View
        style={{ paddingHorizontal: spacing.lg, marginTop: spacing.md }}
        accessibilityLabel="Settings"
      >
        <Feather name="settings" size={22} color={c.text} />
      </View>

      <Section title="Premium">
        <Pressable
          testID="settings-open-paywall"
          onPress={() => router.push('/paywall?source=settings')}
          style={[styles.row, { borderColor: c.border }]}
        >
          <View style={styles.rowLeft}>
            <Feather name="zap" size={18} color={c.textMuted} />
            <Text style={[typography.body, { color: c.text }]}>
              {isPremium ? 'Bindle Premium — active' : 'Go Premium'}
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color={c.textFaint} />
        </Pressable>
      </Section>

      <Section title="Account">
        <Row icon="mail" label={user?.email ?? 'Not signed in'} c={c} />
        <Pressable
          testID="settings-open-account"
          onPress={() => router.push('/account')}
          style={[styles.row, { borderColor: c.border }]}
        >
          <View style={styles.rowLeft}>
            <Feather name="user" size={18} color={c.textMuted} />
            <Text style={[typography.body, { color: c.text }]}>Account details</Text>
          </View>
          <Feather name="chevron-right" size={16} color={c.textFaint} />
        </Pressable>
        <Pressable
          testID="settings-open-import"
          onPress={() => router.push('/import')}
          style={[styles.row, { borderColor: c.border }]}
        >
          <View style={styles.rowLeft}>
            <Feather name="upload" size={18} color={c.textMuted} />
            <Text style={[typography.body, { color: c.text }]}>Import links</Text>
          </View>
          <Feather name="chevron-right" size={16} color={c.textFaint} />
        </Pressable>
      </Section>

      <Section title="Reminders">
        <View style={[styles.row, { borderColor: c.border }]}>
          <View style={styles.rowLeft}>
            <Feather name="bell" size={18} color={c.textMuted} />
            <Text style={[typography.body, { color: c.text }]}>Daily reading reminder</Text>
          </View>
          <Switch value={reminderOn} onValueChange={onToggleReminder} />
        </View>
      </Section>

      <Pressable onPress={onSignOut} style={[styles.signOut, { borderColor: c.border }]}>
        <Feather name="log-out" size={18} color={c.danger} />
        <Text style={[typography.body, { color: c.danger }]}>Sign out</Text>
      </Pressable>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ marginTop: spacing.lg }}>
      <Text style={[typography.tiny, { color: c.textFaint, paddingHorizontal: spacing.lg, marginBottom: spacing.xs }]}>
        {title.toUpperCase()}
      </Text>
      <View style={{ paddingHorizontal: spacing.lg }}>{children}</View>
    </View>
  );
}

function Row({
  icon,
  label,
  c,
  multiline,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  c: ReturnType<typeof useTheme>['c'];
  multiline?: boolean;
}) {
  return (
    <View style={[styles.row, { borderColor: c.border, alignItems: multiline ? 'flex-start' : 'center' }]}>
      <View style={[styles.rowLeft, { alignItems: multiline ? 'flex-start' : 'center' }]}>
        <Feather name={icon} size={18} color={c.textMuted} style={{ marginTop: multiline ? 2 : 0 }} />
        <Text style={[typography.caption, { color: c.textMuted, flex: 1, lineHeight: 18 }]}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  rowLeft: {
    flexDirection: 'row',
    gap: spacing.sm,
    flex: 1,
  },
  signOut: {
    marginTop: spacing.xl,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
