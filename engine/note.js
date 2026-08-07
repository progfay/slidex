/**
 * slidex note viewer
 *
 * manifest.json の並び順でスライドHTMLを fetch し、各スライドのプレビュー
 * (Shadow DOM 注入、CSSで max-height: 40dvb に収める)と
 * <aside class="notes"> の中身を縦スクロールの一覧に並べる。
 * スマホから読み返すための簡易ビュー(index.html の上映とは同期しない、
 * 独立した読み物)。
 */

const $ = (sel) => document.querySelector(sel);

// スライドHTML取り込み時に捨てるもの(engine.js と同じ契約。詳細はそちらを参照)
const slideSanitizer = new Sanitizer({
  removeElements: ['link', 'meta', 'title', 'base', 'script'],
  comments: false,
});

async function boot() {
  const manifest = JSON.parse(await fetchText('manifest.json'));
  document.title = `ノート — ${manifest.title ?? 'Slides'}`;
  $('#deck-title').textContent = manifest.title ?? 'Slides';

  setupTimer();

  const sheets = await buildSharedSheets(manifest);
  const list = $('#note-items');

  // 各スライドの note item は fetch 前に(順序どおり)追加し、
  // 内容は非同期で後から埋める(並列 fetch でも表示順が崩れない)
  const total = manifest.slides.length;

  await Promise.all(
    manifest.slides.map(async (file, i) => {
      const item = document.createElement('section');
      item.className = 'note-item';
      list.appendChild(item);

      const index = document.createElement('div');
      index.className = 'note-index';
      index.textContent = `${i + 1} / ${total}`;
      item.appendChild(index);

      const preview = document.createElement('div');
      preview.className = 'note-preview';
      const canvas = document.createElement('div');
      canvas.className = 'note-preview-canvas';
      const shadow = canvas.attachShadow({ mode: 'open' });
      shadow.adoptedStyleSheets = sheets;
      preview.appendChild(canvas);
      item.appendChild(preview);

      const body = document.createElement('div');
      body.className = 'note-body';
      item.appendChild(body);

      try {
        const html = await fetchText(`slides/${file}`);
        const doc = Document.parseHTMLUnsafe(html, { sanitizer: slideSanitizer });

        // 相対の src/poster をスライドファイル基準で解決する(engine.js と同じ)
        const slideURL = new URL(`slides/${file}`, location.href);
        for (const el of doc.querySelectorAll('[src], [poster]')) {
          for (const attr of ['src', 'poster']) {
            const v = el.getAttribute(attr);
            if (v === null) continue;
            try {
              el.setAttribute(attr, new URL(v, slideURL).href);
            } catch {
              // 不正なURLはそのまま残す(プレビュー全体の読み込みは止めない)
            }
          }
        }

        // aside.notes は body ごとプレビューへ移植する前に読んでおく
        // (base.css が display: none にするので移植しても見た目には出ない)
        const notes = doc.querySelector('aside.notes')?.innerHTML.trim();

        shadow.append(...doc.querySelectorAll('style'));
        const wrapper = document.createElement('div');
        wrapper.className = 'slide';
        wrapper.classList.add(...doc.body.classList);
        wrapper.append(...doc.body.childNodes);
        shadow.appendChild(wrapper);

        body.innerHTML = notes || '<p class="note-empty">ノートなし</p>';
      } catch (err) {
        console.error(err);
        body.innerHTML = '<p class="note-empty">読み込みに失敗しました</p>';
      }
    }),
  );
}

// 共有シート(base + design system)を構築する(engine.js と同じ)
async function buildSharedSheets(manifest) {
  const urls = [
    new URL('./base.css', import.meta.url).href,
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

// 経過タイマー。タップでリセットする(発表の経過時間確認用)
function setupTimer() {
  const timer = $('#timer');
  let started = Date.now();

  const pad = (n) => String(n).padStart(2, '0');
  const tick = () => {
    const sec = Math.floor((Date.now() - started) / 1000);
    timer.textContent =
      (sec >= 3600 ? `${Math.floor(sec / 3600)}:` : '') +
      `${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
  };
  timer.addEventListener('click', () => {
    started = Date.now();
    tick();
  });
  tick();
  setInterval(tick, 1000);
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

boot();
