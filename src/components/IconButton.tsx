import { Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../lib/useTheme';
import { radius } from '../lib/theme';

type Props = {
  name: keyof typeof Feather.glyphMap;
  onPress?: () => void;
  size?: number;
  active?: boolean;
  danger?: boolean;
  accessibilityLabel: string;
  testID?: string;
};

export function IconButton({
  name,
  onPress,
  size = 20,
  active,
  danger,
  accessibilityLabel,
  testID,
}: Props) {
  const { c } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.hit,
        { backgroundColor: pressed ? c.overlay : 'transparent', borderRadius: radius.pill },
      ]}
    >
      <Feather
        name={name}
        size={size}
        color={danger ? c.danger : active ? c.accent : c.textMuted}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
