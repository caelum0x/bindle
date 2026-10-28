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

export class WallabagApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'WallabagApiError';
    this.status = status;
  }
}
