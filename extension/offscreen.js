import { Wllama, LoggerWithoutDebug } from "./vendor/wllama/index.js";

// PLaMo の語彙は </s> を通常トークンとして持つため、llama.cpp が読み込み時に型の補正を
// 警告する。動作には影響せず chrome://extensions のエラー欄を埋めるだけなので捨てる。
var logger = {
  ...LoggerWithoutDebug,
  warn: function (...args) {
    if (!String(args[0]).startsWith("load:")) console.warn(...args);
  },
};
var wllama = null;
var loading = null;
var progress = 0;
var state = "idle";
var error = null;

function load() {
  loading ??= Promise.resolve().then(async function () {
    state = "loading";
    progress = 0;
    error = null;
    try {
      wllama = new Wllama({ default: "vendor/wllama/wllama.wasm" }, { logger: logger });
      // 固定URLなら HF API を呼ばず、wllama が先に OPFS キャッシュを確認する。
      var url = "https://huggingface.co/" + MODEL.repo + "/resolve/main/" + MODEL.file;
      await wllama.loadModelFromUrl(url, {
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

async function translate(body) {
  await load();
  var res = await wllama.createChatCompletion(body);
  return res.choices[0].message.content;
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.target !== "offscreen") return;
  if (msg.type === "translate") {
    translate(msg.body).then(
      function (text) {
        sendResponse({ text: text });
      },
      function (e) {
        sendResponse({ error: "翻訳モデルの実行に失敗しました: " + String(e.message || e) });
      }
    );
    return true;
  }
  if (msg.type === "status") sendResponse({ ready: state === "ready", state: state, progress: progress, error: error });
});
