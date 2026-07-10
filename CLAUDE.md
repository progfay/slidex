# slide-platform — スライド生成規約

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
<body class="layout-two-col">
  <h1>見出し</h1>
  ...
  <aside class="notes">発表者ノート(任意)</aside>
</body>
</html>
```

ルール:

- **キャンバスは 1280x720 固定**。レスポンシブ対応は不要(エンジンが scale する)
- レイアウトは `<body>` の class で指定する(下記レイアウト一覧)
- スライド固有のスタイルは `<head>` 内の `<style>` に書く。Shadow DOM に
  隔離されるため他スライドとの衝突は考えなくてよい
- `<link rel="stylesheet">` はデザインシステムだけを指す(単体表示用。
  シェル経由では捨てられ、共有シートが代わりに適用される)
- **`@font-face` をスライドや system.css に書かない**(shadow 内では無効)。
  フォント追加は `design-system/fonts.css` に書く
- 色・フォント・余白はデザイントークン(CSS変数)を参照し、生の値を書かない
- 1スライドの情報量は「見出し + 箇条書き4項目」程度を上限の目安にする

## 利用できるレイアウト(body の class)

| class | 用途 |
|---|---|
| `layout-title` | タイトルスライド(中央寄せ、大見出し + `.subtitle`) |
| `layout-section` | セクション区切り(反転配色) |
| `layout-two-col` | 2カラム。`<div class="cols">` の直下に2つの `<div>` |
| `layout-code` | コード中心。`<pre><code>` が残り高さいっぱいに広がる |
| (なし) | 標準。見出し + 本文/箇条書き |

## デザイントークン(抜粋)

`--color-bg` `--color-ink` `--color-muted` `--color-accent`
`--font-display` `--font-body` `--font-mono` `--space-page`

## インタラクティブな要素

スクリプトは opt-in。`<script data-slide-run>` に書くと、エンジンが shadow root
内で実行する。自分の shadow root は `root` 変数で参照する(`document` を
直接触らない)。

```html
<button id="go" data-slide-run>実行</button>
<script data-slide-run>
  root.getElementById('go').addEventListener('click', () => { ... });
</script>
```

## プレビューとエクスポート

```sh
# プレビュー(リポジトリルートで)
python3 -m http.server 8000
# → http://localhost:8000/engine/shell.html?deck=../decks/<deck-name>

# 単一HTMLへエクスポート
node export/build.js decks/<deck-name>   # → dist/<deck-name>.html
```

エクスポートの簡易パーサの制約: スライド内で `<body>` `<style>` `<script>`
を入れ子・分割記述しない。画像はスライドからの相対パスで置く(base64 化される)。
