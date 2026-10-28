import * as SQLite from 'expo-sqlite';
import type { EntryFilter, WallabagAnnotation, WallabagEntry, WallabagTag } from '../api/types';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('bindle-cache.db').then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS entries (
          id INTEGER PRIMARY KEY,
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
          cached_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pending_actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entry_id INTEGER NOT NULL,
          action TEXT NOT NULL,
          value INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS annotations (
          id INTEGER PRIMARY KEY,
          entry_id INTEGER NOT NULL,
          text TEXT NOT NULL DEFAULT '',
          quote TEXT NOT NULL,
          ranges_json TEXT NOT NULL,
          created_at TEXT,
          updated_at TEXT,
          cached_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pending_annotations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          local_id INTEGER NOT NULL,
          entry_id INTEGER NOT NULL,
          text TEXT NOT NULL DEFAULT '',
          quote TEXT NOT NULL,
          ranges_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
      return db;
    });
  }
  return dbPromise;
}

export async function upsertEntries(items: WallabagEntry[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const item of items) {
      await db.runAsync(
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

export async function getCachedEntries(filter: EntryFilter, tag?: string): Promise<WallabagEntry[]> {
  const db = await getDb();
  let where = '1=1';
  if (filter === 'unread') where = 'is_archived = 0';
  if (filter === 'archived') where = 'is_archived = 1';
  if (filter === 'starred') where = 'is_starred = 1';
  const rows = await db.getAllAsync<EntryRow>(
    `SELECT * FROM entries WHERE ${where} ORDER BY created_at DESC LIMIT 200`
  );
  const entries = rows.map(rowToEntry);
  if (!tag) return entries;
  const needle = tag.toLowerCase();
  return entries.filter((e) =>
    e.tags.some((t) => t.slug?.toLowerCase() === needle || t.label.toLowerCase() === needle)
  );
}

/** Derives the account's tag list from whatever entries are cached locally — the
 * offline fallback when a live GET /api/tags.json isn't reachable. Not a perfect
 * substitute (tags on entries that were never fetched won't appear) but real data,
 * not an empty screen. */
export async function getCachedTags(): Promise<WallabagTag[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ tags_json: string }>('SELECT tags_json FROM entries');
  const byId = new Map<number, WallabagTag>();
  for (const row of rows) {
    const tags: WallabagTag[] = JSON.parse(row.tags_json ?? '[]');
    for (const t of tags) {
      if (!byId.has(t.id)) byId.set(t.id, t);
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export async function getCachedEntry(id: number): Promise<WallabagEntry | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<EntryRow>('SELECT * FROM entries WHERE id = ?', [id]);
  return row ? rowToEntry(row) : null;
}

export async function removeCachedEntry(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM entries WHERE id = ?', [id]);
}

export async function updateCachedFlags(
  id: number,
  patch: Partial<{ is_archived: 0 | 1; is_starred: 0 | 1 }>
): Promise<void> {
  const db = await getDb();
  if (patch.is_archived !== undefined) {
    await db.runAsync('UPDATE entries SET is_archived = ? WHERE id = ?', [patch.is_archived, id]);
  }
  if (patch.is_starred !== undefined) {
    await db.runAsync('UPDATE entries SET is_starred = ? WHERE id = ?', [patch.is_starred, id]);
  }
}

export async function queuePendingAction(
  entryId: number,
  action: 'archive' | 'starred',
  value: 0 | 1
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO pending_actions (entry_id, action, value, created_at) VALUES (?, ?, ?, ?)',
    [entryId, action, value, Date.now()]
  );
}

type PendingActionRow = { id: number; entry_id: number; action: 'archive' | 'starred'; value: 0 | 1 };

export async function getPendingActions(): Promise<PendingActionRow[]> {
  const db = await getDb();
  return db.getAllAsync<PendingActionRow>('SELECT * FROM pending_actions ORDER BY created_at ASC');
}

export async function clearPendingAction(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM pending_actions WHERE id = ?', [id]);
}

/** Caches the server's authoritative highlight list for one article, so the reader
 * screen can re-render highlights offline too (same write-through pattern as entries). */
export async function upsertAnnotations(entryId: number, items: WallabagAnnotation[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM annotations WHERE entry_id = ?', [entryId]);
    for (const item of items) {
      await db.runAsync(
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
  id: number;
  entry_id: number;
  text: string;
  quote: string;
  ranges_json: string;
  created_at: string | null;
  updated_at: string | null;
};

function rowToAnnotation(row: AnnotationRow): WallabagAnnotation {
  return {
    id: row.id,
    text: row.text,
    quote: row.quote,
    ranges: JSON.parse(row.ranges_json ?? '[]'),
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? '',
  };
}

export async function getCachedAnnotations(entryId: number): Promise<WallabagAnnotation[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<AnnotationRow>(
    'SELECT * FROM annotations WHERE entry_id = ? ORDER BY created_at ASC',
    [entryId]
  );
  return rows.map(rowToAnnotation);
}

export async function removeCachedAnnotation(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM annotations WHERE id = ?', [id]);
}

/** Queues a highlight created while offline. `localId` is a negative placeholder id
 * (so it can be rendered/removed locally before the server assigns the real one). */
export async function queuePendingAnnotation(
  localId: number,
  entryId: number,
  quote: string,
  text: string,
  ranges: WallabagAnnotation['ranges']
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO pending_annotations (local_id, entry_id, text, quote, ranges_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [localId, entryId, text, quote, JSON.stringify(ranges), Date.now()]
  );
}

type PendingAnnotationRow = {
  id: number;
  local_id: number;
  entry_id: number;
  text: string;
  quote: string;
  ranges_json: string;
};

export async function getPendingAnnotations(): Promise<PendingAnnotationRow[]> {
  const db = await getDb();
  return db.getAllAsync<PendingAnnotationRow>(
    'SELECT * FROM pending_annotations ORDER BY created_at ASC'
  );
}

export async function clearPendingAnnotation(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM pending_annotations WHERE id = ?', [id]);
}

export async function clearCache(): Promise<void> {
  const db = await getDb();
  await db.execAsync(
    'DELETE FROM entries; DELETE FROM pending_actions; DELETE FROM annotations; DELETE FROM pending_annotations;'
  );
}

type EntryRow = {
  id: number;
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
};

function rowToEntry(row: EntryRow): WallabagEntry {
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
  };
}
