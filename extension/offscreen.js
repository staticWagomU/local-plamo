import { Wllama, ModelManager, LoggerWithoutDebug } from "./vendor/wllama/index.js";

// PLaMo の語彙は </s> を通常トークンとして持つため、llama.cpp が読み込み時に型の補正を
// 警告する。動作には影響せず chrome://extensions のエラー欄を埋めるだけなので捨てる。
var logger = {
  ...LoggerWithoutDebug,
  warn: function (...args) {
    if (!String(args[0]).startsWith("load:")) console.warn(...args);
  },
};
var MODEL_URL = "https://huggingface.co/" + MODEL.repo + "/resolve/main/" + MODEL.file;
var wllama = null;
var loading = null;
var progress = 0;
// absent: 未保存 / idle: 保存済み・未読み込み / downloading・loading: 取得中・キャッシュから読み込み中 / ready / error
var state = "idle";
var error = null;

// 利用者にそのまま見せる文言。ライブラリ由来の例外とは区別して前置きを付けない。
function userError(message) {
  var e = new Error(message);
  e.userFacing = true;
  return e;
}

async function isCached() {
  var models = await new ModelManager().getModels();
  return models.some(function (m) {
    return m.url === MODEL_URL;
  });
}

async function refreshIdle() {
  if (state === "idle" || state === "absent") state = (await isCached()) ? "idle" : "absent";
}

function load(download) {
  loading ??= Promise.resolve().then(async function () {
    var cached = await isCached();
    if (!cached && !download) {
      state = "absent";
      loading = null;
      throw userError("翻訳モデルがまだダウンロードされていません。ツールバーの拡張アイコンからダウンロードしてください。");
    }
    state = cached ? "loading" : "downloading";
    progress = 0;
    error = null;
    try {
      if (!cached) {
        var est = await navigator.storage.estimate();
        var free = est.quota - est.usage;
        if (free < MODEL.size) {
          throw userError("空き容量が足りません (必要: 約" + mb(MODEL.size) + "、空き: 約" + mb(free) + ")。ディスクの空きを増やしてから再試行してください。");
        }
      }
      wllama = new Wllama({ default: "vendor/wllama/wllama.wasm" }, { logger: logger });
      // 固定URLなら HF API を呼ばず、wllama が先に OPFS キャッシュを確認する。
      await wllama.loadModelFromUrl(MODEL_URL, {
        n_ctx: 8192,
        progressCallback: function (p) {
          progress = p.total ? p.loaded / p.total : 0;
        },
      });
      state = "ready";
    } catch (e) {
      error = String(e.message || e);
      // 途中まで初期化したワーカーを解放し、次の要求では新規インスタンスを使う。
      if (wllama) await wllama.exit().catch(function (cleanupError) { console.warn(cleanupError); });
      wllama = null;
      progress = 0;
      state = "error";
      loading = null;
      throw e;
    }
  });
  return loading;
}

async function translate(body, download) {
  await load(download);
  var res = await wllama.createChatCompletion(body);
  return res.choices[0].message.content;
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.target !== "offscreen") return;
  if (msg.type === "translate") {
    translate(msg.body, msg.download).then(
      function (text) {
        sendResponse({ text: text });
      },
      function (e) {
        var message = String(e.message || e);
        sendResponse({ error: e.userFacing ? message : "翻訳モデルの実行に失敗しました: " + message });
      }
    );
    return true;
  }
  if (msg.type === "load") {
    load(true).catch(function () {});
    sendResponse({});
  }
  if (msg.type === "status") {
    refreshIdle().then(function () {
      sendResponse({ state: state, progress: progress, error: error });
    });
    return true;
  }
});
