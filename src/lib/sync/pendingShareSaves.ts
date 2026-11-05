import * as SecureStore from 'expo-secure-store';
import { KEYCHAIN_ACCESS_GROUP } from '../auth/sharedAuth';
import type { Entry } from '../api/types';

/**
 * Cross-process hand-off queue for entries saved by the iOS Share Extension.
 *
 * Root cause this closes (see plans/bindle.md, 2026-11-04 investigation):
 * `expo-sqlite`'s `defaultDatabaseDirectory` (`ios/SQLiteModule.swift`) resolves
 * to whichever process's OWN sandbox `documentDirectory` called it. The main
 * app and the Share Extension are separate processes/containers, so each
 * calling `SQLite.openDatabaseAsync('bindle-cache.db')` with no explicit
 * directory silently produces two different physical database files — a link
 * saved via the extension's best-effort `upsertEntries` call writes into a
 * cache file the main app never reads.
 *
 * This is Option A from that investigation: reuse the Keychain access group
 * already shared between both targets' entitlements
 * (`sharedAuth.ts`'s `KEYCHAIN_ACCESS_GROUP`). The extension appends a small
 * record here on every successful save; the main app drains (reads, merges
 * into its own real cache, clears) this queue whenever it gets a chance to
 * run — on every Entries list load and on every app foreground — closing the
 * staleness window with zero new native code (Option B, a real shared
 * App-Group SQLite file, is the bigger architectural fix if that's ever
 * worth the lift).
 *
 * Deliberately excludes `content` (the full article HTML, which can be large):
 * Keychain items have a low practical size ceiling, and this is meant as a
 * short-lived handoff queue for a handful of pending saves, not a general
 * store. The main app's next live fetch of the entry (already happening in
 * `listEntries`/`loadEntry`, since the extension's save is authoritative
 * against the live server) fills `content` in properly; the cached row works
 * fine without it in the meantime.
 */

export type PendingShareSave = Omit<Entry, 'content'>;

const PENDING_SHARE_SAVES_KEY = 'bindle.pendingShareSaves.v1';

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  accessGroup: KEYCHAIN_ACCESS_GROUP,
};

async function readPendingShareSaves(): Promise<PendingShareSave[]> {
  const raw = await SecureStore.getItemAsync(PENDING_SHARE_SAVES_KEY, SECURE_STORE_OPTIONS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingShareSave[]) : [];
  } catch {
    // Corrupt/unexpected payload — treat as empty rather than throwing, since
    // this queue must never block a real save from completing.
    return [];
  }
}

/** Called by the Share Extension right after a successful save (see
 * `ShareExtension.tsx`). Best-effort by design: the server already has the
 * entry by the time this runs, so a failure here must never be surfaced to
 * the user as a save failure — same contract `saveLink`'s own local-cache
 * write already follows. De-dupes by entry id so re-sharing the same link
 * before the main app has drained the queue doesn't pile up duplicates. */
export async function appendPendingShareSave(entry: Entry): Promise<void> {
  const { content, ...withoutContent } = entry;
  const existing = await readPendingShareSaves();
  const next = [...existing.filter((e) => e.id !== entry.id), withoutContent];
  await SecureStore.setItemAsync(PENDING_SHARE_SAVES_KEY, JSON.stringify(next), SECURE_STORE_OPTIONS);
}

/** Called by the main app to pull in whatever the Share Extension has queued
 * since the last drain and clear the queue. Returns the drained records
 * (an empty array when there's nothing queued) so the caller can decide
 * whether merging them is worth a UI refresh. Safe to call often/concurrently
 * from multiple call sites (list load, app foreground) — it's a plain
 * read-then-clear, and a drain racing with a concurrent `appendPendingShareSave`
 * only risks losing a save back to the extension's own next retry window, not
 * corrupting the queue. */
export async function drainPendingShareSaves(): Promise<PendingShareSave[]> {
  const pending = await readPendingShareSaves();
  if (pending.length === 0) return [];
  await SecureStore.deleteItemAsync(PENDING_SHARE_SAVES_KEY, SECURE_STORE_OPTIONS);
  return pending;
}
