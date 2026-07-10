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
 * 依存パッケージなし。HTML は下部の軽量トークナイザで処理する
 * (コメント・script/style の中身・引用符付き属性値を正しくスキップするので、
 * コメント内の </body> や属性値内の ">" 等で壊れない)。
 * 制約: スライド内(スクリプト文字列も含む)に "</template>" という文字列を
 * 書かないこと(DSD の template が途中で閉じてしまう)。
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
    const html = await readFile(slidePath, 'utf8');
    const slide = parseSlide(html, file);

    const bodyInner = await transformBody(slide.bodyInner, path.dirname(slidePath), file);

    if (/<\/template/i.test(bodyInner)) {
      console.warn(`  ! ${file}: "</template>" を含むため DSD が壊れる可能性がある`);
    }

    hosts.push(
      `<div class="slide-host" data-title="${escapeAttr(slide.title ?? file)}">
<template shadowrootmode="open">
<style>
${baseCss}
${dsCss}
</style>
${slide.headStyles.join('\n')}
<div class="slide ${escapeAttr(slide.bodyClass)}">
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
${engineJs}
</script>
</body>
</html>
`;

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, out);
  console.log(`✓ ${path.relative(ROOT, outPath)} (${(out.length / 1024).toFixed(1)} KB, ${manifest.slides.length} slides)`);
}

/* ---------------------------------------------------------------- *
 * スライドHTMLの分解
 * ---------------------------------------------------------------- */

/**
 * スライドHTMLから title / head 内 <style> / body の class と中身を取り出す。
 */
function parseSlide(html, file) {
  const tokens = tokenize(html);
  const tags = tokens.filter((t) => t.type === 'tag');

  const bodyOpen = tags.find((t) => t.name === 'body' && !t.closing);
  if (!bodyOpen) throw new Error(`${file}: <body> が見つからない`);
  const bodyClose = tags.find((t) => t.name === 'body' && t.closing && t.start >= bodyOpen.end);
  const htmlClose = tags.find((t) => t.name === 'html' && t.closing && t.start >= bodyOpen.end);
  const bodyEnd = bodyClose?.start ?? htmlClose?.start ?? html.length;

  const titleOpen = tags.find((t) => t.name === 'title' && !t.closing && t.start < bodyOpen.start);
  const title = titleOpen ? html.slice(titleOpen.end, titleOpen.contentEnd).trim() : null;

  const headStyles = tags
    .filter((t) => t.name === 'style' && !t.closing && t.start < bodyOpen.start)
    .map((t) => html.slice(t.start, t.elementEnd));

  return {
    title,
    headStyles,
    bodyClass: getAttr(bodyOpen.attrsRaw, 'class') ?? '',
    bodyInner: html.slice(bodyOpen.end, bodyEnd),
  };
}

/**
 * body の中身に2つの変換をかける:
 *  - data-slide-run スクリプトに type="text/slide" を強制(パーサの自動実行を防ぎ、
 *    エンジン(runSlideScripts)が type を剥がして `root` 付きで実行する)
 *  - ローカル画像の src/href を base64 データURLへ
 * 置換は元文字列のタグ位置に対して行う(テキストやコード例の中は触らない)。
 */
async function transformBody(bodyInner, baseDir, file) {
  const edits = []; // { start, end, text }

  for (const token of tokenize(bodyInner)) {
    if (token.type !== 'tag' || token.closing) continue;
    const attrsStart = token.end - 1 - token.attrsRaw.length;
    const attrs = [...matchAttrs(token.attrsRaw)];

    if (token.name === 'script' && attrs.some((a) => a.name === 'data-slide-run')) {
      const type = attrs.find((a) => a.name === 'type');
      if (type?.value !== 'text/slide') {
        if (type) {
          console.warn(`  ! ${file}: <script data-slide-run> の type="${type.value}" を "text/slide" に置き換えた`);
          edits.push({
            start: attrsStart + type.start,
            end: attrsStart + type.end,
            text: 'type="text/slide"',
          });
        } else {
          edits.push({ start: token.start + '<script'.length, end: token.start + '<script'.length, text: ' type="text/slide"' });
        }
      }
      continue;
    }

    for (const attr of attrs) {
      if (attr.name !== 'src' && attr.name !== 'href') continue;
      const src = attr.value;
      if (!src || /^(https?:|data:)/i.test(src)) continue;
      const ext = path.extname(src.split(/[?#]/)[0]).toLowerCase();
      if (!(ext in MIME)) continue;
      try {
        const data = await readFile(path.resolve(baseDir, src));
        edits.push({
          start: attrsStart + attr.valueStart,
          end: attrsStart + attr.valueEnd,
          text: `data:${MIME[ext]};base64,${data.toString('base64')}`,
        });
      } catch {
        console.warn(`  ! ${file}: 画像が見つからないためそのまま残した: ${src}`);
      }
    }
  }

  // 後ろから適用して位置ずれを防ぐ
  edits.sort((a, b) => b.start - a.start);
  let out = bodyInner;
  for (const { start, end, text } of edits) {
    out = out.slice(0, start) + text + out.slice(end);
  }
  return out;
}

/* ---------------------------------------------------------------- *
 * 軽量HTMLトークナイザ
 * ---------------------------------------------------------------- */

// 中身をテキストとして扱う要素(タグとして解釈してはいけない)
const RAWTEXT = new Set(['script', 'style', 'title', 'textarea']);

const TAG_NAME_RE = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/;

/**
 * タグとコメントの位置を列挙する。
 *  - { type: 'comment', start, end }
 *  - { type: 'tag', name, closing, start, end, attrsRaw }
 *    rawtext 要素の開始タグには contentEnd(中身の終端)と
 *    elementEnd(閉じタグの後)が付く。
 */
function tokenize(html) {
  const tokens = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;

    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      const end = close === -1 ? html.length : close + 3;
      tokens.push({ type: 'comment', start: lt, end });
      i = end;
      continue;
    }
    if (html[lt + 1] === '!') {
      // <!doctype> などの宣言
      const gt = html.indexOf('>', lt);
      i = gt === -1 ? html.length : gt + 1;
      continue;
    }

    const m = TAG_NAME_RE.exec(html.slice(lt, lt + 80));
    if (!m) {
      i = lt + 1;
      continue;
    }
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const attrsStart = lt + m[0].length;
    const end = findTagEnd(html, attrsStart);
    const token = {
      type: 'tag',
      name,
      closing,
      start: lt,
      end,
      attrsRaw: closing ? '' : html.slice(attrsStart, end - 1),
    };
    tokens.push(token);
    i = end;

    if (!closing && RAWTEXT.has(name)) {
      const closeRe = new RegExp(`</${name}(?=[\\s/>])`, 'gi');
      closeRe.lastIndex = end;
      const cm = closeRe.exec(html);
      if (cm) {
        const gt = html.indexOf('>', cm.index);
        const closeEnd = gt === -1 ? html.length : gt + 1;
        token.contentEnd = cm.index;
        token.elementEnd = closeEnd;
        tokens.push({ type: 'tag', name, closing: true, start: cm.index, end: closeEnd, attrsRaw: '' });
        i = closeEnd;
      } else {
        token.contentEnd = html.length;
        token.elementEnd = html.length;
        i = html.length;
      }
    }
  }
  return tokens;
}

/** 引用符付き属性値の中の ">" を無視してタグの終わりを探す */
function findTagEnd(html, from) {
  let quote = null;
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i + 1;
    }
  }
  return html.length;
}

const ATTR_RE = /([^\s=/>"']+)(\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g;

/**
 * 属性文字列を先頭から順に解釈して列挙する(引用符内に属性風の文字列が
 * あっても値として消費されるので誤検出しない)。
 * start/end は attrsRaw 内のオフセット。valueStart/valueEnd は引用符の内側。
 */
function* matchAttrs(attrsRaw) {
  for (const m of attrsRaw.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    let value = m[3];
    let valueStart = null;
    let valueEnd = null;
    if (value !== undefined) {
      valueStart = m.index + m[1].length + m[2].length - value.length;
      if (value.startsWith('"') || value.startsWith("'")) {
        value = value.slice(1, -1);
        valueStart += 1;
      }
      valueEnd = valueStart + value.length;
    }
    yield { name, value, start: m.index, end: m.index + m[0].length, valueStart, valueEnd };
  }
}

function getAttr(attrsRaw, name) {
  for (const attr of matchAttrs(attrsRaw)) {
    if (attr.name === name) return attr.value ?? '';
  }
  return null;
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s) => escapeHtml(s).replace(/"/g, '&quot;');
