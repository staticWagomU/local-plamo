#!/bin/sh
# 翻訳モデルを http://127.0.0.1:8788 で起動する。拡張はここへ直接リクエストする。
set -eu

MODEL_DIR=$(uvx --from huggingface_hub hf download pfnet/plamo-3-translate-2b-MLX-4bit --quiet)

# スナップショット内のファイルはシンボリックリンクで、Python はリンク先 (blobs/) を基準に import する。
# serve.py が同じフォルダの server.py を読めるよう PYTHONPATH を通す。
cd "$MODEL_DIR"
PYTHONPATH="$MODEL_DIR" exec uv run --python 3.12 --with-requirements requirements-mlx.txt \
  python serve.py --model . --trust-remote-code --host 127.0.0.1 --port 8788
