/**
 * Freemium limits — pure, no React/Expo/RevenueCat imports — so they are
 * unit-testable and shared by the Import screen, the entry detail Export
 * action, and the paywall. Free accounts get a fully usable Bindle account;
 * Premium removes two real ceilings:
 *
 *   - Bulk import: free accounts can submit up to FREE_MAX_BULK_IMPORT links
 *     per Import-screen batch; Premium submits the whole paste in one request.
 *   - Export formats: free accounts can export plain text; the formatted
 *     HTML export is Premium.
 */
import type { EntryExportFormat } from '../lib/api/types';

/** Max links a free account may submit in one Import-screen batch. */
export const FREE_MAX_BULK_IMPORT = 10;

/** Export formats gated behind Premium (plain text stays free). */
const PREMIUM_EXPORT_FORMATS: readonly EntryExportFormat[] = ['html'];

/** Is this export format gated behind Premium? */
export const isExportFormatPremium = (format: EntryExportFormat): boolean =>
  PREMIUM_EXPORT_FORMATS.includes(format);

/** May this account use the given export format? */
export const canUseExportFormat = (format: EntryExportFormat, isPremium: boolean): boolean =>
  isPremium || !isExportFormatPremium(format);

export interface BulkImportClamp {
  /** The URLs that may actually be submitted this batch. */
  allowed: string[];
  /** How many of the original list were cut by the free limit (0 for Premium). */
  overflow: number;
}

/** How many of `urls` a free account may actually submit, and how many were cut. */
export function clampBulkImport(urls: readonly string[], isPremium: boolean): BulkImportClamp {
  if (isPremium || urls.length <= FREE_MAX_BULK_IMPORT) {
    return { allowed: [...urls], overflow: 0 };
  }
  return {
    allowed: urls.slice(0, FREE_MAX_BULK_IMPORT),
    overflow: urls.length - FREE_MAX_BULK_IMPORT,
  };
}
