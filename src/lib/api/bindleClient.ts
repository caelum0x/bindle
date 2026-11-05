import type {
  Annotation,
  AnnotationRange,
  BindleUser,
  BulkSaveResult,
  Entry,
  EntriesPage,
  EntryExportFormat,
  EntryFilter,
  Tag,
} from './types';
import { BindleApiError } from './types';

/** Bindle's own hosted backend — no self-hosted server to point at anymore. */
export const BINDLE_API_URL = (process.env.EXPO_PUBLIC_BINDLE_API_URL || 'https://bindle-core.ereboslab.com').trim();

export type StoredSession = {
  token: string;
};

export type SessionPersistence = {
  read: () => Promise<StoredSession | null>;
  write: (session: StoredSession) => Promise<void>;
};

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-');
}

function toTag(raw: { id: string; name: string }): Tag {
  return { id: raw.id, label: raw.name, slug: slugify(raw.name) };
}

type RawEntry = {
  id: string;
  title: string;
  url: string;
  excerpt?: string;
  imageUrl: string | null;
  readingMins: number;
  starred: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  tags: { id: string; name: string }[];
  contentHtml?: string;
  contentText?: string;
};

function toEntry(raw: RawEntry): Entry {
  return {
    id: raw.id,
    title: raw.title,
    url: raw.url,
    domain_name: hostOf(raw.url),
    content: raw.contentHtml,
    preview_picture: raw.imageUrl,
    is_archived: raw.archived ? 1 : 0,
    is_starred: raw.starred ? 1 : 0,
    reading_time: raw.readingMins,
    created_at: new Date(raw.createdAt).toISOString(),
    updated_at: new Date(raw.updatedAt).toISOString(),
    tags: (raw.tags ?? []).map(toTag),
  };
}

type RawAnnotation = {
  id: string;
  quote: string;
  note: string;
  startOffset: number;
  endOffset: number;
  createdAt: number;
};

function toAnnotation(raw: RawAnnotation): Annotation {
  return {
    id: raw.id,
    text: raw.note ?? '',
    quote: raw.quote,
    ranges: [{ start: '', startOffset: raw.startOffset, end: '', endOffset: raw.endOffset }],
    created_at: new Date(raw.createdAt).toISOString(),
    updated_at: new Date(raw.createdAt).toISOString(),
  };
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const json = await res.json();
    return typeof json?.error === 'string' ? json.error : fallback;
  } catch {
    return fallback;
  }
}

/** Creates a new Bindle account. Signing up IS the "connect" step now — no
 * server URL, no OAuth client id/secret, nothing to self-host. */
export async function signup(email: string, password: string): Promise<{ token: string; user: BindleUser }> {
  let res: Response;
  try {
    res = await fetch(`${BINDLE_API_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new BindleApiError('Could not reach Bindle. Check your connection.');
  }
  if (!res.ok) {
    throw new BindleApiError(await readErrorMessage(res, 'Could not create your account.'), res.status);
  }
  return res.json();
}

export async function login(email: string, password: string): Promise<{ token: string; user: BindleUser }> {
  let res: Response;
  try {
    res = await fetch(`${BINDLE_API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new BindleApiError('Could not reach Bindle. Check your connection.');
  }
  if (!res.ok) {
    throw new BindleApiError(await readErrorMessage(res, 'Incorrect email or password.'), res.status);
  }
  return res.json();
}

/** Thin client over Bindle's own hosted REST API, authenticated with a bearer
 * session token (no refresh flow — a 30-day session, same as the login
 * screen's "stay signed in" promise; an expired/revoked token surfaces as a
 * normal 401 the caller treats like any other request failure). */
export class BindleClient {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetch(`${BINDLE_API_URL}${path}`, {
        ...init,
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers || {}),
          Authorization: `Bearer ${this.token}`,
        },
      });
    } catch {
      throw new BindleApiError('Could not reach Bindle. Check your connection.');
    }
  }

  async me(): Promise<BindleUser> {
    const res = await this.authedFetch('/me');
    if (!res.ok) throw new BindleApiError(await readErrorMessage(res, 'Could not load your account.'), res.status);
    return res.json();
  }

  async fetchEntries(opts: { filter: EntryFilter; tag?: string; page?: number; perPage?: number }): Promise<EntriesPage> {
    const params = new URLSearchParams();
    if (opts.filter === 'unread') params.set('archived', 'false');
    if (opts.filter === 'archived') params.set('archived', 'true');
    if (opts.filter === 'starred') params.set('starred', 'true');
    if (opts.tag) params.set('tag', opts.tag);
    const res = await this.authedFetch(`/entries?${params.toString()}`);
    if (!res.ok) throw new BindleApiError(await readErrorMessage(res, 'Could not load entries.'), res.status);
    const json = await res.json();
    const items = (json.entries as RawEntry[]).map(toEntry);
    return { page: 1, limit: items.length, pages: 1, total: items.length, items };
  }

  async fetchEntry(id: string): Promise<Entry> {
    const res = await this.authedFetch(`/entries/${id}`);
    if (!res.ok) throw new BindleApiError(await readErrorMessage(res, 'Could not load article.'), res.status);
    const json = await res.json();
    return toEntry(json.entry);
  }

  async saveEntry(url: string): Promise<Entry> {
    const res = await this.authedFetch('/entries', { method: 'POST', body: JSON.stringify({ url }) });
    if (!res.ok) throw new BindleApiError(await readErrorMessage(res, 'Could not save that link.'), res.status);
    const json = await res.json();
    return toEntry(json.entry);
  }

  async patchEntry(id: string, patch: Partial<{ archive: 0 | 1; starred: 0 | 1 }>): Promise<Entry> {
    const body: Record<string, boolean> = {};
    if (patch.archive !== undefined) body.archived = patch.archive === 1;
    if (patch.starred !== undefined) body.starred = patch.starred === 1;
    const res = await this.authedFetch(`/entries/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!res.ok) throw new BindleApiError(await readErrorMessage(res, 'Could not update article.'), res.status);
    const json = await res.json();
    return toEntry(json.entry);
  }

  async deleteEntry(id: string): Promise<void> {
    const res = await this.authedFetch(`/entries/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      throw new BindleApiError(await readErrorMessage(res, 'Could not delete article.'), res.status);
    }
  }

  async fetchTags(): Promise<Tag[]> {
    const res = await this.authedFetch('/tags');
    if (!res.ok) throw new BindleApiError(await readErrorMessage(res, 'Could not load tags.'), res.status);
    const json = await res.json();
    return (json.tags as { id: string; name: string }[]).map(toTag);
  }

  /** Adds a tag (by free-text label) to an entry. Only ever called with one
   * label at a time by this app's UI (the "csv" name is kept only for drop-in
   * compatibility with the repository call site). */
  async addTagsToEntry(entryId: string, tagsCsv: string): Promise<Entry> {
    const name = tagsCsv.split(',')[0]?.trim() ?? tagsCsv.trim();
    const res = await this.authedFetch(`/entries/${entryId}/tags`, { method: 'POST', body: JSON.stringify({ name }) });
    if (!res.ok) throw new BindleApiError(await readErrorMessage(res, 'Could not add tag.'), res.status);
    const json = await res.json();
    return toEntry(json.entry);
  }

  async removeTagFromEntry(entryId: string, tagId: string): Promise<Entry> {
    const res = await this.authedFetch(`/entries/${entryId}/tags/${tagId}`, { method: 'DELETE' });
    if (!res.ok) throw new BindleApiError(await readErrorMessage(res, 'Could not remove tag.'), res.status);
    const json = await res.json();
    return toEntry(json.entry);
  }

  async fetchAnnotations(entryId: string): Promise<Annotation[]> {
    const res = await this.authedFetch(`/entries/${entryId}/annotations`);
    if (!res.ok) throw new BindleApiError(await readErrorMessage(res, 'Could not load highlights.'), res.status);
    const json = await res.json();
    return (json.annotations as RawAnnotation[]).map(toAnnotation);
  }

  async createAnnotation(
    entryId: string,
    annotation: { quote: string; text?: string; ranges: AnnotationRange[] }
  ): Promise<Annotation> {
    const range = annotation.ranges[0];
    const res = await this.authedFetch(`/entries/${entryId}/annotations`, {
      method: 'POST',
      body: JSON.stringify({
        quote: annotation.quote,
        note: annotation.text ?? '',
        startOffset: range?.startOffset ?? 0,
        endOffset: range?.endOffset ?? 0,
      }),
    });
    if (!res.ok) throw new BindleApiError(await readErrorMessage(res, 'Could not save highlight.'), res.status);
    const json = await res.json();
    return toAnnotation(json.annotation);
  }

  async deleteAnnotation(annotationId: string): Promise<void> {
    const res = await this.authedFetch(`/annotations/${annotationId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      throw new BindleApiError(await readErrorMessage(res, 'Could not remove highlight.'), res.status);
    }
  }

  /** Real server-side search (`GET /entries?q=`) — one request, no pagination
   * needed (the server already caps at 500 results). */
  async searchEntriesServer(term: string, _page = 1, _perPage = 500): Promise<EntriesPage> {
    const res = await this.authedFetch(`/entries?q=${encodeURIComponent(term)}`);
    if (!res.ok) throw new BindleApiError(await readErrorMessage(res, 'Search failed.'), res.status);
    const json = await res.json();
    const items = (json.entries as RawEntry[]).map(toEntry);
    return { page: 1, limit: items.length, pages: 1, total: items.length, items };
  }

  async reloadEntry(id: string): Promise<Entry> {
    const res = await this.authedFetch(`/entries/${id}/reload`, { method: 'POST' });
    if (!res.ok) throw new BindleApiError(await readErrorMessage(res, 'Could not refresh this article.'), res.status);
    const json = await res.json();
    return toEntry(json.entry);
  }

  async exportEntry(id: string, format: EntryExportFormat): Promise<{ bytes: ArrayBuffer; contentType: string }> {
    const res = await this.authedFetch(`/entries/${id}/export?format=${format}`);
    if (!res.ok) throw new BindleApiError(await readErrorMessage(res, 'Could not export this article.'), res.status);
    const contentType = res.headers.get('content-type') ?? 'text/plain';
    const bytes = await res.arrayBuffer();
    return { bytes, contentType };
  }

  async checkEntryExists(url: string): Promise<boolean> {
    const res = await this.authedFetch(`/entries/exists?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new BindleApiError(await readErrorMessage(res, 'Could not check that link.'), res.status);
    const json = await res.json();
    return Boolean(json.exists);
  }

  async deleteTagGlobally(tagId: string): Promise<void> {
    const res = await this.authedFetch(`/tags/${tagId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      throw new BindleApiError(await readErrorMessage(res, 'Could not delete tag.'), res.status);
    }
  }

  async bulkSaveLinks(urls: string[]): Promise<BulkSaveResult[]> {
    const res = await this.authedFetch('/entries/bulk', { method: 'POST', body: JSON.stringify({ urls }) });
    if (!res.ok) throw new BindleApiError(await readErrorMessage(res, 'Could not import those links.'), res.status);
    const json = await res.json();
    return json.results as BulkSaveResult[];
  }
}
