import { create } from 'zustand';
import {
  BindleClient,
  login as apiLogin,
  signup as apiSignup,
  oauthGoogle as apiOauthGoogle,
  oauthApple as apiOauthApple,
  verifyMagicLink as apiVerifyMagicLink,
} from '../api/bindleClient';
import type { BindleUser } from '../api/types';
import { clearStoredAuth, loadStoredClient, writeStoredSession } from './sharedAuth';

type AuthStatus = 'checking' | 'signedOut' | 'signedIn';

type AuthState = {
  status: AuthStatus;
  user: BindleUser | null;
  client: BindleClient | null;
  restore: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  /** `mfaCode` is omitted on the first attempt; a `BindleApiError` with
   * `mfaRequired: true` means the password was correct and the caller should
   * re-call with the code the user just typed. */
  signIn: (email: string, password: string, mfaCode?: string) => Promise<void>;
  signInWithGoogle: (idToken: string) => Promise<void>;
  signInWithApple: (idToken: string) => Promise<void>;
  signInWithMagicLinkToken: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const applySession = (
  set: (partial: Partial<AuthState>) => void,
  session: { token: string; user: BindleUser }
): Promise<void> =>
  writeStoredSession(session).then(() => {
    set({ status: 'signedIn', user: session.user, client: new BindleClient(session.token) });
  });

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
    const session = await apiSignup(email, password);
    await applySession(set, session);
  },

  signIn: async (email: string, password: string, mfaCode?: string) => {
    const session = await apiLogin(email, password, mfaCode);
    await applySession(set, session);
  },

  signInWithGoogle: async (idToken: string) => {
    const session = await apiOauthGoogle(idToken);
    await applySession(set, session);
  },

  signInWithApple: async (idToken: string) => {
    const session = await apiOauthApple(idToken);
    await applySession(set, session);
  },

  signInWithMagicLinkToken: async (token: string) => {
    const session = await apiVerifyMagicLink(token);
    await applySession(set, session);
  },

  signOut: async () => {
    await clearStoredAuth();
    set({ status: 'signedOut', user: null, client: null });
  },
}));
