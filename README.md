# local-plamo

手元の Mac で動く翻訳モデル [plamo-3-translate-2b-MLX-4bit](https://huggingface.co/pfnet/plamo-3-translate-2b-MLX-4bit) を使って、Web ページを翻訳する Edge / Chrome 拡張「ローカル翻訳」。翻訳する文章は外部に送信しない。ログインも不要。

```
拡張 (extension/) ──▶ モデルサーバー (local-server/start.sh, 127.0.0.1:8788)
```

## 使い方

前提: Apple silicon の Mac と `uv`。

1. モデルサーバーを起動する。初回はモデル (約1.5GB) をダウンロードする。Ctrl+C で止まる。
   ```sh
   sh local-server/start.sh
   # uv が PATH に無い場合
   mise exec uv@latest -- sh local-server/start.sh
   ```
2. Edge で `edge://extensions` を開き、開発者モードを有効にして「展開して読み込み」から `extension/` を選ぶ。
3. ツールバーのアイコンからポップアップを開き、「このページを翻訳」を押す。

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
node e2e.mjs                  # Chromium に拡張を読み込んで全機能を確認 (モデルサーバーの起動が必要)
```

## ライセンス

モデルは PLaMo Community License。個人利用・非商用利用は無料。
