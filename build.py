"""Build the Debt-Free Clock.

Writes two files from src/:
  index.html                 the live website (GitHub Pages serves this)
  dist/debt-free-clock.html  page fragment for the Claude artifact preview. It runs in
                             "preview" mode: payments aren't connected there, so the Pro
                             button and any key-shaped code unlock Pro for testing.
"""
from pathlib import Path

root = Path(__file__).parent
src = lambda name: (root / "src" / name).read_text()

page = src("page.html")
for marker, name in [("/*@ENGINE@*/", "engine.js"), ("/*@LICENSE@*/", "license.js"),
                     ("/*@CONFIG@*/", "config.js"), ("/*@APP@*/", "app.js")]:
    assert marker in page, marker
    page = page.replace(marker, src(name))

# 1) Artifact preview fragment
frag = root / "dist/debt-free-clock.html"
frag.parent.mkdir(exist_ok=True)
frag.write_text(page.replace("/*@PREVIEW@*/", "window.DFC_PREVIEW = true;"))

# 2) Standalone site: head items (title, font links, styles) go in <head>, the rest in <body>
site_page = page.replace("/*@PREVIEW@*/", "")
split = site_page.index('<div class="wrap">')
head_part, body_part = site_page[:split], site_page[split:]

DESCRIPTION = ("A live countdown to the day you're debt-free, with your balance, interest "
               "and net worth ticking in real time. Private: your numbers never leave your browser.")
FAVICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
           "%3Crect width='32' height='32' rx='7' fill='%230C110E'/%3E"
           "%3Ccircle cx='16' cy='16' r='6' fill='%23FF5B4D'/%3E%3C/svg%3E")

site = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="{DESCRIPTION}">
<meta property="og:title" content="Debt-Free Clock">
<meta property="og:description" content="{DESCRIPTION}">
<meta property="og:type" content="website">
<meta property="og:url" content="https://the-ljaw.github.io/debt-free-clock/">
<meta property="og:image" content="https://the-ljaw.github.io/debt-free-clock/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Debt-Free Clock: a glowing countdown reading 04 years, 08 months, 26 days">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Debt-Free Clock">
<meta name="twitter:description" content="{DESCRIPTION}">
<meta name="twitter:image" content="https://the-ljaw.github.io/debt-free-clock/og-image.png">
<meta name="theme-color" content="#0C110E">
<link rel="icon" href="{FAVICON}">
<style>
:root {{ color-scheme: light; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }}
body {{ margin: 0; }}
img {{ max-width: 100%; }}
[hidden] {{ display: none !important; }}
</style>
{head_part.strip()}
</head>
<body>
{body_part.strip()}
</body>
</html>
"""
(root / "index.html").write_text(site)
print(f"wrote {frag.relative_to(root)} (preview mode) and index.html ({len(site.encode()):,} bytes)")
