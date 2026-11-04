/**
 * Pure RevenueCat mapping logic — no `react-native-purchases` import, no
 * platform APIs — so it stays trivially unit-testable and isomorphic. The
 * app-level service (src/premium/purchases.ts) drives the real SDK and hands
 * the resulting CustomerInfo / Offering objects to these helpers.
 *
 * The port interfaces below are structural subsets of the SDK's own types, so
 * real SDK objects satisfy them without importing the native module.
 */

export interface RcEntitlementInfo {
  readonly identifier: string;
  readonly isActive: boolean;
  readonly willRenew: boolean;
  readonly expirationDate: string | null;
  readonly productIdentifier: string;
}

export interface RcCustomerInfo {
  readonly entitlements: { readonly active: Readonly<Record<string, RcEntitlementInfo>> };
  readonly managementURL?: string | null;
}

export interface RcStoreProduct {
  readonly identifier: string;
  readonly priceString: string;
}

export interface RcPackage {
  readonly identifier: string;
  readonly product: RcStoreProduct;
}

export interface RcOffering {
  readonly availablePackages: readonly RcPackage[];
}

/** Device-side view of the user's Premium entitlement, derived from RC. */
export interface EntitlementSnapshot {
  isActive: boolean;
  productId: string | null;
  expiresAt: string | null;
  willRenew: boolean;
  managementUrl: string | null;
}

/** The "no Premium" snapshot. */
export const FREE_ENTITLEMENT: EntitlementSnapshot = {
  isActive: false,
  productId: null,
  expiresAt: null,
  willRenew: false,
  managementUrl: null,
};

/**
 * Read the configured Premium entitlement out of an RC CustomerInfo. Active
 * means the entitlement id is present in `entitlements.active` AND flagged
 * `isActive` (RC keeps a subscription in `active` through a grace period).
 */
export function resolveEntitlement(
  customerInfo: RcCustomerInfo,
  entitlementId: string
): EntitlementSnapshot {
  const managementUrl = customerInfo.managementURL ?? null;
  const ent = customerInfo.entitlements.active[entitlementId];
  if (!ent || !ent.isActive) {
    return { ...FREE_ENTITLEMENT, managementUrl };
  }
  return {
    isActive: true,
    productId: ent.productIdentifier || null,
    expiresAt: ent.expirationDate ?? null,
    willRenew: Boolean(ent.willRenew),
    managementUrl,
  };
}

export type PremiumPlan = 'monthly' | 'yearly';

export interface PlanInfo {
  plan: PremiumPlan;
  productId: string;
  title: string;
  /** The store-localized `priceString` from RevenueCat. Never a constant. */
  price: string;
  period: string;
  badge?: string;
}

/** Display labels for a plan. Deliberately has no price: prices come only from the store. */
export interface PlanLabel {
  title: string;
  period: string;
  badge?: string;
}

/** Display order on the paywall (yearly first — the better value). */
export const PLAN_ORDER: readonly PremiumPlan[] = ['yearly', 'monthly'];

/**
 * A store product id can come back suffixed with the Android base-plan id
 * (`bindle_pro_yearly:p1y`), so match on an exact id or that `<id>:` prefix.
 */
const productMatches = (actual: string, expected: string): boolean =>
  actual === expected || actual.startsWith(`${expected}:`);

/**
 * Build the paywall rows from the store offering. Only plans whose product
 * the store actually returned are listed, each with the store-localized
 * `priceString`. With no offering (store unreachable, Expo Go) the list is
 * empty and the paywall says so: a price is never invented in code.
 */
export function mapOfferingToPlans(
  offering: RcOffering | null,
  opts: { productIds: Record<PremiumPlan, string>; labels: Record<PremiumPlan, PlanLabel> }
): PlanInfo[] {
  const packages = offering?.availablePackages ?? [];
  const plans: PlanInfo[] = [];
  for (const plan of PLAN_ORDER) {
    const productId = opts.productIds[plan];
    const match = packages.find((p) => productMatches(p.product.identifier, productId));
    const price = match?.product.priceString.trim() ?? '';
    if (!match || price.length === 0) continue;
    const label = opts.labels[plan];
    plans.push({
      plan,
      productId,
      title: label.title,
      price,
      period: label.period,
      ...(label.badge ? { badge: label.badge } : {}),
    });
  }
  return plans;
}

/** Find the RC package to purchase for a plan's product id (null when absent). */
export function findPackageForPlan<P extends RcPackage>(
  packages: readonly P[],
  productId: string
): P | null {
  return packages.find((p) => productMatches(p.product.identifier, productId)) ?? null;
}

/** The paywall's plans-fetch outcome: what to render, never a raw error. */
export interface PlansResult {
  plans: PlanInfo[];
  /**
   * True when the store fetch itself failed (network, SDK, or RC
   * configuration error) rather than cleanly resolving to zero matching
   * packages. The UI must treat this exactly like the empty-plans case — a
   * quiet "temporarily unavailable, try again" state, never the raw
   * underlying error — this flag exists only so a caller can log/observe the
   * distinction without ever surfacing it to the user.
   */
  failed: boolean;
}

/**
 * Build the paywall's plans-fetch result from either a resolved offering or a
 * caught fetch failure. Centralizes the "never show a raw error" rule so the
 * untestable I/O edge (src/premium/purchases.ts) only has to report whether
 * its fetch succeeded or failed; this pure function decides what the UI gets.
 */
export function buildPlansResult(
  offering: RcOffering | null,
  failed: boolean,
  opts: { productIds: Record<PremiumPlan, string>; labels: Record<PremiumPlan, PlanLabel> }
): PlansResult {
  return { plans: mapOfferingToPlans(offering, opts), failed };
}
