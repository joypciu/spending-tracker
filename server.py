"""Serve Ledger as an installable web app and store encrypted sync blobs.

Phone and desktop both open this origin. The server never sees spending
plaintext — only ciphertext keyed by the pairing secret on each device.
"""
from __future__ import annotations

import json
import os
import re
import socket
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "sync-data"
PORT = int(os.environ.get("LEDGER_PORT", "8788"))
ID_RE = re.compile(r"^[a-zA-Z0-9_-]{8,80}$")


def lan_urls(port: int) -> list[str]:
    urls = [f"http://127.0.0.1:{port}"]
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip.startswith("127."):
                continue
            candidate = f"http://{ip}:{port}"
            if candidate not in urls:
                urls.append(candidate)
    except OSError:
        pass
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        sock.close()
        candidate = f"http://{ip}:{port}"
        if candidate not in urls:
            urls.append(candidate)
    except OSError:
        pass
    return urls


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/info":
            self._json(200, {"ok": True, "urls": lan_urls(PORT), "port": PORT})
            return
        if parsed.path.startswith("/api/sync/"):
            sync_id = parsed.path.rsplit("/", 1)[-1]
            if not ID_RE.match(sync_id):
                self._json(400, {"error": "bad id"})
                return
            path = DATA / f"{sync_id}.json"
            if not path.exists():
                self._json(404, {"error": "empty"})
                return
            body = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_PUT(self):
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/sync/"):
            self._json(404, {"error": "not found"})
            return
        sync_id = parsed.path.rsplit("/", 1)[-1]
        if not ID_RE.match(sync_id):
            self._json(400, {"error": "bad id"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 8_000_000:
            self._json(400, {"error": "bad body"})
            return
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._json(400, {"error": "invalid json"})
            return
        if not isinstance(payload, dict) or "ciphertext" not in payload:
            self._json(400, {"error": "missing ciphertext"})
            return
        DATA.mkdir(exist_ok=True)
        (DATA / f"{sync_id}.json").write_text(json.dumps(payload), encoding="utf-8")
        self._json(200, {"ok": True})

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    DATA.mkdir(exist_ok=True)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("Ledger is running.")
    print("On this computer:  http://127.0.0.1:%s/" % PORT)
    print("On your phone (same Wi-Fi):")
    for url in lan_urls(PORT)[1:]:
        print("  %s/" % url)
    print("Install as an app from the browser menu (Add to Home Screen / Install).")
    print("Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
