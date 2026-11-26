#!/usr/bin/env node
// Screenshot slides so Claude can look at its own rendered output before
// reporting a visual change as done.
// Not part of the deck itself — a dev-only tool for Claude's self-check.
//
// Usage: node self-check.mjs <baseURL|repoDir> <outDir> <pageNumber> [pageNumber...]
//   baseURL    e.g. http://localhost:8000/ (a running preview server)
//   repoDir    or the deck repository's root directory: files are served
//              straight from disk through Playwright's request interception,
//              so no local server is needed (for sandboxes that forbid one)
//   outDir     where to write slide-NN.png (e.g. the session scratchpad)
//   pageNumber 1-indexed slide numbers to capture (manifest.json order)
//
// Must be run with `node` from wherever `playwright` resolves (module
// resolution is relative to this file's own location, not the process cwd)
// — see SKILL.md for the install step.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [, , target, outDir, ...pageArgs] = process.argv;
const pageNumbers = pageArgs.map(Number);
if (!target || !outDir || pageNumbers.length === 0 || pageNumbers.some(Number.isNaN)) {
  console.error('usage: node self-check.mjs <baseURL|repoDir> <outDir> <pageNumber> [pageNumber...]');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

let baseURL = target;
if (!/^https?:\/\//.test(target)) {
  // ディレクトリ指定: 架空のオリジンへのリクエストをディスクから返す
  const root = path.resolve(target);
  baseURL = 'http://slidex.local/';
  await context.route('http://slidex.local/**', (route) => {
    const { pathname } = new URL(route.request().url());
    const file = path.join(root, decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return route.fulfill({ status: 404, body: 'not found' });
    }
    route.fulfill({
      body: fs.readFileSync(file),
      contentType: MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    });
  });
}

const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

for (const n of pageNumbers) {
  const url = new URL(baseURL);
  url.searchParams.set('page', String(n));
  await page.goto(url.href, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200); // let webfonts/view-transitions settle
  const out = path.join(outDir, `slide-${String(n).padStart(2, '0')}.png`);
  await page.screenshot({ path: out });
  console.log('wrote', out);
}
if (errors.length) console.log('page errors:\n' + errors.join('\n'));

await browser.close();
