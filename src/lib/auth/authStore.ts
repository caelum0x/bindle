import { create } from 'zustand';
import type { WallabagClient } from '../api/wallabagClient';
import type { WallabagCredentials } from '../api/types';
import { clearStoredAuth, createClient, loadStoredClient, writeStoredCredentials } from './sharedAuth';

type AuthStatus = 'checking' | 'signedOut' | 'signedIn';

type AuthState = {
  status: AuthStatus;
  credentials: WallabagCredentials | null;
  client: WallabagClient | null;
  serverLabel: string | null;
  restore: () => Promise<void>;
  connect: (credentials: WallabagCredentials) => Promise<void>;
  signOut: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  status: 'checking',
  credentials: null,
  client: null,
  serverLabel: null,

  restore: async () => {
    const stored = await loadStoredClient();
    if (!stored) {
      set({ status: 'signedOut' });
      return;
    }
    set({
      status: 'signedIn',
      credentials: stored.credentials,
      client: stored.client,
      serverLabel: hostOf(stored.credentials.serverUrl),
    });
  },

  connect: async (credentials: WallabagCredentials) => {
    const client = createClient(credentials);
    await client.testConnection();
    await writeStoredCredentials(credentials);
    set({
      status: 'signedIn',
      credentials,
      client,
      serverLabel: hostOf(credentials.serverUrl),
    });
  },

  signOut: async () => {
    await clearStoredAuth();
    set({ status: 'signedOut', credentials: null, client: null, serverLabel: null });
  },
}));

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
