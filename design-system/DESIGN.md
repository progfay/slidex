# DESIGN — slidex デザインシステム仕様

Claude Design で `system.css` を制作するための入力仕様。思想と判断基準は
[PRINCIPLE.md](./PRINCIPLE.md) を参照。成果物は **`design-system/system.css`
1ファイル**。

## 1. 技術制約(MUST — エンジンとの契約)

これらを破ると表示自体が壊れる。デザイン上の裁量はない。

- **すべてのセレクタを `.slide` スコープ配下に書く**。`:root` `html` `body`
  素の要素セレクタをトップレベルで使わない(単体表示時にページ全体を
  汚染しないため)
- **キャンバスは 1280×720px 固定**。メディアクエリ・レスポンシブ対応は
  書かない(エンジンが `transform: scale()` でフィットさせる)
- この CSS は Constructable Stylesheet として全スライドの Shadow DOM に
  共有適用される。**`@font-face` を書かない**(shadow 内では無効。フォントは
  システムフォントを使う)
- **依存ゼロ**。`@import`・外部 URL 参照(CDN フォント・画像)を書かない
- 以下は `engine/base.css` の責務なので書かない:
  キャンバスサイズと scale、`box-sizing: border-box`、`overflow: hidden`、
  `aside.notes { display: none }`
- **既存のトークン名とレイアウトクラス名を維持する**(slides/ 内の既存
  スライドが参照している)。§3 の「契約トークン」と §6 のクラス名は
  改名・削除しない。追加は自由

## 2. デザインの方向性(決定事項)

- **ダーク基調・ブルーグレー背景・シアンアクセント**
- ミニマル。ターミナルモチーフ(プロンプト記号、ウィンドウクローム等)は
  使わない
- 見出しに装飾要素(下線バー等)を付けない。階層はサイズ・ウェイト・余白で
- 日本語システムフォント(Hiragino / Noto Sans JP フォールバック)を維持
- 用途は汎用(登壇・画面共有・配布)。基準は「会場の最後列で読める」

## 3. カラートークン

**名前は契約(維持必須)**、値は参考値(この方向性の中で Claude Design が
調整してよい)。すべて `.slide` 上に CSS 変数として定義する。

### 契約トークン(既存 slides が参照)

| トークン | 参考値 | 役割 |
|---|---|---|
| `--color-bg` | `#10141F` | 背景。ブルーグレーの暗色(純黒にしない) |
| `--color-ink` | `#E8EDF6` | 本文。bg とのコントラスト比 12:1 以上 |
| `--color-muted` | `#8C96AB` | 補足・キャプション。bg と 4.5:1 以上 |
| `--color-accent` | `#5CCFE6` | シアン。強調・リストマーカー。1スライド1箇所目安 |
| `--color-code-bg` | `#171D2B` | コードブロック背景。bg よりわずかに明るい面 |
| `--color-code-ink` | `#DDE4F0` | コード本文 |

### 追加トークン(新規定義)

| トークン | 参考値 | 役割 |
|---|---|---|
| `--color-surface` | `#171D2B` | 持ち上がった面(引用背景・パネル等)。code-bg と共通で可 |
| `--color-line` | `#2A3245` | 罫線・区切り。主張しない明度 |
| `--color-success` | `#7DD8A0` | 良い例・追加・OK |
| `--color-warning` | `#F0C674` | 注意・非推奨 |
| `--color-danger` | `#F2708A` | 悪い例・削除・NG |

セマンティック色は**意味があるときだけ**使う(比較・diff・警告)。装飾には
使わない。

## 4. タイポグラフィ

### フォントトークン(契約)

```css
--font-display: 'Hiragino Sans', 'Noto Sans JP', system-ui, sans-serif;
--font-body:    'Hiragino Sans', 'Noto Sans JP', system-ui, sans-serif;
--font-mono:    ui-monospace, 'SF Mono', Menlo, monospace;
```

### スケール(参考値。1280×720 の実 px で指定)

| 用途 | サイズ | 備考 |
|---|---|---|
| タイトルスライド h1 | 72px / bold | letter-spacing をわずかに詰める |
| 通常スライド h1 | 52px / bold | |
| h2 | 32px / bold | |
| 本文・li | 24px / line-height 1.7 | **これより小さい本文を作らない** |
| 補足(`.muted` 等) | 20px 目安 | 最小サイズ。これ未満は不可 |
| コード(pre 内) | 19px / line-height 1.7 | |

ダーク背景では細いウェイトが痩せて見える。本文は 400 を基準にしつつ、
見出しは 700 でしっかりコントラストを付ける。

## 5. スペーシング

- `--space-page: 80px`(契約。スライドの内側余白)
- 余白は詰めるより空ける方向で。1280×720 に対して情報が少なく見えるくらいが
  正しい(PRINCIPLE §4)

## 6. 基本要素とレイアウト

`.slide` は `display: flex; flex-direction: column` を基本とし、各レイアウトは
`justify-content` や子要素の `flex` で高さを配分する。

### 基本要素(レイアウト非依存)

- `h1` `h2` `p`: §4 のスケール。装飾なし
- `ul > li`: デフォルトマーカーを消し、アクセント色の小さな幾何マーカー
  (短いバー等、ミニマルな形)に置き換える。項目間は 16px 程度
- `strong`: bold。色は変えない(色の強調は `.accent` 等の明示クラスで)
- `.muted`: `--color-muted`
- `code`(インライン): mono、`--color-surface` 系の淡い面 + 小さな角丸
- `pre`: `--color-code-bg`、padding 28〜32px、角丸 8px、`overflow: hidden`

### レイアウトクラス(`<body class="slide layout-*">` で指定)

**既存(クラス名・マークアップ契約を維持):**

| クラス | 仕様 | マークアップ契約 |
|---|---|---|
| (`slide` のみ) | 標準。見出し+本文/箇条書き | — |
| `layout-title` | 縦中央寄せ。h1 72px、`.subtitle` は muted 28px | `.subtitle` |
| `layout-section` | セクション区切り。見出しを縦中央寄せして章の切り替わりを示す(配色は反転しない) | — |
| `layout-code` | `pre` が残り高さいっぱいに広がる | `pre > code` |

**新規追加:**

| クラス | 仕様 | マークアップ契約 |
|---|---|---|
| `layout-quote` | キーメッセージ。縦中央寄せ、`blockquote` を 44〜56px の大きな文字で。引用記号の装飾は付けない。`.attribution` は muted で下に | `blockquote` + `.attribution`(任意) |
| `layout-image` | 画像フルブリード。`.slide` の padding を 0 にし、`img` を `width/height: 100%; object-fit: cover` で全面に。`.caption` は下辺にオーバーレイ(可読性のためのスクリム/グラデーション可 — 数少ない「仕事のある装飾」) | `img` + `.caption`(任意) |

## 7. コードのシンタックスハイライト

ライブラリは使わない。スライド生成時に Claude が `<span class="tok-*">` を
埋める前提で、**クラスだけ**を定義する。色相はパレットの再利用に限定し、
新しい色相を持ち込まない(PRINCIPLE §3)。

| クラス | 役割 | 参考色 |
|---|---|---|
| `.tok-kw` | キーワード | アクセント(シアン) |
| `.tok-fn` | 関数・メソッド名 | ink より少し明るく/青み(例 `#A8B8E8`) |
| `.tok-str` | 文字列 | success 系グリーン |
| `.tok-num` | 数値・定数 | warning 系アンバー |
| `.tok-com` | コメント | muted より暗く(例 `#5F6B84`) |

ハイライトなしの単色コードも成立するように、`--color-code-ink` 単体で
十分読めること。

## 8. 品質チェックリスト(Claude Design の完了条件)

- [ ] トップレベルのセレクタがすべて `.slide` 起点である
- [ ] `@font-face` `@import` `@media`・外部 URL がない
- [ ] §3 の契約トークン 6 つと §6 の既存クラス 5 つが全て存在する
- [ ] `slides/` の 8 枚が崩れずに表示される(規約のリファレンスデッキ)
- [ ] 本文 24px / ink–bg コントラスト 12:1 / muted–bg 4.5:1 を満たす
- [ ] 見出し・リスト以外に恒常的な装飾要素がない
