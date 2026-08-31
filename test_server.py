"""Smoke-test the Ledger HTTP server: static files and encrypted sync API."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = os.environ.get("LEDGER_TEST_PORT", "8799")
BASE = f"http://127.0.0.1:{PORT}"


def get(path: str) -> tuple[int, bytes]:
    req = urllib.request.Request(BASE + path, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def put(path: str, body: dict) -> tuple[int, bytes]:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method="PUT",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def main() -> None:
    env = os.environ.copy()
    env["LEDGER_PORT"] = PORT
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "server.py")],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.time() + 8
        last = None
        while time.time() < deadline:
            try:
                last = get("/")
                if last[0] == 200:
                    break
            except OSError:
                time.sleep(0.15)
        assert last and last[0] == 200, "home page did not load"
        html = last[1].decode("utf-8", "replace")
        for needle in ("core.js", "view-overview", "palette", "search-all", "make-recurring", "lock-gate", "wallets", "skip-recurring", "repeat-last", "dismiss-banner", "wallet-starts", "amount-chips", "date-chips", "modal-duplicate", "clear-filters", "density-compact", "copy-summary", "week-start", "date-locale", "amount-up", "idle-lock-min", "pin-lock"):
            assert needle in html, f"missing {needle} in index"

        code, css = get("/styles.css")
        assert code == 200 and b".palette-list" in css and b".wallet-row" in css

        code, info = get("/api/info")
        assert code == 200
        payload = json.loads(info)
        assert payload.get("ok") is True
        assert payload.get("port") == int(PORT)

        sync_id = "testdevice" + str(int(time.time()))[-6:]
        code, empty = get(f"/api/sync/{sync_id}")
        assert code == 404

        pack = {"v": 1, "salt": "YQ==", "iv": "YQ==", "ciphertext": "dGVzdA=="}
        code, _ = put(f"/api/sync/{sync_id}", pack)
        assert code == 200
        code, stored = get(f"/api/sync/{sync_id}")
        assert code == 200
        assert json.loads(stored)["ciphertext"] == "dGVzdA=="

        code, _ = put("/api/sync/bad", pack)
        assert code == 400

        print("ok — server smoke tests passed")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    main()
