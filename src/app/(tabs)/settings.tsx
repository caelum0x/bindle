import { useEffect, useState } from 'react';
import { View, Text, Pressable, Switch, StyleSheet, Linking } from 'react-native';
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

export default function Settings() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const serverLabel = useAuthStore((s) => s.serverLabel);
  const signOut = useAuthStore((s) => s.signOut);

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
      <Text style={[typography.title, { color: c.text, paddingHorizontal: spacing.lg, marginTop: spacing.md }]}>
        Settings
      </Text>

      <Section title="Server">
        <Row icon="server" label={serverLabel ?? 'Not connected'} c={c} />
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

      <Section title="About">
        <Row
          icon="info"
          label="Bindle connects to self-hosted Wallabag (MIT-licensed) servers. Independent client, not affiliated with or endorsed by the Wallabag project."
          c={c}
          multiline
        />
        <Pressable
          onPress={() => Linking.openURL('https://github.com/wallabag/wallabag')}
          style={[styles.row, { borderColor: c.border }]}
        >
          <View style={styles.rowLeft}>
            <Feather name="external-link" size={18} color={c.textMuted} />
            <Text style={[typography.body, { color: c.text }]}>Wallabag project (MIT License)</Text>
          </View>
        </Pressable>
      </Section>

      <Pressable onPress={onSignOut} style={[styles.signOut, { borderColor: c.border }]}>
        <Feather name="log-out" size={18} color={c.danger} />
        <Text style={[typography.body, { color: c.danger }]}>Disconnect server</Text>
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
