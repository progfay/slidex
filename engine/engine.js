/**
 * slidex engine
 *
 * manifest.json を fetch し、各スライドHTMLを Shadow DOM に注入する。
 * スライドは 1280x720 の固定キャンバスとして書かれ、
 * ビューポートへのフィットは shell.css の transform: scale() が担う。
 */

const state = {
  slides: [],      // { host: HTMLElement, shadow: ShadowRoot,
                   //   file: string, loaded: Promise<void>|null }
  current: -1,
  overview: false,
  presenter: false, // 発表者ビュー(p キーで開くポップアップ側)
  audience: false,  // 発表者ビューを開いた側(観客用)。発表者ビューと同期する
};

const $ = (sel) => document.querySelector(sel);

/* ---------------------------------------------------------------- *
 * 起動
 * ---------------------------------------------------------------- */

async function boot() {
  await loadDeckFromManifest();

  setupNavigation();
  setupPresenterSync();

  // ?mode=presenter はポップアップの発表者ビュー、?mode=audience はそれを開いた
  // 観客用ウィンドウ(リロードしても役割を保つ)
  const mode = new URL(location.href).searchParams.get('mode');
  if (mode === 'presenter') enterPresenter();
  else if (mode === 'audience') state.audience = true;

  // 初期ページ: URL (?page=3) があればそこへ、なければ先頭へ
  goTo(pageFromURL(new URL(location.href)) ?? 0, { replace: true });
}

/* ---------------------------------------------------------------- *
 * manifest を読んでスライドを Shadow DOM に注入
 *
 * 起動時は全スライド分の空の host(プレースホルダ)だけを作り、
 * HTML の fetch と注入は ensureSlide() で表示直前まで遅延する。
 * ---------------------------------------------------------------- */

async function loadDeckFromManifest() {
  const manifest = JSON.parse(await fetchText('manifest.json'));
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

// スライドHTML取り込み時に捨てるもの:
// - <link>: 単体表示用のデザインシステム参照(共有シートと重複)
// - <meta> <title>: 文書メタ情報(シェル側は manifest の title を使う)
// - <base>: シェルの相対URL解決を狂わせる
// - <script>: スライドはスクリプト実行をサポートしない
// - コメント
const slideSanitizer = new Sanitizer({
  removeElements: ['link', 'meta', 'title', 'base', 'script'],
  comments: false,
});

/**
 * スライド i の HTML を fetch して shadow root に注入する(初回のみ)。
 * 進行中/完了済みの Promise をキャッシュして多重 fetch を防ぐ。
 * 失敗時はキャッシュを破棄し、次の表示で再試行できるようにする。
 */
function ensureSlide(i) {
  const s = state.slides[i];
  if (!s) return Promise.resolve();

  if (!s.loaded) {
    s.loaded = (async () => {
      const html = await fetchText(`slides/${s.file}`);
      const doc = Document.parseHTMLUnsafe(html, { sanitizer: slideSanitizer });

      // 相対の src/poster をスライドファイル基準で解決する。シェルの
      // ドキュメントはルートにあるため、そのままでは単体表示と基準がずれる
      const slideURL = new URL(`slides/${s.file}`, location.href);
      for (const el of doc.querySelectorAll('[src], [poster]')) {
        for (const attr of ['src', 'poster']) {
          const v = el.getAttribute(attr);
          if (v === null) continue;
          try {
            el.setAttribute(attr, new URL(v, slideURL).href);
          } catch {
            // 不正なURLはそのまま残す(スライド全体の読み込みは止めない)
          }
        }
      }

      // スライド内のリンクは上映を離れないよう別タブで開く
      for (const a of doc.querySelectorAll('a[href]')) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }

      // スライド固有の <style>(head/body どちらでも)を移植
      s.shadow.append(...doc.querySelectorAll('style'));

      // <body> の中身を移植
      const body = doc.body;
      const wrapper = document.createElement('div');
      wrapper.className = 'slide';
      // body の class(レイアウト指定)を wrapper に引き継ぐ
      wrapper.classList.add(...body.classList);
      wrapper.append(...body.childNodes);
      s.shadow.appendChild(wrapper);
    })();
    s.loaded.catch(() => (s.loaded = null));
  }
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

  return Promise.all(
    urls.map(async (url) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(await fetchText(url));
      return sheet;
    }),
  );
}

/* ---------------------------------------------------------------- *
 * ナビゲーション
 * ---------------------------------------------------------------- */

// URL 同期 (?page=N) は Navigation API 前提: navigation.navigate() で遷移し、
// navigate イベントを intercept して描画する
// (戻る/進む・URL直編集・スライド内リンクも同経路)

function pageFromURL(url) {
  // URLは1始まり、内部は0始まり
  const q = url.searchParams.get('page');
  if (q !== null && /^\d+$/.test(q)) return clamp(Number(q) - 1, 0, state.slides.length - 1);
  return null;
}

function urlFor(n) {
  const url = new URL(location.href);
  url.searchParams.set('page', n + 1);
  return url;
}

function goTo(index, { replace = false } = {}) {
  const n = clamp(index, 0, state.slides.length - 1);
  const url = urlFor(n);
  if (url.href === location.href) {
    transitionTo(n);
    return;
  }
  // 描画は navigate リスナーの intercept handler(transitionTo)が行う
  navigation.navigate(url.href, { history: replace ? 'replace' : 'push' });
}

/**
 * スライドの遅延ロードを待ってからページ切り替えを View Transition で包む
 * (演出は shell.css の ::view-transition-* に定義)。reduced-motion・
 * 初回表示はそのまま切り替える。進行中の遷移は新しい startViewTransition
 * が自動でスキップするので連打の考慮は不要。
 */
async function transitionTo(n) {
  const from = state.current;
  // state は同期的に確定させる(ロード完了まで遅らせると、連打時に
  // 次の入力が古い state.current を見て取りこぼす)
  state.current = n;
  syncPage(n);
  try {
    await ensureSlide(n);
  } catch (err) {
    console.error(err); // ロード失敗時も空の host のまま切り替える
  }
  // ロード待ちの間に別ページへ移っていたら描画しない(後発の呼び出しに任せる)
  if (state.current !== n) return;

  // 発表者ビューは2枚(現在+次)を同時に出すので遷移演出をかけない
  if (from === -1 || from === n || state.presenter ||
      matchMedia('(prefers-reduced-motion: reduce)').matches) {
    render();
  } else {
    const vt = document.startViewTransition({ update: render, types: [n > from ? 'forward' : 'backward'] });
    // 連打で遷移がスキップされた時の AbortError を console に出さない
    vt.ready.catch(() => {});
  }
  prefetchAround(n);
}

const next = () => goTo(state.current + 1);
const prev = () => goTo(state.current - 1);

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
  if (state.presenter) renderPresenter();
}

function setupNavigation() {
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

  window.addEventListener('keydown', (e) => {
    // Cmd/Ctrl+P はブラウザの印刷より先に横取りし、全スライドの
    // ロードを待ってから印刷に入る(未ロードのスライドが白紙で刷られるのを防ぐ)
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === 'p') {
      e.preventDefault();
      exportPDF();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isInteractive(e.composedPath()[0])) return;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case ' ':
        e.preventDefault();
        next();
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        prev();
        break;
      case 'o':
        toggleOverview();
        break;
      case 'p':
        // 発表者ビューでは p でポップアップを閉じる。それ以外では開く
        if (state.presenter) window.close();
        else openPresenter();
        break;
      case '+':
      case '=':
      case '-':
        if (state.presenter) resizeNotes(e.key === '-' ? -2 : 2);
        break;
    }
  });

  // クリック: 画面の左1/4で戻る、右1/4で進む。中央は何もしない
  // (overview中はスライド選択)
  // 注意: shadow 内の要素は event.target がホストにリターゲットされるため
  // composedPath() で実際のクリック先を見る
  let pointerDownAt = null;
  $('#stage').addEventListener('pointerdown', (e) => {
    pointerDownAt = { x: e.clientX, y: e.clientY };
  });
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

    if (isInteractive(path[0])) return;
    // テキスト選択を遷移と誤認しない: ドラッグ(押下位置から動いた)か、
    // 選択が残っている間のクリックでは遷移しない
    if (pointerDownAt && Math.hypot(e.clientX - pointerDownAt.x, e.clientY - pointerDownAt.y) > 5) {
      return;
    }
    const selection = document.getSelection();
    if (selection && !selection.isCollapsed) return;

    const ratio = e.clientX / window.innerWidth;
    if (ratio < 0.25) {
      prev();
    } else if (ratio > 0.75) {
      next();
    }
  });
}

// スライド内の操作可能な要素(の中)なら、ナビゲーションに入力を奪わせない
function isInteractive(target) {
  return (
    target instanceof Element &&
    target.closest('a, button, input, textarea, select, label') !== null
  );
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
 * 発表者ビュー(presentation mode)
 *
 * p キーで、発表者ビューをポップアップで開く(?mode=presenter)。
 * 開いた側(opener)はそのまま観客用の上映画面になる(?mode=audience)。
 * 発表者ビューには現在のスライド・次のスライド・発表者ノート・経過
 * タイマーを出す。ページ送りは BroadcastChannel で双方向に同期する
 * (どちらで送ってももう一方が追従する)。チャネルに参加するのは
 * この2つのウィンドウだけで、普通に開いた他のタブは巻き込まない。
 * ---------------------------------------------------------------- */

const PRESENTER_NAME = 'slidex-presenter';
const channel = new BroadcastChannel(`slidex:${location.pathname}`);
let syncedPage = -1; // 最後に送受信したページ(受信→送信のループ防止)
const NOTES_SIZE_KEY = 'slidex:presenter-notes-size';

function syncing() {
  return state.audience || state.presenter;
}

function syncPage(n) {
  if (!syncing() || n === syncedPage) return;
  syncedPage = n;
  channel.postMessage({ type: 'goto', page: n });
}

function setupPresenterSync() {
  channel.addEventListener('message', (e) => {
    if (!syncing()) return;
    const msg = e.data;
    if (msg?.type === 'goto' && Number.isInteger(msg.page)) {
      syncedPage = msg.page;
      goTo(msg.page, { replace: true });
    } else if (msg?.type === 'hello' && state.current >= 0) {
      // 相手が(再)読み込みされたら現在ページを教える
      channel.postMessage({ type: 'goto', page: state.current });
    }
  });
  // 観客用ウィンドウがリロードされた時は、発表者ビューのページに合わせる
  if (state.audience) channel.postMessage({ type: 'hello' });
}

// 発表者ビューをポップアップで開き、このウィンドウを観客用にする
function openPresenter() {
  const url = new URL(location.href);
  url.searchParams.set('mode', 'presenter');
  if (state.current >= 0) url.searchParams.set('page', state.current + 1);
  // 同名のウィンドウが既にあれば、それを再利用(再読み込み)する
  const win = window.open(url.href, PRESENTER_NAME, 'popup,width=1280,height=800');
  if (win === null) {
    alert('発表者ビューを開けませんでした。ポップアップを許可してから、もう一度 p を押してください。');
    return;
  }
  state.audience = true;
  setModeParam('audience');
  syncedPage = state.current;
}

function enterPresenter() {
  state.presenter = true;
  document.body.classList.add('presenter');
  $('#presenter').hidden = false;
  startTimer();
  applyNotesSize(loadNotesSize());
}

// ?mode= を履歴を増やさずに付け替える(goTo の urlFor が引き継ぐ)
function setModeParam(mode) {
  const url = new URL(location.href);
  if (mode) url.searchParams.set('mode', mode);
  else url.searchParams.delete('mode');
  if (url.href !== location.href) history.replaceState(history.state, '', url.href);
}

function renderPresenter() {
  const total = state.slides.length;
  const n = state.current;
  state.slides.forEach((s, i) => s.host.toggleAttribute('data-next', i === n + 1));
  $('#presenter-page').textContent = `${n + 1} / ${total}`;
  $('#presenter-end').hidden = n + 1 < total;

  const notesEl = $('#presenter-notes');
  const aside = state.slides[n]?.shadow.querySelector('aside.notes');
  notesEl.replaceChildren();
  if (aside && aside.textContent.trim()) {
    notesEl.append(...[...aside.childNodes].map((c) => c.cloneNode(true)));
    // 子要素のない素のテキストのノートは改行をそのまま活かす
    notesEl.classList.toggle('plain', aside.children.length === 0);
  } else {
    const empty = document.createElement('p');
    empty.className = 'presenter-empty';
    empty.textContent = state.slides[n]?.loaded ? 'ノートなし' : '読み込み中…';
    notesEl.append(empty);
  }
  notesEl.scrollTop = 0;
}

// 経過タイマー(クリックでリセット)と現在時刻
let timerStarted = 0;
let timerId = 0;

function startTimer() {
  if (timerId) return;
  timerStarted = Date.now();
  const timer = $('#presenter-timer');
  timer.onclick = () => {
    timerStarted = Date.now();
    tick();
  };
  const pad = (v) => String(v).padStart(2, '0');
  const tick = () => {
    const sec = Math.floor((Date.now() - timerStarted) / 1000);
    timer.textContent = `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
    const now = new Date();
    $('#presenter-clock').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  };
  tick();
  timerId = setInterval(tick, 1000);
}

// ノートの文字サイズ(+ / - で調整、ブラウザに記憶)
function loadNotesSize() {
  try {
    const v = Number(localStorage.getItem(NOTES_SIZE_KEY));
    if (v >= 12 && v <= 64) return v;
  } catch {}
  return 24;
}

function applyNotesSize(px) {
  $('#presenter').style.setProperty('--presenter-notes-size', `${px}px`);
}

function resizeNotes(delta) {
  const px = clamp(loadNotesSize() + delta, 12, 64);
  try {
    localStorage.setItem(NOTES_SIZE_KEY, String(px));
  } catch {}
  applyNotesSize(px);
}

/* ---------------------------------------------------------------- *
 * PDF エクスポート(印刷)
 *
 * レイアウトは shell.css の @media print / @page が担う
 * (1スライド = 1ページ、キャンバスと同寸の 1280x720)。
 * 印刷ダイアログで「PDF に保存」を選べばそのまま PDF になる。
 * ---------------------------------------------------------------- */

async function exportPDF() {
  // スライドは遅延ロードなので、全ページ分の注入と画像のデコードを
  // 待ってから印刷に入る(print 中に非同期処理は完了できない)
  await Promise.allSettled(state.slides.map((_, i) => ensureSlide(i)));
  const imgs = state.slides.flatMap((s) => [...s.shadow.querySelectorAll('img')]);
  await Promise.allSettled(imgs.map((img) => img.decode()));
  window.print();
}

// メニュー等からの印刷(beforeprint は await できない)では間に合わない分の
// ロードだけ開始しておく。確実な出力経路は Cmd/Ctrl+P(上の exportPDF)
window.addEventListener('beforeprint', () => {
  for (let i = 0; i < state.slides.length; i++) ensureSlide(i).catch(() => {});
});

/* ---------------------------------------------------------------- *
 * util
 * ---------------------------------------------------------------- */

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

boot();
