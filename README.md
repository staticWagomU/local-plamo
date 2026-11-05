# local-plamo

翻訳モデル [plamo-3-translate-0.8b](https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF) (Q4_K_M) を拡張の中で動かし、Web ページを翻訳する Edge / Chrome 拡張「ローカル翻訳」。翻訳する文章は外部に送信しない。ログインもサーバーも不要。

```
拡張 (extension/) ─ offscreen.html ─ wllama (llama.cpp の WebAssembly 版, WebGPU 対応) ─ モデル
```

モデル (約570MB) は最初に翻訳するときに Hugging Face から一度だけダウンロードし、ブラウザ (OPFS) にキャッシュする。通信はこのダウンロードだけ。

## 使い方

1. Edge で `edge://extensions` を開き、開発者モードを有効にして「展開して読み込み」から `extension/` を選ぶ。
2. ツールバーのアイコンからポップアップを開き、「このページを翻訳」を押す。初回はモデルのダウンロードと読み込みを待つ (ポップアップに進捗が出る)。

## 機能

- ページ全体の翻訳 (Alt+P で翻訳と原文を切り替え)。リンクや強調などの文中のタグは保ったまま訳す。画面に近い部分から順に訳し、後から追加された要素も訳す。
- 選択した文章の翻訳。選択すると出る「訳」ボタンか、右クリックメニューの「「…」を翻訳」から。
- 右クリックメニューの「このページを翻訳 / 原文に戻す」。
- 原文のホバー表示。訳文にマウスを乗せると原文を出す (Alt+H で切り替え)。
- 自動翻訳。サイト単位、またはページの言語単位で登録できる。
- 翻訳先の言語 (モデルが対応する53言語) と、日本語訳の文体 (です・ます / だ・である) の指定。

`pre`・`textarea`・入力欄・`translate="no"`・`.notranslate` の中は訳さない。

## テスト

```sh
cd test && npm install
node --test shared.test.mjs   # 言語コード変換とリクエスト組み立て
node e2e.mjs                  # Chromium に拡張を読み込んで全機能を確認 (初回はモデルをダウンロードする)
```

## wllama の更新

`extension/vendor/wllama/` は [wllama](https://github.com/ngxson/wllama) のビルド成果物 (`esm/index.js` と `esm/wasm/wllama.wasm`)。PLaMo-3 のトークナイザーに対応した llama.cpp (2026-10-06 以降) が要るため、npm 版 3.8.1 ではなく master (33b4346) をビルドしたものを置いている。`npm run build:wasm && npm run build` (Docker が必要) の成果物で置き換える。

## ライセンス

モデルは PLaMo Community License。個人利用・非商用利用は無料。wllama は MIT (`extension/vendor/wllama/LICENCE`)。
