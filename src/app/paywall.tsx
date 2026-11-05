/**
 * Bindle Premium. Shown to every free account right after the real value
 * moment — the first successful server connect (see `connect.tsx`) — and
 * reachable any time afterward from Settings. Plans and prices come only
 * from the store via RevenueCat (`priceString`); if the store returns
 * nothing, the screen says so and offers a retry rather than showing a price
 * written in code. Purchase -> RevenueCat entitlement ->
 * PremiumProvider.refresh(). Includes the auto-renew disclosure and restore
 * (App Store 3.1.2).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePremium } from '../premium/premium-context';
import {
  fetchPlans,
  purchasePremium,
  restorePurchases,
  type PlanInfo,
  type PremiumPlan,
} from '../premium/purchases';
import { FREE_MAX_BULK_IMPORT } from '../premium/limits';
import { useTheme } from '../lib/useTheme';
import { radius, spacing, typography } from '../lib/theme';

const BENEFITS: readonly { icon: React.ComponentProps<typeof Feather>['name']; text: string }[] = [
  { icon: 'upload', text: `Bulk-import any number of links at once (free stops at ${FREE_MAX_BULK_IMPORT})` },
  { icon: 'file-text', text: 'Export articles as formatted HTML, not just plain text' },
  { icon: 'heart', text: 'Fund ongoing development of an independent, ad-free client' },
];

// Only our own curated, user-safe messages are ever shown for a purchase or
// restore failure. Anything else — a raw native StoreKit/RevenueCat error
// string — degrades to the generic fallback below instead of reaching the
// screen verbatim.
const KNOWN_PURCHASE_ERRORS = new Set<string>([
  'Purchases require the native build of the app.',
  'That subscription is not available in the store right now.',
  'Restore requires the native build of the app.',
]);

const friendlyError = (e: unknown, fallback: string): string =>
  e instanceof Error && KNOWN_PURCHASE_ERRORS.has(e.message) ? e.message : fallback;

const DISCLOSURE =
  Platform.OS === 'ios'
    ? 'Bindle Premium is an auto-renewing subscription. Payment is charged to your App Store ' +
      'account at confirmation. It renews automatically unless cancelled at least 24 hours ' +
      'before the period ends. Manage or cancel anytime in your App Store account settings.'
    : 'Bindle Premium is an auto-renewing subscription. Payment is charged to your Google Play ' +
      'account at confirmation. It renews automatically unless cancelled at least 24 hours ' +
      'before the period ends. Manage or cancel anytime in your Google Play account settings.';

/**
 * A single, purposeful entrance for the paywall's content: a short fade +
 * settle-up as the native modal sheet finishes its own slide-up transition,
 * so the value moment (icon → title → benefits) reads as one deliberate
 * reveal rather than content just appearing mid-animation. Native driver
 * only (opacity/translateY), no extra dependency — `Animated` ships with
 * React Native itself.
 */
function useEnterAnimation(): { opacity: Animated.Value; transform: { translateY: Animated.AnimatedInterpolation<number> }[] } {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 360,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [progress]);
  return {
    opacity: progress,
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
  };
}

export default function PaywallScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const { isPremium, refresh } = usePremium();
  const [plans, setPlans] = useState<PlanInfo[] | null>(null);
  const [selected, setSelected] = useState<PremiumPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const enter = useEnterAnimation();

  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  const load = useCallback(() => {
    setPlans(null);
    void fetchPlans().then((result) => {
      if (!mounted.current) return;
      if (result.failed && __DEV__) {
        // Dev-only visibility into the fetch failure; the UI below always
        // shows the same quiet "temporarily unavailable" state either way.
        console.warn('[paywall] plans fetch failed, showing graceful fallback');
      }
      setPlans(result.plans);
      setSelected((cur) => cur ?? result.plans[0]?.plan ?? null);
    });
  }, []);

  useEffect(load, [load]);

  const buy = async (): Promise<void> => {
    if (!selected) return;
    setBusy(true);
    try {
      const snapshot = await purchasePremium(selected);
      await refresh();
      if (!mounted.current) return;
      if (snapshot.isActive) {
        Alert.alert('Premium is on', 'Unlimited bulk import and every export format are unlocked.');
        router.back();
      } else {
        Alert.alert('Premium', 'The purchase could not be verified. Try Restore purchases.');
      }
    } catch (e: unknown) {
      if (mounted.current) {
        Alert.alert('Premium', friendlyError(e, 'The purchase did not complete. Please try again.'));
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const restore = async (): Promise<void> => {
    setBusy(true);
    try {
      const snapshot = await restorePurchases();
      await refresh();
      if (!mounted.current) return;
      if (snapshot.isActive) {
        Alert.alert('Premium', 'Your subscription has been restored.');
        router.back();
      } else {
        Alert.alert('Restore', 'No purchases were found for this account.');
      }
    } catch (e: unknown) {
      if (mounted.current) {
        Alert.alert('Restore', friendlyError(e, 'Restore did not complete. Please try again.'));
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  if (isPremium) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <Animated.View style={{ alignItems: 'center', opacity: enter.opacity, transform: enter.transform }}>
          <View style={[styles.iconWrap, { backgroundColor: c.surfaceAlt }]}>
            <Feather name="check" size={32} color={c.text} />
          </View>
          <Text style={[typography.title, { color: c.text, marginTop: spacing.lg, textAlign: 'center' }]}>
            Premium is on
          </Text>
          <Text style={[typography.body, { color: c.textMuted, marginTop: spacing.xs, textAlign: 'center' }]}>
            Unlimited bulk import and every export format are unlocked.
          </Text>
          <Pressable
            testID="paywall-close"
            onPress={() => router.back()}
            accessibilityLabel="Close"
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.closeCircle,
              { borderColor: c.border, marginTop: spacing.xl, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Feather name="x" size={22} color={c.text} />
          </Pressable>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.md,
          paddingBottom: spacing.xxl,
          paddingHorizontal: spacing.lg,
        }}
      >
        <View style={styles.topRow}>
          <View style={{ width: 32 }} />
          <Pressable
            testID="paywall-dismiss"
            onPress={() => router.back()}
            accessibilityLabel="Close"
            accessibilityRole="button"
            hitSlop={12}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <Feather name="x" size={22} color={c.textMuted} />
          </Pressable>
        </View>

        <Animated.View style={{ opacity: enter.opacity, transform: enter.transform }}>
          <View style={[styles.iconWrap, { backgroundColor: c.surfaceAlt, alignSelf: 'center', marginTop: spacing.sm }]}>
            <Feather name="zap" size={32} color={c.text} />
          </View>
          <Text style={[typography.title, { color: c.text, marginTop: spacing.lg, textAlign: 'center' }]}>
            Bindle Premium
          </Text>
          <Text style={[typography.body, { color: c.textMuted, marginTop: spacing.xs, textAlign: 'center' }]}>
            Your bindle is connected. Premium removes the limits free accounts keep.
          </Text>

          <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
            {BENEFITS.map((b) => (
              <View key={b.text} style={styles.benefitRow}>
                <View style={[styles.benefitIcon, { backgroundColor: c.surfaceAlt }]}>
                  <Feather name={b.icon} size={16} color={c.text} />
                </View>
                <Text style={[typography.body, { color: c.text, flex: 1 }]}>{b.text}</Text>
              </View>
            ))}
          </View>

          {plans === null ? (
            <ActivityIndicator color={c.text} style={{ marginTop: spacing.xl }} />
          ) : plans.length === 0 ? (
            <View style={[styles.unavailable, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
              <View style={[styles.unavailableIcon, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Feather name="cloud-off" size={18} color={c.textMuted} />
              </View>
              <Text style={[typography.caption, { color: c.textMuted, textAlign: 'center', lineHeight: 18, marginTop: spacing.sm }]}>
                Premium plans are temporarily unavailable. Check your connection and try again.
              </Text>
              <Pressable
                testID="paywall-retry"
                onPress={load}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.retryButton,
                  { borderColor: c.border, backgroundColor: c.surface, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Feather name="refresh-cw" size={13} color={c.text} />
                <Text style={[typography.caption, { color: c.text, fontWeight: '700' }]}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ marginTop: spacing.xl, gap: spacing.sm }} accessibilityRole="radiogroup">
              {plans.map((p) => {
                const active = selected === p.plan;
                return (
                  <Pressable
                    key={p.plan}
                    testID={`paywall-plan-${p.plan}`}
                    onPress={() => setSelected(p.plan)}
                    style={({ pressed }) => [
                      styles.plan,
                      {
                        borderColor: active ? c.text : c.border,
                        backgroundColor: active ? c.surfaceAlt : c.surface,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={`${p.title}, ${p.price} per ${p.period}${p.badge ? `, ${p.badge}` : ''}`}
                  >
                    <View style={[styles.planTick, { backgroundColor: active ? c.text : c.border }]} />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                        <Text style={[typography.body, { color: c.text, fontWeight: '600' }]}>{p.title}</Text>
                        {p.badge ? (
                          <View style={[styles.planBadge, { backgroundColor: c.text }]}>
                            <Text style={[typography.tiny, { color: c.background }]}>{p.badge.toUpperCase()}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <Text style={[styles.planPrice, { color: c.text }]}>
                      {p.price}
                      <Text style={[typography.caption, { color: c.textMuted }]}> / {p.period}</Text>
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </Animated.View>

        <Pressable
          testID="paywall-subscribe"
          onPress={() => void buy()}
          disabled={busy || !selected || !plans?.length}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: busy || !selected || !plans?.length ? c.surfaceAlt : c.accent,
              marginTop: spacing.xl,
              opacity: pressed && !(busy || !selected || !plans?.length) ? 0.85 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={c.background} />
          ) : (
            <Text style={[typography.heading, { color: !selected || !plans?.length ? c.textFaint : c.background }]}>
              Subscribe
            </Text>
          )}
        </Pressable>

        <Pressable
          testID="paywall-restore"
          onPress={() => void restore()}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => ({ marginTop: spacing.md, opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={[typography.body, { color: c.text, fontWeight: '600', textAlign: 'center' }]}>
            Restore purchases
          </Text>
        </Pressable>

        <Text style={[typography.caption, { color: c.textFaint, marginTop: spacing.lg, lineHeight: 18 }]}>
          {DISCLOSURE}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconWrap: { width: 72, height: 72, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  closeCircle: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  benefitIcon: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  unavailable: {
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  unavailableIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
  },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  planTick: { width: 4, height: 28, borderRadius: radius.pill },
  planBadge: { borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  planPrice: { fontSize: 20, fontWeight: '700' },
  cta: { paddingVertical: 16, borderRadius: radius.md, alignItems: 'center' },
});
