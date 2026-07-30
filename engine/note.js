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
const REMOVE_TAGS = ['link', 'meta', 'title', 'base', 'script'];

// note.html は iOS Safari からも開かれるため、engine.js と違い Sanitizer API に
// fallback なしで依存しない(README の動作要件は index.html 側の話)
const supportsSanitizer =
  typeof Sanitizer === 'function' && typeof Document.parseHTMLUnsafe === 'function';

const slideSanitizer = supportsSanitizer
  ? new Sanitizer({ removeElements: REMOVE_TAGS, comments: false })
  : null;

// Sanitizer API 非対応環境向けフォールバック。DOMParser が生成する script は
// 実行不能なため、link/meta/title/base/script の除去とコメント除去だけ手動で行う
function parseSlideHTML(html) {
  if (supportsSanitizer) {
    return Document.parseHTMLUnsafe(html, { sanitizer: slideSanitizer });
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of doc.querySelectorAll(REMOVE_TAGS.join(', '))) {
    el.remove();
  }
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  const comments = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    comments.push(node);
  }
  for (const comment of comments) comment.remove();
  return doc;
}

async function boot() {
  const manifest = JSON.parse(await fetchText('manifest.json'));
  document.title = `ノート — ${manifest.title ?? 'Slides'}`;
  $('#deck-title').textContent = manifest.title ?? 'Slides';

  setupTimer();

  const sheets = await buildSharedSheets(manifest);
  const list = $('#note-items');

  // 各スライドの note item は fetch 前に(順序どおり)追加し、
  // 内容は非同期で後から埋める(並列 fetch でも表示順が崩れない)
  await Promise.all(
    manifest.slides.map(async (file) => {
      const item = document.createElement('section');
      item.className = 'note-item';
      list.appendChild(item);

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
        const doc = parseSlideHTML(html);

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
