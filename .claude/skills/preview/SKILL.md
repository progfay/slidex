---
name: preview
description: Bundle the current slidex deck (manifest.json + slides/ + design-system/) into one self-contained HTML file via tools/build-preview.py and publish it as a Claude Artifact, so it can be reviewed on a phone or any device that can't run a local server. Use when the user asks to preview, check, or review the deck/slides — especially "on my phone" — or asks for an Artifact preview of the current slides.
---

# デッキのプレビュー

`slides/` は複数ファイルに分かれているため、ローカルサーバーが使えない環境
(スマホなど)からはそのまま確認できない。`tools/build-preview.py` で1枚の
自己完結HTMLに束ね、Artifactとして publish する。

## 手順

1. `python3 tools/build-preview.py` を実行する
   (`dist/preview.html` に出力。`dist/` は gitignore 対象なので commit 不要)
2. 出力された `dist/preview.html` を Artifact として publish する
   - title: `manifest.json` の `title` を使う(例: 「◯◯ (preview)」)
   - favicon: 🖼️ で固定する(同じデッキを再publishするときも同じ絵文字にして
     URLを使い回す。faviconを変えると別ページ扱いに見えてしまう)
   - description: 「現在のデッキ(N枚)を1ファイルにまとめたプレビュー」程度で簡潔に
3. デッキを更新した後にまた見たいと言われたら、同じ手順を再実行し、
   **同じファイルパスで再publish**して同じURLを使い回す(新規URLを乱発しない)

## 注意

- これは配信物ではなくレビュー専用。本番はGitHub Pagesが `slides/` を
  `engine.js` 経由で個別にfetchする(このArtifactには関与しない)
- スクリプトは正規表現ベースの簡易パーサ。CLAUDE.mdのスライドHTML契約
  (属性はダブルクォート、画像は `src` 属性経由、など)に沿っている限り壊れない
- Artifactの見た目(上下バーの配色)は `design-system/system.css` の
  トークン値を手動で複製して合わせてある。デザインシステム側のトークンを
  変更したら `tools/build-preview.py` の `shell_css` も追随させる
