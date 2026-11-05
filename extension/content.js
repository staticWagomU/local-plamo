// ページ翻訳・選択テキスト翻訳・原文のホバー表示。shared.js の後に読み込まれる。
(function () {
  if (window.__localTranslatorLoaded) return;
  window.__localTranslatorLoaded = true;

  // 文中に現れ、中身ごと訳文に持ち越すインライン要素
  var INLINE = new Set([
    "A", "ABBR", "B", "BDI", "BDO", "CITE", "CODE", "DATA", "DFN", "EM", "FONT", "I", "INS", "DEL",
    "KBD", "LABEL", "MARK", "Q", "S", "SAMP", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TIME", "U", "VAR",
  ]);
  var SKIP = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "PRE", "TEXTAREA", "INPUT", "SELECT", "OPTION",
    "SVG", "MATH", "CANVAS", "IFRAME", "OBJECT", "VIDEO", "AUDIO", "HEAD",
  ]);
  var TRANSLATED_CLASS = "lt-translated";
  var UI_TAG = "local-translator-ui";

  var settings = Object.assign({}, DEFAULT_SETTINGS);

  // ---- ページ翻訳の状態 ----
  // idle: 原文 / translated: 翻訳表示中 (未訳の部分は画面に近づくと順次翻訳)
  var state = "idle";
  var generation = 0;
  var originals = new WeakMap(); // 訳文 span -> 原文ノード配列
  var pendingRuns = new Map(); // 監視中の要素 -> まだ訳していない run の配列
  var errorShown = false;
  var inflight = 0; // 応答待ちの翻訳リクエスト数 (現在の generation の分だけ数える)
  var doneShown = false;

  var visibility = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        visibility.unobserve(entry.target);
        var runs = pendingRuns.get(entry.target) || [];
        pendingRuns.delete(entry.target);
        runs.forEach(translateRun);
      });
    },
    { rootMargin: "600px 0px" }
  );

  var mutations = new MutationObserver(function (records) {
    records.forEach(function (r) {
      r.addedNodes.forEach(function (node) {
        var root = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        if (root && !isOurs(root)) queueRoot(root);
      });
    });
  });

  function isOurs(el) {
    return !!el.closest("." + TRANSLATED_CLASS + "," + UI_TAG);
  }

  function skipped(el) {
    return (
      SKIP.has(el.tagName.toUpperCase()) ||
      el.isContentEditable ||
      el.getAttribute("translate") === "no" ||
      el.classList.contains("notranslate") ||
      el.classList.contains(TRANSLATED_CLASS) ||
      el.localName === UI_TAG
    );
  }

  function isSimpleInline(el) {
    if (!INLINE.has(el.tagName) || skipped(el)) return false;
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === Node.ELEMENT_NODE && !isSimpleInline(c)) return false;
    }
    return true;
  }

  function hasWords(nodes) {
    var text = nodes
      .map(function (n) {
        return n.textContent;
      })
      .join("");
    return /\p{L}/u.test(text);
  }

  /** 同じ親の中で連続するテキストと単純なインライン要素の並び (run) を集める。 */
  function collectRuns(root, out) {
    if (skipped(root)) return out;
    var run = [];
    var flush = function () {
      while (run.length && run[0].nodeType === Node.TEXT_NODE && !run[0].data.trim()) run.shift();
      while (run.length && run[run.length - 1].nodeType === Node.TEXT_NODE && !run[run.length - 1].data.trim()) run.pop();
      if (run.length && hasWords(run)) out.push({ parent: root, nodes: run });
      run = [];
    };
    for (var c = root.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === Node.TEXT_NODE) run.push(c);
      else if (c.nodeType === Node.ELEMENT_NODE && isSimpleInline(c)) run.push(c);
      else {
        flush();
        if (c.nodeType === Node.ELEMENT_NODE) collectRuns(c, out);
      }
    }
    flush();
    return out;
  }

  function queueRoot(root) {
    if (state !== "translated") return;
    collectRuns(root, []).forEach(function (run) {
      if (!pendingRuns.has(run.parent)) {
        pendingRuns.set(run.parent, []);
        visibility.observe(run.parent);
      }
      pendingRuns.get(run.parent).push(run);
    });
  }

  // ---- モデルとの受け渡し形式 ----
  // インライン要素は属性を落として番号 (i) だけ付けて送る。モデルは番号付きタグを語順に合わせて並べ替える。
  function escapeText(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function serialize(nodes, inlines) {
    return nodes
      .map(function (n) {
        if (n.nodeType === Node.TEXT_NODE) return escapeText(n.data);
        var i = inlines.push(n) - 1;
        var tag = n.localName;
        return "<" + tag + ' i="' + i + '">' + serialize(Array.from(n.childNodes), inlines) + "</" + tag + ">";
      })
      .join("");
  }

  // モデルの出力は信用しない。番号と要素名が元と一致するタグだけを元要素の複製で再構築し、他は中身のテキストだけ残す。
  function rebuild(srcNode, inlines, into) {
    srcNode.childNodes.forEach(function (c) {
      if (c.nodeType === Node.TEXT_NODE) {
        into.appendChild(document.createTextNode(c.data));
      } else if (c.nodeType === Node.ELEMENT_NODE) {
        var orig = inlines[Number(c.getAttribute("i"))];
        if (orig && orig.localName === c.localName) {
          var copy = orig.cloneNode(false);
          rebuild(c, inlines, copy);
          into.appendChild(copy);
        } else {
          rebuild(c, inlines, into);
        }
      }
    });
    return into;
  }

  function translateRun(run) {
    var gen = generation;
    if (!run.nodes.every(function (n) { return n.parentNode === run.parent; })) return;
    var inlines = [];
    var source = serialize(run.nodes, inlines);
    inflight++;
    request(source).then(function (res) {
      if (gen !== generation || state !== "translated") return;
      inflight--;
      // ponytail: 完了通知は翻訳開始ごとに1回だけ。スクロールや動的追加で後から訳す分は通知しない (ツールバーのバッジで見える)
      if (inflight === 0 && !doneShown && !errorShown && !res.error) {
        doneShown = true;
        showToast("翻訳が完了しました");
      }
      if (res.error) return showError(res.error);
      if (!run.nodes.every(function (n) { return n.parentNode === run.parent; })) return;
      var parsed = new DOMParser().parseFromString("<body>" + res.text + "</body>", "text/html").body;
      var span = document.createElement("span");
      span.className = TRANSLATED_CLASS;
      rebuild(parsed, inlines, span);
      run.parent.insertBefore(span, run.nodes[0]);
      run.nodes.forEach(function (n) {
        n.remove();
      });
      originals.set(span, run.nodes);
    });
  }

  function request(text) {
    var context = document.title ? "Title: " + document.title : "";
    return chrome.runtime.sendMessage({ type: "translate", text: text, context: context }).catch(function (e) {
      return { error: String(e.message || e) };
    });
  }

  function translatePage() {
    if (state === "translated") return;
    state = "translated";
    generation++;
    errorShown = false;
    inflight = 0;
    doneShown = false;
    showToast(LANGUAGES[settings.targetLang] + "に翻訳しています…");
    queueRoot(document.body);
    mutations.observe(document.body, { childList: true, subtree: true });
  }

  function restorePage() {
    if (state === "idle") return;
    state = "idle";
    generation++;
    mutations.disconnect();
    visibility.disconnect();
    pendingRuns.clear();
    hideTooltip();
    document.querySelectorAll("." + TRANSLATED_CLASS).forEach(function (span) {
      var nodes = originals.get(span);
      if (nodes) span.replaceWith.apply(span, nodes);
    });
  }

  // ---- 画面上の UI (ページの CSS から隔離するため Shadow DOM に置く) ----
  var ui = document.createElement(UI_TAG);
  var shadow = ui.attachShadow({ mode: "open" });
  shadow.innerHTML =
    "<style>" +
    ":host{all:initial}" +
    ".box{position:fixed;z-index:2147483647;max-width:420px;padding:8px 12px;border-radius:8px;" +
    "background:#1f2933;color:#f5f7fa;font:13px/1.6 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);" +
    "white-space:pre-wrap;pointer-events:none}" +
    ".panel{pointer-events:auto;background:#fff;color:#1f2933;border:1px solid #d9e2ec}" +
    ".btn{position:fixed;z-index:2147483647;width:28px;height:28px;border:none;border-radius:6px;cursor:pointer;" +
    "background:#0f766e;color:#fff;font:bold 13px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2)}" +
    ".toast{position:fixed;right:16px;bottom:16px;z-index:2147483647}" +
    "[hidden]{display:none}" +
    "</style>" +
    '<div class="box" id="tip" hidden></div>' +
    '<button class="btn" id="sel" title="選択した文章を翻訳" hidden>訳</button>' +
    '<div class="box panel" id="panel" hidden></div>' +
    '<div class="box toast" id="toast" hidden></div>';
  var tip = shadow.getElementById("tip");
  var selBtn = shadow.getElementById("sel");
  var panel = shadow.getElementById("panel");
  var toast = shadow.getElementById("toast");
  document.documentElement.appendChild(ui);

  function placeNear(el, rect) {
    var top = rect.bottom + 8;
    if (top + 60 > window.innerHeight) top = Math.max(8, rect.top - 8 - el.offsetHeight);
    el.style.top = top + "px";
    el.style.left = Math.min(Math.max(8, rect.left), window.innerWidth - el.offsetWidth - 8) + "px";
  }

  function showToast(message, ms) {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () {
      toast.hidden = true;
    }, ms || 2500);
  }

  function showError(message) {
    if (errorShown) return;
    errorShown = true;
    showToast(message, 6000);
  }

  // 原文のホバー表示
  function hideTooltip() {
    tip.hidden = true;
  }

  document.addEventListener("mouseover", function (e) {
    if (!settings.hover || state !== "translated") return;
    var span = e.target.closest && e.target.closest("." + TRANSLATED_CLASS);
    var nodes = span && originals.get(span);
    if (!nodes) return hideTooltip();
    tip.textContent = nodes.map(function (n) { return n.textContent; }).join("").trim();
    tip.hidden = false;
    placeNear(tip, span.getBoundingClientRect());
  });

  // 選択テキストの翻訳
  var selectedText = "";
  var selectedRect = null;

  document.addEventListener("mouseup", function (e) {
    if (e.composedPath().includes(ui)) return;
    setTimeout(function () {
      var sel = window.getSelection();
      var text = sel && !sel.isCollapsed ? sel.toString().trim() : "";
      if (!settings.selection || !text || !/\p{L}/u.test(text)) {
        selBtn.hidden = true;
        return;
      }
      selectedText = text;
      selectedRect = sel.getRangeAt(0).getBoundingClientRect();
      selBtn.hidden = false;
      selBtn.style.top = Math.min(selectedRect.bottom + 6, window.innerHeight - 36) + "px";
      selBtn.style.left = Math.min(selectedRect.right, window.innerWidth - 36) + "px";
    }, 0);
  });

  document.addEventListener("mousedown", function (e) {
    if (e.composedPath().includes(ui)) return;
    panel.hidden = true;
    selBtn.hidden = true;
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      panel.hidden = true;
      selBtn.hidden = true;
    }
  });

  function currentSelectionRect() {
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed) return sel.getRangeAt(0).getBoundingClientRect();
    return { top: 16, bottom: 16, left: 16 };
  }

  function translateSelection(source, rect) {
    selBtn.hidden = true;
    panel.textContent = "翻訳中…";
    panel.hidden = false;
    placeNear(panel, rect);
    request(escapeText(source)).then(function (res) {
      var text = res.error
        ? res.error
        : new DOMParser().parseFromString(res.text, "text/html").body.textContent;
      panel.textContent = text;
      placeNear(panel, rect);
    });
  }

  selBtn.addEventListener("click", function () {
    translateSelection(selectedText, selectedRect);
  });

  // ---- 設定・メッセージ・自動翻訳 ----
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "sync") return;
    Object.keys(changes).forEach(function (k) {
      settings[k] = changes[k].newValue;
    });
    if (changes.hover) {
      if (!settings.hover) hideTooltip();
      showToast(settings.hover ? "原文のホバー表示: オン" : "原文のホバー表示: オフ");
    }
    if (changes.targetLang && state === "translated") {
      restorePage();
      translatePage();
    }
  });

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === "toggle-page") {
      state === "idle" ? translatePage() : restorePage();
    } else if (msg.type === "translate-selection") {
      translateSelection(msg.text, currentSelectionRect());
    } else if (msg.type === "translate-page") {
      translatePage();
    } else if (msg.type === "restore-page") {
      restorePage();
    } else if (msg.type === "page-info") {
      sendResponse({ state: state, lang: toModelLang(document.documentElement.lang) });
    }
  });

  loadSettings().then(function (s) {
    settings = s;
    var lang = toModelLang(document.documentElement.lang);
    var siteMatch = s.autoSites.indexOf(location.hostname) !== -1;
    var langMatch = lang !== null && lang !== s.targetLang && s.autoLangs.indexOf(lang) !== -1;
    if (siteMatch || langMatch) translatePage();
  });
})();
