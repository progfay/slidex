# slidex

Claude Code でスライドを高速に作るためのプラットフォーム。
「エンジン」「デザインシステム」「コンテンツ」を分離した3層構成。

```
slidex/
├── engine/           # ビューア: ページ送り・スケーリング・Shadow DOM 注入
│   ├── shell.html    #   開発時のエントリポイント
│   ├── engine.js     #   本体(依存ゼロ・ESM)
│   ├── shell.css     #   シェルUI(ステージ・プログレスバー)
│   └── base.css      #   全スライド共通の基本レイヤー(1280x720 キャンバス)
├── design-system/
│   ├── fonts.css     # @font-face(ドキュメント側。shadow 内では効かないため分離)
│   └── system.css    # トークン + レイアウト(Claude Design 製に差し替える想定)
├── decks/
│   └── demo/         # 1スライド = 1HTML + manifest.json
├── scripts/build.sh  # GitHub Pages 用に dist/ へサイト一式を集約
└── CLAUDE.md         # Claude Code 向けの生成規約
```

## 使い方

### プレビュー

```sh
python3 -m http.server 8000
```

http://localhost:8000/engine/shell.html?deck=../decks/demo を開く。

| 操作 | 動作 |
|---|---|
| → ↓ Space / クリック | 次へ |
| ← ↑ / 画面左端クリック | 前へ |
| Home / End | 先頭 / 末尾 |
| o | 一覧(オーバービュー) |
| `?page=3` | 3ページ目へ直接ジャンプ(URL共有可。旧形式 `#/3` も受け付ける) |

ページ位置は Navigation API 対応ブラウザでは実URL(`?page=N`)に同期され、
非対応環境では自動的にハッシュ(`#/N`)にフォールバックする。

### 新しいデッキを作る

`decks/demo/` をコピーして manifest とスライドを書き換える。
詳細な規約は [CLAUDE.md](./CLAUDE.md) を参照(Claude Code はこれを読んで生成する)。

### GitHub Pages に公開

```sh
./scripts/build.sh   # → dist/
```

`engine/` `design-system/`(CSS のみ)`decks/` を `dist/` にそのままコピーし、
デッキ一覧の `index.html` と `.nojekyll` を生成する。変換は行わない。
`dist/` を GitHub Pages のサイトルートとして配信すれば、各デッキは
`engine/shell.html?deck=../decks/<deck-name>` で閲覧できる。

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
