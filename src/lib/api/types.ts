// Fresh, original types for the public Wallabag REST API (MIT-licensed project,
// https://github.com/wallabag/wallabag). Bindle is an independent client — these
// types model Wallabag's documented API responses, no Wallabag source code is
// vendored here.

export type WallabagCredentials = {
  serverUrl: string; // e.g. https://wallabag.example.com (no trailing slash)
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
};

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string | null;
  refresh_token: string;
};

export type WallabagTag = {
  id: number;
  label: string;
  slug: string;
};

export type WallabagEntry = {
  id: number;
  title: string;
  url: string;
  given_url?: string;
  content?: string;
  preview_picture?: string | null;
  is_archived: 0 | 1;
  is_starred: 0 | 1;
  reading_time?: number;
  created_at: string;
  updated_at: string;
  domain_name?: string;
  tags: WallabagTag[];
};

export type EntriesPage = {
  page: number;
  limit: number;
  pages: number;
  total: number;
  items: WallabagEntry[];
};

export type EntryFilter = 'all' | 'unread' | 'archived' | 'starred';

/** One highlight range. Shape matches Wallabag's Annotator.js-schema `ranges` field
 * (https://doc.wallabag.org — opaque to the server, stored/returned verbatim), but
 * Bindle defines its own meaning for the fields: `startOffset`/`endOffset` are
 * absolute character offsets into the article root's full visible text; `start`/`end`
 * are unused placeholders kept only for shape compatibility. See the header comment in
 * `src/lib/annotations/highlightScript.ts` for why (a per-node relative-XPath scheme
 * broke when two highlights shared a paragraph). */
export type WallabagAnnotationRange = {
  start: string;
  startOffset: number;
  end: string;
  endOffset: number;
};

export type WallabagAnnotation = {
  id: number;
  text: string;
  quote: string;
  ranges: WallabagAnnotationRange[];
  created_at: string;
  updated_at: string;
  user?: string;
  annotator_schema_version?: string;
};

/** Account config fields exposed under JMS Serializer's `config_api` group
 * (`src/Entity/Config.php`, github.com/wallabag/wallabag) — the fields the
 * server actually returns from `GET /api/config`, not every column on the
 * entity (some, like `pocket_consumer_key`, carry no `config_api` group and
 * are never serialized to this endpoint). */
export type WallabagConfig = {
  id: number;
  items_per_page: number;
  language: string;
  reading_speed: number | null;
  action_mark_as_read: number | null;
  list_mode: number | null;
  display_thumbnails: number | null;
};

/** Fields under JMS Serializer's `user_api` group (`src/Entity/User.php`) —
 * what `GET /api/user` actually returns. */
export type WallabagUser = {
  id: number;
  name: string | null;
  username: string;
  email: string;
  created_at: string;
  updated_at: string;
};

/** `GET /api/info` response shape (`src/Entity/Api/ApplicationInfo.php`). */
export type WallabagServerInfo = {
  appname: string;
  version: string;
  allowed_registration: boolean;
};

export type EntryExportFormat = 'epub' | 'pdf' | 'txt' | 'csv' | 'xml';

export type BulkSaveResult = {
  url: string;
  entry: number;
};

export class WallabagApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'WallabagApiError';
    this.status = status;
  }
}
