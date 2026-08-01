#!/usr/bin/env python3
"""
cuffedup_server.py - serves CuffedUpBoard and acts as its blind relay.

Two jobs, one file, standard library only (no pip install):

  1. Static server   Serves index.html, sw.js, manifest.webmanifest, icon.svg.
                     Serving over http:// (instead of opening the file directly)
                     is what lets the browser install it as an app on a phone.

  2. Blind relay     POST /api/sync?board=<id>&since=<n>
                     Clients push their items and pull anything newer.

WHAT THIS SERVER CAN SEE
    Nothing readable. Items arrive already encrypted by the browser: message
    bodies and journal entries are AES-256-GCM ciphertext, member records are
    key-wrap blobs. This process holds no key and does no crypto.
    It DOES see metadata - board id, member names, timestamps, sizes - the
    same exposure the CuffedUpCloud case study accepts for its server tier.

WHAT IT DOES ON DELETE
    A 'tomb' (tombstone) item deletes the matching message or journal entry
    from disk here too, so retention sweeps actually remove ciphertext instead
    of leaving it on the relay forever.

USAGE
    python cuffedup_server.py                 # port 8765
    python cuffedup_server.py 9000            # custom port

Then open the printed address. On your phone, use the LAN address (same Wi-Fi)
and choose "Add to Home Screen" / "Install app".

Data lives in ./relay_data/<board-id>.json. Delete that folder to wipe the
relay; every member's own device still has the full board.
"""

import json
import socket
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).parent.resolve()
DATA = ROOT / "relay_data"
DATA.mkdir(exist_ok=True)

LOCK = threading.Lock()
MAX_BODY = 8 * 1024 * 1024      # 8 MB per push
MAX_ITEMS = 20_000              # per board, oldest dropped beyond this
KINDS = {"member", "message", "journal", "tomb"}


def store_path(board_id: str) -> Path:
    """Board ids are hex from the client; refuse anything else (no path tricks)."""
    safe = "".join(c for c in str(board_id) if c.isalnum())[:64]
    if not safe:
        raise ValueError("bad board id")
    return DATA / f"{safe}.json"


def load(board_id: str) -> dict:
    p = store_path(board_id)
    if p.exists():
        try:
            return json.loads(p.read_text("utf-8"))
        except json.JSONDecodeError:
            pass
    return {"seq": 0, "items": []}


def save(board_id: str, doc: dict) -> None:
    p = store_path(board_id)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc), "utf-8")
    tmp.replace(p)                      # atomic-ish: never a half-written board


def apply_push(doc: dict, incoming: list) -> int:
    """Append items we haven't seen; honour tombstones by deleting the target."""
    have = {(i.get("kind"), i.get("id")) for i in doc["items"]}
    added = 0
    for item in incoming:
        kind, ident = item.get("kind"), item.get("id")
        if kind not in KINDS or not isinstance(ident, str) or (kind, ident) in have:
            continue
        doc["seq"] += 1
        item["seq"] = doc["seq"]
        doc["items"].append(item)
        have.add((kind, ident))
        added += 1
        if kind == "tomb":
            doc["items"] = [
                i for i in doc["items"]
                if not (i.get("kind") in ("message", "journal") and i.get("id") == ident)
            ]
            have -= {("message", ident), ("journal", ident)}
    if len(doc["items"]) > MAX_ITEMS:
        doc["items"] = doc["items"][-MAX_ITEMS:]
    return added


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        # Lets the app ask "is there a relay here?" without writing any data.
        # A static host (GitHub Pages) has no such endpoint, so the app stays
        # on manual sync codes instead of polling a 404.
        if urlparse(self.path).path == "/api/relay":
            return self._json({"relay": True})
        super().do_GET()

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/api/sync":
            return self._json({"error": "not found"}, 404)
        query = parse_qs(url.query)
        board_id = (query.get("board") or [""])[0]
        try:
            since = int((query.get("since") or ["0"])[0])
        except ValueError:
            since = 0

        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return self._json({"error": "payload too large"}, 413)

        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            incoming = body.get("items", [])
            if not isinstance(incoming, list):
                raise ValueError("items must be a list")
            with LOCK:
                doc = load(board_id)
                added = apply_push(doc, incoming)
                if added:
                    save(board_id, doc)
                fresh = [i for i in doc["items"] if i.get("seq", 0) > since]
                cursor = doc["seq"]
            if added:
                print(f"  relay: board {board_id[:8]}... +{added} item(s), {len(doc['items'])} stored")
            self._json({"cursor": cursor, "items": fresh, "added": added})
        except (ValueError, KeyError, TypeError) as exc:
            self._json({"error": str(exc)}, 400)

    def log_message(self, fmt, *args):
        line = fmt % args
        if "/api/sync" not in line:          # sync polls every 12s - too noisy to log
            sys.stderr.write(f"  {line}\n")


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))          # no packet is sent; just picks the route
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def main() -> None:
    port = 8765
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print(f"[ERROR] '{sys.argv[1]}' is not a port number.")
            return
    if not (ROOT / "index.html").exists():
        print(f"[ERROR] index.html not found next to this script ({ROOT}).")
        return

    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print("=" * 62)
    print("  CuffedUpBoard - app server + blind relay")
    print("=" * 62)
    print(f"  Open here     : http://localhost:{port}")
    print(f"  Board data    : {DATA}")
    print()
    print("  Phones cannot use this server's http://%s address:" % lan_ip())
    print("  browsers only expose the Web Crypto engine over https:// or")
    print("  localhost, so the app refuses to run there. Put it behind a")
    print("  tunnel or a host with HTTPS - see 'Getting it onto phones'")
    print("  in README.md.")
    print()
    print("  The relay stores ciphertext only - it holds no key and cannot")
    print("  read a single message. Ctrl+C to stop.")
    print("=" * 62)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped. Everyone's boards are still on their own devices.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
