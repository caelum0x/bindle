// Injected into the article WebView (alongside `highlightScript.ts`'s script —
// `injectedJavaScript` only accepts one string, so the two are concatenated at
// the call site in `entry/[id].tsx`, which is safe: both wrap in their own
// guarded IIFE and both end in `true;`) to track and restore reading position.
// Original code — not vendored from anywhere.
//
// Real competitors (Readwise Reader most explicitly) resume an article exactly
// where the reader left off and show a progress indicator in the list — this is
// the client-side half of that; `entriesRepository.markReadProgress` persists
// whatever this script reports into the local SQLite cache (purely on-device,
// never sent to `bindle-core` — see that file's header comment).
//
// Progress is `scrollY / (scrollHeight - innerHeight)`, clamped to [0, 1]; an
// article shorter than one screen reports 1 (fully visible = fully read) rather
// than dividing by a non-positive number. Reported on a short debounce while
// scrolling (not every scroll-frame — no reason to flood the RN bridge) and
// immediately on `visibilitychange`/`pagehide` so backgrounding the app or
// navigating away still saves the latest position rather than losing up to one
// debounce window of progress.

export function buildReadingProgressScript(initialProgress: number): string {
  const clamped = Math.max(0, Math.min(1, initialProgress || 0));

  return `
(function () {
  if (window.__bindleProgressInstalled) return;
  window.__bindleProgressInstalled = true;

  function post(payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  function maxScroll() {
    var doc = document.documentElement;
    return Math.max(0, (doc ? doc.scrollHeight : 0) - window.innerHeight);
  }

  function currentProgress() {
    var max = maxScroll();
    if (max <= 0) return 1;
    var p = window.scrollY / max;
    if (p < 0) return 0;
    if (p > 1) return 1;
    return p;
  }

  function sendNow() {
    post({ type: 'readingProgress', progress: currentProgress() });
  }

  // Restore the saved scroll position once layout has settled. Images loading
  // asynchronously can still grow scrollHeight shortly after the first paint,
  // so this retries a couple of times rather than assuming one attempt is enough.
  var restoreTarget = ${clamped};
  function restoreScroll() {
    if (restoreTarget <= 0.02) return;
    var max = maxScroll();
    if (max > 0) {
      window.scrollTo(0, Math.round(restoreTarget * max));
    }
  }
  setTimeout(restoreScroll, 60);
  setTimeout(restoreScroll, 300);

  var sendTimer = null;
  function scheduleSend() {
    if (sendTimer) return;
    sendTimer = setTimeout(function () {
      sendTimer = null;
      sendNow();
    }, 400);
  }
  window.addEventListener('scroll', scheduleSend, { passive: true });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') sendNow();
  });
  window.addEventListener('pagehide', sendNow);
})();
true;
`;
}
