importScripts("shared.js");

// wllama はひとつのコンテキストで1件ずつしか推論できない
var CONCURRENCY = 1;
var running = 0;
var waiting = [];
var pendingByTab = new Map();

function acquire() {
  if (running < CONCURRENCY) {
    running++;
    return Promise.resolve();
  }
  return new Promise(function (resolve) {
    waiting.push(resolve);
  });
}

function release() {
  var next = waiting.shift();
  if (next) next();
  else running--;
}

function updateBadge(tabId, delta) {
  if (tabId === undefined) return;
  var n = (pendingByTab.get(tabId) || 0) + delta;
  if (n > 0) pendingByTab.set(tabId, n);
  else pendingByTab.delete(tabId);
  chrome.action.setBadgeText({ tabId: tabId, text: n > 0 ? String(n) : "" }).catch(function () {});
}

async function translate(text, context, tabId) {
  var settings = await loadSettings();
  updateBadge(tabId, 1);
  await acquire();
  try {
    await ensureOffscreen();
    var res = await chrome.runtime.sendMessage({ target: "offscreen", type: "translate", body: chatRequest(text, context, settings) });
    if (res.error) throw new Error(res.error);
    return res.text;
  } finally {
    release();
    updateBadge(tabId, -1);
  }
}

var creatingOffscreen = null;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({ url: "offscreen.html", reasons: ["WORKERS"], justification: "翻訳モデルをワーカーで実行する" })
    .finally(function () {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

async function modelStatus() {
  if (!(await chrome.offscreen.hasDocument())) return { ready: false, progress: 0 };
  return chrome.runtime.sendMessage({ target: "offscreen", type: "status" });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === "translate") {
    translate(msg.text, msg.context, sender.tab && sender.tab.id).then(
      function (text) {
        sendResponse({ text: text });
      },
      function (e) {
        sendResponse({ error: String(e.message || e) });
      }
    );
    return true;
  }
  if (msg.type === "status") {
    modelStatus().then(sendResponse);
    return true;
  }
});

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({ id: "toggle-page", title: "このページを翻訳 / 原文に戻す", contexts: ["page"] });
    chrome.contextMenus.create({ id: "translate-selection", title: "「%s」を翻訳", contexts: ["selection"] });
  });
});

function onMenuClick(info, tab) {
  if (!tab || tab.id === undefined) return;
  var msg =
    info.menuItemId === "translate-selection"
      ? { type: "translate-selection", text: info.selectionText }
      : { type: "toggle-page" };
  return chrome.tabs.sendMessage(tab.id, msg, { frameId: info.frameId || 0 }).catch(function () {});
}

chrome.contextMenus.onClicked.addListener(onMenuClick);

chrome.commands.onCommand.addListener(async function (command, tab) {
  if (!tab || tab.id === undefined) return;
  if (command === "toggle-page") {
    chrome.tabs.sendMessage(tab.id, { type: "toggle-page" }).catch(function () {});
  } else if (command === "toggle-hover") {
    var s = await loadSettings();
    await chrome.storage.sync.set({ hover: !s.hover });
  }
});
