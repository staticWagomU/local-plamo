import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const read = (file) => readFileSync(new URL("../extension/" + file, import.meta.url), "utf8");
const vendorSource = read("vendor/wllama/index.js");
const vendor = vm.createContext({ console, Blob, TextEncoder, TextDecoder, URLSearchParams,
  fetch() { throw new Error("外部通信は禁止"); },
});
vm.runInContext(vendorSource.slice(0, vendorSource.lastIndexOf("export {")), vendor);
const modelURL = "https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF/resolve/main/plamo-3-translate-0.8b-Q4_K_M.gguf";
const blob = new Blob(["cached model fixture"]);

function offscreen({ cached = true, failOnce = false, constructorFails = false, gate } = {}) {
  let listener;
  let downloads = 0;
  let exits = 0;
  const instances = [];
  class Wllama {
    constructor() {
      if (constructorFails && instances.length === 0) {
        instances.push(null);
        throw new Error("constructor failed");
      }
      instances.push(this);
      this.modelManager = new vendor.ModelManager({ cacheManager: {
        list: async () => cached ? [{ name: "cached.gguf", size: blob.size,
          metadata: { originalURL: modelURL, originalSize: blob.size } }] : [],
        open: async () => blob,
      } });
      this.modelManager.downloadModel = async (source, options) => {
        assert.equal(source.url, modelURL);
        downloads++;
        options.progressCallback({ loaded: blob.size, total: blob.size });
        cached = true;
        return { open: async () => [blob] };
      };
    }
    loadModelFromUrl(...args) { return vendor.Wllama.prototype.loadModelFromUrl.apply(this, args); }
    async loadModel(blobs) {
      assert.equal(blobs[0], blob);
      this.proxy = {};
      if (gate) await gate;
      if (failOnce) { failOnce = false; throw new Error("initialization failed"); }
    }
    async exit() { exits++; this.proxy = null; }
    async createChatCompletion() { return { choices: [{ message: { content: "こんにちは" } }] }; }
  }
  const ctx = vm.createContext({ console, Wllama, LoggerWithoutDebug: console,
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } },
  });
  vm.runInContext(read("shared.js"), ctx);
  vm.runInContext(read("offscreen.js").replace(/^import .*;\n/, ""), ctx);
  const send = (type) => new Promise(resolve => listener({ target: "offscreen", type, body: {} }, {}, resolve));
  return { send, instances, stats: () => ({ downloads, exits }) };
}

test("保存済みモデルは HF API・外部通信なしで読み込み、再利用する", async () => {
  const app = offscreen();
  assert.equal((await app.send("status")).state, "idle");
  assert.equal((await app.send("translate")).text, "こんにちは");
  assert.equal((await app.send("status")).state, "ready");
  await app.send("translate");
  assert.equal(app.instances.length, 1);
  assert.equal(app.stats().downloads, 0);
});

test("キャッシュがない場合だけ固定 URL のモデルをダウンロードする", async () => {
  const app = offscreen({ cached: false });
  assert.equal((await app.send("translate")).text, "こんにちは");
  await app.send("translate");
  assert.equal(app.stats().downloads, 1);
});

test("初期化失敗を状態に残し、解放後に新規インスタンスで再試行する", async () => {
  const app = offscreen({ failOnce: true });
  assert.match((await app.send("translate")).error, /initialization failed/);
  const failed = await app.send("status");
  assert.equal(failed.state, "error");
  assert.equal(failed.progress, 0);
  assert.equal(failed.error, "initialization failed");
  assert.equal(app.stats().exits, 1);
  assert.equal((await app.send("translate")).text, "こんにちは");
  assert.equal(app.instances.length, 2);
  assert.equal((await app.send("status")).error, null);
});

test("同期的な生成失敗でも拒否された Promise を保持せず再試行できる", async () => {
  const app = offscreen({ constructorFails: true });
  assert.match((await app.send("translate")).error, /constructor failed/);
  assert.equal((await app.send("translate")).text, "こんにちは");
});

test("初期化中は loading と報告し、読み込みを重複起動しない", async () => {
  let finish;
  const app = offscreen({ gate: new Promise(resolve => { finish = resolve; }) });
  const first = app.send("translate");
  const second = app.send("translate");
  await new Promise(resolve => setImmediate(resolve));
  const status = await app.send("status");
  assert.equal(status.ready, false);
  assert.equal(status.state, "loading");
  assert.equal(status.progress, 1);
  assert.equal(app.instances.length, 1);
  finish();
  await Promise.all([first, second]);
});

test("ポップアップは未開始・初期化中・失敗・準備完了を開いたまま更新する", async () => {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, { add() {}, replaceChildren() {} });
    return elements.get(id);
  };
  let timer;
  let onClose;
  let response = { ready: false, state: "idle", progress: 0 };
  const ctx = vm.createContext({ URL, Option: function () {},
    document: { getElementById: get },
    window: { addEventListener(name, fn) { assert.equal(name, "pagehide"); onClose = fn; } },
    setTimeout(fn) { timer = fn; return 1; }, clearTimeout() { timer = null; },
    chrome: {
      storage: { sync: { get: async defaults => defaults } },
      tabs: { query: async () => [{ id: 1, url: "https://example.com" }], sendMessage: async () => ({ lang: "en", state: "idle" }) },
      runtime: { sendMessage: async () => { if (response instanceof Error) throw response; return response; } },
    },
  });
  vm.runInContext(read("shared.js"), ctx);
  vm.runInContext(read("popup.js"), ctx);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(get("status").textContent, /未読み込み/);
  for (const [res, expected] of [
    [{ state: "loading", progress: 0 }, /読み込み中 0%/],
    [{ state: "loading", progress: 1 }, /初期化中/],
    [{ state: "error", error: "GPU error" }, /失敗/],
    [new Error("connection lost"), /状態を取得できません/],
    [{ ready: true, state: "ready" }, /準備完了/],
  ]) {
    response = res;
    await timer();
    assert.match(get("status").textContent, expected);
    if (res.error) assert.equal(get("status").title, res.error);
  }
  onClose();
  assert.equal(timer, null);
});
