// List sort order — the other real competitive gap flagged alongside reader
// customization in the 2026-11-06 commercial-readiness audit (plans/bindle.md:
// "Pocket lets you sort oldest-first/shortest-first/longest-first; Bindle only
// has the four status filter chips, no sort.").
//
// Purely client-side: `bindleClient.fetchEntries` has no server-side sort
// param, and both the live endpoint and the offline SQLite cache
// (`db/database.ts`'s `getCachedEntries`/`searchCachedEntries`) already return
// rows `ORDER BY created_at DESC`, so "newest" is the existing implicit
// default, not a new behavior — "oldest" and "shortest" are the two real new
// orderings this file adds.

import type { Entry } from './api/types';

export type EntrySort = 'newest' | 'oldest' | 'shortest';

export const SORT_LABELS: Record<EntrySort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  shortest: 'Shortest first',
};

export const SORT_ORDER: EntrySort[] = ['newest', 'oldest', 'shortest'];

/** Estimated reading time in minutes for one entry. Prefers the server's own
 * `reading_time` (bindle-core always populates `readingMins` on extraction);
 * falls back to a rough words/200 estimate from whatever article content is
 * locally available for the rare row that doesn't carry it. Exported so
 * `EntryCard` (display) and `sortEntries` (shortest-first ordering) share one
 * definition rather than drifting apart. */
export function estimateReadingMinutes(entry: Entry): number {
  if (entry.reading_time && entry.reading_time > 0) return entry.reading_time;
  const words = (entry.content ?? '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** Returns a new, sorted array — never mutates `items` (immutable-update
 * convention used throughout this codebase). */
export function sortEntries(items: Entry[], sort: EntrySort): Entry[] {
  const copy = [...items];
  if (sort === 'oldest') {
    return copy.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }
  if (sort === 'shortest') {
    return copy.sort((a, b) => estimateReadingMinutes(a) - estimateReadingMinutes(b));
  }
  return copy.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}
