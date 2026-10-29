// Injected into the article WebView to turn a text selection into a real Wallabag
// highlight ("annotation") and to re-render highlights already saved on the server.
// Original code — not vendored from anywhere. The range format produced here
// (relative XPath `start`/`end` + `startOffset`/`endOffset`) matches the Annotator.js
// schema Wallabag's own API expects (https://doc.wallabag.org, GET/POST
// /api/annotations/{entry}.json), confirmed by reading the real
// wallabag/wallabag Entity/Annotation.php + Form/Type/RangeType.php source.

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

  // --- Range <-> relative-XPath serialization (Annotator.js-compatible shape) ---

  function kindOf(node) {
    return node.nodeType === 3 ? 'text()' : node.nodeName.toLowerCase();
  }

  function siblingIndex(node) {
    var kind = kindOf(node);
    var i = 0;
    var sib = node.parentNode ? node.parentNode.childNodes : [];
    for (var k = 0; k < sib.length; k++) {
      var n = sib[k];
      if (kindOf(n) === kind) {
        i++;
        if (n === node) return i;
      }
    }
    return i;
  }

  function nodeToPath(node) {
    var r = root();
    if (!r) return null;
    var parts = [];
    var cur = node;
    while (cur && cur !== r) {
      var parent = cur.parentNode;
      if (!parent) return null;
      parts.unshift(kindOf(cur) + '[' + siblingIndex(cur) + ']');
      cur = parent;
    }
    return '/' + parts.join('/');
  }

  function pathToNode(path) {
    var r = root();
    if (!r || !path) return null;
    var segments = path.split('/').filter(Boolean);
    var cur = r;
    for (var s = 0; s < segments.length; s++) {
      var m = segments[s].match(/^(text\\(\\)|[a-zA-Z0-9_-]+)\\[(\\d+)\\]$/);
      if (!m) return null;
      var kind = m[1];
      var index = parseInt(m[2], 10);
      var count = 0;
      var next = null;
      var children = cur.childNodes;
      for (var c = 0; c < children.length; c++) {
        if (kindOf(children[c]) === kind) {
          count++;
          if (count === index) { next = children[c]; break; }
        }
      }
      if (!next) return null;
      cur = next;
    }
    return cur;
  }

  function rangeFromAnnotation(ann) {
    var r0 = ann.ranges && ann.ranges[0];
    if (!r0) return null;
    var startNode = pathToNode(r0.start);
    var endNode = pathToNode(r0.end);
    if (!startNode || !endNode) return null;
    var range = document.createRange();
    try {
      var startLen = startNode.nodeType === 3 ? startNode.length : startNode.childNodes.length;
      var endLen = endNode.nodeType === 3 ? endNode.length : endNode.childNodes.length;
      range.setStart(startNode, Math.min(r0.startOffset, startLen));
      range.setEnd(endNode, Math.min(r0.endOffset, endLen));
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
    var startPath = nodeToPath(pendingRange.startContainer);
    var endPath = nodeToPath(pendingRange.endContainer);
    var startOffset = pendingRange.startOffset;
    var endOffset = pendingRange.endOffset;
    hideButton();
    window.getSelection().removeAllRanges();
    if (!quote.trim() || !startPath || !endPath) return;
    post({
      type: 'createHighlight',
      quote: quote,
      ranges: [{
        start: startPath,
        startOffset: startOffset,
        end: endPath,
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
