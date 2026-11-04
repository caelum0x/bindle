import type {
  BulkSaveResult,
  EntriesPage,
  EntryExportFormat,
  EntryFilter,
  TokenResponse,
  WallabagAnnotation,
  WallabagAnnotationRange,
  WallabagConfig,
  WallabagCredentials,
  WallabagEntry,
  WallabagServerInfo,
  WallabagTag,
  WallabagUser,
} from './types';
import { WallabagApiError } from './types';

export type StoredTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
};

export type TokenPersistence = {
  read: () => Promise<StoredTokens | null>;
  write: (tokens: StoredTokens) => Promise<void>;
};

function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Original Wallabag REST API client, written against Wallabag's public, documented
 * OAuth2 + /api/entries contract (https://doc.wallabag.org — MIT licensed project).
 * No Wallabag source code is reused; this only implements the HTTP contract so Bindle
 * can talk to any self-hosted Wallabag server the user points it at.
 */
export class WallabagClient {
  private credentials: WallabagCredentials;
  private persistence: TokenPersistence;
  private tokens: StoredTokens | null = null;
  private refreshing: Promise<StoredTokens> | null = null;

  constructor(credentials: WallabagCredentials, persistence: TokenPersistence) {
    this.credentials = { ...credentials, serverUrl: normalizeServerUrl(credentials.serverUrl) };
    this.persistence = persistence;
  }

  private get baseUrl() {
    return this.credentials.serverUrl;
  }

  async login(): Promise<StoredTokens> {
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      username: this.credentials.username,
      password: this.credentials.password,
    });
    const res = await this.rawFetch('/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new WallabagApiError(
        res.status === 400 || res.status === 401
          ? 'Could not sign in. Check the server URL, client ID/secret, and your username/password.'
          : `Login failed (${res.status}): ${text}`,
        res.status
      );
    }
    const json = (await res.json()) as TokenResponse;
    const tokens: StoredTokens = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Date.now() + json.expires_in * 1000 - 30_000, // refresh 30s early
    };
    this.tokens = tokens;
    await this.persistence.write(tokens);
    return tokens;
  }

  private async refresh(current: StoredTokens): Promise<StoredTokens> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      refresh_token: current.refreshToken,
    });
    const res = await this.rawFetch('/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      // Refresh token expired/invalid — fall back to a full password login.
      return this.login();
    }
    const json = (await res.json()) as TokenResponse;
    const tokens: StoredTokens = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Date.now() + json.expires_in * 1000 - 30_000,
    };
    this.tokens = tokens;
    await this.persistence.write(tokens);
    return tokens;
  }

  private async ensureTokens(): Promise<StoredTokens> {
    if (!this.tokens) {
      this.tokens = await this.persistence.read();
    }
    if (!this.tokens) {
      return this.login();
    }
    if (Date.now() >= this.tokens.expiresAt) {
      if (!this.refreshing) {
        this.refreshing = this.refresh(this.tokens).finally(() => {
          this.refreshing = null;
        });
      }
      return this.refreshing;
    }
    return this.tokens;
  }

  private async rawFetch(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, init);
    } catch (err) {
      throw new WallabagApiError(
        'Could not reach the server. Check the URL and your network connection.'
      );
    }
  }

  private async authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const tokens = await this.ensureTokens();
    const res = await this.rawFetch(path, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    });
    if (res.status === 401) {
      // Token might have just been revoked server-side — one retry after a hard refresh.
      const fresh = await this.refresh(tokens);
      return this.rawFetch(path, {
        ...init,
        headers: {
          ...(init.headers || {}),
          Authorization: `Bearer ${fresh.accessToken}`,
        },
      });
    }
    return res;
  }

  async testConnection(): Promise<void> {
    await this.login();
  }

  async fetchEntries(opts: {
    filter: EntryFilter;
    page?: number;
    perPage?: number;
    tag?: string;
  }): Promise<EntriesPage> {
    const params = new URLSearchParams({
      page: String(opts.page ?? 1),
      perPage: String(opts.perPage ?? 30),
      sort: 'created',
      order: 'desc',
      detail: 'metadata',
    });
    if (opts.filter === 'unread') params.set('archive', '0');
    if (opts.filter === 'archived') params.set('archive', '1');
    if (opts.filter === 'starred') params.set('starred', '1');
    if (opts.tag) params.set('tags', opts.tag);

    const res = await this.authedFetch(`/api/entries.json?${params.toString()}`);
    if (!res.ok) throw new WallabagApiError(`Could not load entries (${res.status})`, res.status);
    const json = await res.json();
    return {
      page: json.page,
      limit: json.limit,
      pages: json.pages,
      total: json.total,
      items: json._embedded?.items ?? [],
    };
  }

  async fetchEntry(id: number): Promise<WallabagEntry> {
    const res = await this.authedFetch(`/api/entries/${id}.json`);
    if (!res.ok) throw new WallabagApiError(`Could not load article (${res.status})`, res.status);
    return res.json();
  }

  async saveEntry(url: string): Promise<WallabagEntry> {
    const body = new URLSearchParams({ url });
    const res = await this.authedFetch('/api/entries.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new WallabagApiError(`Could not save that link (${res.status})`, res.status);
    return res.json();
  }

  async patchEntry(
    id: number,
    patch: Partial<{ archive: 0 | 1; starred: 0 | 1 }>
  ): Promise<WallabagEntry> {
    const body = new URLSearchParams();
    if (patch.archive !== undefined) body.set('archive', String(patch.archive));
    if (patch.starred !== undefined) body.set('starred', String(patch.starred));
    const res = await this.authedFetch(`/api/entries/${id}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new WallabagApiError(`Could not update article (${res.status})`, res.status);
    return res.json();
  }

  async deleteEntry(id: number): Promise<void> {
    const res = await this.authedFetch(`/api/entries/${id}.json`, { method: 'DELETE' });
    if (!res.ok) throw new WallabagApiError(`Could not delete article (${res.status})`, res.status);
  }

  /** All tags across the whole account (https://doc.wallabag.org — GET /api/tags). */
  async fetchTags(): Promise<WallabagTag[]> {
    const res = await this.authedFetch('/api/tags.json');
    if (!res.ok) throw new WallabagApiError(`Could not load tags (${res.status})`, res.status);
    return res.json();
  }

  /** Adds one or more comma-separated tag labels to an entry; server creates tags that
   * don't exist yet and returns the entry with its full, updated tag list. */
  async addTagsToEntry(entryId: number, tagsCsv: string): Promise<WallabagEntry> {
    const body = new URLSearchParams({ tags: tagsCsv });
    const res = await this.authedFetch(`/api/entries/${entryId}/tags.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new WallabagApiError(`Could not add tag (${res.status})`, res.status);
    return res.json();
  }

  async removeTagFromEntry(entryId: number, tagId: number): Promise<WallabagEntry> {
    const res = await this.authedFetch(`/api/entries/${entryId}/tags/${tagId}.json`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new WallabagApiError(`Could not remove tag (${res.status})`, res.status);
    return res.json();
  }

  /** All highlights (Wallabag's "annotations") saved on one article
   * (`GET /api/annotations/{entry}.json` — Annotator.js-schema rows,
   * https://doc.wallabag.org). */
  async fetchAnnotations(entryId: number): Promise<WallabagAnnotation[]> {
    const res = await this.authedFetch(`/api/annotations/${entryId}.json`);
    if (!res.ok) throw new WallabagApiError(`Could not load highlights (${res.status})`, res.status);
    const json = await res.json();
    return (json.rows ?? []) as WallabagAnnotation[];
  }

  /** Saves a new highlight on an article (`POST /api/annotations/{entry}.json`).
   * `text` is an optional note attached to the highlight; Wallabag stores it even
   * when empty. `quote` is the highlighted text itself, `ranges` locate it in the
   * article's HTML so it can be re-rendered later. */
  async createAnnotation(
    entryId: number,
    annotation: { quote: string; text?: string; ranges: WallabagAnnotationRange[] }
  ): Promise<WallabagAnnotation> {
    const res = await this.authedFetch(`/api/annotations/${entryId}.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: annotation.text ?? '',
        quote: annotation.quote,
        ranges: annotation.ranges,
      }),
    });
    if (!res.ok) throw new WallabagApiError(`Could not save highlight (${res.status})`, res.status);
    return res.json();
  }

  /** Updates a highlight's note text (`PUT /api/annotations/{annotation}.json`). */
  async updateAnnotation(annotationId: number, text: string): Promise<WallabagAnnotation> {
    const res = await this.authedFetch(`/api/annotations/${annotationId}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new WallabagApiError(`Could not update highlight (${res.status})`, res.status);
    return res.json();
  }

  /** Removes a highlight (`DELETE /api/annotations/{annotation}.json`). */
  async deleteAnnotation(annotationId: number): Promise<void> {
    const res = await this.authedFetch(`/api/annotations/${annotationId}.json`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new WallabagApiError(`Could not remove highlight (${res.status})`, res.status);
  }

  /** Server-side full-text search (`GET /api/search.{_format}` —
   * `src/Controller/Api/SearchRestController.php`), across title/content/url/
   * annotations. Uses the same Pagerfanta/HATEOAS pagination envelope as
   * `fetchEntries`, so the response shape (and this parsing) is identical. */
  async searchEntriesServer(term: string, page = 1, perPage = 30): Promise<EntriesPage> {
    const params = new URLSearchParams({ term, page: String(page), perPage: String(perPage) });
    const res = await this.authedFetch(`/api/search.json?${params.toString()}`);
    if (!res.ok) throw new WallabagApiError(`Search failed (${res.status})`, res.status);
    const json = await res.json();
    return {
      page: json.page,
      limit: json.limit,
      pages: json.pages,
      total: json.total,
      items: json._embedded?.items ?? [],
    };
  }

  /** Re-fetches and re-parses an entry's content from its original URL
   * (`PATCH /api/entries/{entry}/reload.json`). The server answers 304 (no
   * body) when it couldn't update the content — not an error, just "nothing
   * changed" — so this returns `null` for that case instead of throwing. */
  async reloadEntry(id: number): Promise<WallabagEntry | null> {
    const res = await this.authedFetch(`/api/entries/${id}/reload.json`, { method: 'PATCH' });
    if (res.status === 304) return null;
    if (!res.ok) throw new WallabagApiError(`Could not refresh this article (${res.status})`, res.status);
    return res.json();
  }

  /** Downloads one entry in a predefined format (`GET /api/entries/{entry}/
   * export.{_format}` — epub/pdf/txt/csv/xml, real server-rendered content,
   * no client-side conversion). Returns the raw bytes so the caller can write
   * them straight to a file (`expo-file-system`'s `File.write` accepts an
   * `ArrayBuffer` directly, binary or text, with no base64 round-trip). */
  async exportEntry(
    id: number,
    format: EntryExportFormat
  ): Promise<{ bytes: ArrayBuffer; contentType: string }> {
    const res = await this.authedFetch(`/api/entries/${id}/export.${format}`);
    if (!res.ok) throw new WallabagApiError(`Could not export this article (${res.status})`, res.status);
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    const bytes = await res.arrayBuffer();
    return { bytes, contentType };
  }

  /** Checks whether a URL is already saved (`GET /api/entries/exists.json?url=`
   * — `src/Controller/Api/EntryRestController.php::getEntriesExistsAction`,
   * single-`url` form of the call, which answers `{ exists: boolean }`). */
  async checkEntryExists(url: string): Promise<boolean> {
    const params = new URLSearchParams({ url });
    const res = await this.authedFetch(`/api/entries/exists.json?${params.toString()}`);
    if (!res.ok) throw new WallabagApiError(`Could not check that link (${res.status})`, res.status);
    const json = await res.json();
    return Boolean(json.exists);
  }

  /** Account config/settings (`GET /api/config.json`). */
  async fetchConfig(): Promise<WallabagConfig> {
    const res = await this.authedFetch('/api/config.json');
    if (!res.ok) throw new WallabagApiError(`Could not load account settings (${res.status})`, res.status);
    return res.json();
  }

  /** Signed-in user's identity (`GET /api/user.json`). */
  async fetchUser(): Promise<WallabagUser> {
    const res = await this.authedFetch('/api/user.json');
    if (!res.ok) throw new WallabagApiError(`Could not load account info (${res.status})`, res.status);
    return res.json();
  }

  /** Server application name/version/registration flag (`GET /api/info.json`). */
  async fetchServerInfo(): Promise<WallabagServerInfo> {
    const res = await this.authedFetch('/api/info.json');
    if (!res.ok) throw new WallabagApiError(`Could not load server info (${res.status})`, res.status);
    return res.json();
  }

  /** Permanently deletes a tag from every entry that carries it (`DELETE
   * /api/tags/{tag}.json`, tag addressed by id — `TagRestController::deleteTagAction`). */
  async deleteTagGlobally(tagId: number): Promise<void> {
    const res = await this.authedFetch(`/api/tags/${tagId}.json`, { method: 'DELETE' });
    if (!res.ok) throw new WallabagApiError(`Could not delete tag (${res.status})`, res.status);
  }

  /** Bulk-saves a list of URLs in one request (`POST /api/entries/lists.json`
   * — `EntryRestController::postEntriesListAction`). The server reads `urls`
   * from the query string even on this POST (it calls `$request->query->get`,
   * not the form body), so it's sent the same way here. */
  async bulkSaveLinks(urls: string[]): Promise<BulkSaveResult[]> {
    const params = new URLSearchParams({ urls: JSON.stringify(urls) });
    const res = await this.authedFetch(`/api/entries/lists.json?${params.toString()}`, {
      method: 'POST',
    });
    if (!res.ok) throw new WallabagApiError(`Could not import those links (${res.status})`, res.status);
    return res.json();
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
