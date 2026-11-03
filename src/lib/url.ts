// Shared URL-detection helpers used by both the main app's Add screen (paste-a-URL
// flow) and the iOS share extension (`src/ShareExtension.tsx`) — one implementation,
// so "does this look like a saveable link" never drifts between the two entry points.

const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;

/** True if the whole trimmed string looks like a web link (what the Add screen uses
 * to decide whether to enable its Save button). */
export function looksLikeUrl(value: string): boolean {
  return /^https?:\/\/\S+\.\S+/i.test(value.trim());
}

/** Finds the first http(s) URL anywhere inside arbitrary shared text — e.g. a Safari
 * share (`url` field, already a clean link) or a share from an app that only exposes
 * `text` (a WhatsApp message, a tweet, a note with a link pasted inside a sentence). */
export function extractFirstUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (looksLikeUrl(trimmed)) return trimmed;
  const match = trimmed.match(URL_PATTERN);
  return match ? match[0] : null;
}
