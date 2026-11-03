import * as SecureStore from 'expo-secure-store';
import { WallabagClient, type StoredTokens, type TokenPersistence } from '../api/wallabagClient';
import type { WallabagCredentials } from '../api/types';

/**
 * Single source of truth for where/how Bindle's Wallabag credentials and OAuth
 * tokens are stored, and how a `WallabagClient` is built from them. Used by both
 * the main app (`authStore.ts`) and the iOS share extension (`src/ShareExtension.tsx`)
 * — two separate native targets/processes — so they read and write the exact same
 * stored credentials/tokens instead of each having their own copy of this logic.
 *
 * The iOS Share Extension runs as a different app target with its own bundle ID
 * (`<bundleIdentifier>.ShareExtension`), so by default it has no access to the main
 * app's Keychain items. `KEYCHAIN_ACCESS_GROUP` matches the shared App Group
 * (`group.<bundleIdentifier>`, the default `expo-share-extension` uses, see
 * `app.json`'s `ios.entitlements` and the `withShareExtensionKeychainAccessGroup`
 * config plugin) added to both targets' entitlements as a Keychain Sharing group —
 * Apple's documented pattern of reusing an App Group identifier as a Keychain access
 * group (no separate team-ID-prefixed group needed). Passing it explicitly on every
 * read/write (rather than relying on "first group in the entitlements list" being
 * implicit) keeps this deterministic regardless of entitlement ordering.
 */
export const KEYCHAIN_ACCESS_GROUP = 'group.app.bindle.mobile';

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  accessGroup: KEYCHAIN_ACCESS_GROUP,
};

const CREDENTIALS_KEY = 'bindle.credentials.v1';
const TOKENS_KEY = 'bindle.tokens.v1';

const tokenPersistence: TokenPersistence = {
  async read() {
    const raw = await SecureStore.getItemAsync(TOKENS_KEY, SECURE_STORE_OPTIONS);
    return raw ? (JSON.parse(raw) as StoredTokens) : null;
  },
  async write(tokens) {
    await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens), SECURE_STORE_OPTIONS);
  },
};

export async function readStoredCredentials(): Promise<WallabagCredentials | null> {
  const raw = await SecureStore.getItemAsync(CREDENTIALS_KEY, SECURE_STORE_OPTIONS);
  return raw ? (JSON.parse(raw) as WallabagCredentials) : null;
}

export async function writeStoredCredentials(credentials: WallabagCredentials): Promise<void> {
  await SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify(credentials), SECURE_STORE_OPTIONS);
}

export async function clearStoredAuth(): Promise<void> {
  await SecureStore.deleteItemAsync(CREDENTIALS_KEY, SECURE_STORE_OPTIONS);
  await SecureStore.deleteItemAsync(TOKENS_KEY, SECURE_STORE_OPTIONS);
}

export function createClient(credentials: WallabagCredentials): WallabagClient {
  return new WallabagClient(credentials, tokenPersistence);
}

/** Reconstructs a ready-to-use `WallabagClient` from whatever credentials are
 * currently stored in the shared Keychain group, or `null` if the user hasn't
 * connected a Wallabag server yet (from either target's point of view). */
export async function loadStoredClient(): Promise<
  { client: WallabagClient; credentials: WallabagCredentials } | null
> {
  const credentials = await readStoredCredentials();
  if (!credentials) return null;
  return { client: createClient(credentials), credentials };
}
