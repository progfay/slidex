# slidex — スライド生成規約

このリポジトリは HTML スライドのプラットフォームである。Claude Code はここで
**decks/ 以下のコンテンツを生成・編集する**のが主な仕事であり、engine/ と
design-system/ は明示的に指示されない限り変更しない。

## 新しいデッキの作り方

1. `decks/<deck-name>/manifest.json` と `decks/<deck-name>/slides/` を作る
2. スライドは `NN-slug.html` の連番命名で 1スライド = 1ファイル
3. manifest の `slides` 配列に順番どおり列挙する

```json
{
  "title": "デッキのタイトル",
  "stylesheets": ["../../design-system/system.css"],
  "slides": ["01-title.html", "02-agenda.html"]
}
```

## スライドHTMLの契約

各スライドは**単体でブラウザで開いても表示できる完全なHTML**として書く。

```html
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>スライドのタイトル</title>
  <link rel="stylesheet" href="../../../design-system/system.css">
  <style>/* このスライド固有のスタイル(任意) */</style>
</head>
<body class="slide layout-two-col">
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
- スライド固有のスタイルは `<head>` 内の `<style>` に書く。Shadow DOM に
  隔離されるため他スライドとの衝突は考えなくてよい
- `<link rel="stylesheet">` はデザインシステムだけを指す(単体表示用。
  シェル経由では捨てられ、共有シートが代わりに適用される)
- **`@font-face` をスライドや system.css に書かない**(shadow 内では無効)。
  フォント追加は `design-system/fonts.css` に書く
- 色・フォント・余白はデザイントークン(CSS変数)を参照し、生の値を書かない
- 1スライドの情報量は「見出し + 箇条書き4項目」程度を上限の目安にする

## 利用できるレイアウト(body の class)

`slide` class に追加して指定する(例: `class="slide layout-title"`)。

| class | 用途 |
|---|---|
| `layout-title` | タイトルスライド(中央寄せ、大見出し + `.subtitle`) |
| `layout-section` | セクション区切り(中央寄せの見出し) |
| `layout-two-col` | 2カラム。`<div class="cols">` の直下に2つの `<div>` |
| `layout-code` | コード中心。`<pre><code>` が残り高さいっぱいに広がる |
| `layout-quote` | 引用。中央寄せの大きな `<blockquote>` + `.attribution` |
| `layout-image` | 全面画像。`<img>` + 下端スクリムの `.caption` |
| `layout-freeform` | 自由配置。flex 積みを解除した白紙キャンバス(図解・演出向け、絶対配置可) |
| (`slide` のみ) | 標準。見出し + 本文/箇条書き |

## デザイントークン(抜粋)

`--color-bg` `--color-ink` `--color-muted` `--color-accent`
`--color-surface` `--color-line` `--color-success` `--color-warning` `--color-danger`
`--font-display` `--font-body` `--font-mono` `--space-page`
`--text-title` `--text-h1` `--text-h2` `--text-body` `--text-muted` `--text-code`

補助クラス: `.accent`(アクセント色の文字)、`.muted`(控えめな文字)、
コードハイライト用の `.tok-kw` `.tok-fn` `.tok-str` `.tok-num` `.tok-com`。

## インタラクティブな要素

スクリプトは opt-in。`<script type="text/slide" data-slide-run>` に書くと、
エンジンが `type` を剥がして shadow root 内で実行する。自分の shadow root は
`root` 変数で参照する(`document` を直接触らない)。
`type="text/slide"` は必須(単体表示でブラウザが生実行して `root` 未定義で
エラーになるのを防ぐ。単体表示ではスクリプトは動かない)。

```html
<button id="go">実行</button>
<script type="text/slide" data-slide-run>
  root.getElementById('go').addEventListener('click', () => { ... });
</script>
```

## プレビューと公開

```sh
# プレビュー(リポジトリルートで)
python3 -m http.server 8000
# → http://localhost:8000/engine/shell.html?deck=../decks/<deck-name>

# GitHub Pages 用に dist/ へ集約
./scripts/build.sh   # → dist/(engine + design-system + decks + index.html)
```

公開は GitHub Pages(dist/ をサイトルートとして配信)。build.sh は変換なしの
コピーで、デッキ一覧の index.html を生成するだけ。各デッキの URL は
`engine/shell.html?deck=../decks/<deck-name>` になる。

- 画像などのアセットはデッキディレクトリ内に相対パスで置く(decks/ ごと
  コピーされるため、外を参照するとリンク切れになる)
- design-system/ からは `*.css` だけがコピーされる
