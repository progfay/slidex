/**
 * slide-platform engine
 *
 * 2つのモードで動作する:
 *  - dev モード:   manifest.json を fetch し、各スライドHTMLを Shadow DOM に注入する
 *  - export モード: Declarative Shadow DOM としてスライドが既にDOMに存在する
 *                  (document.documentElement に data-exported 属性がある)
 *
 * スライドは 1280x720 の固定キャンバスとして書かれ、
 * エンジンが transform: scale() でビューポートにフィットさせる。
 */

const SLIDE_W = 1280;
const SLIDE_H = 720;

const state = {
  slides: [],      // { host: HTMLElement, shadow: ShadowRoot, title: string }
  current: -1,
  overview: false,
};

const $ = (sel) => document.querySelector(sel);

/* ---------------------------------------------------------------- *
 * 起動
 * ---------------------------------------------------------------- */

export async function boot() {
  const exported = document.documentElement.hasAttribute('data-exported');

  if (exported) {
    collectExportedSlides();
  } else {
    await loadDeckFromManifest();
  }

  setupChrome();
  setupNavigation();
  setupScaling();

  // 初期ページ: ハッシュ (#/3) があればそこへ、なければ先頭へ
  goTo(pageFromHash() ?? 0, { replace: true });
}

/* ---------------------------------------------------------------- *
 * dev モード: manifest を読んでスライドを Shadow DOM に注入
 * ---------------------------------------------------------------- */

async function loadDeckFromManifest() {
  const params = new URLSearchParams(location.search);
  const deckPath = params.get('deck') ?? '../decks/demo';

  const manifest = await fetchJSON(`${deckPath}/manifest.json`);
  document.title = manifest.title ?? 'Slides';

  // デザインシステムを Constructable Stylesheet として1度だけ構築し、
  // 全スライドの shadow root で共有する
  const sheets = await buildSharedSheets(manifest, deckPath);

  const stage = $('#stage');
  const parser = new DOMParser();

  for (const file of manifest.slides) {
    const url = `${deckPath}/slides/${file}`;
    const html = await fetchText(url);
    const doc = parser.parseFromString(html, 'text/html');

    const host = document.createElement('div');
    host.className = 'slide-host';
    const shadow = host.attachShadow({ mode: 'open' });

    // 共有シート(base + design system)を適用
    shadow.adoptedStyleSheets = sheets;

    // スライド固有の <style>(head/body どちらでも)を移植
    for (const style of doc.querySelectorAll('style')) {
      shadow.appendChild(style.cloneNode(true));
    }

    // <link rel="stylesheet"> は単体表示用なので捨てる(共有シートと重複)

    // <body> の中身を移植
    const body = doc.body;
    const wrapper = document.createElement('div');
    wrapper.className = 'slide';
    // body の class(レイアウト指定)を wrapper に引き継ぐ
    wrapper.classList.add(...body.classList);
    wrapper.append(...body.childNodes);
    shadow.appendChild(wrapper);

    stage.appendChild(host);
    state.slides.push({
      host,
      shadow,
      title: doc.title || file,
    });

    // opt-in スクリプトの実行 (<script data-slide-run>)
    runSlideScripts(shadow);
  }
}

async function buildSharedSheets(manifest, deckPath) {
  const urls = [
    new URL('./base.css', import.meta.url).href,
    ...(manifest.stylesheets ?? ['../../design-system/system.css']).map(
      (p) => new URL(p, new URL(`${deckPath}/`, location.href)).href,
    ),
  ];

  const sheets = [];
  for (const url of urls) {
    const css = await fetchText(url);
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    sheets.push(sheet);
  }
  return sheets;
}

let scriptSeq = 0;

function runSlideScripts(shadow) {
  for (const old of shadow.querySelectorAll('script[data-slide-run]')) {
    const script = document.createElement('script');
    // type="text/slide" はエクスポート時にパーサの自動実行を防ぐための印なので剥がす
    for (const { name, value } of old.attributes) {
      if (name !== 'type') script.setAttribute(name, value);
    }
    // スライド内スクリプトには自分の shadow root を `root` として渡す規約。
    // (document.currentScript は shadow tree 内では null になるため、レジストリ経由で渡す)
    const key = `s${scriptSeq++}`;
    (window.__slideRoot ??= {})[key] = shadow;
    script.textContent =
      `{ const root = window.__slideRoot['${key}']; delete window.__slideRoot['${key}'];\n` +
      `${old.textContent}\n}`;
    old.replaceWith(script);
  }
}

/* ---------------------------------------------------------------- *
 * export モード: DSD で既に存在するスライドを回収
 * ---------------------------------------------------------------- */

function collectExportedSlides() {
  for (const host of document.querySelectorAll('.slide-host')) {
    state.slides.push({
      host,
      shadow: host.shadowRoot,
      title: host.dataset.title ?? '',
    });
    runSlideScripts(host.shadowRoot);
  }
}

/* ---------------------------------------------------------------- *
 * ナビゲーション
 * ---------------------------------------------------------------- */

function pageFromHash() {
  const m = location.hash.match(/^#\/(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]) - 1; // URLは1始まり、内部は0始まり
  return clamp(n, 0, state.slides.length - 1);
}

export function goTo(index, { replace = false } = {}) {
  const n = clamp(index, 0, state.slides.length - 1);
  if (n === state.current) {
    syncHash(n, replace);
    render();
    return;
  }
  state.current = n;
  syncHash(n, replace);
  render();
}

const next = () => goTo(state.current + 1);
const prev = () => goTo(state.current - 1);

function syncHash(n, replace) {
  const hash = `#/${n + 1}`;
  if (location.hash === hash) return;
  if (replace) history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
}

function render() {
  state.slides.forEach((s, i) => {
    s.host.toggleAttribute('data-active', i === state.current);
  });
  $('#page-counter').textContent = `${state.current + 1} / ${state.slides.length}`;
  $('#progress').style.transform =
    `scaleX(${state.slides.length > 1 ? state.current / (state.slides.length - 1) : 1})`;
  document.body.classList.toggle('overview', state.overview);
}

function setupNavigation() {
  window.addEventListener('hashchange', () => {
    const n = pageFromHash();
    if (n !== null) goTo(n, { replace: true });
  });

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
        e.preventDefault();
        e.shiftKey ? prev() : next();
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        e.preventDefault();
        prev();
        break;
      case 'Home':
        e.preventDefault();
        goTo(0);
        break;
      case 'End':
        e.preventDefault();
        goTo(state.slides.length - 1);
        break;
      case 'o':
        toggleOverview();
        break;
      case 'Escape':
        if (state.overview) toggleOverview();
        break;
    }
  });

  // タッチスワイプ
  let touchX = null;
  window.addEventListener('touchstart', (e) => (touchX = e.touches[0].clientX), { passive: true });
  window.addEventListener(
    'touchend',
    (e) => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 50) (dx < 0 ? next() : prev());
      touchX = null;
    },
    { passive: true },
  );

  // クリック: 画面の左1/4で戻る、それ以外で進む(overview中はスライド選択)
  // 注意: shadow 内の要素は event.target がホストにリターゲットされるため
  // composedPath() で実際のクリック先を見る
  $('#stage').addEventListener('click', (e) => {
    const path = e.composedPath();

    if (state.overview) {
      const host = path.find((el) => el instanceof Element && el.classList.contains('slide-host'));
      if (host) {
        state.overview = false;
        goTo(state.slides.findIndex((s) => s.host === host));
      }
      return;
    }

    const real = path[0];
    if (real instanceof Element && real.closest('a, button, input, textarea, select, label')) return;
    const ratio = e.clientX / window.innerWidth;
    ratio < 0.25 ? prev() : next();
  });
}

function toggleOverview() {
  state.overview = !state.overview;
  render();
}

/* ---------------------------------------------------------------- *
 * スケーリング: 1280x720 をビューポートにフィット
 * ---------------------------------------------------------------- */

function setupScaling() {
  const fit = () => {
    const scale = Math.min(window.innerWidth / SLIDE_W, window.innerHeight / SLIDE_H);
    document.documentElement.style.setProperty('--slide-scale', scale);
  };
  window.addEventListener('resize', fit);
  fit();

  // overview モードなどで host の実寸が 1280px でないとき、
  // shadow 内の .slide を host 幅に合わせて縮小する
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const w = entry.contentRect.width;
      entry.target.style.setProperty('--host-scale', w / SLIDE_W);
    }
  });
  for (const s of state.slides) ro.observe(s.host);
}

/* ---------------------------------------------------------------- *
 * シェルのUI(ページ番号・プログレスバー)
 * ---------------------------------------------------------------- */

function setupChrome() {
  if (!$('#stage')) {
    const stage = document.createElement('div');
    stage.id = 'stage';
    document.body.prepend(stage);
  }
  if (!$('#chrome')) {
    const chrome = document.createElement('div');
    chrome.id = 'chrome';
    chrome.innerHTML = `
      <div id="progress-track"><div id="progress"></div></div>
      <div id="page-counter"></div>
    `;
    document.body.appendChild(chrome);
  }
}

/* ---------------------------------------------------------------- *
 * util
 * ---------------------------------------------------------------- */

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

boot();
