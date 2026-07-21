#!/usr/bin/env python3
"""Bundle a slidex deck (manifest.json + slides/ + design-system/) into a
single self-contained HTML file, for previewing on devices that can't run
a local server or open multiple relative-path files (e.g. as a Claude
Artifact from a phone). Not used for the real Pages deployment — the
production shell (engine/) still fetches slides/ individually.

Usage: python3 .claude/skills/preview/build-preview.py [output_path]
  output_path defaults to dist/preview.html (dist/ is gitignored)
"""
import base64
import html
import json
import mimetypes
import re
import sys
from pathlib import Path

# this file lives at <repo_root>/.claude/skills/preview/build-preview.py
repo_root = Path(__file__).resolve().parents[3]
out_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else repo_root / "dist" / "preview.html"

manifest = json.loads((repo_root / "manifest.json").read_text())
title = manifest.get("title", "Slides")
stylesheet_paths = manifest.get("stylesheets", ["design-system/system.css"])
slide_files = manifest["slides"]

base_css = (repo_root / "engine" / "base.css").read_text()
shared_css_parts = [base_css]
for sp in stylesheet_paths:
    shared_css_parts.append((repo_root / sp).read_text())
shared_css = "\n\n".join(shared_css_parts)

STYLE_RE = re.compile(r"<style[^>]*>(.*?)</style>", re.DOTALL | re.IGNORECASE)
SCRIPT_RE = re.compile(r"<script[^>]*>.*?</script>", re.DOTALL | re.IGNORECASE)
BODY_RE = re.compile(r"<body([^>]*)>(.*)</body>", re.DOTALL | re.IGNORECASE)
CLASS_RE = re.compile(r'class="([^"]*)"')
SRC_RE = re.compile(r'(?<![\w-])(src|poster)="([^"]*)"')


def to_data_uri(rel_path, from_dir):
    asset_path = (from_dir / rel_path).resolve()
    mime, _ = mimetypes.guess_type(str(asset_path))
    mime = mime or "application/octet-stream"
    data = base64.b64encode(asset_path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{data}"


def inline_assets(fragment, slide_dir):
    def repl(m):
        attr, val = m.group(1), m.group(2)
        if val.startswith(("http://", "https://", "data:")):
            return m.group(0)
        try:
            uri = to_data_uri(val, slide_dir)
        except FileNotFoundError:
            return m.group(0)
        return f'{attr}="{uri}"'

    return SRC_RE.sub(repl, fragment)


templates = []
slides_dir = repo_root / "slides"
for fname in slide_files:
    raw = (slides_dir / fname).read_text()
    styles = "\n".join(STYLE_RE.findall(raw))
    body_match = BODY_RE.search(raw)
    if not body_match:
        raise ValueError(f"{fname}: no <body> found")
    body_attrs, body_inner = body_match.group(1), body_match.group(2)
    class_match = CLASS_RE.search(body_attrs)
    body_class = class_match.group(1) if class_match else "slide"
    body_inner = SCRIPT_RE.sub("", body_inner)
    body_inner = inline_assets(body_inner, slides_dir)

    templates.append(f'''<template class="slide-tpl" data-file="{html.escape(fname)}">
<style>{styles}</style>
<div class="{html.escape(body_class)}">{body_inner}</div>
</template>''')

# Chrome colors mirror design-system/system.css tokens so the shell doesn't
# clash with the (fixed-dark) slide theme it's framing.
shell_css = """
:root {
  color-scheme: dark;
  --shell-bg: #0A0D14;
  --shell-ink: #E8EDF6;
  --shell-muted: #8C96AB;
  --shell-accent: #5CCFE6;
  --shell-surface: #171D2B;
  --shell-line: #2A3245;
  --shell-font: 'Avenir Next', 'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN',
    'Hiragino Sans', 'Noto Sans JP', sans-serif;
}
html, body { margin: 0; height: 100%; }
body {
  display: flex; flex-direction: column;
  background: var(--shell-bg); color: var(--shell-ink);
  font-family: var(--shell-font);
}

/* ---- top bar: deck title + mode toggles ---- */
#topbar {
  flex: none; display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 8px 10px 6px 16px;
}
#deck-title {
  font-size: 13px; color: var(--shell-muted);
  letter-spacing: 0.04em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#topbar-actions { flex: none; display: flex; gap: 6px; }
#topbar-actions button {
  font: inherit; font-size: 13px; color: var(--shell-muted); background: transparent;
  border: 1px solid var(--shell-line); border-radius: 999px;
  padding: 5px 10px; min-height: 30px;
  display: flex; align-items: center; gap: 4px;
  font-variant-numeric: tabular-nums;
}
#topbar-actions button[aria-pressed="true"] {
  color: var(--shell-bg); background: var(--shell-accent); border-color: var(--shell-accent);
}

/* ---- stage ----
   Mirrors engine/shell.css's own .slide-host rule: fit *both* dimensions
   (not just width) and center the result, instead of base.css's
   width-only cqw scaling (which is meant for a host that's already been
   sized to 1280x720 by the real shell — here the host has no shell
   around it, so we have to do that sizing ourselves). Matching this
   avoids a dead letterboxed gap anchored to one side on non-16:9
   viewports (typical on phones). */
#stage { flex: 1; position: relative; overflow: hidden; min-height: 0; container-type: size; }
body[data-mode="annotate"] #stage { cursor: crosshair; }
.slide-host {
  display: none;
  position: absolute; top: 50%; left: 50%;
  width: 1280px; height: 720px;
  transform: translate(-50%, -50%) scale(min(calc(100cqw / 1280px), calc(100cqh / 720px)));
  transform-origin: center;
}
.slide-host[data-active] { display: block; }

/* ---- annotation pins ----
   The layer is sized to the actual rendered slide rect (see
   layoutAnnotationLayer) purely so pins line up visually; it never
   catches clicks itself (pointer-events: none) — #stage does that
   across its full area, including any letterboxed dead space below
   the rendered slide on non-16:9 viewports, and clamps the resulting
   coordinate into the valid 0-1280 / 0-720 range. */
#annotation-layer {
  position: absolute; left: 0; top: 0; width: 0; height: 0;
  z-index: 5; pointer-events: none;
}
body[data-mode="annotate"] #annotation-layer { box-shadow: inset 0 0 0 2px var(--shell-accent); }
.pin {
  position: absolute; transform: translate(-50%, -50%);
  width: 26px; height: 26px; border-radius: 50%;
  background: var(--shell-accent); color: #06262E;
  border: 2px solid var(--shell-bg); box-shadow: 0 1px 4px rgba(0,0,0,.5);
  font: 700 12px/1 var(--shell-font); font-variant-numeric: tabular-nums;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; pointer-events: auto; padding: 0;
}
.pin:hover, .pin:focus-visible { transform: translate(-50%, -50%) scale(1.15); }

/* ---- note composer (appears near the tapped point) ---- */
#composer {
  position: absolute; z-index: 10; display: none;
  width: min(260px, calc(100% - 24px));
  background: var(--shell-surface); border: 1px solid var(--shell-line);
  border-radius: 10px; padding: 10px; box-shadow: 0 6px 20px rgba(0,0,0,.5);
}
#composer.open { display: block; }
#composer .hit {
  font-size: 12px; color: var(--shell-muted); margin-bottom: 6px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#composer textarea {
  width: 100%; box-sizing: border-box; resize: vertical; min-height: 56px;
  font: 14px/1.4 var(--shell-font); color: var(--shell-ink);
  background: var(--shell-bg); border: 1px solid var(--shell-line); border-radius: 6px;
  padding: 6px 8px;
}
#composer textarea:focus-visible, #copy-box textarea:focus-visible, #topbar-actions button:focus-visible,
#bar button:focus-visible, .pin:focus-visible, #drawer-header button:focus-visible {
  outline: 2px solid var(--shell-accent); outline-offset: 1px;
}
#composer .actions { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
#composer button {
  font: inherit; font-size: 13px; border-radius: 6px; padding: 6px 12px; border: 1px solid var(--shell-line);
  background: transparent; color: var(--shell-ink);
}
#composer .delete { color: #F2708A; border-color: #F2708A; margin-right: auto; display: none; }
#composer .save { background: var(--shell-accent); border-color: var(--shell-accent); color: #06262E; font-weight: 600; }

/* ---- bottom nav bar ---- */
#bar {
  flex: none; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
  gap: 12px; padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
  background: var(--shell-surface); border-top: 1px solid var(--shell-line);
  -webkit-user-select: none; user-select: none;
}
#bar button {
  font: inherit; color: var(--shell-ink); background: transparent;
  border: 1px solid var(--shell-line); border-radius: 8px;
  min-width: 52px; min-height: 44px;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; line-height: 1;
}
#prev { justify-self: start; }
#next { justify-self: end; }
#bar button:active { background: var(--shell-line); border-color: var(--shell-accent); }
#counter {
  justify-self: center; font-variant-numeric: tabular-nums;
  font-size: 13px; color: var(--shell-muted);
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ---- notes drawer ---- */
#drawer {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
  background: var(--shell-surface); border-top: 1px solid var(--shell-line);
  border-radius: 14px 14px 0 0; box-shadow: 0 -8px 24px rgba(0,0,0,.5);
  max-height: 70vh; display: flex; flex-direction: column;
  transform: translateY(100%); transition: transform .2s ease;
}
#drawer.open { transform: translateY(0); }
#drawer-header {
  flex: none; display: flex; align-items: center; gap: 8px;
  padding: 12px 14px; border-bottom: 1px solid var(--shell-line);
}
#drawer-header h2 { font-size: 14px; margin: 0; flex: 1; font-weight: 600; }
#drawer-header button {
  font: inherit; font-size: 13px; border-radius: 6px; padding: 6px 10px; border: 1px solid var(--shell-line);
  background: transparent; color: var(--shell-ink);
}
#copy-btn { background: var(--shell-accent); border-color: var(--shell-accent); color: #06262E; font-weight: 600; }
#copy-box { display: none; padding: 10px 14px; border-bottom: 1px solid var(--shell-line); }
#copy-box.open { display: block; }
#copy-box textarea {
  width: 100%; box-sizing: border-box; min-height: 130px;
  font: 12px/1.6 ui-monospace, 'SF Mono', Menlo, monospace;
  color: var(--shell-ink); background: var(--shell-bg); border: 1px solid var(--shell-line);
  border-radius: 6px; padding: 8px;
}
#copy-box .hint { font-size: 12px; color: var(--shell-muted); margin-top: 6px; }
#note-list { overflow-y: auto; padding: 10px 14px calc(14px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 8px; }
#empty-note { padding: 16px 4px; text-align: center; color: var(--shell-muted); font-size: 13px; }
.note-item { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; background: var(--shell-bg); border: 1px solid var(--shell-line); border-radius: 8px; }
.note-item .badge {
  flex: none; width: 22px; height: 22px; border-radius: 50%;
  background: var(--shell-accent); color: #06262E; font: 700 11px/22px var(--shell-font);
  text-align: center; font-variant-numeric: tabular-nums;
}
.note-item .body { flex: 1; min-width: 0; }
.note-item .loc { font-size: 11px; color: var(--shell-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note-item .text { font-size: 14px; margin-top: 2px; white-space: pre-wrap; word-break: break-word; }
.note-item .remove { flex: none; background: transparent; border: none; color: var(--shell-muted); font-size: 18px; line-height: 1; padding: 2px 4px; cursor: pointer; }
"""

runtime_js = """
(function () {
  var sheet = new CSSStyleSheet();
  sheet.replaceSync(document.getElementById('shared-style').textContent);
  var stage = document.getElementById('stage');
  var annotationLayer = document.getElementById('annotation-layer');
  var hosts = [];
  document.querySelectorAll('template.slide-tpl').forEach(function (tpl) {
    var host = document.createElement('div');
    host.className = 'slide-host';
    var shadow = host.attachShadow({ mode: 'open' });
    shadow.adoptedStyleSheets = [sheet];
    shadow.appendChild(tpl.content.cloneNode(true));
    stage.insertBefore(host, annotationLayer);
    hosts.push(host);
  });

  var files = Array.prototype.map.call(document.querySelectorAll('template.slide-tpl'), function (t) {
    return t.getAttribute('data-file');
  });
  var current = 0;
  function render() {
    hosts.forEach(function (h, i) { h.toggleAttribute('data-active', i === current); });
    document.getElementById('counter').textContent =
      (files[current] || '') + '  ·  ' + (current + 1) + ' / ' + hosts.length;
    layoutAnnotationLayer();
    renderPins();
  }
  function goTo(n) { current = Math.max(0, Math.min(hosts.length - 1, n)); closeComposer(); render(); }

  document.getElementById('prev').addEventListener('click', function () { goTo(current - 1); });
  document.getElementById('next').addEventListener('click', function () { goTo(current + 1); });
  stage.addEventListener('click', function (e) {
    if (document.body.dataset.mode === 'annotate') {
      if (e.target.closest('.pin') || e.target.closest('#composer')) return;
      openComposerForNew(e.clientX, e.clientY);
      return;
    }
    var ratio = e.clientX / window.innerWidth;
    if (ratio < 0.3) goTo(current - 1); else if (ratio > 0.7) goTo(current + 1);
  });
  function isTyping() {
    var a = document.activeElement;
    return !!(a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT'));
  }
  window.addEventListener('keydown', function (e) {
    if (isTyping()) return;
    if (e.key === 'ArrowRight' || e.key === ' ') goTo(current + 1);
    if (e.key === 'ArrowLeft') goTo(current - 1);
  });

  /* ------------------------------------------------------------ *
   * Annotations: pin position is stored in the slide's own fixed
   * 1280x720 coordinate space, not screen pixels, so it stays
   * meaningful regardless of how much the canvas is scaled down to
   * fit the viewport (phone vs desktop).
   * ------------------------------------------------------------ */
  var notes = []; // { id, slideIndex, file, x, y, tag, text, note }
  var nextId = 1;
  var editingId = null;
  var pending = null; // { slideIndex, x, y, tag, text } for a not-yet-saved pin

  // Matches .slide-host's own CSS (fit both dimensions, centered), so this
  // rect is exactly where the slide is actually drawn on non-16:9
  // viewports (typically phones), not the full #stage box.
  function getSlideRect() {
    var stageRect = stage.getBoundingClientRect();
    var scale = Math.min(stageRect.width / 1280, stageRect.height / 720);
    var w = 1280 * scale;
    var h = 720 * scale;
    return {
      left: stageRect.left + (stageRect.width - w) / 2,
      top: stageRect.top + (stageRect.height - h) / 2,
      width: w, height: h,
    };
  }
  function layoutAnnotationLayer() {
    var stageRect = stage.getBoundingClientRect();
    var r = getSlideRect();
    annotationLayer.style.left = (r.left - stageRect.left) + 'px';
    annotationLayer.style.top = (r.top - stageRect.top) + 'px';
    annotationLayer.style.width = r.width + 'px';
    annotationLayer.style.height = r.height + 'px';
  }
  window.addEventListener('resize', function () { layoutAnnotationLayer(); positionComposer(); });

  function toSlideSpace(clientX, clientY) {
    var r = getSlideRect();
    var x = ((clientX - r.left) / r.width) * 1280;
    var y = ((clientY - r.top) / r.height) * 720;
    return { x: Math.round(Math.max(0, Math.min(1280, x))), y: Math.round(Math.max(0, Math.min(720, y))) };
  }
  function hitInfo(clientX, clientY) {
    var host = hosts[current];
    if (!host || !host.shadowRoot || !host.shadowRoot.elementFromPoint) return { tag: '', text: '' };
    // elementFromPoint gives unreliable results for points outside the
    // shadow host's actual rendered box (e.g. a tap in the letterboxed
    // margin on non-16:9 viewports) — skip the hit test there and fall
    // back to a coordinate-only label instead.
    var r = getSlideRect();
    if (clientX < r.left || clientX > r.left + r.width || clientY < r.top || clientY > r.top + r.height) {
      return { tag: '', text: '' };
    }
    var el;
    try { el = host.shadowRoot.elementFromPoint(clientX, clientY); } catch (e) { el = null; }
    if (!el) return { tag: '', text: '' };
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    var text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 30);
    return { tag: tag, text: text };
  }

  function renderPins() {
    annotationLayer.querySelectorAll('.pin').forEach(function (p) { p.remove(); });
    notes.forEach(function (n, i) {
      if (n.slideIndex !== current) return;
      var pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'pin';
      pin.style.left = (n.x / 1280) * 100 + '%';
      pin.style.top = (n.y / 720) * 100 + '%';
      pin.textContent = String(i + 1);
      pin.setAttribute('aria-label', '指摘 ' + (i + 1) + ': ' + n.note);
      pin.addEventListener('click', function (e) {
        e.stopPropagation();
        openComposerForEdit(n, pin);
      });
      annotationLayer.appendChild(pin);
    });
  }

  function renderList() {
    var list = document.getElementById('note-list');
    document.getElementById('note-count').textContent = String(notes.length);
    list.innerHTML = '';
    if (notes.length === 0) {
      var empty = document.createElement('div');
      empty.id = 'empty-note';
      empty.textContent = '注釈モードでスライドをタップすると指摘を追加できます';
      list.appendChild(empty);
      return;
    }
    notes.forEach(function (n, i) {
      var item = document.createElement('div');
      item.className = 'note-item';
      var loc = (n.tag ? n.tag + (n.text ? ' “' + n.text + '”' : '') : 'x=' + n.x + ',y=' + n.y);
      item.innerHTML =
        '<div class="badge">' + (i + 1) + '</div>' +
        '<div class="body"><div class="loc"></div><div class="text"></div></div>' +
        '<button class="remove" type="button" aria-label="削除">×</button>';
      item.querySelector('.loc').textContent = n.file + ' — ' + loc;
      item.querySelector('.text').textContent = n.note;
      item.querySelector('.remove').addEventListener('click', function () { removeNote(n.id); });
      list.appendChild(item);
    });
  }

  function removeNote(id) {
    notes = notes.filter(function (n) { return n.id !== id; });
    renderPins();
    renderList();
  }

  /* ---- composer ---- */
  var composer = document.getElementById('composer');
  var composerHit = composer.querySelector('.hit');
  var composerText = composer.querySelector('textarea');
  var composerDelete = composer.querySelector('.delete');

  function positionComposer() {
    if (!composer.classList.contains('open')) return;
    var stageRect = stage.getBoundingClientRect();
    var anchor = pending || editingId !== null
      ? composer._anchor
      : null;
    if (!anchor) return;
    var w = composer.offsetWidth || 240;
    var h = composer.offsetHeight || 140;
    var left = Math.max(8, Math.min(anchor.x - w / 2, stageRect.width - w - 8));
    var top = Math.max(8, Math.min(anchor.y + 16, stageRect.height - h - 8));
    composer.style.left = left + 'px';
    composer.style.top = top + 'px';
  }

  function openComposerForNew(clientX, clientY) {
    var stageRect = stage.getBoundingClientRect();
    var pos = toSlideSpace(clientX, clientY);
    var hit = hitInfo(clientX, clientY);
    pending = { slideIndex: current, x: pos.x, y: pos.y, tag: hit.tag, text: hit.text };
    editingId = null;
    composerHit.textContent = hit.tag ? hit.tag + (hit.text ? ': “' + hit.text + '”' : '') : ('x=' + pos.x + ', y=' + pos.y);
    composerText.value = '';
    composerDelete.style.display = 'none';
    composer._anchor = { x: clientX - stageRect.left, y: clientY - stageRect.top };
    composer.classList.add('open');
    positionComposer();
    composerText.focus();
  }

  function openComposerForEdit(note, pinEl) {
    pending = null;
    editingId = note.id;
    var stageRect = stage.getBoundingClientRect();
    var pinRect = pinEl.getBoundingClientRect();
    composerHit.textContent = note.tag ? note.tag + (note.text ? ': “' + note.text + '”' : '') : ('x=' + note.x + ', y=' + note.y);
    composerText.value = note.note;
    composerDelete.style.display = 'inline-block';
    composer._anchor = { x: pinRect.left - stageRect.left + pinRect.width / 2, y: pinRect.top - stageRect.top + pinRect.height / 2 };
    composer.classList.add('open');
    positionComposer();
    composerText.focus();
  }

  function closeComposer() {
    composer.classList.remove('open');
    pending = null;
    editingId = null;
  }

  composer.addEventListener('click', function (e) { e.stopPropagation(); });
  composer.querySelector('.cancel').addEventListener('click', closeComposer);
  composerDelete.addEventListener('click', function () {
    if (editingId !== null) removeNote(editingId);
    closeComposer();
  });
  composer.querySelector('.save').addEventListener('click', function () {
    var text = composerText.value.trim();
    if (!text) { closeComposer(); return; }
    if (editingId !== null) {
      var n = notes.find(function (n) { return n.id === editingId; });
      if (n) n.note = text;
    } else if (pending) {
      notes.push({
        id: nextId++, slideIndex: pending.slideIndex, file: files[pending.slideIndex],
        x: pending.x, y: pending.y, tag: pending.tag, text: pending.text, note: text,
      });
    }
    closeComposer();
    renderPins();
    renderList();
  });

  /* ---- mode + drawer toggles ---- */
  var annotateToggle = document.getElementById('annotate-toggle');
  annotateToggle.addEventListener('click', function () {
    var on = document.body.dataset.mode !== 'annotate';
    document.body.dataset.mode = on ? 'annotate' : '';
    annotateToggle.setAttribute('aria-pressed', String(on));
    if (!on) closeComposer();
  });

  var drawer = document.getElementById('drawer');
  document.getElementById('list-toggle').addEventListener('click', function () {
    drawer.classList.toggle('open');
  });
  document.getElementById('drawer-close').addEventListener('click', function () {
    drawer.classList.remove('open');
  });

  var copyBox = document.getElementById('copy-box');
  var copyText = document.getElementById('copy-text');
  document.getElementById('copy-btn').addEventListener('click', function () {
    var lines = notes.map(function (n, i) {
      var loc = n.tag ? n.tag + (n.text ? ' “' + n.text + '”' : '') : '';
      return (i + 1) + '. ' + n.file + ' — ' + loc + ' (x=' + n.x + ',y=' + n.y + ' / 1280x720)\\n   → ' + n.note;
    });
    copyText.value = lines.length ? lines.join('\\n\\n') : '(まだ指摘がありません)';
    copyBox.classList.add('open');
    copyText.focus();
    copyText.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(copyText.value).catch(function () {});
    }
  });

  render();
  renderList();
})();
"""

doc = f"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)} (preview)</title>
<style>{shell_css}</style>
<script id="shared-style" type="text/plain">{shared_css}</script>
</head>
<body>
<div id="topbar">
  <div id="deck-title">{html.escape(title)}</div>
  <div id="topbar-actions">
    <button id="annotate-toggle" type="button" aria-pressed="false">📍 注釈</button>
    <button id="list-toggle" type="button">📝 <span id="note-count">0</span></button>
  </div>
</div>
<div id="stage">
{chr(10).join(templates)}
<div id="annotation-layer"></div>
<div id="composer">
  <div class="hit"></div>
  <textarea rows="3" placeholder="気になる点を一言で"></textarea>
  <div class="actions">
    <button class="delete" type="button">削除</button>
    <button class="cancel" type="button">キャンセル</button>
    <button class="save" type="button">追加</button>
  </div>
</div>
</div>
<div id="bar">
  <button id="prev" type="button" aria-label="前のスライド">&larr;</button>
  <span id="counter"></span>
  <button id="next" type="button" aria-label="次のスライド">&rarr;</button>
</div>
<div id="drawer">
  <div id="drawer-header">
    <h2>指摘一覧</h2>
    <button id="copy-btn" type="button">コピー</button>
    <button id="drawer-close" type="button">閉じる</button>
  </div>
  <div id="copy-box">
    <textarea id="copy-text" readonly></textarea>
    <div class="hint">上のテキストは選択済みです。長押し(PCはCmd/Ctrl+C)でコピーできます。</div>
  </div>
  <div id="note-list"></div>
</div>
<script>{runtime_js}</script>
</body>
</html>
"""

out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(doc)
print(f"wrote {out_path} ({out_path.stat().st_size} bytes, {len(slide_files)} slides)")
