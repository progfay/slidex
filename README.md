# slidex

Claude Code でスライドを高速に作るためのプラットフォーム。
「エンジン」「デザインシステム」「コンテンツ」を分離した3層構成で、
**1リポジトリ = 1デッキ**。

```
slidex/
├── index.html        # ビューアの入口(開くと上映が始まる)
├── manifest.json     # デッキ定義(タイトル・スライドの並び)
├── slides/           # 1スライド = 1HTML(NN-slug.html)
├── engine/           # ビューア: ページ送り・スケーリング・Shadow DOM 注入
│   ├── engine.js     #   本体(依存ゼロ・ESM)
│   ├── shell.css     #   シェルUI(ステージ・プログレスバー)
│   └── base.css      #   全スライド共通の基本レイヤー(1280x720 キャンバス)
├── design-system/
│   ├── fonts.css     # @font-face(ドキュメント側。shadow 内では効かないため分離)
│   └── system.css    # トークン + レイアウト(Claude Design 製に差し替える想定)
├── scripts/build.sh  # GitHub Pages 用に dist/ へサイト一式を集約
└── CLAUDE.md         # Claude Code 向けの生成規約
```

## 使い方

### プレビュー

```sh
python3 -m http.server 8000
```

http://localhost:8000/ を開く(ソースと配信物が同じ構造なのでビルド不要)。

| 操作 | 動作 |
|---|---|
| → ↓ Space / クリック | 次へ |
| ← ↑ / 画面左端クリック | 前へ |
| Home / End | 先頭 / 末尾 |
| o | 一覧(オーバービュー) |
| `?page=3` | 3ページ目へ直接ジャンプ(URL共有可。旧形式 `#/3` も受け付ける) |

ページ位置は Navigation API 対応ブラウザでは実URL(`?page=N`)に同期され、
非対応環境では自動的にハッシュ(`#/N`)にフォールバックする。

### スライドを作る

`slides/` にスライドを足し、`manifest.json` の `slides` 配列に列挙する。
詳細な規約は [CLAUDE.md](./CLAUDE.md) を参照(Claude Code はこれを読んで生成する)。
別のデッキを作るときはリポジトリごと複製する(1リポジトリ = 1デッキ)。

### GitHub Pages に公開

```sh
./scripts/build.sh   # → dist/
```

`index.html` `manifest.json` `slides/` `engine/` `design-system/`(CSS のみ)を
`dist/` にそのままコピーし、`.nojekyll` を足す。変換は行わない。
`dist/` を GitHub Pages のサイトルートとして配信すれば、**URL 直下でそのまま
上映**が始まり、各スライドは `slides/NN-slug.html` で単体閲覧もできる。

## アーキテクチャ上の要点

- **各スライドは Shadow DOM に隔離**。スライド間の CSS 衝突は構造的に起きない
- **デザインシステムは Constructable Stylesheet を全 shadow root で共有**
  (`adoptedStyleSheets`)。差し替えると全スライドに即反映
- **スライドは単体でも開ける完全な HTML**。シェル経由では `<link>` を捨てて
  共有シートに置き換える二重動作
- **@font-face はドキュメントスコープ**なので `fonts.css` に分離してある
- キャンバスは 1280x720 固定。エンジンが `transform: scale()` でフィットさせる

## 動作要件

モダンブラウザ(Chrome / Edge / Firefox / Safari の最新)。
Constructable Stylesheets を使用。
Navigation API は任意(あれば実URL遷移、なければハッシュ遷移)。
View Transition API も任意(あればページ送りに遷移演出、なければ即時切り替え。
`prefers-reduced-motion` では常に即時)。
