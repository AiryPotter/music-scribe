"""Build the "Music Scribe iOS" edition page: app/ios/index.html.

It is the same app as app/index.html (same code, same files), with its own
name and home-screen manifest so it installs on an iPhone as "Music Scribe iOS".
The page is generated, never edited by hand: GitHub Actions runs this before
every deploy, and app/serve.py runs it whenever /ios/ is requested locally.

Usage:  python tools/make_ios.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(os.path.dirname(HERE), "app")
SRC = os.path.join(APP, "index.html")
OUT = os.path.join(APP, "ios", "index.html")

NAME = "Music Scribe iOS"

# (find, replace) pairs; every one must match exactly once
CHANGES = [
    ('<html lang="en">', '<html lang="en" data-edition="ios">'),
    ('<meta charset="utf-8">',
     '<meta charset="utf-8">\n'
     '  <!-- GENERATED from ../index.html by tools/make_ios.py: edit index.html, not this file -->\n'
     '  <base href="../">'),
    ("<title>Music Scribe</title>", f"<title>{NAME}</title>"),
    ('<meta name="apple-mobile-web-app-title" content="Music Scribe">',
     f'<meta name="apple-mobile-web-app-title" content="{NAME}">'),
    ('<link rel="manifest" href="manifest.webmanifest">',
     '<link rel="manifest" href="manifest-ios.webmanifest">'),
    ('<span id="editionName">Music Scribe</span>', f'<span id="editionName">{NAME}</span>'),
]


def build():
    with open(SRC, encoding="utf-8") as f:
        html = f.read()
    for find, repl in CHANGES:
        n = html.count(find)
        if n != 1:
            raise SystemExit(f"make_ios: expected 1 match for {find!r} in index.html, found {n}")
        html = html.replace(find, repl)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    old = None
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            old = f.read()
    if html != old:
        with open(OUT, "w", encoding="utf-8", newline="\n") as f:
            f.write(html)
    return OUT


if __name__ == "__main__":
    print("wrote", build())
    sys.exit(0)
