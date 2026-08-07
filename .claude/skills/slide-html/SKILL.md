---
name: slide-html
description: スライド1枚のHTMLを新規作成・編集するときのリファレンス。単体表示可能な完全HTML構造、キャンバス1280x720固定、body classに必須の`slide`、assets/画像参照ルール、@font-face禁止などの契約、デザイントークンの参照先、箇条書き以外は各スライドの<style>でレイアウト・見出し・本文を組む方針をまとめている。concept.mdをHTMLへ書き起こす手順3、リッチ化する手順5、既存のslides/*.htmlのレイアウトやスタイルを直すときに読む。
---

# スライドHTMLの契約

各スライドは**単体でブラウザで開いても表示できる完全なHTML**として書く。

```html
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>スライドのタイトル</title>
  <link rel="stylesheet" href="../design-system/system.css">
  <style>
    /* このスライドの見た目はすべてここで組む。
       background / color / font-family / padding / レイアウトは
       system.css が与えてくれないので、トークンを使って自分で書く */
    .slide {
      display: flex;
      flex-direction: column;
      gap: 24px;
      padding: var(--space-page);
      background: var(--color-bg);
      color: var(--color-ink);
      font-family: var(--font-body);
      font-size: var(--text-body);
      line-height: 1.7;
    }
    .slide h1 {
      font-family: var(--font-display);
      font-size: var(--text-h1);
      font-weight: 700;
      margin: 0;
    }
  </style>
</head>
<body class="slide">
  <h1>見出し</h1>
  ...
  <aside class="notes">発表者ノート(任意)</aside>
</body>
</html>
```

ルール:

- **`system.css` はデザイントークン(色・タイポグラフィ・余白)と箇条書き
  (`ul`/`li`)の基本スタイルしか持たない**。それ以外(背景・文字色・
  フォント・余白の適用、見出し、レイアウト)はスライドごとに `<style>` で
  組む。上のサンプルの `.slide { ... }` `.slide h1 { ... }` は毎回コピペで
  よい最低限のセット
- **`system.css` の中身は `@layer system` に入っている**ので、この
  `<style>`(無レイヤーのまま書く)は詳細度を気にせず常に `system.css` を
  上書きできる。`.slide` 1個・要素セレクタ1個でも十分勝てるので、詳細度を
  稼ぐためにクラスを重ねる必要はない。**この `<style>` の中身を
  `@layer` で囲まない**(囲むと逆に system.css に埋没する)
- **キャンバスは 1280x720 固定**。レスポンシブ対応は不要(エンジンが scale する)
- **`<body>` の class には必ず `slide` を含める**(デザインシステムは `.slide`
  スコープなので、これがないと単体表示でトークンが当たらない)
- レイアウトクラス(`layout-*`)は存在しない。中央寄せ・全面画像・引用の
  大文字表示なども含め、そのスライドの `<style>` に直接書く
- **画像などのアセットは `assets/` に置き**、`../assets/foo.png` のように
  スライドファイル基準の相対パスで参照する(シェル取り込み時はエンジンが
  `src` / `poster` をスライドのURL基準に解決するので、単体表示と同じ書き方で動く)
- 画像は `src` 属性で参照する。**CSS の `url()` は使わない**
  (単体表示とシェル表示で解決基準がずれるため)
- `<base>` を書かない(シェルの相対URL解決を狂わせるため捨てられる)
- `<a>` に `target` / `rel` を書く必要はない(シェル取り込み時にエンジンが
  `target="_blank"` と `rel="noopener noreferrer"` を付与し、
  リンクは常に別タブで開く)
- スライド固有のスタイルは `<head>` 内の `<style>` に書く。Shadow DOM に
  隔離されるため他スライドとの衝突は考えなくてよい
- `<link rel="stylesheet">` はデザインシステムだけを指す(単体表示用。
  シェル経由では捨てられ、共有シートが代わりに適用される)
- **`@font-face` を書かない**(shadow 内では無効)。フォントはシステムフォントを使う
- 色・フォント・余白はデザイントークン(CSS変数)を参照し、生の値を書かない
- 1スライドの情報量は「見出し + 箇条書き4項目」程度を上限の目安にする

## レイアウト

共通レイアウトクラスは存在しない。タイトル・セクション区切り・コード・
引用・全面画像・自由配置など、どんな構図でもそのスライドの `<style>` に
直接書く(中央寄せなら `justify-content: center` を書く、全面画像なら
`padding: 0` を書く、といった具合)。他スライドと衝突しないので
遠慮なく書いてよい。共通クラス化はしない(`design-system/PRINCIPLE.md` 参照)。

## デザイントークン

トークン一覧は `design-system/system.css` の `.slide` セレクタ内の
CSS Custom Properties(`--color-*` `--font-*` `--text-*` `--space-page`)を参照。
色・フォント・見出しサイズ・余白はすべてこれらのトークン経由で指定し、
生の値(16進カラーやpx直書き)は書かない。

`system.css` が唯一持つ既定スタイルは `ul` / `li` の箇条書き(マーカー・
行間・積み方)。それ以外の要素(`h1` `h2` `p` `blockquote` `code` `pre` 等)
は既定スタイルを持たないので、使うスライドの `<style>` で毎回定義する。
`.accent` `.muted` `.tok-*` のような補助クラスも存在しないので、強調したい
箇所には `color: var(--color-accent)` のようにそのスライドの `<style>` へ
直接書く。
