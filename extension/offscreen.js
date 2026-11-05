import { Wllama, LoggerWithoutDebug } from "./vendor/wllama/index.js";

var wllama = new Wllama({ default: "vendor/wllama/wllama.wasm" }, { logger: LoggerWithoutDebug });
var loading = null;
var progress = 0;

function load() {
  loading ??= wllama
    .loadModelFromHF(MODEL, {
      n_ctx: 8192,
      progressCallback: function (p) {
        progress = p.total ? p.loaded / p.total : 0;
      },
    })
    .catch(function (e) {
      loading = null;
      throw e;
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
  if (msg.type === "status") sendResponse({ ready: wllama.isModelLoaded(), progress: progress });
});
