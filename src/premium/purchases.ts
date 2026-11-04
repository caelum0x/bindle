/**
 * Premium purchases via RevenueCat (react-native-purchases). RevenueCat is
 * the source of truth for the "premium" entitlement; this module is a thin
 * device-side adapter:
 *
 *   configure/logIn → getOfferings → paywall plans; purchasePackage;
 *   restorePurchases; read the "premium" entitlement off CustomerInfo.
 *
 * The native module only exists in a dev/native build (NOT Expo Go), so it is
 * loaded dynamically and any failure degrades to the free state instead of
 * crashing. A missing/`test_…` API key (or Expo Go) => free mode; a `test_`
 * key is honored only in __DEV__ (RC's sandbox Test Store) so a store build
 * never ships a broken paywall. The whole module is a clean NO-OP when
 * unconfigured.
 *
 * Store setup: create the auto-renewable subscriptions (PRODUCT_IDS) in App
 * Store Connect + Google Play, wire them to a RevenueCat "premium"
 * entitlement and a current Offering, then set the EXPO_PUBLIC_REVENUECAT_*
 * env below (see .env.example) before a native build (RevenueCat autolinks —
 * no config plugin needed).
 */
import { Platform } from 'react-native';
import {
  FREE_ENTITLEMENT,
  buildPlansResult,
  findPackageForPlan,
  resolveEntitlement,
  type EntitlementSnapshot,
  type PlanLabel,
  type PlansResult,
  type PremiumPlan,
} from './entitlement';

export type { EntitlementSnapshot, PlanInfo, PlansResult, PremiumPlan } from './entitlement';

/** RevenueCat entitlement identifier — the "Premium" gate in the RC dashboard. */
export const ENTITLEMENT_ID = (process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID || 'premium').trim();

/** Store product ids — overridable via env; must match the store + RC offering. */
export const PRODUCT_IDS: Record<PremiumPlan, string> = {
  monthly: (process.env.EXPO_PUBLIC_REVENUECAT_MONTHLY_PRODUCT_ID || 'bindle_pro_monthly').trim(),
  yearly: (process.env.EXPO_PUBLIC_REVENUECAT_YEARLY_PRODUCT_ID || 'bindle_pro_yearly').trim(),
};

// Plan labels only. Prices are never written in code: the paywall shows the
// store's own localized priceString or no plan at all.
const PLAN_LABELS: Record<PremiumPlan, PlanLabel> = {
  monthly: { title: 'Monthly', period: 'month' },
  yearly: { title: 'Yearly', period: 'year' },
};

/** Where the user manages or cancels the subscription (App Store review 3.1.2). */
export const manageSubscriptionUrl = (): string =>
  Platform.OS === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';

// --- API key (dev-safe) ------------------------------------------------------
const apiKeyForPlatform = (): string => {
  if (Platform.OS === 'ios') return (process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY || '').trim();
  if (Platform.OS === 'android') return (process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY || '').trim();
  return '';
};

// A RevenueCat "test store" key (test_…) only works with RC's sandbox Test
// Store; shipping it in a store build makes every offerings/purchase call fail.
// Treat a test_/empty key as "not configured" in production so the app runs in
// free mode instead of crashing. Test keys are still honored in dev.
const isUsableKey = (key: string): boolean => key.length > 0 && (__DEV__ || !key.startsWith('test_'));

const isSupported = (): boolean => Platform.OS === 'ios' || Platform.OS === 'android';

/** True only when RevenueCat is supported AND a usable API key is present. */
export const isRevenueCatAvailable = (): boolean => isSupported() && isUsableKey(apiKeyForPlatform());

// --- SDK loader --------------------------------------------------------------
type PurchasesModule = typeof import('react-native-purchases');
type PurchasesSdk = PurchasesModule['default'];
let configured = false;

/**
 * Lazy-load + configure the RevenueCat SDK. Returns null (free mode) when RC
 * is unavailable (Expo Go, unsupported platform, or missing/test key) so
 * every caller degrades gracefully rather than throwing on a raw native error.
 */
const loadPurchases = async (): Promise<PurchasesSdk | null> => {
  if (!isRevenueCatAvailable()) return null;
  let mod: PurchasesModule;
  try {
    mod = await import('react-native-purchases');
  } catch {
    return null; // no native build (Expo Go)
  }
  const Purchases = mod.default;
  if (!configured) {
    try {
      Purchases.configure({ apiKey: apiKeyForPlatform() });
      configured = true;
    } catch {
      return null;
    }
  }
  return Purchases;
};

/** Configure RevenueCat at startup (before any server account is connected). No-op in free mode. */
export async function configureRevenueCat(): Promise<void> {
  await loadPurchases();
}

/**
 * Tie the RevenueCat identity to the connected Wallabag account (see
 * `premium-context.tsx`'s `identityFor`) so the entitlement follows that
 * account across reinstalls/devices via Restore Purchases. No-op in free
 * mode. Call on connect.
 */
export async function loginRevenueCat(identity: string): Promise<void> {
  const Purchases = await loadPurchases();
  if (!Purchases || !identity) return;
  try {
    await Purchases.logIn(identity);
  } catch {
    // Non-fatal: entitlement still resolves against the anonymous id.
  }
}

/** Drop the RevenueCat identity on disconnect. No-op in free mode. */
export async function logoutRevenueCat(): Promise<void> {
  const Purchases = await loadPurchases();
  if (!Purchases) return;
  try {
    await Purchases.logOut();
  } catch {
    // ignore
  }
}

/** Read the current Premium entitlement from RevenueCat (free when unavailable). */
export async function getEntitlement(): Promise<EntitlementSnapshot> {
  const Purchases = await loadPurchases();
  if (!Purchases) return FREE_ENTITLEMENT;
  try {
    return resolveEntitlement(await Purchases.getCustomerInfo(), ENTITLEMENT_ID);
  } catch {
    return FREE_ENTITLEMENT;
  }
}

/** Convenience: is the current customer premium right now? */
export async function isPremium(): Promise<boolean> {
  return (await getEntitlement()).isActive;
}

/**
 * Plans the store returned, each with its store-localized price. Never
 * throws: a missing/failed SDK or a failed `getOfferings()` call both
 * degrade to `{ plans: [], failed: true }` — the same "clean NO-OP" instinct
 * this module uses for missing config, extended to any fetch failure, so the
 * paywall can always render a quiet "temporarily unavailable" state instead
 * of a raw error (see app/paywall.tsx).
 */
export async function fetchPlans(): Promise<PlansResult> {
  const opts = { productIds: PRODUCT_IDS, labels: PLAN_LABELS };
  const Purchases = await loadPurchases();
  if (!Purchases) return buildPlansResult(null, false, opts); // free mode by design, not a failure
  try {
    const offering = (await Purchases.getOfferings()).current;
    return buildPlansResult(offering, false, opts);
  } catch {
    return buildPlansResult(null, true, opts); // store unreachable: the paywall degrades quietly
  }
}

/**
 * Run a subscription purchase and resolve with the resulting entitlement. The
 * actual charge (Apple/Google payment sheet) can only complete on a real
 * device / native build; in Expo Go this throws a friendly message.
 */
export async function purchasePremium(plan: PremiumPlan): Promise<EntitlementSnapshot> {
  const Purchases = await loadPurchases();
  if (!Purchases) throw new Error('Purchases require the native build of the app.');
  const offering = (await Purchases.getOfferings()).current;
  const pkg = findPackageForPlan(offering?.availablePackages ?? [], PRODUCT_IDS[plan]);
  if (!pkg) throw new Error('That subscription is not available in the store right now.');
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return resolveEntitlement(customerInfo, ENTITLEMENT_ID);
}

/** Restore prior purchases (e.g. after reinstall); resolves with the entitlement. */
export async function restorePurchases(): Promise<EntitlementSnapshot> {
  const Purchases = await loadPurchases();
  if (!Purchases) throw new Error('Restore requires the native build of the app.');
  return resolveEntitlement(await Purchases.restorePurchases(), ENTITLEMENT_ID);
}
