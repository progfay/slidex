# DESIGN — slidex デザインシステム仕様

Claude Design で `system.css` を制作するための入力仕様。思想と判断基準は
[PRINCIPLE.md](./PRINCIPLE.md) を参照。成果物は **`design-system/system.css`
1ファイル**。

`system.css` は**デザイントークン(色・タイポグラフィ・余白)と箇条書きの
基本スタイルだけ**を持つ。レイアウト・装飾・見出しや本文の組版は共通クラス
化せず、各スライドの HTML 内 `<style>` でそのつどスライド固有に組む
(「1スライド1ファイルで完結する」の徹底)。

`system.css` の全宣言は `@layer system` に入っている。CSS Cascade Layers の
規則(無レイヤーの通常宣言は詳細度に関係なくレイヤー内の宣言に必ず勝つ)に
より、スライド側の `<style>` は無レイヤーのまま書くだけで要素セレクタ1個
でも `system.css` を上書きできる。詳細度を稼ぐためのクラス重ねは不要。

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
- **既存のトークン名を維持する**(§3 §4 §5 は契約。改名・削除しない。
  追加は自由)。**箇条書き(§6)の基本スタイルも維持する**(手順3で
  スライドの HTML を書き起こす際にそのまま使う前提のため)
- **上記以外の共通クラス(レイアウトクラス・ヘルパークラス・見出しや
  本文の既定スタイル等)を持ち込まない**。それらは各スライドの `<style>`
  側の責務
- **ファイル全体を `@layer system { ... }` で包む**。これによりスライド側の
  無レイヤー `<style>` が詳細度を気にせず常に上書きできる(詳細度を上げる
  ハックが要らない)。この layer 化そのものが技術契約であり外さない

## 2. デザインの方向性(決定事項)

トークンの**値**を決めるときの基準。構造上の強制力はない(各スライドの
`<style>` がどう組むかは自由だが、トークンを使う限り自然とこの方向に寄る)。

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
| 補足(muted 相当) | 20px 目安 | 最小サイズ。これ未満は不可 |
| コード(pre 内) | 19px / line-height 1.7 | |

ダーク背景では細いウェイトが痩せて見える。本文は 400 を基準にしつつ、
見出しは 700 でしっかりコントラストを付ける。

見出しや本文そのもののスタイル(font-family / font-size の適用、和文組版の
調整など)は `system.css` は持たない。各スライドの `<style>` で上記トークン
を使って組む。和文組版(Chromium 前提のため fallback 不要)は必要に応じて
スライド側で以下を使う:

- 全体: `overflow-wrap: anywhere`(はみ出し防止)+ `line-break: strict`
  (禁則強化)+ `text-autospace: normal`(和欧間アキ)+
  `text-spacing-trim: trim-start`(約物のアキ詰め)
- 見出し・大きな表示文字: `font-feature-settings: 'palt'`(文字詰め)+
  `word-break: auto-phrase` + `text-wrap: balance`(文節区切りの均等改行)。
  本文はベタ組み原則のため適用しない
- 本文: `text-wrap: pretty`(行末の孤立文字を改善)
- `code` / `pre` は `text-autospace: no-autospace` で除外し、`pre` は
  `text-spacing-trim: space-all` で約物を等幅のまま維持する

## 5. スペーシング

- `--space-page: 80px`(契約。スライドの内側余白の参考値。各スライドの
  `<style>` で `padding` に使う)
- 余白は詰めるより空ける方向で。1280×720 に対して情報が少なく見えるくらいが
  正しい(PRINCIPLE §4)

## 6. 箇条書き(契約 — `system.css` が唯一持つ基本要素スタイル)

`ul` / `li` だけは共通スタイルとして `system.css` に残す(手順3でスライドの
HTML を書き起こす際、箇条書きは毎回使うため)。

- `ul`: デフォルトマーカーを消し、`flex-direction: column; gap: 16px` で
  積む
- `li`: `--text-body` / line-height 1.7、左に `--color-accent` の小さな
  幾何マーカー(丸)、項目間は `ul` の gap で確保
- それ以外の基本要素(`h1` `h2` `p` `blockquote` `code` `pre` 等)は
  `system.css` に持たない。スライドごとに `<style>` で組む

## 7. 品質チェックリスト(Claude Design の完了条件)

- [ ] トップレベルのセレクタがすべて `.slide` 起点である
- [ ] 全宣言が `@layer system { ... }` の中に入っている
- [ ] `@font-face` `@import` `@media`・外部 URL がない
- [ ] §3 の契約トークン 6 つ、§4 のフォントトークン 3 つ、§5 の
      `--space-page` が全て存在する
- [ ] §6 の箇条書きスタイル(`ul` / `li` / `li::before`)が存在する
- [ ] 箇条書き以外の共通クラス・基本要素スタイル(レイアウトクラス・
      `.accent` `.muted` 等のヘルパークラス・見出しや本文の既定スタイル)を
      持ち込んでいない
- [ ] 本文 24px / ink–bg コントラスト 12:1 / muted–bg 4.5:1 を満たす
