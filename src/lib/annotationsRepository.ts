import type { BindleClient } from './api/bindleClient';
import type { Annotation, AnnotationRange } from './api/types';
import {
  clearPendingAnnotation,
  getCachedAnnotations,
  getPendingAnnotations,
  queuePendingAnnotation,
  removeCachedAnnotation,
  upsertAnnotations,
} from './db/database';

export type AnnotationsResult = {
  items: Annotation[];
  fromCache: boolean;
};

/** Loads every highlight saved on one article, preferring the live server list but
 * falling back to the local cache (same "never a blank screen offline" pattern as
 * entries/tags). Any highlights still queued from a previous offline session are
 * merged in with `local-`-prefixed placeholder ids so they render immediately too. */
export async function loadAnnotations(
  client: BindleClient,
  entryId: string
): Promise<AnnotationsResult> {
  const pending = (await getPendingAnnotations()).filter((p) => p.entry_id === entryId);
  const pendingAsAnnotations: Annotation[] = pending.map((p) => ({
    id: p.local_id,
    text: p.text,
    quote: p.quote,
    ranges: JSON.parse(p.ranges_json) as AnnotationRange[],
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

let nextLocalId = 0;

/** Saves a new highlight. Tries the server first so the real annotation id (needed
 * for later deletion) comes back immediately; if offline, queues it under a
 * `local-`-prefixed placeholder id so it's still visible and deletable locally,
 * then gets replayed by `flushPendingAnnotations` on the next successful connection. */
export async function createHighlight(
  client: BindleClient,
  entryId: string,
  quote: string,
  ranges: AnnotationRange[],
  text = ''
): Promise<Annotation> {
  try {
    const annotation = await client.createAnnotation(entryId, { quote, text, ranges });
    await upsertAnnotations(entryId, [...(await getCachedAnnotations(entryId)), annotation]);
    return annotation;
  } catch (err) {
    const localId = `local-${++nextLocalId}`;
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

/** Removes a highlight. A highlight that only exists in the offline queue
 * (`local-`-prefixed id) is simply dropped from the queue; a real server-side
 * highlight is deleted live — there is no safe offline-delete queue for those,
 * since the id must be confirmed by the server first (same boundary the rest of
 * the app draws for delete-while-offline), so this surfaces the real error to
 * the caller instead of silently no-op. The server delete must run *before* the
 * local cache row is dropped: if it fails (offline, DNS failure, a 500, a
 * revoked token), the cached copy must survive so the highlight doesn't silently
 * disappear next time it's rendered from the offline cache — same ordering fix
 * already applied to article deletion in `entriesRepository.ts`. */
export async function deleteHighlight(client: BindleClient, annotationId: string): Promise<void> {
  if (annotationId.startsWith('local-')) {
    const pending = await getPendingAnnotations();
    const match = pending.find((p) => p.local_id === annotationId);
    if (match) await clearPendingAnnotation(match.id);
    return;
  }
  await client.deleteAnnotation(annotationId);
  await removeCachedAnnotation(annotationId);
}

/** Replays highlights created while offline. Call alongside `flushPendingActions`. */
export async function flushPendingAnnotations(client: BindleClient): Promise<number> {
  const pending = await getPendingAnnotations();
  let replayed = 0;
  for (const item of pending) {
    try {
      const ranges = JSON.parse(item.ranges_json) as AnnotationRange[];
      await client.createAnnotation(item.entry_id, { quote: item.quote, text: item.text, ranges });
      await clearPendingAnnotation(item.id);
      replayed += 1;
    } catch {
      break;
    }
  }
  return replayed;
}
