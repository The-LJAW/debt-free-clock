"""Inline engine.js and app.js into the page and write dist/debt-free-clock.html."""
from pathlib import Path

root = Path(__file__).parent
page = (root / "src/page.html").read_text()
page = page.replace("/*@ENGINE@*/", (root / "src/engine.js").read_text())
page = page.replace("/*@APP@*/", (root / "src/app.js").read_text())
out = root / "dist/debt-free-clock.html"
out.write_text(page)
print(f"wrote {out} ({len(page):,} bytes)")
