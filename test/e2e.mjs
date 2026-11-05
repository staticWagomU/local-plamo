// 拡張を Chromium に読み込み、拡張内の翻訳モデルを実際に動かして各機能を確かめる。
// 初回はモデル (約570MB) をダウンロードする。プロファイルは .profile/ に残し、2回目以降はキャッシュを使う。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { chromium } from "playwright";

const extensionPath = new URL("../extension", import.meta.url).pathname;
const fixture = readFileSync(new URL("fixture.html", import.meta.url));
const server = createServer((req, res) => res.end(fixture)).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const context = await chromium.launchPersistentContext(new URL(".profile", import.meta.url).pathname, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
await worker.evaluate(() => chrome.storage.sync.clear());
const page = await context.newPage();
const japanese = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const html = (sel) => page.$eval(sel, (el) => el.innerHTML);
const text = (sel) => page.$eval(sel, (el) => el.textContent);
const togglePage = () =>
  worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true });
    await chrome.tabs.sendMessage(tab.id, { type: "toggle-page" });
  });
const step = async (name, fn) => {
  await fn();
  console.log("ok -", name);
};

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__localTranslatorLoaded !== undefined || document.querySelector("local-translator-ui"));
  const before = await page.$eval("body", (b) => b.innerHTML);

  await step("Alt+P 相当でページが翻訳され、リンクの href が残る", async () => {
    await togglePage();
    const toast = await page.$eval("local-translator-ui", (ui) => {
      const t = ui.shadowRoot.getElementById("toast");
      return { hidden: t.hidden, text: t.textContent };
    });
    assert.deepEqual(toast, { hidden: false, text: "日本語に翻訳しています…" });
    await page.waitForSelector("#p1 .lt-translated", { timeout: 15 * 60000 });
    assert.match(await text("#p1"), japanese);
    assert.equal(await page.$eval("#p1 a", (a) => a.getAttribute("href")), "https://example.com/guide");
    assert.equal(await page.$eval("#p1 a", (a) => a.className), "link");
    assert.match(await html("#p1"), /<code>npm install<\/code>/);
    await page.waitForFunction(
      () => document.querySelector("local-translator-ui").shadowRoot.getElementById("toast").textContent === "翻訳が完了しました",
      null,
      { timeout: 5 * 60000 }
    );
  });

  await step("入れ子のリストとリンク内のブロックも訳される", async () => {
    await page.waitForSelector("#li1 > .lt-translated");
    await page.waitForSelector("#li2 .lt-translated");
    await page.waitForSelector("#cardTitle .lt-translated");
    await page.waitForSelector("#cardBody .lt-translated");
    assert.equal(await page.$$eval("#li1 > ul", (l) => l.length), 1, "入れ子の ul が残る");
  });

  await step("pre と notranslate は訳さない", async () => {
    assert.equal(await text("#pre"), 'const greeting = "Hello world";');
    assert.equal(await text("#keep"), "Do not translate this sentence.");
  });

  await step("画面外の段落はスクロールするまで訳さない", async () => {
    await page.waitForTimeout(1500);
    assert.equal(await page.$("#far .lt-translated"), null);
    await page.$eval("#far", (el) => el.scrollIntoView());
    await page.waitForSelector("#far .lt-translated", { timeout: 30000 });
  });

  await step("後から追加された要素も訳される", async () => {
    await page.$eval("#dynamic", (el) => {
      el.innerHTML = "<p id='added'>Settings were saved successfully.</p>";
    });
    await page.waitForSelector("#added .lt-translated", { timeout: 30000 });
  });

  await step("訳文にマウスを乗せると原文が出る", async () => {
    await page.hover("#p1 .lt-translated");
    const tip = await page.$eval("local-translator-ui", (ui) => {
      const t = ui.shadowRoot.getElementById("tip");
      return { hidden: t.hidden, text: t.textContent };
    });
    assert.equal(tip.hidden, false);
    assert.equal(tip.text, "Read the installation guide before running npm install.");
  });

  await step("Alt+H 相当でホバー表示を切り替えられる", async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ hover: false }));
    await page.mouse.move(0, 0);
    await page.hover("#title .lt-translated");
    await page.waitForTimeout(200);
    assert.equal(await page.$eval("local-translator-ui", (ui) => ui.shadowRoot.getElementById("tip").hidden), true);
    await worker.evaluate(() => chrome.storage.sync.set({ hover: true }));
  });

  await step("もう一度切り替えると原文の HTML に完全に戻る", async () => {
    await togglePage();
    await page.$eval("#dynamic", (el) => (el.innerHTML = ""));
    assert.equal(await page.$eval("body", (b) => b.innerHTML), before);
  });

  await step("選択した文章を翻訳ボタンから訳せる", async () => {
    await page.$eval("#keep", (el) => el.scrollIntoView());
    const box = await page.$eval("#keep", (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top + r.height / 2, w: r.width };
    });
    await page.mouse.move(box.x + 1, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.w - 1, box.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector("local-translator-ui").shadowRoot.getElementById("sel").hidden);
    await page.$eval("local-translator-ui", (ui) => ui.shadowRoot.getElementById("sel").click());
    await page.waitForFunction(
      (re) => new RegExp(re, "u").test(document.querySelector("local-translator-ui").shadowRoot.getElementById("panel").textContent),
      japanese.source,
      { timeout: 30000 }
    );
  });

  const menuClick = (info) =>
    worker.evaluate(async (info) => {
      const [tab] = await chrome.tabs.query({ active: true });
      await onMenuClick(info, tab);
    }, info);
  const panelText = () =>
    page.$eval("local-translator-ui", (ui) => ui.shadowRoot.getElementById("panel").textContent);

  await step("右クリックメニューの「選択した文章を翻訳」で訳が出る", async () => {
    await page.keyboard.press("Escape");
    await menuClick({ menuItemId: "translate-selection", selectionText: "Good morning, everyone." });
    await page.waitForFunction(
      (re) => new RegExp(re, "u").test(document.querySelector("local-translator-ui").shadowRoot.getElementById("panel").textContent),
      japanese.source,
      { timeout: 30000 }
    );
    assert.doesNotMatch(await panelText(), /Good morning/);
  });

  await step("右クリックメニューの「このページを翻訳」で翻訳と原文が切り替わる", async () => {
    await menuClick({ menuItemId: "toggle-page" });
    await page.waitForSelector("#p1 .lt-translated", { timeout: 60000 });
    await menuClick({ menuItemId: "toggle-page" });
    await page.waitForFunction(() => !document.querySelector(".lt-translated"));
  });

  await step("自動翻訳に登録したサイトは開いた時点で訳される", async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ autoSites: ["127.0.0.1"] }));
    await page.reload();
    await page.waitForSelector("#p1 .lt-translated", { timeout: 60000 });
    await worker.evaluate(() => chrome.storage.sync.set({ autoSites: [] }));
  });

  await step("自動翻訳に登録した言語のページも訳される", async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ autoLangs: ["en"] }));
    await page.reload();
    await page.waitForSelector("#p1 .lt-translated", { timeout: 60000 });
  });

  await step("ポップアップに読み込み済みのモデルの状態が出る", async () => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await popup.waitForFunction(() => document.getElementById("status").textContent === "● モデル準備完了");
    await popup.close();
  });
} finally {
  await context.close();
  server.close();
}
