---
name: preview
description: Preview the current slidex deck. Two modes — pick based on the situation. (1) Normal preview, when a local server is reachable (Claude Code's own sandbox, a desktop dev environment): start `python3 -m http.server 8000` at the repo root and open http://localhost:8000/. (2) Artifact preview, when a local server isn't viable — reviewing from a phone or any device that can't reach localhost, or the user explicitly asks for a shareable/Artifact preview: bundle the deck via .claude/skills/preview/build-preview.py and publish it as a Claude Artifact. Use whenever the user asks to preview, check, or review the deck/slides, or after a batch of slide edits when a visual check would help confirm nothing broke.
---

# デッキのプレビュー

プレビューには2つの経路がある。状況に応じて使い分ける。

## 通常のプレビュー: ローカルサーバー

```sh
python3 -m http.server 8000
```

リポジトリルートで実行し、http://localhost:8000/ を開く(ルートの
`index.html` がビューア)。ソースと配信物が同じ構造なのでビルド不要。
ローカルで動けば GitHub Pages 公開後も同じ見た目で動く。

PDF が欲しいときはビューアで ⌘P / Ctrl+P(1スライド = 1ページで出力される。
エンジンが対応済みなのでスライド側での対応は不要)。

## ローカルサーバーが使えないとき: Artifact プレビュー

`slides/` は複数ファイルに分かれているため、ローカルサーバーが使えない環境
(スマホなど)からはそのまま確認できない。同じディレクトリの
`build-preview.py` で1枚の自己完結HTMLに束ね、Artifactとして publish する。

1. `python3 .claude/skills/preview/build-preview.py` を実行する
   (`dist/preview.html` に出力。`dist/` は gitignore 対象なので commit 不要)
2. 出力された `dist/preview.html` を Artifact として publish する
   - title: `manifest.json` の `title` を使う(例: 「◯◯ (preview)」)
   - favicon: 🖼️ で固定する(同じデッキを再publishするときも同じ絵文字にして
     URLを使い回す。faviconを変えると別ページ扱いに見えてしまう)
   - description: 「現在のデッキ(N枚)を1ファイルにまとめたプレビュー」程度で簡潔に
3. デッキを更新した後にまた見たいと言われたら、同じ手順を再実行し、
   **同じファイルパスで再publish**して同じURLを使い回す(新規URLを乱発しない)

## 注意

- Artifact プレビューは配信物ではなくレビュー専用。本番は GitHub Pages が
  `slides/` を `engine.js` 経由で個別に fetch する(このArtifactには関与しない)
- スクリプトは正規表現ベースの簡易パーサ。CLAUDE.md のスライドHTML契約
  (属性はダブルクォート、画像は `src` 属性経由、など)に沿っている限り壊れない
- Artifactの見た目(上下バーの配色)は `design-system/system.css` の
  トークン値を手動で複製して合わせてある。デザインシステム側のトークンを
  変更したら `build-preview.py` の `shell_css` も追随させる
