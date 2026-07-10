#!/usr/bin/env node
/**
 * デッキを自己完結した単一HTMLにエクスポートする。
 *
 *   node export/build.js decks/demo [-o dist/demo.html]
 *
 * - 各スライドを Declarative Shadow DOM (<template shadowrootmode="open">) に変換
 * - base.css / デザインシステム / スライド固有 <style> を各 shadow にインライン
 * - fonts.css をドキュメント側にインライン
 * - engine.js / shell.css をインライン
 * - スライドが参照するローカル画像を base64 データURLに変換
 *
 * 依存パッケージなし(正規表現ベースの簡易パーサ)。
 * 制約: <body>, <style>, <script> タグはスライド内で入れ子にしないこと。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

async function main() {
  const args = process.argv.slice(2);
  const deckArg = args.find((a) => !a.startsWith('-'));
  if (!deckArg) {
    console.error('usage: node export/build.js <deck-dir> [-o output.html]');
    process.exit(1);
  }

  const deckDir = path.resolve(ROOT, deckArg);
  const outFlag = args.indexOf('-o');
  const outPath =
    outFlag !== -1
      ? path.resolve(ROOT, args[outFlag + 1])
      : path.join(ROOT, 'dist', `${path.basename(deckDir)}.html`);

  const manifest = JSON.parse(await readFile(path.join(deckDir, 'manifest.json'), 'utf8'));

  // 共有CSS(shadow側): base + デザインシステム
  const baseCss = await readFile(path.join(ROOT, 'engine/base.css'), 'utf8');
  const dsPaths = manifest.stylesheets ?? ['../../design-system/system.css'];
  const dsCss = (
    await Promise.all(dsPaths.map((p) => readFile(path.resolve(deckDir, p), 'utf8')))
  ).join('\n');

  // ドキュメント側: fonts + shell
  const fontsCss = await readFile(path.join(ROOT, 'design-system/fonts.css'), 'utf8');
  const shellCss = await readFile(path.join(ROOT, 'engine/shell.css'), 'utf8');
  const engineJs = await readFile(path.join(ROOT, 'engine/engine.js'), 'utf8');

  // 各スライドを DSD に変換
  const hosts = [];
  for (const file of manifest.slides) {
    const slidePath = path.join(deckDir, 'slides', file);
    let html = await readFile(slidePath, 'utf8');

    const title = escapeAttr(match1(html, /<title>([\s\S]*?)<\/title>/i) ?? file);
    const bodyClass = match1(html, /<body[^>]*\bclass="([^"]*)"/i) ?? '';
    let bodyInner = match1(html, /<body[^>]*>([\s\S]*?)<\/body>/i) ?? '';

    // data-slide-run スクリプトはパーサに実行させず、エンジン(runSlideScripts)が
    // `root` を注入して実行する。type="text/slide" で自動実行を止める。
    bodyInner = bodyInner.replace(
      /<script((?:(?!type=)[^>])*\bdata-slide-run\b[^>]*)>/gi,
      '<script type="text/slide"$1>',
    );

    // head 内の <style> を body から除外した上で shadow に入れる
    // (bodyInner に含まれる style はそのまま残るので、head 側だけ足す)
    const headInner = match1(html, /<head[^>]*>([\s\S]*?)<\/head>/i) ?? '';
    const headStyles = matchAll(headInner, /<style[^>]*>[\s\S]*?<\/style>/gi).join('\n');

    bodyInner = await inlineImages(bodyInner, path.dirname(slidePath));

    hosts.push(
      `<div class="slide-host" data-title="${title}">
<template shadowrootmode="open">
<style>
${baseCss}
${dsCss}
</style>
${headStyles}
<div class="slide ${escapeAttr(bodyClass)}">
${bodyInner}
</div>
</template>
</div>`,
    );
  }

  const out = `<!doctype html>
<html lang="ja" data-exported>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(manifest.title ?? 'Slides')}</title>
<style>
${fontsCss}
${shellCss}
</style>
</head>
<body>
<div id="stage">
${hosts.join('\n')}
</div>
<script type="module">
${engineJs.replace(/^\s*boot\(\);\s*$/m, 'boot();')}
</script>
</body>
</html>
`;

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, out);
  console.log(`✓ ${path.relative(ROOT, outPath)} (${(out.length / 1024).toFixed(1)} KB, ${manifest.slides.length} slides)`);
}

/* ---- helpers ---- */

function match1(s, re) {
  const m = s.match(re);
  return m ? m[1] : null;
}

function matchAll(s, re) {
  return [...s.matchAll(re)].map((m) => m[0]);
}

async function inlineImages(html, baseDir) {
  const srcRe = /(src|href)="([^"]+\.(?:png|jpe?g|gif|webp|svg|avif))"/gi;
  const jobs = [];
  html.replace(srcRe, (full, attr, src) => {
    if (/^(https?:|data:)/.test(src)) return full;
    jobs.push({ full, attr, src });
    return full;
  });

  for (const { full, attr, src } of jobs) {
    try {
      const filePath = path.resolve(baseDir, src);
      const data = await readFile(filePath);
      const mime = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
      html = html.replace(full, `${attr}="data:${mime};base64,${data.toString('base64')}"`);
    } catch {
      console.warn(`  ! image not found, kept as-is: ${src}`);
    }
  }
  return html;
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s) => escapeHtml(s).replace(/"/g, '&quot;');
