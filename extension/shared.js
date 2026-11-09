// service worker・コンテンツスクリプト・ポップアップで共有する定義。
// コンテンツスクリプトは ES モジュールにできないため、グローバル宣言で共有する。

// 拡張内で動かす翻訳モデル (Hugging Face から初回だけ取得し、ブラウザにキャッシュする)
// size はファイルの実サイズ。ダウンロード前の空き容量確認と表示に使う
var MODEL = { repo: "pfnet/plamo-3-translate-0.8b-GGUF", file: "plamo-3-translate-0.8b-Q4_K_M.gguf", size: 573125952 };

function mb(bytes) {
  return Math.floor(bytes / 1e6) + "MB";
}

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

/** wllama の createChatCompletion に渡す引数。chat_template_kwargs はモデル同梱のチャットテンプレートが解釈する。 */
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

/** オフスクリーンが報告するモデルの状態を、ポップアップ・ウェルカムページ・トーストに出す文言にする。 */
function statusText(s) {
  if (s.state === "downloading" || s.state === "loading") {
    if (s.progress >= 1) return "モデル初期化中…";
    var verb = s.state === "downloading" ? "モデルをダウンロード中 " : "モデル読み込み中 ";
    return verb + Math.floor(s.progress * 100) + "%";
  }
  return {
    absent: "モデル未ダウンロード",
    ready: "モデル準備完了",
    error: "モデルの読み込みに失敗しました",
  }[s.state] || "モデル未読み込み";
}
