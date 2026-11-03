// Plain-text search helpers for full-text search across saved articles.
//
// Wallabag's own REST API has no free-text search query parameter — confirmed
// against the server's real source (`src/Controller/Api/EntryRestController.php`,
// `getEntriesAction`, github.com/wallabag/wallabag): it only accepts `archive`,
// `starred`, `public`, `notParsed`, `tags`, `since`, `domain_name`, `http_status`,
// `annotations`, `sort`/`order`/`page`/`perPage` — no `search`/`term`/`q` param
// anywhere. So Bindle implements matching itself, client-side, against each
// entry's title/content/domain/url — this file is that matching logic, original
// code, no Wallabag source reused.

/** Strips HTML tags/entities down to the article's plain readable text, so a
 * search match reported mid-content doesn't land inside a tag or attribute. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export type SearchableEntry = {
  title: string;
  url: string;
  content?: string;
  domain_name?: string;
};

/** True if `needle` (case-insensitive substring) appears in the entry's title,
 * domain, URL, or full article body text. */
export function matchesQuery(entry: SearchableEntry, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return false;
  if (entry.title.toLowerCase().includes(q)) return true;
  if ((entry.domain_name ?? '').toLowerCase().includes(q)) return true;
  if (entry.url.toLowerCase().includes(q)) return true;
  if (entry.content && stripHtml(entry.content).toLowerCase().includes(q)) return true;
  return false;
}

/** A short plain-text excerpt centered on the first body match of `needle`, for
 * showing "...context around the hit..." under a search result when the match
 * lives in the article body rather than the title. Returns null when there's no
 * body match (e.g. the hit was only in the title/domain). */
export function snippetFor(
  content: string | undefined,
  needle: string,
  radiusChars = 60
): string | null {
  if (!content) return null;
  const q = needle.trim().toLowerCase();
  if (!q) return null;
  const text = stripHtml(content);
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return null;
  const start = Math.max(0, idx - radiusChars);
  const end = Math.min(text.length, idx + q.length + radiusChars);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}
