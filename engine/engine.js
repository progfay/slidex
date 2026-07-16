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
};

const $ = (sel) => document.querySelector(sel);

// 発表者ビュー(?presenter): 同じエンジンを body.presenter の別レイアウトで
// 動かし、ページ位置を BroadcastChannel で上映ウィンドウと相互同期する。
// チャンネル名は pathname 込み(同一オリジンで複数デッキを serve しても混線しない)
const isPresenter = new URL(location.href).searchParams.has('presenter');
const channel = new BroadcastChannel(`slidex:${location.pathname}`);

/* ---------------------------------------------------------------- *
 * 起動
 * ---------------------------------------------------------------- */

async function boot() {
  await loadDeckFromManifest();

  setupNavigation();
  if (isPresenter) setupPresenter();

  // 他ウィンドウのページ移動に追従する(自分の移動は transitionTo が通知する)
  channel.addEventListener('message', (e) => {
    if (typeof e.data === 'number' && e.data !== state.current) {
      goTo(e.data, { replace: true });
    }
  });

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
// - コメント
// <script> は残す(パーサ挿入なので自動実行されず、data-slide-run 付きだけを
// runSlideScripts が明示的に実行する)
const slideSanitizer = new Sanitizer({
  removeElements: ['link', 'meta', 'title', 'base'],
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

      // opt-in スクリプトの実行 (<script data-slide-run>)
      runSlideScripts(s.shadow);
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

// opt-in スクリプト(<script type="text/slide" data-slide-run>)を実行する。
// スライド内スクリプトには自分の shadow root を `root` として渡す規約
function runSlideScripts(shadow) {
  for (const script of shadow.querySelectorAll('script[data-slide-run]')) {
    new Function('root', script.textContent)(shadow);
  }
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
  // 他ウィンドウへ通知。受信側は同じページなら無視するのでループしない
  channel.postMessage(n);
  try {
    await ensureSlide(n);
  } catch (err) {
    console.error(err); // ロード失敗時も空の host のまま切り替える
  }
  // ロード待ちの間に別ページへ移っていたら描画しない(後発の呼び出しに任せる)
  if (state.current !== n) return;

  if (from === -1 || from === n || matchMedia('(prefers-reduced-motion: reduce)').matches) {
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
    // 発表者ビューの「次のスライド」プレビュー用(通常表示では表示に影響しない)
    s.host.toggleAttribute('data-next', i === state.current + 1);
    // base.css の :host([data-overview]) がスライド内の pointer-events を切る
    s.host.toggleAttribute('data-overview', state.overview);
  });
  const counter = `${state.current + 1} / ${state.slides.length}`;
  $('#page-counter').textContent = counter;
  $('#progress').style.transform =
    `scaleX(${state.slides.length > 1 ? state.current / (state.slides.length - 1) : 1})`;
  document.body.classList.toggle('overview', state.overview);

  if (isPresenter) {
    $('#presenter-counter').textContent = counter;
    // 現在スライドの shadow から発表者ノートを転記(transitionTo が
    // ensureSlide を待ってから render するので、表示中スライドは常にロード済み)
    $('#notes').innerHTML =
      state.slides[state.current]?.shadow.querySelector('aside.notes')?.innerHTML ?? '';
  }
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
        if (!isPresenter) openPresenter();
        break;
    }
  });

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

    if (isInteractive(path[0])) return;
    if (e.clientX / window.innerWidth < 0.25) {
      prev();
    } else {
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
  if (isPresenter) return; // 発表者ビューのレイアウトと両立しない
  state.overview = !state.overview;
  if (state.overview) {
    // 一覧では全スライドが見えるので、未ロード分を非同期に埋めていく
    for (let i = 0; i < state.slides.length; i++) ensureSlide(i).catch(() => {});
  }
  render();
}

/* ---------------------------------------------------------------- *
 * 発表者ビュー
 * ---------------------------------------------------------------- */

// 現在ページの ?presenter 付き URL を別ウィンドウで開く。
// ウィンドウ名を固定しているので、2回目以降は既存ウィンドウの再利用になる
function openPresenter() {
  const url = urlFor(state.current);
  url.searchParams.set('presenter', '');
  window.open(url.href, 'slidex-presenter', 'width=1200,height=720');
}

// タイマー(クリックでリセット)と現在時刻。レイアウトは shell.css の
// body.presenter が担い、ノートと次スライドの更新は render() が行う
function setupPresenter() {
  document.body.classList.add('presenter');
  document.title = `発表者ビュー — ${document.title}`;

  const timer = $('#timer');
  const clock = $('#clock');
  let started = Date.now();

  const pad = (n) => String(n).padStart(2, '0');
  const tick = () => {
    const sec = Math.floor((Date.now() - started) / 1000);
    timer.textContent =
      (sec >= 3600 ? `${Math.floor(sec / 3600)}:` : '') +
      `${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
    clock.textContent = new Date().toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  timer.addEventListener('click', () => {
    started = Date.now();
    tick();
    timer.blur(); // フォーカスが残ると Space がページ送りでなくリセットになる
  });
  tick();
  setInterval(tick, 1000);
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
