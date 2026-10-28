import { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Dimensions, FlatList } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useTheme } from '../lib/useTheme';
import { spacing, typography, radius } from '../lib/theme';

const { width } = Dimensions.get('window');
const SEEN_KEY = 'bindle.onboarding.seen.v1';

const SLIDES: { icon: keyof typeof Feather.glyphMap; title: string; body: string }[] = [
  {
    icon: 'bookmark',
    title: 'Save anything',
    body: 'Drop in a link. Bindle keeps the full article, not just the URL.',
  },
  {
    icon: 'wifi-off',
    title: 'Read anywhere',
    body: 'Everything you save is cached on your phone — read it with no signal.',
  },
  {
    icon: 'server',
    title: 'Your server, your data',
    body: 'Bindle connects to a Wallabag server you run. Nothing is stored anywhere else.',
  },
];

export default function Onboarding() {
  const { c } = useTheme();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList>(null);

  const finish = async () => {
    await SecureStore.setItemAsync(SEEN_KEY, '1');
    router.replace('/connect');
  };

  const next = () => {
    if (index < SLIDES.length - 1) {
      listRef.current?.scrollToIndex({ index: index + 1 });
      setIndex(index + 1);
    } else {
      finish();
    }
  };

  return (
    <View style={[styles.wrap, { backgroundColor: c.background }]}>
      <Pressable onPress={finish} style={styles.skip} accessibilityLabel="Skip onboarding" testID="skip-onboarding">
        <Text style={[typography.caption, { color: c.textMuted }]}>Skip</Text>
      </Pressable>
      <FlatList
        ref={listRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
        keyExtractor={(s) => s.title}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            <View style={[styles.iconWrap, { backgroundColor: c.surfaceAlt }]}>
              <Feather name={item.icon} size={36} color={c.text} />
            </View>
            <Text style={[typography.title, { color: c.text, marginTop: spacing.xl, textAlign: 'center' }]}>
              {item.title}
            </Text>
            <Text
              style={[typography.body, { color: c.textMuted, marginTop: spacing.sm, textAlign: 'center' }]}
            >
              {item.body}
            </Text>
          </View>
        )}
      />
      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: i === index ? c.text : c.border, width: i === index ? 18 : 6 },
            ]}
          />
        ))}
      </View>
      <Pressable onPress={next} style={[styles.cta, { backgroundColor: c.accent }]}>
        <Text style={[typography.heading, { color: c.background }]}>
          {index === SLIDES.length - 1 ? 'Connect my server' : 'Next'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  skip: { alignSelf: 'flex-end', padding: spacing.lg, paddingTop: spacing.xxl },
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  dot: { height: 6, borderRadius: radius.pill },
  cta: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    paddingVertical: 16,
    borderRadius: radius.md,
    alignItems: 'center',
  },
});
