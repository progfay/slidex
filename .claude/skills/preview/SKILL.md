---
name: preview
description: Preview the current slidex deck. Three modes — pick based on the situation. (1) Normal preview, when a local server is reachable (Claude Code's own sandbox, a desktop dev environment): start `python3 -m http.server 8000` at the repo root and open http://localhost:8000/. (2) Artifact preview, when a local server isn't viable — reviewing from a phone or any device that can't reach localhost, or the user explicitly asks for a shareable/Artifact preview: bundle the deck via .claude/skills/preview/build-preview.py and publish it as a Claude Artifact. (3) Self-check, when Claude itself (not the user) needs to visually confirm a slide rendered correctly before reporting work as done: screenshot it headlessly via .claude/skills/preview/self-check.mjs and Read the resulting PNG. Use whenever the user asks to preview, check, or review the deck/slides, or after a batch of slide edits when a visual check would help confirm nothing broke.
---

# デッキのプレビュー

プレビューには3つの経路がある。状況に応じて使い分ける。

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

Artifact プレビューにはステージ下部(ナビゲーションバーの上)に発表者ノート
(`<aside class="notes">`)を読み取り専用で表示する横長のノートバーがあり、
「+コメント」からそこに指摘を1件追加できる。右のサイドバーは「指摘」一覧
(画面全体の高さを保つ)で、スライドをタップして付けた通常の指摘・
「+全体へコメント」・ノートバーの「+コメント」がすべて同じ一覧にまとまり、
「コピー」で一括してテキスト化できる(ノートへの指摘は `ファイル名 — 発表者
ノート` という見出しで出る)。ユーザーからこのコピーを渡されたら、指摘は該当
`slides/*.html` の該当箇所を、発表者ノートへの指摘は `<aside class="notes">`
の内容を直す。

## Claude自身が見る: セルフチェック

上の2つはどちらも**人間が見るための**プレビュー。ここは逆に、Claude が
「リッチ化した装飾が実際に崩れていないか」「レイアウトが意図通りか」を
作業完了と報告する前に**自分の目で**確認するための経路。テキストの読み合わせ
(HTMLソースを読む)だけでは検出できない、見た目の崩れの確認に使う。

`.claude/skills/preview/self-check.mjs` が、動いている通常プレビュー
(モード1、`http://localhost:8000/`)を Playwright でヘッドレス起動して
1280x720(キャンバス実寸、スケーリングなし)でスクリーンショットする。

1. モード1のローカルサーバーを起動済みであることを確認する(未起動なら
   `python3 -m http.server 8000` をバックグラウンドで)
2. セッションの scratchpad で(**リポジトリには入れない**。engine/ の
   依存ゼロ方針を維持するため、Playwright は scratchpad 限定の使い捨て
   依存として都度入れる):
   ```sh
   npm init -y >/dev/null && npm i playwright@1.60.0
   ```
   バージョンはこのマシンの `~/Library/Caches/ms-playwright` にキャッシュ済みの
   Chromium リビジョンに合わせてピン留めしてあり([[playwright-cached-chromium]]
   参照)、これを使えばブラウザの再ダウンロードなしに即動く。キャッシュの中身が
   変わっていたら memory の対応表の調べ方に従って新しいバージョンを調べ直す。
3. `self-check.mjs` を scratchpad にコピーし(node のモジュール解決はスクリプト
   自身の場所基準で `node_modules` を探すため、`npm i` した場所と同じ階層に
   置く必要がある)、見たいスライド番号(`manifest.json` の並び順、1始まり)を
   指定して実行する:
   ```sh
   node self-check.mjs http://localhost:8000/ <出力先ディレクトリ> 3 4 5
   ```
4. 出力された `slide-03.png` などを Read ツールで読み、見た目を確認する

## 注意

- Artifact プレビューは配信物ではなくレビュー専用。本番は GitHub Pages が
  `slides/` を `engine.js` 経由で個別に fetch する(このArtifactには関与しない)
- スクリプトは正規表現ベースの簡易パーサ。CLAUDE.md のスライドHTML契約
  (属性はダブルクォート、画像は `src` 属性経由、など)に沿っている限り壊れない
- Artifactの見た目(上下バーの配色)は `design-system/system.css` の
  トークン値を手動で複製して合わせてある。デザインシステム側のトークンを
  変更したら `build-preview.py` の `shell_css` も追随させる
