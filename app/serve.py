"""Tiny local dev server for Music Scribe.

Usage:  python serve.py [port]
Serves this folder at http://localhost:<port> (default 5173) with correct
MIME types for JS modules and the PWA manifest, and no caching.
"""
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(ROOT), "tools"))
import make_ios  # noqa: E402  (builds the "Music Scribe iOS" page from index.html)


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0].rstrip("/") in ("/ios", "/ios/index.html"):
            try:
                make_ios.build()  # always in step with index.html
            except SystemExit as err:
                self.send_error(500, str(err))
                return
        super().do_GET()

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    handler = functools.partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Music Scribe running at http://localhost:{port}", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
