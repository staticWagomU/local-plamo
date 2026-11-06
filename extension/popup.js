(async function () {
  var $ = function (id) {
    return document.getElementById(id);
  };
  var settings = await loadSettings();
  var [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  var host = "";
  try {
    var u = new URL(tab.url);
    if (u.protocol === "http:" || u.protocol === "https:") host = u.hostname;
  } catch (e) {}
  var page = await chrome.tabs.sendMessage(tab.id, { type: "page-info" }).catch(function () {
    return null;
  });

  function save(patch) {
    Object.assign(settings, patch);
    return chrome.storage.sync.set(patch);
  }

  function toggled(list, value, on) {
    var rest = list.filter(function (v) {
      return v !== value;
    });
    return on ? rest.concat(value) : rest;
  }

  function render() {
    $("formRow").hidden = settings.targetLang !== "ja";
    $("form").value = settings.form;
    $("selection").checked = settings.selection;
    $("hover").checked = settings.hover;

    $("autoSite").disabled = !host;
    $("autoSite").checked = settings.autoSites.indexOf(host) !== -1;
    $("autoSiteLabel").textContent = host ? host + " を常に翻訳" : "このサイトを常に翻訳";

    var pageLang = page && page.lang;
    $("autoLangRow").hidden = !pageLang || pageLang === settings.targetLang;
    if (pageLang) {
      $("autoLang").checked = settings.autoLangs.indexOf(pageLang) !== -1;
      $("autoLangLabel").textContent = LANGUAGES[pageLang] + "のページを常に翻訳";
    }

    $("autoLangsBox").hidden = settings.autoLangs.length === 0;
    $("autoLangs").replaceChildren.apply(
      $("autoLangs"),
      settings.autoLangs.map(function (code) {
        var b = document.createElement("button");
        b.textContent = LANGUAGES[code] + " ×";
        b.onclick = function () {
          save({ autoLangs: toggled(settings.autoLangs, code, false) }).then(render);
        };
        return b;
      })
    );

    $("toggle").disabled = !page;
    $("toggle").textContent = !page
      ? "このページは翻訳できません"
      : page.state === "idle"
        ? "このページを翻訳"
        : "原文に戻す";
  }

  Object.keys(LANGUAGES).forEach(function (code) {
    $("targetLang").add(new Option(LANGUAGES[code], code));
  });
  $("targetLang").value = settings.targetLang;

  $("targetLang").onchange = function (e) {
    save({ targetLang: e.target.value }).then(render);
  };
  $("form").onchange = function (e) {
    save({ form: e.target.value });
  };
  $("selection").onchange = function (e) {
    save({ selection: e.target.checked });
  };
  $("hover").onchange = function (e) {
    save({ hover: e.target.checked });
  };
  $("autoSite").onchange = function (e) {
    save({ autoSites: toggled(settings.autoSites, host, e.target.checked) });
    if (e.target.checked && page && page.state === "idle") $("toggle").click();
  };
  $("autoLang").onchange = function (e) {
    save({ autoLangs: toggled(settings.autoLangs, page.lang, e.target.checked) }).then(render);
  };
  $("toggle").onclick = function () {
    var next = page.state === "idle" ? "translated" : "idle";
    chrome.tabs.sendMessage(tab.id, { type: next === "idle" ? "restore-page" : "translate-page" });
    page.state = next;
    render();
  };
  $("shortcuts").onclick = function (e) {
    e.preventDefault();
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  };

  render();

  var statusTimer;
  var closed = false;
  window.addEventListener("pagehide", function () {
    closed = true;
    clearTimeout(statusTimer);
  });
  async function updateStatus() {
    try {
      var res = await chrome.runtime.sendMessage({ type: "status" });
      if (!res) throw new Error("モデルの状態を取得できませんでした");
      $("status").textContent = res.ready
        ? "● モデル準備完了"
        : res.state === "error"
          ? "● モデルの読み込みに失敗しました"
          : res.state === "loading"
            ? res.progress >= 1
              ? "● モデル初期化中…"
              : "● モデル読み込み中 " + Math.floor(res.progress * 100) + "%"
            : "● モデル未読み込み";
      $("status").className = res.ready ? "ok" : "ng";
      $("status").title = res.error || (res.ready ? "" : "最初の翻訳でモデルを読み込みます (保存済みなら通信不要)");
    } catch (e) {
      $("status").textContent = "● モデルの状態を取得できません";
      $("status").className = "ng";
      $("status").title = String(e.message || e);
    } finally {
      if (!closed) statusTimer = setTimeout(updateStatus, 500);
    }
  }
  updateStatus();
})();
