import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { WallabagClient, type StoredTokens, type TokenPersistence } from '../api/wallabagClient';
import type { WallabagCredentials } from '../api/types';

const CREDENTIALS_KEY = 'bindle.credentials.v1';
const TOKENS_KEY = 'bindle.tokens.v1';

const tokenPersistence: TokenPersistence = {
  async read() {
    const raw = await SecureStore.getItemAsync(TOKENS_KEY);
    return raw ? (JSON.parse(raw) as StoredTokens) : null;
  },
  async write(tokens) {
    await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens));
  },
};

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
    const raw = await SecureStore.getItemAsync(CREDENTIALS_KEY);
    if (!raw) {
      set({ status: 'signedOut' });
      return;
    }
    const credentials = JSON.parse(raw) as WallabagCredentials;
    const client = new WallabagClient(credentials, tokenPersistence);
    set({
      status: 'signedIn',
      credentials,
      client,
      serverLabel: hostOf(credentials.serverUrl),
    });
  },

  connect: async (credentials: WallabagCredentials) => {
    const client = new WallabagClient(credentials, tokenPersistence);
    await client.testConnection();
    await SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify(credentials));
    set({
      status: 'signedIn',
      credentials,
      client,
      serverLabel: hostOf(credentials.serverUrl),
    });
  },

  signOut: async () => {
    await SecureStore.deleteItemAsync(CREDENTIALS_KEY);
    await SecureStore.deleteItemAsync(TOKENS_KEY);
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
