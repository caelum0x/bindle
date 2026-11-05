// Types for Bindle's own hosted backend (bindle-core, bindle-core.ereboslab.com).
// Field names deliberately mirror the shape this app already used for its
// retired self-hosted-Wallabag client (`is_archived`/`is_starred` as 0|1,
// `label`/`slug` on a tag, `ranges` on an annotation) so the UI layer needed
// zero changes for the self-host -> hosted-account pivot; only the API client
// underneath changed. `BindleClient` is the adapter that maps the server's
// own (boolean, camelCase) wire shape into this.

export type Tag = {
  id: string;
  label: string;
  slug: string;
};

export type Entry = {
  id: string;
  title: string;
  url: string;
  domain_name?: string;
  content?: string; // article HTML, only present when the caller asked for it
  preview_picture?: string | null;
  is_archived: 0 | 1;
  is_starred: 0 | 1;
  reading_time?: number;
  created_at: string; // ISO
  updated_at: string;
  tags: Tag[];
};

export type EntriesPage = {
  page: number;
  limit: number;
  pages: number;
  total: number;
  items: Entry[];
};

export type EntryFilter = 'all' | 'unread' | 'archived' | 'starred';

/** One highlight range. `start`/`end` are unused placeholders (kept only so
 * `highlightScript.ts`'s WebView wire protocol didn't need to change when the
 * backend did) — `startOffset`/`endOffset` are absolute character offsets
 * into the article root's full visible text. See the header comment in
 * `src/lib/annotations/highlightScript.ts` for why offsets, not XPaths. */
export type AnnotationRange = {
  start: string;
  startOffset: number;
  end: string;
  endOffset: number;
};

export type Annotation = {
  id: string;
  text: string;
  quote: string;
  ranges: AnnotationRange[];
  created_at: string;
  updated_at: string;
};

export type EntryExportFormat = 'txt' | 'html';

export type BulkSaveResult = {
  url: string;
  ok: boolean;
  error?: string;
};

export type BindleUser = {
  id: string;
  email: string;
  createdAt: number;
};

export class BindleApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'BindleApiError';
    this.status = status;
  }
}
