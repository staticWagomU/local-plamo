import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
const requestSource = source.slice(source.indexOf("  async function request(text)"), source.indexOf("  function translatePage()"));
function requestWith(sendMessage) {
  const ctx = vm.createContext({ document: { title: "Example" }, chrome: { runtime: { sendMessage } } });
  vm.runInContext(requestSource, ctx);
  return ctx.request;
}

test("拡張コンテキスト無効化の同期例外はページ再読み込みの案内になる", async () => {
  const request = requestWith(() => { throw new Error("Extension context invalidated."); });
  assert.match((await request("Hello")).error, /このページを再読み込み/);
});

test("非同期の送信失敗もエラー応答に変換する", async () => {
  const request = requestWith(async () => { throw new Error("Connection closed"); });
  assert.equal((await request("Hello")).error, "Connection closed");
});

test("翻訳結果と送信する文章・文脈を保持する", async () => {
  const request = requestWith(async message => {
    assert.equal(message.type, "translate");
    assert.equal(message.text, "Hello");
    assert.equal(message.context, "Title: Example");
    return { text: "こんにちは" };
  });
  assert.equal((await request("Hello")).text, "こんにちは");
});
