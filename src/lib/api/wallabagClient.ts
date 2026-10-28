import type {
  EntriesPage,
  EntryFilter,
  TokenResponse,
  WallabagAnnotation,
  WallabagAnnotationRange,
  WallabagCredentials,
  WallabagEntry,
  WallabagTag,
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
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
