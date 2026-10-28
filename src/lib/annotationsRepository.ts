import type { WallabagClient } from './api/wallabagClient';
import type { WallabagAnnotation, WallabagAnnotationRange } from './api/types';
import {
  clearPendingAnnotation,
  getCachedAnnotations,
  getPendingAnnotations,
  queuePendingAnnotation,
  removeCachedAnnotation,
  upsertAnnotations,
} from './db/database';

export type AnnotationsResult = {
  items: WallabagAnnotation[];
  fromCache: boolean;
};

/** Loads every highlight saved on one article, preferring the live server list but
 * falling back to the local cache (same "never a blank screen offline" pattern as
 * entries/tags). Any highlights still queued from a previous offline session are
 * merged in with negative placeholder ids so they render immediately too. */
export async function loadAnnotations(
  client: WallabagClient,
  entryId: number
): Promise<AnnotationsResult> {
  const pending = (await getPendingAnnotations()).filter((p) => p.entry_id === entryId);
  const pendingAsAnnotations: WallabagAnnotation[] = pending.map((p) => ({
    id: p.local_id,
    text: p.text,
    quote: p.quote,
    ranges: JSON.parse(p.ranges_json) as WallabagAnnotationRange[],
    created_at: '',
    updated_at: '',
  }));

  try {
    const live = await client.fetchAnnotations(entryId);
    await upsertAnnotations(entryId, live);
    return { items: [...live, ...pendingAsAnnotations], fromCache: false };
  } catch (err) {
    const cached = await getCachedAnnotations(entryId);
    if (cached.length > 0 || pendingAsAnnotations.length > 0) {
      return { items: [...cached, ...pendingAsAnnotations], fromCache: true };
    }
    throw err;
  }
}

let nextLocalId = -1;

/** Saves a new highlight. Tries the server first so the real annotation id (needed
 * for later deletion) comes back immediately; if offline, queues it under a negative
 * placeholder id so it's still visible and deletable locally, then gets replayed by
 * `flushPendingAnnotations` on the next successful connection. */
export async function createHighlight(
  client: WallabagClient,
  entryId: number,
  quote: string,
  ranges: WallabagAnnotationRange[],
  text = ''
): Promise<WallabagAnnotation> {
  try {
    const annotation = await client.createAnnotation(entryId, { quote, text, ranges });
    await upsertAnnotations(entryId, [...(await getCachedAnnotations(entryId)), annotation]);
    return annotation;
  } catch (err) {
    const localId = nextLocalId--;
    await queuePendingAnnotation(localId, entryId, quote, text, ranges);
    return {
      id: localId,
      text,
      quote,
      ranges,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
}

/** Removes a highlight. A highlight that only exists in the offline queue (negative
 * id) is simply dropped from the queue; a real server-side highlight is deleted live
 * — there is no safe offline-delete queue for those, since the id must be confirmed
 * by the server first (same boundary the rest of the app draws for delete-while-
 * offline), so this surfaces the real error to the caller instead of silently no-op. */
export async function deleteHighlight(client: WallabagClient, annotationId: number): Promise<void> {
  if (annotationId < 0) {
    const pending = await getPendingAnnotations();
    const match = pending.find((p) => p.local_id === annotationId);
    if (match) await clearPendingAnnotation(match.id);
    return;
  }
  await removeCachedAnnotation(annotationId);
  await client.deleteAnnotation(annotationId);
}

/** Replays highlights created while offline. Call alongside `flushPendingActions`. */
export async function flushPendingAnnotations(client: WallabagClient): Promise<number> {
  const pending = await getPendingAnnotations();
  let replayed = 0;
  for (const item of pending) {
    try {
      const ranges = JSON.parse(item.ranges_json) as WallabagAnnotationRange[];
      await client.createAnnotation(item.entry_id, { quote: item.quote, text: item.text, ranges });
      await clearPendingAnnotation(item.id);
      replayed += 1;
    } catch {
      break;
    }
  }
  return replayed;
}
