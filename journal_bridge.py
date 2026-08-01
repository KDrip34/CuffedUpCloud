#!/usr/bin/env python3
"""
journal_bridge.py - moves entries between CuffedUpBoard and journal.py.

The board's Journal tab exports a bundle: one JSON file holding the metadata
and every entry, already re-encrypted under a passphrase you chose, in the
exact envelope format journal.py writes (PBKDF2-200k -> AES-256-GCM, plus the
HMAC-SHA256 and SHA-256 fingerprint). This script only moves those envelopes
between "one bundle file" and "the folder layout journal.py expects" - it
never sees your passphrase and does no crypto, so it needs no dependencies.

    python journal_bridge.py unpack cuffedup-journal-bundle.json my_journal
        -> my_journal/.journal_meta.json
           my_journal/entries/entry_0001.json ...
        Copy journal.py into my_journal/ and run `python journal.py read`.

    python journal_bridge.py pack my_journal cuffedup-journal-bundle.json
        -> rebuilds a bundle you can import back into the Journal tab.

Both directions are lossless: the ciphertext is copied verbatim.
"""

import json
import sys
from pathlib import Path

META_NAME = ".journal_meta.json"


def unpack(bundle_path: Path, out_dir: Path) -> None:
    bundle = json.loads(bundle_path.read_text("utf-8"))
    meta, entries = bundle.get("meta"), bundle.get("entries")
    if not isinstance(meta, dict) or not isinstance(entries, list):
        raise ValueError("that file is not a CuffedUpBoard journal bundle")

    entries_dir = out_dir / "entries"
    entries_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / META_NAME).write_text(json.dumps(meta, indent=2), "utf-8")

    for entry in entries:
        seq = int(entry.get("sequence", 0))
        (entries_dir / f"entry_{seq:04d}.json").write_text(json.dumps(entry, indent=2), "utf-8")

    print(f"[OK] {len(entries)} entries -> {entries_dir}")
    print(f"     metadata      -> {out_dir / META_NAME}")
    print()
    print("Next: put journal.py in that folder and run")
    print(f"     cd {out_dir}")
    print("     python journal.py read")
    print("It will ask for the passphrase you typed in the Journal tab.")


def pack(in_dir: Path, bundle_path: Path) -> None:
    meta_file = in_dir / META_NAME
    if not meta_file.exists():
        raise ValueError(f"no {META_NAME} in {in_dir}")
    entries = [
        json.loads(f.read_text("utf-8"))
        for f in sorted((in_dir / "entries").glob("entry_*.json"))
    ]
    bundle = {"meta": json.loads(meta_file.read_text("utf-8")), "entries": entries}
    bundle_path.write_text(json.dumps(bundle, indent=2), "utf-8")
    print(f"[OK] {len(entries)} entries -> {bundle_path}")
    print("Import it from the Journal tab with the same passphrase.")


USAGE = """
journal_bridge.py - CuffedUpBoard <-> journal.py

  python journal_bridge.py unpack <bundle.json> [out_dir]
  python journal_bridge.py pack   <journal_dir> [bundle.json]
""".strip()


def main() -> None:
    args = sys.argv[1:]
    if not args or args[0] in ("help", "-h", "--help"):
        return print(USAGE)

    cmd = args[0].lower()
    try:
        if cmd == "unpack":
            if len(args) < 2:
                return print(USAGE)
            unpack(Path(args[1]), Path(args[2] if len(args) > 2 else "cuffedup_journal"))
        elif cmd == "pack":
            if len(args) < 2:
                return print(USAGE)
            pack(Path(args[1]), Path(args[2] if len(args) > 2 else "cuffedup-journal-bundle.json"))
        else:
            print(f"[ERROR] unknown command: {cmd}\n")
            print(USAGE)
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(f"[ERROR] {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
