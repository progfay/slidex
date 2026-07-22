---
name: slide-html
description: スライド1枚のHTMLを新規作成・編集するときのリファレンス。単体表示可能な完全HTML構造、キャンバス1280x720固定、body classに必須の`slide`、assets/画像参照ルール、@font-face禁止などの契約、使えるレイアウト一覧(layout-title など)、デザイントークンの参照先をまとめている。outline.mdをHTML化する手順4、リッチ化する手順5、既存のslides/*.htmlのレイアウトやスタイルを直すときに読む。
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
  <style>/* このスライド固有のスタイル(任意) */</style>
</head>
<body class="slide">
  <h1>見出し</h1>
  ...
  <aside class="notes">発表者ノート(任意)</aside>
</body>
</html>
```

ルール:

- **キャンバスは 1280x720 固定**。レスポンシブ対応は不要(エンジンが scale する)
- **`<body>` の class には必ず `slide` を含める**(デザインシステムは `.slide`
  スコープなので、これがないと単体表示でスタイルが当たらない)
- レイアウトは `<body>` の class に追加で指定する(下記レイアウト一覧)
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

## 利用できるレイアウト(body の class)

`slide` class に追加して指定する(例: `class="slide layout-title"`)。

| class | 用途 |
|---|---|
| `layout-title` | タイトルスライド(中央寄せ、大見出し + `.subtitle`) |
| `layout-section` | セクション区切り(中央寄せの見出し) |
| `layout-code` | コード中心。`<pre><code>` が残り高さいっぱいに広がる |
| `layout-quote` | 引用。中央寄せの大きな `<blockquote>` + `.attribution` |
| `layout-image` | 全面画像。`<img>` + 下端スクリムの `.caption` |
| `layout-freeform` | 自由配置。flex 積みを解除した白紙キャンバス(図解・演出向け、絶対配置可) |
| (`slide` のみ) | 標準。見出し + 本文/箇条書き |

## デザイントークン

トークン一覧は `design-system/system.css` の `.slide` セレクタ内の
CSS Custom Properties(`--color-*` `--font-*` `--text-*` `--space-page`)を参照。

補助クラス: `.accent`(アクセント色の文字)、`.muted`(控えめな文字)、
コードハイライト用の `.tok-kw` `.tok-fn` `.tok-str` `.tok-num` `.tok-com`。
