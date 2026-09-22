"""Build the Debt-Free Clock.

Writes two files from src/:
  dist/debt-free-clock.html  page fragment, published as a Claude artifact
  index.html                 standalone website (GitHub Pages serves this)
"""
from pathlib import Path

root = Path(__file__).parent
page = (root / "src/page.html").read_text()
page = page.replace("/*@ENGINE@*/", (root / "src/engine.js").read_text())
page = page.replace("/*@APP@*/", (root / "src/app.js").read_text())

# 1) Artifact fragment
frag = root / "dist/debt-free-clock.html"
frag.parent.mkdir(exist_ok=True)
frag.write_text(page)

# 2) Standalone site: head items (title, font links, styles) go in <head>, the rest in <body>
split = page.index('<div class="wrap">')
head_part, body_part = page[:split], page[split:]

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
print(f"wrote {frag.relative_to(root)} and index.html ({len(site.encode()):,} bytes)")
