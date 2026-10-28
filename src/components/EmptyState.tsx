import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../lib/useTheme';
import { spacing, typography } from '../lib/theme';

export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle?: string;
}) {
  const { c } = useTheme();
  return (
    <View style={styles.wrap}>
      <Feather name={icon} size={32} color={c.textFaint} />
      <Text style={[typography.heading, { color: c.text, marginTop: spacing.md }]}>{title}</Text>
      {subtitle ? (
        <Text style={[typography.body, { color: c.textMuted, marginTop: spacing.xs, textAlign: 'center' }]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },
});
