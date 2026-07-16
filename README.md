# slidex

Claude Code でスライドを高速に作るための**テンプレートリポジトリ**。
「エンジン」「デザインシステム」「コンテンツ」を分離した3層構成で、
**1リポジトリ = 1デッキ**。デッキごとにこのテンプレートから新しいリポジトリを作る。

デモ(テンプレート付属のデッキ): https://progfay.github.io/slidex/

## 新しいデッキを作る

1. GitHub で **Use this template → Create a new repository** からデッキ名のリポジトリを作る
2. clone して Claude Code に発表内容を伝える。テンプレート付属のデモスライドを
   削除して新しいデッキに置き換えるところまで Claude Code が行う
   (手順と生成規約は [CLAUDE.md](./CLAUDE.md) に記載)
3. 公開する場合は **Settings → Pages → Source を「GitHub Actions」** に設定する。
   以降は main への push で自動デプロイされる(有効化前に失敗した workflow は
   Re-run するか、Actions タブから "Deploy to GitHub Pages" を手動実行する)

## 使い方

### プレビュー

```sh
python3 -m http.server 8000
```

http://localhost:8000/ を開く(ソースと配信物が同じ構造なのでビルド不要)。

| 操作 | 動作 |
|---|---|
| → ↓ Space / 画面右端 1/4 クリック | 次へ |
| ← ↑ / 画面左端 1/4 クリック | 前へ |
| o | 一覧(オーバービュー) |
| p | 発表者ビューを別ウィンドウで開く |
| ⌘P / Ctrl+P | PDF に出力(印刷ダイアログ) |
| `?page=3` | 3ページ目へ直接ジャンプ(URL共有可) |

ページ位置は実URL(`?page=N`)に同期される。

### 発表者ビュー

`p` で開く別ウィンドウ(`?presenter`)に、現在のスライド・次のスライド・
発表者ノート(スライド内の `<aside class="notes">`)・経過タイマー(クリックで
リセット)・現在時刻を表示する。ページ位置は BroadcastChannel で上映ウィンドウと
相互同期されるので、どちらのウィンドウで操作してもよい。

### PDF に出力

ビューアで **⌘P / Ctrl+P** を押すと、全スライドのロードを待ってから印刷ダイアログが
開く。送信先を「PDF に保存」にすれば、1スライド = 1ページ・キャンバスと同寸
(1280x720)の PDF がそのまま得られる。用紙サイズや余白の手動設定は不要
(ページ側の `@page` 指定が使われる)。ローカルプレビューでも公開済みの
GitHub Pages でも同じ手順で出力できる。

### スライドを作る

`slides/` にスライドを足し、`manifest.json` の `slides` 配列に列挙する。
詳細な規約は [CLAUDE.md](./CLAUDE.md) を参照(Claude Code はこれを読んで生成する)。

### GitHub Pages に公開

ビルドはない。付属の workflow(`.github/workflows/deploy.yml`)が main への
push でリポジトリ root をそのまま GitHub Pages にデプロイする。**URL 直下で
そのまま上映**が始まり、各スライドは `slides/NN-slug.html` で単体閲覧もできる。

リポジトリの全ファイル(`README.md` や `draft.md` などのソースを含む)が
そのまま配信される前提の運用なので、public リポジトリで使うこと。

### テンプレートの更新を取り込む

デッキリポジトリは作成時点のテンプレートのスナップショットで、テンプレート側の
改善は自動では反映されない。取り込みたくなったら:

```sh
git remote add template https://github.com/progfay/slidex.git
git fetch template
git checkout template/main -- engine index.html CLAUDE.md
```

デッキ側で手を入れていなければ `design-system` もパスに足してよい
(`manifest.json` と `slides/` はデッキ固有なので含めないこと)。

## 構成

```
<デッキ名>/
├── index.html        # ビューアの入口(開くと上映が始まる)
├── manifest.json     # デッキ定義(タイトル・スライドの並び)← デッキごとに編集
├── slides/           # 1スライド = 1HTML(NN-slug.html)← デッキごとに編集
├── assets/           # 画像などのアセット + favicon ← デッキごとに編集
├── engine/           # ビューア: ページ送り・スケーリング・Shadow DOM 注入
│   ├── engine.js     #   本体(依存ゼロ・ESM)
│   ├── shell.css     #   シェルUI(ステージ・プログレスバー)
│   └── base.css      #   全スライド共通の基本レイヤー(1280x720 キャンバス)
├── design-system/
│   └── system.css    # トークン + レイアウト
├── .github/workflows/deploy.yml  # main への push で root をそのまま Pages へデプロイ
└── CLAUDE.md         # Claude Code 向けの生成規約(新デッキの始め方を含む)
```

デッキとして編集するのは `manifest.json` `slides/` `assets/` だけ。それ以外は
プラットフォーム部分で、テンプレートから複製されたまま使う。

## アーキテクチャ上の要点

- **各スライドは Shadow DOM に隔離**。スライド間の CSS 衝突は構造的に起きない
- **デザインシステムは Constructable Stylesheet を全 shadow root で共有**
  (`adoptedStyleSheets`)。差し替えると全スライドに即反映
- **スライドは単体でも開ける完全な HTML**。シェル経由では `<link>` を捨てて
  共有シートに置き換える二重動作。相対パスの `src` / `poster` は取り込み時に
  スライドファイル基準へ解決されるので、単体表示と同じ書き方で動く
- キャンバスは 1280x720 固定。エンジンが `transform: scale()` でフィットさせる

## 動作要件

最新の Chromium 系ブラウザ(Chrome / Edge)。Navigation API・Sanitizer API・
Constructable Stylesheets・View Transitions(types 付き)を fallback なしで使用する。
