#!/usr/bin/env node
// Screenshot slides from a running slidex preview server so Claude can look
// at its own rendered output before reporting a visual change as done.
// Not part of the deck itself — a dev-only tool for Claude's self-check.
//
// Usage: node self-check.mjs <baseURL> <outDir> <pageNumber> [pageNumber...]
//   baseURL    e.g. http://localhost:8000/ (the shell, engine.js reads ?page=N)
//   outDir     where to write slide-NN.png (e.g. the session scratchpad)
//   pageNumber 1-indexed slide numbers to capture (manifest.json order)
//
// Must be run with `node` from wherever `npm i playwright` installed
// node_modules (module resolution is relative to this file's own location,
// not the process cwd) — see SKILL.md for the install step and the pinned
// version to use.
import { chromium } from 'playwright';
import path from 'node:path';

const [, , baseURL, outDir, ...pageArgs] = process.argv;
const pageNumbers = pageArgs.map(Number);
if (!baseURL || !outDir || pageNumbers.length === 0 || pageNumbers.some(Number.isNaN)) {
  console.error('usage: node self-check.mjs <baseURL> <outDir> <pageNumber> [pageNumber...]');
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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
