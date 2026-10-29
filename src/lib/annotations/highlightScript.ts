// Injected into the article WebView to turn a text selection into a real Wallabag
// highlight ("annotation") and to re-render highlights already saved on the server.
// Original code — not vendored from anywhere.
//
// Range addressing: `startOffset`/`endOffset` are absolute character offsets into the
// article root's full visible text (`start`/`end` are unused placeholders, kept only
// to satisfy the `WallabagAnnotationRange` shape shared with Wallabag's own
// Annotator.js-schema fields — https://doc.wallabag.org, GET/POST
// /api/annotations/{entry}.json; the server stores `ranges` as an opaque blob it never
// interprets, so Bindle is free to define its own meaning here). An earlier version
// used relative-XPath sibling-node-index paths instead (closer to Wallabag's web
// client's own Annotator.js format) but that broke as soon as two highlights shared a
// paragraph: wrapping/unwrapping one highlight's `<mark>` shifts the sibling text-node
// index every *other* highlight in the same paragraph was anchored to, so e.g.
// deleting one highlight silently un-rendered any later highlight sharing its
// paragraph even though it was never deleted. Character offsets are counted by
// walking all text nodes in document order, which is unaffected by `<mark>` wrapping
// (wrapping text doesn't add/remove characters or reorder text nodes), so they stay
// correct regardless of how many sibling highlights currently exist, their render
// order, or deletions — found via a real repro in /tmp/bindle-repro2, 2026-10-29.

/** Returns the full `<script>` body injected once per article load (via
 * `injectedJavaScript`). Builds the selection → highlight-button → postMessage flow
 * and exposes `window.bindleRenderHighlights`/`window.bindleClearHighlights` for the
 * RN side to call after annotations are fetched. */
export function buildHighlightScript(dark: boolean): string {
  const markBg = dark ? '#3A3A3A' : '#E5E5E5';
  const markFg = dark ? '#F5F5F5' : '#111111';
  const btnBg = dark ? '#F5F5F5' : '#111111';
  const btnFg = dark ? '#111111' : '#F5F5F5';

  return `
(function () {
  if (window.__bindleHighlightsInstalled) return;
  window.__bindleHighlightsInstalled = true;

  function post(payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  function root() {
    return document.getElementById('bindle-content');
  }

  // --- Range <-> absolute character-offset serialization (see file header) ---

  function allTextNodes() {
    var r = root();
    var nodes = [];
    if (!r) return nodes;
    var walker = document.createTreeWalker(r, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  function textOffsetOf(node, offset) {
    var nodes = allTextNodes();
    var total = 0;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] === node) return total + offset;
      total += nodes[i].length;
    }
    return total;
  }

  function nodeAtTextOffset(target) {
    var nodes = allTextNodes();
    var total = 0;
    for (var i = 0; i < nodes.length; i++) {
      var len = nodes[i].length;
      if (target <= total + len) return { node: nodes[i], offset: target - total };
      total += len;
    }
    return null;
  }

  function rangeFromAnnotation(ann) {
    var r0 = ann.ranges && ann.ranges[0];
    if (!r0) return null;
    var startPos = nodeAtTextOffset(r0.startOffset);
    var endPos = nodeAtTextOffset(r0.endOffset);
    if (!startPos || !endPos) return null;
    var range = document.createRange();
    try {
      range.setStart(startPos.node, startPos.offset);
      range.setEnd(endPos.node, endPos.offset);
      return range;
    } catch (e) {
      return null;
    }
  }

  // --- Selection -> floating "Highlight" button ---

  var btn = document.createElement('button');
  btn.textContent = 'Highlight';
  btn.setAttribute('style',
    'position:fixed;display:none;z-index:9999;border:none;border-radius:16px;' +
    'padding:8px 16px;font-size:14px;font-family:-apple-system,Roboto,sans-serif;' +
    'background:${btnBg};color:${btnFg};box-shadow:0 2px 8px rgba(0,0,0,0.25);'
  );
  document.body.appendChild(btn);

  var pendingRange = null;

  function hideButton() {
    btn.style.display = 'none';
    pendingRange = null;
  }

  document.addEventListener('selectionchange', function () {
    var sel = window.getSelection();
    var r = root();
    if (!sel || sel.isCollapsed || !r || sel.rangeCount === 0) {
      hideButton();
      return;
    }
    var range = sel.getRangeAt(0);
    if (!r.contains(range.commonAncestorContainer)) {
      hideButton();
      return;
    }
    var rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      hideButton();
      return;
    }
    pendingRange = range.cloneRange();
    btn.style.left = Math.max(8, rect.left) + 'px';
    btn.style.top = Math.max(8, rect.top - 44) + 'px';
    btn.style.display = 'block';
  });

  btn.addEventListener('touchend', confirmHighlight);
  btn.addEventListener('click', confirmHighlight);

  function confirmHighlight(e) {
    e.preventDefault();
    if (!pendingRange) return;
    var quote = pendingRange.toString();
    var startOffset = textOffsetOf(pendingRange.startContainer, pendingRange.startOffset);
    var endOffset = textOffsetOf(pendingRange.endContainer, pendingRange.endOffset);
    hideButton();
    window.getSelection().removeAllRanges();
    if (!quote.trim()) return;
    post({
      type: 'createHighlight',
      quote: quote,
      ranges: [{
        start: '',
        startOffset: startOffset,
        end: '',
        endOffset: endOffset,
      }],
    });
  }

  // --- Rendering saved highlights as <mark> + tap-to-delete ---

  function wrapTextNode(node, start, end, id) {
    var text = node.textContent;
    var before = text.slice(0, start);
    var middle = text.slice(start, end);
    var after = text.slice(end);
    if (!middle) return;
    var mark = document.createElement('mark');
    mark.className = 'bindle-highlight';
    mark.setAttribute('data-annotation-id', String(id));
    mark.setAttribute('style', 'background:${markBg};color:${markFg};border-radius:2px;');
    mark.textContent = middle;
    var parent = node.parentNode;
    if (!parent) return;
    var afterNode = document.createTextNode(after);
    parent.replaceChild(afterNode, node);
    parent.insertBefore(mark, afterNode);
    if (before) parent.insertBefore(document.createTextNode(before), mark);
  }

  function highlightRange(range, id) {
    var r = root();
    if (!r) return;
    if (range.startContainer === range.endContainer && range.startContainer.nodeType === 3) {
      wrapTextNode(range.startContainer, range.startOffset, range.endOffset, id);
      return;
    }
    var walker = document.createTreeWalker(r, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) {
      if (range.intersectsNode ? range.intersectsNode(n) : true) {
        nodes.push(n);
      }
    }
    for (var i = nodes.length - 1; i >= 0; i--) {
      var node = nodes[i];
      var start = node === range.startContainer ? range.startOffset : 0;
      var end = node === range.endContainer ? range.endOffset : node.length;
      if (start < end) wrapTextNode(node, start, end, id);
    }
  }

  window.bindleClearHighlights = function () {
    var r = root();
    if (!r) return;
    var marks = r.querySelectorAll('.bindle-highlight');
    for (var i = 0; i < marks.length; i++) {
      var mark = marks[i];
      var parent = mark.parentNode;
      if (!parent) continue;
      var text = document.createTextNode(mark.textContent || '');
      parent.replaceChild(text, mark);
      parent.normalize();
    }
  };

  window.bindleRenderHighlights = function (json) {
    window.bindleClearHighlights();
    var annotations;
    try {
      annotations = JSON.parse(json);
    } catch (e) {
      return;
    }
    for (var i = 0; i < annotations.length; i++) {
      var ann = annotations[i];
      var range = rangeFromAnnotation(ann);
      if (range) highlightRange(range, ann.id);
    }
  };

  document.addEventListener('click', function (e) {
    var target = e.target;
    while (target && target !== document.body) {
      if (target.classList && target.classList.contains('bindle-highlight')) {
        post({ type: 'deleteHighlightRequest', id: Number(target.getAttribute('data-annotation-id')) });
        return;
      }
      target = target.parentNode;
    }
  });
})();
true;
`;
}
