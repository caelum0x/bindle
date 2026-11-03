import type { WallabagClient } from './api/wallabagClient';
import type { EntryFilter, WallabagEntry, WallabagTag } from './api/types';
import {
  getCachedEntries,
  getCachedEntry,
  getCachedTags,
  queuePendingAction,
  removeCachedEntry,
  searchCachedEntries,
  updateCachedFlags,
  upsertEntries,
  getPendingActions,
  clearPendingAction,
} from './db/database';
import { matchesQuery } from './search';

export type EntriesResult = {
  items: WallabagEntry[];
  fromCache: boolean;
};

export type TagsResult = {
  items: WallabagTag[];
  fromCache: boolean;
};

/** List entries, preferring live data but always falling back to the local SQLite
 * cache when the network/server is unreachable — the core "works offline" promise.
 * `tag` (a tag label or slug) narrows the list to entries carrying that tag, same as
 * the Unread/Starred/Archived filters, and composes with them. */
export async function listEntries(
  client: WallabagClient,
  filter: EntryFilter,
  tag?: string
): Promise<EntriesResult> {
  try {
    const page = await client.fetchEntries({ filter, perPage: 50, tag });
    await upsertEntries(page.items);
    return { items: page.items, fromCache: false };
  } catch (err) {
    const cached = await getCachedEntries(filter, tag);
    if (cached.length > 0) {
      return { items: cached, fromCache: true };
    }
    throw err;
  }
}

/** Lists every tag in the account, preferring the live server list but falling back
 * to tags derived from whatever is cached offline. */
export async function listTags(client: WallabagClient): Promise<TagsResult> {
  try {
    const tags = await client.fetchTags();
    return { items: tags, fromCache: false };
  } catch (err) {
    const cached = await getCachedTags();
    if (cached.length > 0) {
      return { items: cached, fromCache: true };
    }
    throw err;
  }
}

const SEARCH_MAX_PAGES = 6; // 6 * 100 = up to 600 entries walked per live search

/** Full-text search across the account's saved articles — titles and article
 * bodies, across every status (unread/archived/starred), not just whatever
 * filter the Entries tab currently has selected.
 *
 * Wallabag's REST API has no free-text search parameter (see the header comment
 * in `./search.ts` for the confirmed server contract), so when online this walks
 * `/api/entries` page by page (filter "all", `perPage=100`, up to
 * `SEARCH_MAX_PAGES` pages) and matches each page's entries client-side via
 * `matchesQuery`. Every page touched is written through to the local cache
 * (`upsertEntries`) exactly like `listEntries` does, so later offline searches
 * can still find it. If the server can't be reached at all, falls back to
 * `searchCachedEntries`. If it's reached for at least one page but a later page
 * fails mid-walk (e.g. the connection drops), the matches found so far are
 * returned rather than discarded — a partial live result is more useful than an
 * error for a search. */
export async function searchEntries(client: WallabagClient, query: string): Promise<EntriesResult> {
  const q = query.trim();
  if (!q) return { items: [], fromCache: false };

  const matches: WallabagEntry[] = [];
  let page = 1;
  let totalPages = 1;
  let reachedServer = false;

  while (page <= totalPages && page <= SEARCH_MAX_PAGES) {
    let result;
    try {
      result = await client.fetchEntries({ filter: 'all', perPage: 100, page });
    } catch {
      break; // offline / server unreachable partway through — use what we have
    }
    reachedServer = true;
    await upsertEntries(result.items);
    for (const item of result.items) {
      if (matchesQuery(item, q)) matches.push(item);
    }
    totalPages = result.pages || 1;
    page += 1;
  }

  if (reachedServer) {
    return { items: matches, fromCache: false };
  }

  const cached = await searchCachedEntries(q);
  return { items: cached, fromCache: true };
}

/** Adds a tag (by free-text label, server creates it if new) to an entry and
 * refreshes the local cache with the server's authoritative, updated entry. */
export async function addTagToEntry(
  client: WallabagClient,
  entry: WallabagEntry,
  label: string
): Promise<WallabagEntry> {
  const updated = await client.addTagsToEntry(entry.id, label);
  await upsertEntries([updated]);
  return updated;
}

export async function removeTagFromEntry(
  client: WallabagClient,
  entry: WallabagEntry,
  tagId: number
): Promise<WallabagEntry> {
  const updated = await client.removeTagFromEntry(entry.id, tagId);
  await upsertEntries([updated]);
  return updated;
}

/** Load a single entry's full content, preferring live data (content is only ever
 * sent in full by the server) but falling back to whatever was cached earlier. */
export async function loadEntry(
  client: WallabagClient,
  id: number
): Promise<{ entry: WallabagEntry; fromCache: boolean }> {
  try {
    const entry = await client.fetchEntry(id);
    await upsertEntries([entry]);
    return { entry, fromCache: false };
  } catch (err) {
    const cached = await getCachedEntry(id);
    if (cached) return { entry: cached, fromCache: true };
    throw err;
  }
}

/** Saves a URL to Wallabag. Used by both the main app's Add screen (paste-a-URL
 * flow) and the iOS share extension (`src/ShareExtension.tsx`) — the exact same
 * function, not a duplicated save path, since it's the real authoritative save
 * logic this app already relies on.
 *
 * The local-cache write is best-effort and intentionally does not fail the save:
 * the server already has the entry once `client.saveEntry` resolves, so a cache
 * write that throws afterward (e.g. a sandbox the share extension process can't
 * fully write to, or any other local-storage hiccup) must not be reported to the
 * caller as "the save failed" — that would risk the user retrying and creating a
 * duplicate server-side entry for something that already saved correctly. */
export async function saveLink(client: WallabagClient, url: string): Promise<WallabagEntry> {
  const entry = await client.saveEntry(url);
  try {
    await upsertEntries([entry]);
  } catch {
    // Server save already succeeded; a failed local cache write is not a save failure.
  }
  return entry;
}

/** Optimistically flips a flag locally, then tries the server. If the server call
 * fails (offline), the change is queued and will be replayed by `flushPendingActions`. */
export async function toggleArchive(
  client: WallabagClient,
  entry: WallabagEntry
): Promise<void> {
  const next: 0 | 1 = entry.is_archived ? 0 : 1;
  await updateCachedFlags(entry.id, { is_archived: next });
  try {
    await client.patchEntry(entry.id, { archive: next });
  } catch {
    await queuePendingAction(entry.id, 'archive', next);
  }
}

export async function toggleStar(client: WallabagClient, entry: WallabagEntry): Promise<void> {
  const next: 0 | 1 = entry.is_starred ? 0 : 1;
  await updateCachedFlags(entry.id, { is_starred: next });
  try {
    await client.patchEntry(entry.id, { starred: next });
  } catch {
    await queuePendingAction(entry.id, 'starred', next);
  }
}

/** Deletes an article from the server first, only clearing the local cache once the
 * server confirms it's gone. A failed/offline delete must leave the cached copy intact
 * — otherwise it would silently wipe the user's only offline copy of an article the
 * server never actually deleted. */
export async function removeEntry(client: WallabagClient, id: number): Promise<void> {
  await client.deleteEntry(id);
  await removeCachedEntry(id);
}

/** Replays any archive/star changes made while offline. Call this on app foreground
 * and after a successful list refresh. */
export async function flushPendingActions(client: WallabagClient): Promise<number> {
  const pending = await getPendingActions();
  let replayed = 0;
  for (const action of pending) {
    try {
      if (action.action === 'archive') {
        await client.patchEntry(action.entry_id, { archive: action.value });
      } else {
        await client.patchEntry(action.entry_id, { starred: action.value });
      }
      await clearPendingAction(action.id);
      replayed += 1;
    } catch {
      // Still offline or server rejected it — leave queued, try again next time.
      break;
    }
  }
  return replayed;
}
