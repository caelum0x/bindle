import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { BindleClient } from './api/bindleClient';
import type { BulkSaveResult, EntryExportFormat, EntryFilter, Entry, Tag } from './api/types';
import {
  getCachedEntries,
  getCachedEntry,
  getCachedTags,
  queuePendingAction,
  removeCachedEntry,
  removeCachedTag,
  searchCachedEntries,
  updateCachedFlags,
  upsertEntries,
  getPendingActions,
  clearPendingAction,
} from './db/database';
import { matchesQuery } from './search';
import { drainPendingShareSaves } from './sync/pendingShareSaves';

export type EntriesResult = {
  items: Entry[];
  fromCache: boolean;
};

export type TagsResult = {
  items: Tag[];
  fromCache: boolean;
};

/** Merges whatever the iOS Share Extension has queued since the last drain
 * (see `sync/pendingShareSaves.ts` for the full root-cause writeup) into the
 * real offline cache, so an entry saved from the share sheet shows up in the
 * cache even if the main app never gets a chance to re-fetch it live before
 * going offline. A plain no-op when nothing is queued — safe to call on
 * every list load and every app foreground. */
export async function syncPendingShareSaves(): Promise<number> {
  const pending = await drainPendingShareSaves();
  if (pending.length === 0) return 0;
  await upsertEntries(pending);
  return pending.length;
}

/** List entries, preferring live data but always falling back to the local SQLite
 * cache when the network/server is unreachable — the core "works offline" promise.
 * `tag` (a tag label or slug) narrows the list to entries carrying that tag, same as
 * the Unread/Starred/Archived filters, and composes with them. */
export async function listEntries(
  client: BindleClient,
  filter: EntryFilter,
  tag?: string
): Promise<EntriesResult> {
  await syncPendingShareSaves().catch(() => {});
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
export async function listTags(client: BindleClient): Promise<TagsResult> {
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

const SEARCH_MAX_PAGES = 6; // 6 * 100 = up to 600 entries walked per live search fallback

/** Full-text search across the account's saved articles — titles and article
 * bodies, across every status (unread/archived/starred), not just whatever
 * filter the Entries tab currently has selected.
 *
 * Tries the server's real search endpoint first (`GET /api/search` —
 * `SearchRestController::getSearchAction`, confirmed against current upstream
 * source; matches title/content/url/annotations server-side). Every page
 * touched is written through to the local cache (`upsertEntries`) exactly like
 * `listEntries` does. If that endpoint itself fails (older server without it,
 * a transient 5xx, etc.) this falls back to the previous client-side walk of
 * `/api/entries` (filter "all", `perPage=100`, up to `SEARCH_MAX_PAGES` pages)
 * matched via `matchesQuery`, so a working search never regresses just because
 * one endpoint had a bad day. If nothing can be reached at all, falls back to
 * `searchCachedEntries`. */
export async function searchEntries(client: BindleClient, query: string): Promise<EntriesResult> {
  const q = query.trim();
  if (!q) return { items: [], fromCache: false };

  try {
    const matches: Entry[] = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages && page <= SEARCH_MAX_PAGES) {
      const result = await client.searchEntriesServer(q, page, 100);
      await upsertEntries(result.items);
      matches.push(...result.items);
      totalPages = result.pages || 1;
      page += 1;
    }
    return { items: matches, fromCache: false };
  } catch {
    // Server search unavailable — fall through to the page-walk below.
  }

  const matches: Entry[] = [];
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
  client: BindleClient,
  entry: Entry,
  label: string
): Promise<Entry> {
  const updated = await client.addTagsToEntry(entry.id, label);
  await upsertEntries([updated]);
  return updated;
}

export async function removeTagFromEntry(
  client: BindleClient,
  entry: Entry,
  tagId: string
): Promise<Entry> {
  const updated = await client.removeTagFromEntry(entry.id, tagId);
  await upsertEntries([updated]);
  return updated;
}

/** Load a single entry's full content, preferring live data (content is only ever
 * sent in full by the server) but falling back to whatever was cached earlier. */
export async function loadEntry(
  client: BindleClient,
  id: string
): Promise<{ entry: Entry; fromCache: boolean }> {
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

/** Saves a URL to Bindle's own account. Used by both the main app's Add screen (paste-a-URL
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
export async function saveLink(client: BindleClient, url: string): Promise<Entry> {
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
  client: BindleClient,
  entry: Entry
): Promise<void> {
  const next: 0 | 1 = entry.is_archived ? 0 : 1;
  await updateCachedFlags(entry.id, { is_archived: next });
  try {
    await client.patchEntry(entry.id, { archive: next });
  } catch {
    await queuePendingAction(entry.id, 'archive', next);
  }
}

export async function toggleStar(client: BindleClient, entry: Entry): Promise<void> {
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
export async function removeEntry(client: BindleClient, id: string): Promise<void> {
  await client.deleteEntry(id);
  await removeCachedEntry(id);
}

/** Replays any archive/star changes made while offline. Call this on app foreground
 * and after a successful list refresh. */
export async function flushPendingActions(client: BindleClient): Promise<number> {
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

/** Re-fetches an entry's content from its original source URL (fixes a
 * mis-parsed article without having to delete and re-save it). Bindle's own
 * backend always re-runs extraction and returns the updated article, so this
 * either succeeds or throws — there is no "nothing changed" case to report. */
export async function reloadEntryContent(
  client: BindleClient,
  id: string
): Promise<{ entry: Entry | null; refreshed: boolean }> {
  const entry = await client.reloadEntry(id);
  await upsertEntries([entry]);
  return { entry, refreshed: true };
}

/** Checks whether a URL is already saved, so the Add screen can point the user
 * at the existing copy instead of letting them create a duplicate. Online-only
 * by design — an offline cache can't tell whether *today's* current server
 * state has the URL, so a failure here should be treated as "unknown", not
 * "not saved". */
export async function checkUrlAlreadySaved(client: BindleClient, url: string): Promise<boolean> {
  return client.checkEntryExists(url);
}

function sanitizeFilename(title: string): string {
  const trimmed = title.trim() || 'article';
  return trimmed.replace(/[^a-zA-Z0-9-_ ]/g, '').slice(0, 80).trim() || 'article';
}

/** Exports one entry as a real file (epub/pdf/txt/csv/xml, rendered by the
 * server, not a client-side conversion) and opens the native share sheet on
 * it. Writes to the app's cache directory since this is a disposable, re-
 * downloadable copy, not something Bindle needs to keep around. */
export async function exportEntryToFile(
  client: BindleClient,
  entry: Entry,
  format: EntryExportFormat
): Promise<void> {
  const { bytes, contentType } = await client.exportEntry(entry.id, format);
  const file = new File(Paths.cache, `${sanitizeFilename(entry.title)}.${format}`);
  file.create({ overwrite: true });
  await file.write(bytes);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { dialogTitle: entry.title, mimeType: contentType });
  }
}

/** Bulk-saves a newline-separated list of URLs in one request (the Import
 * screen's paste-many-links flow). Doesn't write through to the local cache
 * itself — the server already has every successfully-saved entry, and the
 * next `listEntries` call (the Entries tab is always one screen away) picks
 * them up through its normal `upsertEntries` write-through. */
export async function bulkSaveLinks(client: BindleClient, urls: string[]): Promise<BulkSaveResult[]> {
  return client.bulkSaveLinks(urls);
}

/** Permanently deletes a tag account-wide (every entry carrying it loses it),
 * then strips it from the local cache so the Tags screen and any cached
 * entries' tag chips stay consistent without needing a full re-sync. */
export async function deleteTagGlobally(client: BindleClient, tag: Tag): Promise<void> {
  await client.deleteTagGlobally(tag.id);
  await removeCachedTag(tag.id);
}
