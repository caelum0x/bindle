import type { WallabagClient } from './api/wallabagClient';
import type { EntryFilter, WallabagEntry } from './api/types';
import {
  getCachedEntries,
  getCachedEntry,
  queuePendingAction,
  removeCachedEntry,
  updateCachedFlags,
  upsertEntries,
  getPendingActions,
  clearPendingAction,
} from './db/database';

export type EntriesResult = {
  items: WallabagEntry[];
  fromCache: boolean;
};

/** List entries, preferring live data but always falling back to the local SQLite
 * cache when the network/server is unreachable — the core "works offline" promise. */
export async function listEntries(
  client: WallabagClient,
  filter: EntryFilter
): Promise<EntriesResult> {
  try {
    const page = await client.fetchEntries({ filter, perPage: 50 });
    await upsertEntries(page.items);
    return { items: page.items, fromCache: false };
  } catch (err) {
    const cached = await getCachedEntries(filter);
    if (cached.length > 0) {
      return { items: cached, fromCache: true };
    }
    throw err;
  }
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

export async function saveLink(client: WallabagClient, url: string): Promise<WallabagEntry> {
  const entry = await client.saveEntry(url);
  await upsertEntries([entry]);
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

export async function removeEntry(client: WallabagClient, id: number): Promise<void> {
  await removeCachedEntry(id);
  await client.deleteEntry(id);
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
