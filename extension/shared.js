// service worker・コンテンツスクリプト・ポップアップで共有する定義。
// コンテンツスクリプトは ES モジュールにできないため、グローバル宣言で共有する。

var MODEL_URL = "http://127.0.0.1:8788";

var DEFAULT_SETTINGS = {
  targetLang: "ja",
  form: "polite",
  autoSites: [],
  autoLangs: [],
  hover: true,
  selection: true,
};

// 翻訳モデルの対応言語 (モデル README の対応言語表)
var LANGUAGES = {
  ja: "日本語", en: "英語", "zh-hans": "中国語（簡体字）", "zh-hant": "中国語（繁体字）",
  ko: "韓国語", ar: "アラビア語", az: "アゼルバイジャン語", be: "ベラルーシ語",
  bg: "ブルガリア語", bn: "ベンガル語", ca: "カタルーニャ語", ceb: "セブアノ語",
  de: "ドイツ語", es: "スペイン語", et: "エストニア語", eu: "バスク語",
  fa: "ペルシャ語", fr: "フランス語", gu: "グジャラート語", he: "ヘブライ語",
  hi: "ヒンディー語", hr: "クロアチア語", hu: "ハンガリー語", hy: "アルメニア語",
  id: "インドネシア語", it: "イタリア語", jv: "ジャワ語", ka: "ジョージア語",
  kk: "カザフ語", km: "クメール語", lt: "リトアニア語", lv: "ラトビア語",
  ml: "マラヤーラム語", mr: "マラーティー語", ms: "マレー語", my: "ミャンマー語",
  ne: "ネパール語", nl: "オランダ語", pa: "パンジャーブ語", pl: "ポーランド語",
  ru: "ロシア語", si: "シンハラ語", sk: "スロバキア語", sl: "スロベニア語",
  sr: "セルビア語", sw: "スワヒリ語", ta: "タミル語", te: "テルグ語",
  th: "タイ語", tl: "タガログ語", ur: "ウルドゥー語", uz: "ウズベク語",
  vi: "ベトナム語",
};

/** BCP 47 の言語タグ (例: "en-US", "zh-TW") をモデルの言語コードにする。非対応なら null。 */
function toModelLang(tag) {
  if (!tag) return null;
  var parts = tag.toLowerCase().split("-");
  var code = parts[0];
  if (code === "zh") {
    var traditional = parts.some(function (p) {
      return p === "hant" || p === "tw" || p === "hk" || p === "mo";
    });
    code = traditional ? "zh-hant" : "zh-hans";
  }
  return Object.prototype.hasOwnProperty.call(LANGUAGES, code) ? code : null;
}

/** serve.py の /v1/chat/completions に送る本文。 */
function chatRequest(text, context, settings) {
  var kwargs = { target_lang: settings.targetLang };
  if (context) kwargs.context = context;
  if (settings.targetLang === "ja") kwargs.form = settings.form;
  return {
    messages: [{ role: "user", content: text }],
    chat_template_kwargs: kwargs,
    temperature: 0,
    max_tokens: 4096,
  };
}

function loadSettings() {
  return chrome.storage.sync.get(DEFAULT_SETTINGS);
}
