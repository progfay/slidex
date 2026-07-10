/**
 * slidex engine
 *
 * manifest.json を fetch し、各スライドHTMLを Shadow DOM に注入する。
 * スライドは 1280x720 の固定キャンバスとして書かれ、
 * エンジンが transform: scale() でビューポートにフィットさせる。
 */

const SLIDE_W = 1280;
const SLIDE_H = 720;

const state = {
  slides: [],      // { host: HTMLElement, shadow: ShadowRoot,
                   //   file: string, loaded: Promise<void>|null }
  current: -1,
  overview: false,
};

const $ = (sel) => document.querySelector(sel);

/* ---------------------------------------------------------------- *
 * 起動
 * ---------------------------------------------------------------- */

async function boot() {
  await loadDeckFromManifest();

  setupChrome();
  setupNavigation();
  setupScaling();

  // 初期ページ: URL (?page=3 または #/3) があればそこへ、なければ先頭へ
  goTo(pageFromURL(new URL(location.href)) ?? 0, { replace: true });
}

/* ---------------------------------------------------------------- *
 * manifest を読んでスライドを Shadow DOM に注入
 *
 * 起動時は全スライド分の空の host(プレースホルダ)だけを作り、
 * HTML の fetch と注入は ensureSlide() で表示直前まで遅延する。
 * ---------------------------------------------------------------- */

async function loadDeckFromManifest() {
  const manifest = await fetchJSON('manifest.json');
  document.title = manifest.title ?? 'Slides';

  // デザインシステムを Constructable Stylesheet として1度だけ構築し、
  // 全スライドの shadow root で共有する
  const sheets = await buildSharedSheets(manifest);

  const stage = $('#stage');
  for (const file of manifest.slides) {
    const host = document.createElement('div');
    host.className = 'slide-host';
    const shadow = host.attachShadow({ mode: 'open' });

    // 共有シート(base + design system)を適用
    shadow.adoptedStyleSheets = sheets;

    stage.appendChild(host);
    state.slides.push({ host, shadow, file, loaded: null });
  }
}

/**
 * スライド i の HTML を fetch して shadow root に注入する(初回のみ)。
 * 進行中/完了済みの Promise をキャッシュして多重 fetch を防ぐ。
 * 失敗時はキャッシュを破棄し、次の表示で再試行できるようにする。
 */
function ensureSlide(i) {
  const s = state.slides[i];
  if (!s || s.loaded) return s?.loaded ?? Promise.resolve();

  s.loaded = (async () => {
    const html = await fetchText(`slides/${s.file}`);
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // スライド固有の <style>(head/body どちらでも)を移植
    for (const style of doc.querySelectorAll('style')) {
      s.shadow.appendChild(style.cloneNode(true));
    }

    // <link rel="stylesheet"> は単体表示用なので捨てる(共有シートと重複)

    // <body> の中身を移植
    const body = doc.body;
    const wrapper = document.createElement('div');
    wrapper.className = 'slide';
    // body の class(レイアウト指定)を wrapper に引き継ぐ
    wrapper.classList.add(...body.classList);
    wrapper.append(...body.childNodes);
    s.shadow.appendChild(wrapper);

    // opt-in スクリプトの実行 (<script data-slide-run>)
    runSlideScripts(s.shadow);
  })();

  s.loaded.catch(() => (s.loaded = null));
  return s.loaded;
}

// 前後のスライドを先読みしておく(次の1操作を待たせない)
function prefetchAround(n) {
  ensureSlide(n + 1).catch(() => {});
  ensureSlide(n - 1).catch(() => {});
}

async function buildSharedSheets(manifest) {
  const urls = [
    new URL('./base.css', import.meta.url).href,
    // manifest の stylesheets はサイトルート(= manifest.json の場所)基準
    ...(manifest.stylesheets ?? ['design-system/system.css']).map(
      (p) => new URL(p, location.href).href,
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
    // type="text/slide" は単体表示でブラウザが生実行するのを防ぐための印なので剥がす
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
 * ナビゲーション
 * ---------------------------------------------------------------- */

// URL 同期 (?page=N) は2系統:
//  - Navigation API 対応ブラウザ: navigation.navigate() で遷移し、navigate
//    イベントを intercept して描画する(戻る/進む・URL直編集・スライド内リンクも同経路)
//  - 非対応環境: history.pushState() + popstate
const useNavigationAPI = typeof window.navigation?.navigate === 'function';

function pageFromURL(url) {
  // URLは1始まり、内部は0始まり
  const q = url.searchParams.get('page');
  if (q !== null && /^\d+$/.test(q)) return clamp(Number(q) - 1, 0, state.slides.length - 1);
  return null;
}

function urlFor(n) {
  const url = new URL(location.href);
  url.searchParams.set('page', n + 1);
  url.hash = '';
  return url;
}

function goTo(index, { replace = false } = {}) {
  const n = clamp(index, 0, state.slides.length - 1);
  if (useNavigationAPI) {
    const url = urlFor(n);
    if (url.href === location.href) {
      transitionTo(n);
      return;
    }
    try {
      // 描画は navigate リスナーの intercept handler(transitionTo)が行う
      navigation.navigate(url.href, { history: replace ? 'replace' : 'push' });
      return;
    } catch {
      // 遷移が拒否される環境(サンドボックス等)では pushState にフォールバック
    }
  }
  transitionTo(n);
  syncURL(n, replace);
}

// :active-view-transition-type() が使えるブラウザなら types 付き(オブジェクト
// 引数)で呼べる。古い実装にオブジェクトを渡すと update が呼ばれず DOM 更新が
// 消えるため、セレクタ対応で判定する
const viewTransitionTypesSupported =
  typeof CSS !== 'undefined' &&
  CSS.supports('selector(:active-view-transition-type(forward))');

/**
 * スライドの遅延ロードを待ってからページ切り替えを View Transition で包む
 * (演出は shell.css の ::view-transition-* に定義)。未対応ブラウザ・
 * reduced-motion・初回表示はそのまま切り替える。進行中の遷移は新しい
 * startViewTransition が自動でスキップするので連打の考慮は不要。
 */
async function transitionTo(n) {
  const from = state.current;
  // state は同期的に確定させる(ロード完了まで遅らせると、連打時に
  // 次の入力が古い state.current を見て取りこぼす)
  state.current = n;
  try {
    await ensureSlide(n);
  } catch (err) {
    console.error(err); // ロード失敗時も空の host のまま切り替える
  }
  // ロード待ちの間に別ページへ移っていたら描画しない(後発の呼び出しに任せる)
  if (state.current !== n) return;

  const update = () => render();
  if (
    !document.startViewTransition ||
    from === -1 ||
    from === n ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    render();
  } else if (viewTransitionTypesSupported) {
    document.startViewTransition({ update, types: [n > from ? 'forward' : 'backward'] });
  } else {
    document.startViewTransition(update);
  }
  prefetchAround(n);
}

const next = () => goTo(state.current + 1);
const prev = () => goTo(state.current - 1);

function syncURL(n, replace) {
  const url = urlFor(n);
  if (url.href === location.href) return;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
}

function render() {
  state.slides.forEach((s, i) => {
    s.host.toggleAttribute('data-active', i === state.current);
    // base.css の :host([data-overview]) がスライド内の pointer-events を切る
    s.host.toggleAttribute('data-overview', state.overview);
  });
  $('#page-counter').textContent = `${state.current + 1} / ${state.slides.length}`;
  $('#progress').style.transform =
    `scaleX(${state.slides.length > 1 ? state.current / (state.slides.length - 1) : 1})`;
  document.body.classList.toggle('overview', state.overview);
}

function setupNavigation() {
  if (useNavigationAPI) {
    navigation.addEventListener('navigate', (e) => {
      // 別ページへの遷移・ダウンロード等はブラウザに任せる
      if (!e.canIntercept || e.downloadRequest !== null) return;
      const url = new URL(e.destination.url);
      if (url.origin !== location.origin || url.pathname !== location.pathname) return;
      const n = pageFromURL(url);
      if (n === null) return;
      // スライド切り替えでフォーカス/スクロールを動かさない
      e.intercept({ focusReset: 'manual', scroll: 'manual', handler: () => transitionTo(n) });
    });
  } else {
    // 戻る/進むで URL が変わったときに追従する(pushState は popstate を発火しない)
    window.addEventListener('popstate', () => {
      const n = pageFromURL(new URL(location.href));
      if (n !== null) transitionTo(n);
    });
  }

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
  if (state.overview) {
    // 一覧では全スライドが見えるので、未ロード分を非同期に埋めていく
    for (let i = 0; i < state.slides.length; i++) ensureSlide(i).catch(() => {});
  }
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
  const chrome = document.createElement('div');
  chrome.id = 'chrome';
  chrome.innerHTML = `
    <div id="progress-track"><div id="progress"></div></div>
    <div id="page-counter"></div>
  `;
  document.body.appendChild(chrome);
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
