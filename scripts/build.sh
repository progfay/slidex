#!/bin/sh
# GitHub Pages 用に dist/ へサイト一式を集約する。
#
#   ./scripts/build.sh   # → dist/(index.html + manifest + slides + engine + design-system)
#
# 変換は行わない。ソースと同じ構造でコピーし、.nojekyll を足すだけ。
set -eu
cd "$(dirname "$0")/.."

rm -rf dist
mkdir -p dist/design-system

cp index.html manifest.json favicon.svg dist/
cp -R engine dist/engine
cp design-system/*.css dist/design-system/
cp -R slides dist/slides

# Jekyll 処理を無効化(そのまま静的配信させる)
touch dist/.nojekyll

echo "✓ dist/ ($(find dist/slides -name '*.html' | wc -l | tr -d ' ') slides)"
