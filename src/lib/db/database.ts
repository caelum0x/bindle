import * as SQLite from 'expo-sqlite';
import type { EntryFilter, WallabagEntry } from '../api/types';

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

export async function getCachedEntries(filter: EntryFilter): Promise<WallabagEntry[]> {
  const db = await getDb();
  let where = '1=1';
  if (filter === 'unread') where = 'is_archived = 0';
  if (filter === 'archived') where = 'is_archived = 1';
  if (filter === 'starred') where = 'is_starred = 1';
  const rows = await db.getAllAsync<EntryRow>(
    `SELECT * FROM entries WHERE ${where} ORDER BY created_at DESC LIMIT 200`
  );
  return rows.map(rowToEntry);
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

export async function clearCache(): Promise<void> {
  const db = await getDb();
  await db.execAsync('DELETE FROM entries; DELETE FROM pending_actions;');
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
