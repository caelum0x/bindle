/**
 * Premium entitlement state, exposed to React. Configures RevenueCat once at
 * startup, ties the RC identity to the signed-in Bindle account whenever
 * `authStore`'s user changes, and refreshes the on-device "premium"
 * entitlement (RevenueCat is the source of truth). Everything degrades to
 * `isPremium: false` in Expo Go / when RC is not configured, so the app never
 * crashes on the native module.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuthStore } from '../lib/auth/authStore';
import {
  configureRevenueCat,
  getEntitlement,
  loginRevenueCat,
  logoutRevenueCat,
} from './purchases';

interface PremiumContextValue {
  /** True when the current customer has the active "premium" entitlement. */
  isPremium: boolean;
  /** True until the first entitlement read resolves. */
  loading: boolean;
  /** Re-read the entitlement from RevenueCat (call after a purchase/restore). */
  refresh: () => Promise<void>;
}

const PremiumContext = createContext<PremiumContextValue | null>(null);

/**
 * Stable RevenueCat identity for one signed-in Bindle account — ties the
 * "premium" entitlement to the account's own (stable, server-assigned) user
 * id, not the device, so Restore Purchases on a reinstall or a second device
 * recovers the same subscription as long as the same account signs back in.
 */
export function identityFor(userId: string): string {
  return `bindle:${userId}`;
}

export function PremiumProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const [isPremium, setIsPremium] = useState(false);
  const [loading, setLoading] = useState(true);
  const configuredOnce = useRef(false);
  const lastIdentity = useRef<string | null>(null);
  // Both effects below call `refresh()` independently (anonymous read at
  // mount, identity-linked read on every connect/disconnect) and they can
  // resolve out of order — e.g. the anonymous read's network round trip
  // lands AFTER a slower identity-linked read that already produced the real
  // answer. Without this guard, a stale anonymous resolution could overwrite
  // the correct linked result with `false`. Each `refresh()` call captures
  // the id current at its own start; only the call that is still the latest
  // one outstanding by the time it resolves is allowed to write state.
  const refreshId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++refreshId.current;
    try {
      const snapshot = await getEntitlement();
      if (id === refreshId.current) setIsPremium(snapshot.isActive);
    } finally {
      if (id === refreshId.current) setLoading(false);
    }
  }, []);

  // Configure RC once at startup and read the anonymous entitlement.
  useEffect(() => {
    let active = true;
    if (!configuredOnce.current) {
      configuredOnce.current = true;
      void configureRevenueCat()
        .then(() => (active ? refresh() : undefined))
        .catch(() => {
          if (active) setLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [refresh]);

  // Tie the RC identity to the connected account and refresh whenever it changes.
  useEffect(() => {
    if (status === 'checking') return;
    const identity = user ? identityFor(user.id) : null;
    if (identity === lastIdentity.current) return;
    lastIdentity.current = identity;

    // The entitlement answer currently held (from the anonymous read, or from
    // whichever account was linked before) no longer applies to this
    // identity — it's about to be re-derived against the new RC identity.
    // Flip back to `loading` so every consumer of `usePremium()` shows a
    // brief loading state here instead of either: (a) wrongly denying a real
    // subscriber access during the connect relink window (the stale value is
    // `false` while the real, linked answer is still in flight), or (b)
    // wrongly granting access for a moment right after disconnect (the stale
    // value is `true`, left over from the account that just disconnected,
    // until the logout's refresh actually lands).
    setLoading(true);

    if (identity) {
      void loginRevenueCat(identity)
        .then(refresh)
        .catch(() => setLoading(false));
    } else {
      void logoutRevenueCat()
        .then(refresh)
        .catch(() => setLoading(false));
    }
  }, [status, user, refresh]);

  const value = useMemo<PremiumContextValue>(
    () => ({ isPremium, loading, refresh }),
    [isPremium, loading, refresh]
  );

  return <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>;
}

export function usePremium(): PremiumContextValue {
  const ctx = useContext(PremiumContext);
  if (!ctx) throw new Error('usePremium must be used within a PremiumProvider');
  return ctx;
}
