import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const ctx = {};
vm.runInNewContext(readFileSync(new URL("../extension/shared.js", import.meta.url), "utf8"), ctx);

test("ページの lang 属性をモデルの言語コードに変換する", () => {
  assert.equal(ctx.toModelLang("en-US"), "en");
  assert.equal(ctx.toModelLang("JA"), "ja");
  assert.equal(ctx.toModelLang("zh-CN"), "zh-hans");
  assert.equal(ctx.toModelLang("zh"), "zh-hans");
  assert.equal(ctx.toModelLang("zh-TW"), "zh-hant");
  assert.equal(ctx.toModelLang("zh-Hant-HK"), "zh-hant");
  assert.equal(ctx.toModelLang("ceb"), "ceb");
});

test("モデルが対応していない言語や空の lang は null", () => {
  assert.equal(ctx.toModelLang("pt-BR"), null);
  assert.equal(ctx.toModelLang(""), null);
  assert.equal(ctx.toModelLang(undefined), null);
});

test("リクエストに設定を反映する", () => {
  const body = ctx.chatRequest("Hello", "Title: x", { targetLang: "ja", form: "plain" });
  assert.deepEqual(JSON.parse(JSON.stringify(body)), {
    messages: [{ role: "user", content: "Hello" }],
    chat_template_kwargs: { target_lang: "ja", context: "Title: x", form: "plain" },
    temperature: 0,
    max_tokens: 4096,
  });
});

test("文体は日本語訳のときだけ、空の文脈は送らない", () => {
  const body = ctx.chatRequest("Hi", "", { targetLang: "en", form: "polite" });
  assert.deepEqual({ ...body.chat_template_kwargs }, { target_lang: "en" });
});
