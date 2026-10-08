#!/usr/bin/env python3
"""Build index.html from src/page.html.

The fonts in src/fonts/ get embedded right into the page, so the finished
file works offline and never contacts a font server.

    python3 build.py                     # writes index.html
    python3 build.py --artifact OUT.html # also writes a copy without the
                                         # <html>/<head>/<body> wrapper, for
                                         # publishing as a claude.ai page
"""
import base64
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src" / "page.html"
FONT_DIR = ROOT / "src" / "fonts"
OUT = ROOT / "index.html"
MARKER = "/*@font-faces@*/"

FONTS = [
    ("Plex Condensed", 600, "ibm-plex-sans-condensed-latin-600-normal.woff2"),
    ("Plex Sans", 400, "ibm-plex-sans-latin-400-normal.woff2"),
    ("Plex Sans", 600, "ibm-plex-sans-latin-600-normal.woff2"),
    ("Plex Mono", 400, "ibm-plex-mono-latin-400-normal.woff2"),
]

# Lines the claude.ai page host adds by itself.
WRAPPER_LINES = {
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "</head>",
    "<body>",
    "</body>",
    "</html>",
}


def font_css():
    rules = []
    for family, weight, filename in FONTS:
        data = base64.b64encode((FONT_DIR / filename).read_bytes()).decode("ascii")
        rules.append(
            f'@font-face{{font-family:"{family}";font-style:normal;font-weight:{weight};'
            f'font-display:swap;src:url(data:font/woff2;base64,{data}) format("woff2")}}'
        )
    return "\n".join(rules)


def main():
    page = SRC.read_text(encoding="utf-8")
    if MARKER not in page:
        sys.exit(f"{SRC} is missing the {MARKER} marker")
    html = page.replace(MARKER, font_css())
    OUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(html) // 1024} KB)")

    if "--artifact" in sys.argv:
        target = pathlib.Path(sys.argv[sys.argv.index("--artifact") + 1])
        body = "\n".join(line for line in html.splitlines() if line.strip() not in WRAPPER_LINES)
        target.write_text(body + "\n", encoding="utf-8")
        print(f"wrote {target}")


if __name__ == "__main__":
    main()
