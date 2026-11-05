import { create } from 'zustand';
import { BindleClient, login as apiLogin, signup as apiSignup } from '../api/bindleClient';
import type { BindleUser } from '../api/types';
import { clearStoredAuth, loadStoredClient, writeStoredSession } from './sharedAuth';

type AuthStatus = 'checking' | 'signedOut' | 'signedIn';

type AuthState = {
  status: AuthStatus;
  user: BindleUser | null;
  client: BindleClient | null;
  restore: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  status: 'checking',
  user: null,
  client: null,

  restore: async () => {
    const stored = await loadStoredClient();
    if (!stored) {
      set({ status: 'signedOut' });
      return;
    }
    set({ status: 'signedIn', user: stored.session.user, client: stored.client });
  },

  signUp: async (email: string, password: string) => {
    const { token, user } = await apiSignup(email, password);
    await writeStoredSession({ token, user });
    set({ status: 'signedIn', user, client: new BindleClient(token) });
  },

  signIn: async (email: string, password: string) => {
    const { token, user } = await apiLogin(email, password);
    await writeStoredSession({ token, user });
    set({ status: 'signedIn', user, client: new BindleClient(token) });
  },

  signOut: async () => {
    await clearStoredAuth();
    set({ status: 'signedOut', user: null, client: null });
  },
}));
