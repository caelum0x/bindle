import * as SQLite from 'expo-sqlite';
import type { Annotation, Entry, EntryFilter, Tag } from '../api/types';

/** Deliberately the `*Sync` family throughout this file, not `*Async`.
 *
 * Root cause this avoids (see plans/bindle.md, 2026-11-05 SIGSEGV investigation,
 * upstream `expo/expo#52462`): on this toolchain (Xcode 26.0.1, iOS 26.0
 * simulator), every `expo-sqlite` `*Async` call's result is converted back to
 * a JS value via `expo-modules-jsi`'s `Task.immediate`, which on iOS 26 does
 * not honor the custom `JavaScriptActor` executor and runs on a Swift
 * concurrency pool thread instead of the JS thread — racing Hermes, which is
 * still running on the real JS thread, and corrupting the heap (SIGSEGV/SIGBUS
 * at a garbage address, confirmed reproduced 5/5 clean launches). The `Sync`
 * API family has no `AsyncFunction`/`Task` boundary — it runs synchronously on
 * the calling (JS) thread — so it cannot hit this race. Queries here are small
 * (local cache, LIMIT 200-300 rows), so the synchronous blocking cost is
 * negligible; this is the officially supported pre-async-API way these calls
 * worked for years. Revert to `*Async` once upstream ships a fix. */
let db: SQLite.SQLiteDatabase | null = null;

function getDb(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync('bindle-cache.db');
    db.execSync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        domain_name TEXT,
        content TEXT,
        is_archived INTEGER NOT NULL DEFAULT 0,
        is_starred INTEGER NOT NULL DEFAULT 0,
        reading_time INTEGER,
        created_at TEXT,
        updated_at TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        cached_at INTEGER NOT NULL,
        read_progress REAL NOT NULL DEFAULT 0,
        last_read_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS pending_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id TEXT NOT NULL,
        action TEXT NOT NULL,
        value INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS annotations (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        quote TEXT NOT NULL,
        ranges_json TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        cached_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending_annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_id TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        quote TEXT NOT NULL,
        ranges_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    // Additive migration for installs whose `entries` table already existed before
    // reading-progress tracking shipped — `CREATE TABLE IF NOT EXISTS` above is a
    // no-op against an existing table, so the two new columns need their own
    // idempotent `ALTER TABLE`, same pattern `bindle-core`'s server-side migrations
    // already use for additive schema changes against a live table with real rows.
    try {
      db.execSync('ALTER TABLE entries ADD COLUMN read_progress REAL NOT NULL DEFAULT 0;');
    } catch {
      // Column already exists on a fresh install (created by the CREATE TABLE above).
    }
    try {
      db.execSync('ALTER TABLE entries ADD COLUMN last_read_at INTEGER;');
    } catch {
      // Column already exists on a fresh install (created by the CREATE TABLE above).
    }
  }
  return db;
}

export async function upsertEntries(items: Entry[]): Promise<void> {
  if (items.length === 0) return;
  const db = getDb();
  db.withTransactionSync(() => {
    for (const item of items) {
      db.runSync(
        `INSERT INTO entries (id, title, url, domain_name, content, is_archived, is_starred, reading_time, created_at, updated_at, tags_json, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, url=excluded.url, domain_name=excluded.domain_name,
           content=COALESCE(excluded.content, entries.content),
           is_archived=excluded.is_archived, is_starred=excluded.is_starred,
           reading_time=excluded.reading_time, created_at=excluded.created_at,
           updated_at=excluded.updated_at, tags_json=excluded.tags_json, cached_at=excluded.cached_at`,
        [
          item.id,
          item.title ?? '(untitled)',
          item.url,
          item.domain_name ?? null,
          item.content ?? null,
          item.is_archived,
          item.is_starred,
          item.reading_time ?? null,
          item.created_at,
          item.updated_at,
          JSON.stringify(item.tags ?? []),
          Date.now(),
        ]
      );
    }
  });
}

export async function getCachedEntries(filter: EntryFilter, tag?: string): Promise<Entry[]> {
  const db = getDb();
  let where = '1=1';
  if (filter === 'unread') where = 'is_archived = 0';
  if (filter === 'archived') where = 'is_archived = 1';
  if (filter === 'starred') where = 'is_starred = 1';
  const rows = db.getAllSync<EntryRow>(
    `SELECT * FROM entries WHERE ${where} ORDER BY created_at DESC LIMIT 200`
  );
  const entries = rows.map(rowToEntry);
  if (!tag) return entries;
  const needle = tag.toLowerCase();
  return entries.filter((e) =>
    e.tags.some((t) => t.slug?.toLowerCase() === needle || t.label.toLowerCase() === needle)
  );
}

/** Full-text search fallback over whatever is cached locally, used when a live
 * search can't reach the server at all. Deliberately not capped at the 200-row
 * recent window `getCachedEntries` uses — a search should be able to surface an
 * older article too, not just recently-viewed ones — so this caps higher (300) and
 * matches title/content/domain/url the same way the live-search path does, via a
 * case-insensitive LIKE (searching raw stored content, since SQLite has no HTML
 * stripping; acceptable for an offline fallback — the live path in
 * `entriesRepository.searchEntries` does the stricter stripped-text match). */
export async function searchCachedEntries(query: string): Promise<Entry[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const db = getDb();
  const needle = `%${trimmed}%`;
  const rows = db.getAllSync<EntryRow>(
    `SELECT * FROM entries
     WHERE title LIKE ? COLLATE NOCASE
        OR content LIKE ? COLLATE NOCASE
        OR domain_name LIKE ? COLLATE NOCASE
        OR url LIKE ? COLLATE NOCASE
     ORDER BY created_at DESC
     LIMIT 300`,
    [needle, needle, needle, needle]
  );
  return rows.map(rowToEntry);
}

/** Derives the account's tag list from whatever entries are cached locally — the
 * offline fallback when a live `GET /tags` isn't reachable. Not a perfect
 * substitute (tags on entries that were never fetched won't appear) but real data,
 * not an empty screen. */
export async function getCachedTags(): Promise<Tag[]> {
  const db = getDb();
  const rows = db.getAllSync<{ tags_json: string }>('SELECT tags_json FROM entries');
  const byId = new Map<string, Tag>();
  for (const row of rows) {
    const tags: Tag[] = JSON.parse(row.tags_json ?? '[]');
    for (const t of tags) {
      if (!byId.has(t.id)) byId.set(t.id, t);
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export async function getCachedEntry(id: string): Promise<Entry | null> {
  const db = getDb();
  const row = db.getFirstSync<EntryRow>('SELECT * FROM entries WHERE id = ?', [id]);
  return row ? rowToEntry(row) : null;
}

export async function removeCachedEntry(id: string): Promise<void> {
  const db = getDb();
  db.runSync('DELETE FROM entries WHERE id = ?', [id]);
}

/** Strips one tag (by id) out of every cached entry's `tags_json` after it's
 * been deleted account-wide server-side — keeps the offline tag-derivation in
 * `getCachedTags`/`getCachedEntries` from still showing a tag that no longer
 * exists on the server. */
export async function removeCachedTag(tagId: string): Promise<void> {
  const db = getDb();
  const rows = db.getAllSync<{ id: string; tags_json: string }>(
    'SELECT id, tags_json FROM entries WHERE tags_json LIKE ?',
    [`%"id":"${tagId}"%`]
  );
  db.withTransactionSync(() => {
    for (const row of rows) {
      const tags: Tag[] = JSON.parse(row.tags_json ?? '[]');
      const next = tags.filter((t) => t.id !== tagId);
      if (next.length !== tags.length) {
        db.runSync('UPDATE entries SET tags_json = ? WHERE id = ?', [JSON.stringify(next), row.id]);
      }
    }
  });
}

export async function updateCachedFlags(
  id: string,
  patch: Partial<{ is_archived: 0 | 1; is_starred: 0 | 1 }>
): Promise<void> {
  const db = getDb();
  if (patch.is_archived !== undefined) {
    db.runSync('UPDATE entries SET is_archived = ? WHERE id = ?', [patch.is_archived, id]);
  }
  if (patch.is_starred !== undefined) {
    db.runSync('UPDATE entries SET is_starred = ? WHERE id = ?', [patch.is_starred, id]);
  }
}

export async function queuePendingAction(
  entryId: string,
  action: 'archive' | 'starred',
  value: 0 | 1
): Promise<void> {
  const db = getDb();
  db.runSync(
    'INSERT INTO pending_actions (entry_id, action, value, created_at) VALUES (?, ?, ?, ?)',
    [entryId, action, value, Date.now()]
  );
}

type PendingActionRow = { id: number; entry_id: string; action: 'archive' | 'starred'; value: 0 | 1 };

export async function getPendingActions(): Promise<PendingActionRow[]> {
  const db = getDb();
  return db.getAllSync<PendingActionRow>('SELECT * FROM pending_actions ORDER BY created_at ASC');
}

export async function clearPendingAction(id: number): Promise<void> {
  const db = getDb();
  db.runSync('DELETE FROM pending_actions WHERE id = ?', [id]);
}

/** Caches the server's authoritative highlight list for one article, so the reader
 * screen can re-render highlights offline too (same write-through pattern as entries). */
export async function upsertAnnotations(entryId: string, items: Annotation[]): Promise<void> {
  const db = getDb();
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM annotations WHERE entry_id = ?', [entryId]);
    for (const item of items) {
      db.runSync(
        `INSERT INTO annotations (id, entry_id, text, quote, ranges_json, created_at, updated_at, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          entryId,
          item.text ?? '',
          item.quote,
          JSON.stringify(item.ranges ?? []),
          item.created_at,
          item.updated_at,
          Date.now(),
        ]
      );
    }
  });
}

type AnnotationRow = {
  id: string;
  entry_id: string;
  text: string;
  quote: string;
  ranges_json: string;
  created_at: string | null;
  updated_at: string | null;
};

function rowToAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    text: row.text,
    quote: row.quote,
    ranges: JSON.parse(row.ranges_json ?? '[]'),
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? '',
  };
}

export async function getCachedAnnotations(entryId: string): Promise<Annotation[]> {
  const db = getDb();
  const rows = db.getAllSync<AnnotationRow>(
    'SELECT * FROM annotations WHERE entry_id = ? ORDER BY created_at ASC',
    [entryId]
  );
  return rows.map(rowToAnnotation);
}

export async function removeCachedAnnotation(id: string): Promise<void> {
  const db = getDb();
  db.runSync('DELETE FROM annotations WHERE id = ?', [id]);
}

/** Queues a highlight created while offline. `localId` is a placeholder id
 * prefixed `local-` (so it can be rendered/removed locally before the server
 * assigns the real one — see `annotationsRepository.createHighlight`). */
export async function queuePendingAnnotation(
  localId: string,
  entryId: string,
  quote: string,
  text: string,
  ranges: Annotation['ranges']
): Promise<void> {
  const db = getDb();
  db.runSync(
    'INSERT INTO pending_annotations (local_id, entry_id, text, quote, ranges_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [localId, entryId, text, quote, JSON.stringify(ranges), Date.now()]
  );
}

type PendingAnnotationRow = {
  id: number;
  local_id: string;
  entry_id: string;
  text: string;
  quote: string;
  ranges_json: string;
};

export async function getPendingAnnotations(): Promise<PendingAnnotationRow[]> {
  const db = getDb();
  return db.getAllSync<PendingAnnotationRow>(
    'SELECT * FROM pending_annotations ORDER BY created_at ASC'
  );
}

export async function clearPendingAnnotation(id: number): Promise<void> {
  const db = getDb();
  db.runSync('DELETE FROM pending_annotations WHERE id = ?', [id]);
}

export async function clearCache(): Promise<void> {
  const db = getDb();
  db.execSync(
    'DELETE FROM entries; DELETE FROM pending_actions; DELETE FROM annotations; DELETE FROM pending_annotations;'
  );
}

type EntryRow = {
  id: string;
  title: string;
  url: string;
  domain_name: string | null;
  content: string | null;
  is_archived: 0 | 1;
  is_starred: 0 | 1;
  reading_time: number | null;
  created_at: string;
  updated_at: string;
  tags_json: string;
  cached_at: number;
  read_progress: number | null;
  last_read_at: number | null;
};

function rowToEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    domain_name: row.domain_name ?? undefined,
    content: row.content ?? undefined,
    is_archived: row.is_archived,
    is_starred: row.is_starred,
    reading_time: row.reading_time ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    tags: JSON.parse(row.tags_json ?? '[]'),
    read_progress: row.read_progress ?? 0,
    last_read_at: row.last_read_at ?? undefined,
  };
}

/** Reading progress (0..1, how far the user has scrolled into an article's reader
 * view) is a purely local, on-device signal — never sent to or read from
 * `bindle-core`, deliberately not part of the `Entry` wire shape `BindleClient`
 * parses. It lives only in this SQLite cache and survives exactly as long as the
 * app's local storage does (same durability as the offline article cache itself).
 * Looked up in batches so `listEntries`/`loadEntry` can merge it onto whichever
 * entries they just fetched (live or cached) without a query per row. */
export async function getReadProgressBatch(
  ids: string[]
): Promise<Map<string, { progress: number; lastReadAt?: number }>> {
  const result = new Map<string, { progress: number; lastReadAt?: number }>();
  if (ids.length === 0) return result;
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.getAllSync<{ id: string; read_progress: number | null; last_read_at: number | null }>(
    `SELECT id, read_progress, last_read_at FROM entries WHERE id IN (${placeholders})`,
    ids
  );
  for (const row of rows) {
    result.set(row.id, { progress: row.read_progress ?? 0, lastReadAt: row.last_read_at ?? undefined });
  }
  return result;
}

/** Persists how far into an article the user has scrolled. Clamped to [0, 1] here
 * (not trusted from the WebView's own math) and a no-op if the entry isn't cached
 * yet (can't happen in practice — the reader screen always writes the entry
 * through `upsertEntries` before the WebView can emit a scroll event, but cheap
 * to guard regardless of call order). */
export async function setReadProgress(id: string, progress: number): Promise<void> {
  const clamped = Math.max(0, Math.min(1, progress));
  const db = getDb();
  db.runSync('UPDATE entries SET read_progress = ?, last_read_at = ? WHERE id = ?', [
    clamped,
    Date.now(),
    id,
  ]);
}
