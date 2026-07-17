#!/usr/bin/env python3
"""Bundle a slidex deck (manifest.json + slides/ + design-system/) into a
single self-contained HTML file, for previewing on devices that can't run
a local server or open multiple relative-path files (e.g. as a Claude
Artifact from a phone). Not used for the real Pages deployment — the
production shell (engine/) still fetches slides/ individually.

Usage: python3 tools/build-preview.py [output_path]
  output_path defaults to dist/preview.html (dist/ is gitignored)
"""
import base64
import html
import json
import mimetypes
import re
import sys
from pathlib import Path

repo_root = Path(__file__).resolve().parent.parent
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
BODY_RE = re.compile(r"<body([^>]*)>(.*)</body>", re.DOTALL | re.IGNORECASE)
CLASS_RE = re.compile(r'class="([^"]*)"')
SRC_RE = re.compile(r'(src|poster)="([^"]*)"')


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
#deck-title {
  flex: none; padding: 10px 16px 6px;
  font-size: 13px; color: var(--shell-muted);
  letter-spacing: 0.04em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#stage { flex: 1; position: relative; overflow: hidden; min-height: 0; }
.slide-host {
  display: none;
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  container-type: inline-size;
}
.slide-host[data-active] { display: block; }
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
"""

runtime_js = """
(function () {
  var sheet = new CSSStyleSheet();
  sheet.replaceSync(document.getElementById('shared-style').textContent);
  var stage = document.getElementById('stage');
  var hosts = [];
  document.querySelectorAll('template.slide-tpl').forEach(function (tpl) {
    var host = document.createElement('div');
    host.className = 'slide-host';
    var shadow = host.attachShadow({ mode: 'open' });
    shadow.adoptedStyleSheets = [sheet];
    shadow.appendChild(tpl.content.cloneNode(true));
    stage.appendChild(host);
    hosts.push(host);
    shadow.querySelectorAll('script[data-slide-run]').forEach(function (s) {
      try { new Function('root', s.textContent)(shadow); } catch (e) { console.error(e); }
    });
  });

  var files = Array.prototype.map.call(document.querySelectorAll('template.slide-tpl'), function (t) {
    return t.getAttribute('data-file');
  });
  var current = 0;
  function render() {
    hosts.forEach(function (h, i) { h.toggleAttribute('data-active', i === current); });
    document.getElementById('counter').textContent =
      (files[current] || '') + '  ·  ' + (current + 1) + ' / ' + hosts.length;
  }
  function goTo(n) { current = Math.max(0, Math.min(hosts.length - 1, n)); render(); }

  document.getElementById('prev').addEventListener('click', function () { goTo(current - 1); });
  document.getElementById('next').addEventListener('click', function () { goTo(current + 1); });
  stage.addEventListener('click', function (e) {
    var ratio = e.clientX / window.innerWidth;
    if (ratio < 0.3) goTo(current - 1); else if (ratio > 0.7) goTo(current + 1);
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === ' ') goTo(current + 1);
    if (e.key === 'ArrowLeft') goTo(current - 1);
  });

  render();
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
<div id="deck-title">{html.escape(title)}</div>
<div id="stage">
{chr(10).join(templates)}
</div>
<div id="bar">
  <button id="prev" type="button" aria-label="前のスライド">&larr;</button>
  <span id="counter"></span>
  <button id="next" type="button" aria-label="次のスライド">&rarr;</button>
</div>
<script>{runtime_js}</script>
</body>
</html>
"""

out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(doc)
print(f"wrote {out_path} ({out_path.stat().st_size} bytes, {len(slide_files)} slides)")
