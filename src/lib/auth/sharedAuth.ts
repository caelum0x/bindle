import * as SecureStore from 'expo-secure-store';
import { BindleClient } from '../api/bindleClient';
import type { BindleUser } from '../api/types';

/**
 * Single source of truth for where Bindle's session token/account are
 * stored, shared by both the main app (`authStore.ts`) and the iOS share
 * extension (`src/ShareExtension.tsx`) — two separate native targets/
 * processes with separate sandboxes by default, so `KEYCHAIN_ACCESS_GROUP`
 * (the shared App Group added to both targets' entitlements, see
 * `app.json`/`withShareExtensionKeychainAccessGroup`) is what lets them read
 * and write the exact same stored session.
 */
export const KEYCHAIN_ACCESS_GROUP = 'group.app.bindle.mobile';

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  accessGroup: KEYCHAIN_ACCESS_GROUP,
};

const SESSION_KEY = 'bindle.session.v2';

export type StoredSession = {
  token: string;
  user: BindleUser;
};

export async function readStoredSession(): Promise<StoredSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY, SECURE_STORE_OPTIONS);
  return raw ? (JSON.parse(raw) as StoredSession) : null;
}

export async function writeStoredSession(session: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), SECURE_STORE_OPTIONS);
}

export async function clearStoredAuth(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY, SECURE_STORE_OPTIONS);
}

/** Reconstructs a ready-to-use `BindleClient` from whatever session is
 * currently stored in the shared Keychain group, or `null` if the user
 * hasn't signed in yet (from either target's point of view). */
export async function loadStoredClient(): Promise<{ client: BindleClient; session: StoredSession } | null> {
  const session = await readStoredSession();
  if (!session) return null;
  return { client: new BindleClient(session.token), session };
}
