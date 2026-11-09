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
  var model = { state: "idle" };
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

    $("retry").hidden = model.state !== "error";
    // ダウンロードはページと無関係なので、翻訳できないページでも押せるようにする
    $("toggle").disabled = !page && model.state !== "absent";
    $("toggle").textContent = model.state === "absent"
      ? "モデルをダウンロード (約" + mb(MODEL.size) + ")"
      : !page
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
  function download() {
    chrome.runtime.sendMessage({ type: "download-model" });
    model = { state: "downloading", progress: 0 };
    render();
  }
  $("retry").onclick = download;
  $("toggle").onclick = function () {
    if (model.state === "absent") return download();
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
      model = res;
      $("status").textContent = "● " + statusText(res);
      $("status").className = res.state === "ready" ? "ok" : "ng";
      $("status").title = res.error || (res.state === "idle" ? "最初の翻訳で保存済みのモデルを読み込みます (通信不要)" : "");
    } catch (e) {
      $("status").textContent = "● モデルの状態を取得できません";
      $("status").className = "ng";
      $("status").title = String(e.message || e);
      model = { state: "unknown" };
    } finally {
      render();
      if (!closed) statusTimer = setTimeout(updateStatus, 500);
    }
  }
  updateStatus();
})();
