# slidex — スライド生成規約

このリポジトリは HTML スライドのデッキである(テンプレート
[progfay/slidex](https://github.com/progfay/slidex) からデッキごとに作成される)。
**1リポジトリ = 1デッキ**。
Claude Code はここで **slides/ 以下のコンテンツを生成・編集する**のが主な仕事であり、
engine/ と design-system/ は明示的に指示されない限り変更しない。

**対応ブラウザは最新の Chromium 系のみ**。エンジンは Navigation API・Sanitizer API・
View Transitions(types 付き)を fallback なしで前提にしており、未対応ブラウザ向けの
機能判定や代替経路は書かない。

## 新しいデッキの始め方

テンプレートから作られた直後のリポジトリには、規約のリファレンスを兼ねた
デモスライドが入っている(manifest の `title` が「slidex demo」ならこの状態)。
最初のスライド作成の指示を受けたら、次の初期化から始める:

1. `manifest.json` の `title` を新しいデッキ名に書き換える
2. `slides/` のデモスライドをすべて削除する
3. 「スライドを作る流れ」(次節)に沿って新しいデッキを作り、
   manifest の `slides` を置き換える

**例外**: このリポジトリ自身がテンプレート本体(origin が progfay/slidex)の
場合、デモスライドはコンテンツそのものなので削除しない。デモは規約の
リファレンスを兼ねるため、規約を変更したときは同時に更新する。

## スライドを作る流れ

デッキは次の3ステップで作る。ステップの区切りでユーザーに確認を取ってから
次へ進む(特に 1→2。原稿の段階なら手直しが安い)。

### 1. ドラフトを書く — `draft.md`

リポジトリルートの `draft.md` に発表の原稿・流れを書き出す。
1スライド = 1セクション(`##`)とし、セクションごとに書くのは:

- スライドに載せる要点(見出し案・箇条書き案)
- 話す内容の語り(そのまま発表者ノートの素材になる)

`draft.md` は build 対象外なので公開されない。コミットはする(原稿の変更履歴として)。

### 2. HTML スライドに書き起こす

`draft.md` の 1セクション = 1スライドで HTML に変換し、manifest の `slides` を
並び順どおり更新する。

- 画面に載せるのは要点だけ。**原稿の文章をそのまま流し込まない**
  (「見出し + 箇条書き4項目」の上限目安はここで守る)
- 語りは `<aside class="notes">` に発表者ノートとして転記する
- スライドごとに適切なレイアウト(`layout-*`)を選ぶ

### 3. リッチ化する

素の書き起こしを、HTML の柔軟性を活かして分かりやすく・見やすくする。

- 箇条書きの図解化(`layout-freeform` での図・対比・タイムライン)
- コードハイライト、`.accent` での強調、インタラクティブな段階表示
- ただし規約は維持する: 生の値ではなくデザイントークンを使い、
  1スライドの情報量は増やさない。**リッチ化 = 装飾の追加ではなく伝達効率の改善**

ステップ3以降は `slides/` が正であり、`draft.md` への逆同期は不要
(内容そのものを変えたときに更新するのは任意)。

## デッキの構成

デッキはリポジトリルートの `manifest.json` と `slides/` で構成する。

1. スライドは `slides/NN-slug.html` の連番命名で 1スライド = 1ファイル
2. manifest の `slides` 配列に順番どおり列挙する(パスは `slides/` からのファイル名)

```json
{
  "title": "デッキのタイトル",
  "stylesheets": ["design-system/system.css"],
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
  <link rel="stylesheet" href="../design-system/system.css">
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
- **`@font-face` を書かない**(shadow 内では無効)。フォントはシステムフォントを使う
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
# → http://localhost:8000/(ルートの index.html がビューア)

# GitHub Pages 用に dist/ へ集約
./scripts/build.sh   # → dist/(index.html + manifest + slides + engine + design-system)
```

PDF が欲しいときはビューアで ⌘P / Ctrl+P(1スライド = 1ページで出力される。
エンジンが対応済みなのでスライド側での対応は不要)。

公開は GitHub Pages(dist/ をサイトルートとして配信)。build.sh は変換なしの
コピーで、ソースと同じ構造を dist/ に集約する。**Pages の URL 直下を開くと
そのまま上映**が始まり、各スライドは `slides/NN-slug.html` で単体閲覧もできる。

- 画像などのアセットは `slides/` 内に相対パスで置く(slides/ ごとコピー
  されるため、コピー対象外を参照するとリンク切れになる)
- design-system/ からは `*.css` だけがコピーされる
