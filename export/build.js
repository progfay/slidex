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
 * スライドHTMLの解釈は自作せず、手元の Chromium を headless で起動して
 * Document.parseHTMLUnsafe + Sanitizer API に任せる。ブラウザとの通信は
 * Node 組み込みの WebSocket + Chrome DevTools Protocol で行うため
 * npm 依存はゼロのまま。Chromium の探索順:
 *   1. 環境変数 CHROME_PATH
 *   2. システムの Chrome / Chromium / Edge
 *   3. Playwright キャッシュ (~/Library/Caches/ms-playwright など)
 *
 * Sanitizer はブロックリスト型 + removeUnsafe() で構成し、XSS-unsafe な
 * 要素・属性(iframe, embed, on* など)を落とす。<script> だけは通し、
 * DOM 側で data-slide-run 付きを type="text/slide"(不活性)に正規化、
 * それ以外の <script> は警告付きで除去する。
 *
 * 制約: <script>/<style> の中に "</template>" という文字列を書かない
 * (DSD の template が途中で閉じる)。地の文では &lt;/template&gt; と書く。
 */

import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
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

  const browser = await launchBrowser();
  try {
    const supported = await browser.evaluate(
      `typeof Document.parseHTMLUnsafe === 'function' && typeof Sanitizer === 'function'`,
    );
    if (!supported) {
      throw new Error(
        'この Chromium は Document.parseHTMLUnsafe / Sanitizer API に未対応。' +
          '新しい Chrome/Chromium を CHROME_PATH で指定すること',
      );
    }

    const slidesDir = path.join(deckDir, 'slides');
    const hosts = [];
    for (const file of manifest.slides) {
      const html = await readFile(path.join(slidesDir, file), 'utf8');

      // フェーズ1: パース + サニタイズ + スクリプト正規化。
      // 画像などローカル資産の参照リストを受け取る(DOM はブラウザ側に保持)
      const { assets } = await browser.call(parseSlide, { html, exts: Object.keys(MIME) });

      // Node 側で資産を読んでデータURL化
      const dataUrls = await Promise.all(assets.map((src) => readAsset(slidesDir, src)));

      // フェーズ2: 属性を書き換えてシリアライズ
      const slide = await browser.call(applyAssetsAndSerialize, { dataUrls });

      for (const w of slide.warnings) console.warn(`  ! ${file}: ${w}`);
      if (/<\/template/i.test(slide.bodyInner)) {
        console.warn(`  ! ${file}: <script>/<style> 内に "</template>" があり DSD が壊れる可能性がある`);
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
${slide.bodyInner}
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
  } finally {
    await browser.close();
  }
}

async function readAsset(baseDir, src) {
  try {
    const filePath = path.resolve(baseDir, src.split(/[?#]/)[0]);
    const ext = path.extname(filePath).toLowerCase();
    if (!(ext in MIME)) return null;
    const data = await readFile(filePath);
    return `data:${MIME[ext]};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- *
 * ブラウザ内で実行される関数(browser.call で送り込む。Node の変数は
 * 参照できない。呼び出し間の状態は globalThis.__slide に置く)
 * ---------------------------------------------------------------- */

function parseSlide({ html, exts }) {
  const warnings = [];

  // ブロックリスト型 Sanitizer: XSS-unsafe(iframe, embed, object, on* 属性
  // など)を落とし、それ以外のマークアップはそのまま通す。<script> は
  // 下で個別に処理するためいったん許可する。
  const sanitizer = new Sanitizer({ removeElements: [], removeAttributes: [] });
  sanitizer.removeUnsafe();
  sanitizer.allowElement('script');

  const doc = Document.parseHTMLUnsafe(html, { sanitizer });

  // <script> の正規化: data-slide-run 付きは type="text/slide"(不活性)に
  // 統一し、opt-in でないものは除去する
  for (const script of [...doc.querySelectorAll('script')]) {
    if (script.hasAttribute('data-slide-run')) {
      const type = script.getAttribute('type');
      if (type !== 'text/slide') {
        if (type) warnings.push(`<script data-slide-run> の type="${type}" を "text/slide" に置き換えた`);
        script.setAttribute('type', 'text/slide');
      }
    } else {
      warnings.push('data-slide-run のない <script> を除去した');
      script.remove();
    }
  }

  // ローカル画像参照を集める(コード例などテキスト中のパスは対象外)
  const targets = [];
  const assets = [];
  for (const el of doc.body.querySelectorAll('[src], [href]')) {
    for (const attr of ['src', 'href']) {
      const value = el.getAttribute(attr);
      if (!value || /^(https?:|data:|#)/i.test(value)) continue;
      const m = value.split(/[?#]/)[0].match(/\.[a-z0-9]+$/i);
      if (!m || !exts.includes(m[0].toLowerCase())) continue;
      targets.push({ el, attr });
      assets.push(value);
    }
  }

  globalThis.__slide = { doc, targets, warnings };
  return { assets };
}

function applyAssetsAndSerialize({ dataUrls }) {
  const { doc, targets, warnings } = globalThis.__slide;
  delete globalThis.__slide;

  targets.forEach(({ el, attr }, i) => {
    if (dataUrls[i]) el.setAttribute(attr, dataUrls[i]);
    else warnings.push(`画像が見つからないためそのまま残した: ${el.getAttribute(attr)}`);
  });

  return {
    title: doc.title || null,
    headStyles: [...doc.head.querySelectorAll('style')].map((s) => s.outerHTML),
    bodyClass: doc.body.className,
    bodyInner: doc.body.innerHTML,
    warnings,
  };
}

/* ---------------------------------------------------------------- *
 * headless Chromium の起動と CDP クライアント(依存ゼロ)
 * ---------------------------------------------------------------- */

async function findChromium() {
  if (process.env.CHROME_PATH) {
    if (existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    throw new Error(`CHROME_PATH が存在しない: ${process.env.CHROME_PATH}`);
  }

  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const p of candidates) if (existsSync(p)) return p;

  // Playwright のブラウザキャッシュ(headless shell を含む)を探す
  const cacheDirs = [
    path.join(os.homedir(), 'Library/Caches/ms-playwright'),
    path.join(os.homedir(), '.cache/ms-playwright'),
  ];
  for (const cache of cacheDirs) {
    if (!existsSync(cache)) continue;
    const entries = (await readdir(cache)).sort().reverse(); // 新しいリビジョン優先
    for (const entry of entries) {
      if (!/^chromium(_headless_shell)?-\d+$/.test(entry)) continue;
      const dir = path.join(cache, entry);
      for (const sub of await readdir(dir)) {
        const bins = [
          path.join(dir, sub, 'chrome-headless-shell'),
          path.join(dir, sub, 'Chromium.app/Contents/MacOS/Chromium'),
          path.join(dir, sub, 'chrome'),
        ];
        for (const bin of bins) if (existsSync(bin)) return bin;
      }
    }
  }

  throw new Error(
    'Chromium が見つからない。Chrome をインストールするか、CHROME_PATH で実行ファイルを指定すること',
  );
}

async function launchBrowser() {
  const bin = await findChromium();
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'slidex-export-'));
  const proc = spawn(
    bin,
    [
      '--headless',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  // stderr に出る "DevTools listening on ws://..." からポートを得る
  const wsEndpoint = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`Chromium が起動しない (${bin})`)), 15000);
    proc.stderr.on('data', (chunk) => {
      buf += chunk;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chromium が終了した (exit ${code}): ${buf.slice(0, 500)}`));
    });
  });

  // ページターゲットの WebSocket に接続する
  const httpOrigin = wsEndpoint.replace(/^ws:/, 'http:').replace(/\/devtools\/.*$/, '');
  const targets = await (await fetch(`${httpOrigin}/json/list`)).json();
  const pageTarget = targets.find((t) => t.type === 'page');
  if (!pageTarget) throw new Error('Chromium のページターゲットが見つからない');

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket に接続できない')), { once: true });
  });

  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`CDP: ${msg.error.message}`));
      else resolve(msg.result);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(`ブラウザ内エラー: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    }
    return result.value;
  };

  return {
    evaluate,
    // Node 側で定義した関数をブラウザ内で実行する(引数は JSON で渡す)
    call: (fn, args) => evaluate(`(${fn})(${JSON.stringify(args)})`),
    close: async () => {
      ws.close();
      const exited = new Promise((resolve) => proc.once('exit', resolve));
      proc.kill();
      await exited;
      await rm(userDataDir, { recursive: true, force: true });
    },
  };
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s) => escapeHtml(s).replace(/"/g, '&quot;');
