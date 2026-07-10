#!/bin/sh
# GitHub Pages 用に dist/ へサイト一式を集約する。
#
#   ./scripts/build.sh   # → dist/(engine + design-system + decks + index.html)
#
# 変換は行わない。engine/design-system/decks をそのままコピーし、
# デッキ一覧の index.html と .nojekyll を生成するだけ。
set -eu
cd "$(dirname "$0")/.."

rm -rf dist
mkdir -p dist/design-system

cp -R engine dist/engine
cp design-system/*.css dist/design-system/
cp -R decks dist/decks

# Jekyll 処理を無効化(そのまま静的配信させる)
touch dist/.nojekyll

escape_html() {
  printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
}

# デッキ一覧の index.html を生成
{
  cat <<'HEADER'
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>slidex</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: system-ui, sans-serif;
    max-width: 40rem;
    margin: 4rem auto;
    padding: 0 1.5rem;
    line-height: 1.8;
  }
  a { font-size: 1.125rem; }
</style>
</head>
<body>
<h1>slidex</h1>
<ul>
HEADER

  for dir in decks/*/; do
    name=$(basename "$dir")
    [ -f "$dir/manifest.json" ] || continue
    title=$(jq -r '.title // empty' "$dir/manifest.json")
    printf '<li><a href="engine/shell.html?deck=../decks/%s">%s</a></li>\n' \
      "$name" "$(escape_html "${title:-$name}")"
  done

  cat <<'FOOTER'
</ul>
</body>
</html>
FOOTER
} > dist/index.html

deck_count=$(find dist/decks -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
echo "✓ dist/ (${deck_count} decks)"
