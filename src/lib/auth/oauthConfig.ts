// Client ids for native Google Sign-In, read from env at build time
// (`EXPO_PUBLIC_*` vars are inlined into the JS bundle, same convention as
// `BINDLE_API_URL` in `bindleClient.ts`). OWNER BLOCKER: real values require
// a Google Cloud Console project (OAuth consent screen + iOS/Android/web
// client ids) — owner-only login step, tracked in plans/bindle.md. Unset
// means the Google button stays wired but inert: `isGoogleSignInConfigured`
// is false, so `connect.tsx` shows a "not configured yet" message instead of
// launching a browser session that could never succeed.
export const GOOGLE_IOS_CLIENT_ID = (process.env.EXPO_PUBLIC_BINDLE_GOOGLE_IOS_CLIENT_ID ?? '').trim();
export const GOOGLE_ANDROID_CLIENT_ID = (process.env.EXPO_PUBLIC_BINDLE_GOOGLE_ANDROID_CLIENT_ID ?? '').trim();
export const GOOGLE_WEB_CLIENT_ID = (process.env.EXPO_PUBLIC_BINDLE_GOOGLE_WEB_CLIENT_ID ?? '').trim();

export const isGoogleSignInConfigured: boolean =
  GOOGLE_IOS_CLIENT_ID.length > 0 || GOOGLE_ANDROID_CLIENT_ID.length > 0 || GOOGLE_WEB_CLIENT_ID.length > 0;
