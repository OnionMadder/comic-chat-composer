"""Tiny no-cache static server for on-device dev iteration.

Plain http.server lets Chrome cache app.js/index.html, so a phone refresh keeps
showing a stale build. This sends no-store on everything, so every refresh
pulls the freshly-built www/.
    python devserve.py [port]
"""
import http.server
import socketserver
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8973
os.chdir(os.path.join(os.path.dirname(__file__), "www"))


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("0.0.0.0", PORT), NoCache) as httpd:
    print(f"no-cache dev server on http://0.0.0.0:{PORT}")
    httpd.serve_forever()
