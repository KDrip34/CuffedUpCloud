# CuffedUpBoard

A zero-knowledge encrypted message board and private journal for a small circle
of friends. One HTML file, no accounts, no backend required — the server here is
optional and can't read anything.

**Live app:** https://YOUR-USERNAME.github.io/cuffedupboard/

Built by **Kendrick Ekejiuba** as the fourth deliverable in the CuffedUpCloud
CIA Triad project series.

---

## What it does

Enroll a few friends, and everyone gets a board where messages arrive **sealed**.
Tap one and it decrypts, verifies the author's signature, and re-seals itself
after 30 seconds. Alongside it, each member gets a **private journal** that syncs
with the board but is mathematically unreadable to everyone else on it.

No account to create, no email to hand over, no server that holds your data.

---

## Design

The security model comes from the CuffedUpCloud CIA Triad case study.

### Confidentiality

The board has one random 256-bit **group key** that is never derived from
anybody's password. Each member gets that key **wrapped separately**, under a key
derived from *their password plus their TOTP secret* — a cryptographic gate, not
just a UI check. Guessing a password alone unwraps nothing, because the second
factor is an input to the key derivation rather than a gate in front of it.

Your journal rides on a **separate personal key** carried inside the same
wrapped envelope, which is why journal entries can travel with the board while
staying private from the group that shares it.

### Integrity

Three independent layers, so no single failure is silent:

| Layer | Catches |
|---|---|
| ECDSA P-256 signature | Forged authorship — even by someone holding the group key |
| AES-256-GCM auth tag | Any edit to the ciphertext |
| SHA-256 fingerprint | Silent corruption of the decrypted plaintext |

Journal entries additionally bind their own metadata into the GCM tag as
**AAD** — change an entry's timestamp and decryption fails outright.

### Availability

The board auto-saves to your device, exports as a file, travels as a
paste-anywhere **sync code**, and can sync automatically through an optional
relay. Four independent copies, no single point of failure.

### Hostile session

Messages stay sealed until tapped and re-seal after 30 seconds. The board locks
after 90 seconds idle, and five failed unlocks freeze it for a minute.

---

## Using it

Open the live link, create a board, and enroll each friend with a password. Each
one gets a TOTP secret to add to Authy or Google Authenticator — that's the
second factor. Then send them the link and a **sync code** (Sync tab → Copy sync
code) pasted into your group chat. Sync codes are pure ciphertext, so the chat
you send them through doesn't have to be private.

On a phone, use **Add to Home Screen** / **Install app** and it runs full screen
like a native app, offline included.

> **The address must be `https://`.** Browsers only expose the Web Crypto engine
> on a secure context, so `https://` or `localhost` work and a plain
> `http://192.168.x.x` address does not — the app will tell you so rather than
> failing quietly.

---

## Optional: automatic sync

`cuffedup_server.py` is a **blind relay**: members push and pull ciphertext
through it instead of pasting codes. It is standard library only — no
`pip install` — and it holds no key, so it cannot read a single message or
journal entry.

```bash
python cuffedup_server.py          # then open http://localhost:8765
```

Being honest about the tradeoff: the relay can't read content, but it *does* see
metadata — board id, member names, timestamps, message sizes. That's the same
exposure the case study accepts at its server tier, and it's why the relay is
opt-in and off by default. Deleting `relay_data/` wipes it; every member still
holds the whole board.

To reach phones it needs HTTPS: put it behind a tunnel (`cloudflared tunnel
--url http://localhost:8765`) or host it somewhere that terminates TLS.

---

## Optional: the Python journal bridge

The Journal tab exports entries re-encrypted under a passphrase you choose, in
the exact envelope format of [`journal.py`](https://github.com/YOUR-USERNAME) from
the CuffedUpCloud project — PBKDF2-200k → AES-256-GCM, HMAC-SHA256, SHA-256
fingerprint.

```bash
python journal_bridge.py unpack cuffedup-journal-bundle.json my_journal
cd my_journal && python journal.py read
```

`journal.py` prompts for the same passphrase and prints
`[VERIFIED] HMAC PASS | AES-GCM PASS | SHA-256 PASS`. The reverse direction,
`journal_bridge.py pack`, rebuilds a bundle the Journal tab imports — entries
whose HMAC doesn't verify are skipped rather than trusted.

---

## Deleting things

The board is **append-only by default**, mirroring the case study's audit
database. Retention (Sync tab) optionally sweeps quiet threads after 30 or 90
days; pinned threads are never swept, and you can delete your own messages
individually.

Deletions travel as **tombstones**, so a friend's copy and the relay drop the
ciphertext too. An old copy syncing back in later can't resurrect a deleted
message.

---

## Known limits

Worth stating plainly, since a security project that hides its gaps isn't one:

- **No member removal or key rotation.** Someone who leaves the circle keeps a
  working copy of the group key. Rotating it means re-running the enrollment
  ceremony. This is the sharpest remaining gap.
- **TOTP is verified client-side.** In a real deployment that check belongs on a
  server; here it's part of key derivation, which is what gives it teeth.
- **The relay sees metadata**, as described above.
- **No forward secrecy.** One group key protects the whole history, so a
  compromised member password exposes everything that member could already read.

---

## Files

| File | Role |
|---|---|
| `index.html` | The entire app — crypto, board, journal, sync |
| `cuffedup_server.py` | Optional blind relay + local static server |
| `journal_bridge.py` | Moves journal entries to/from `journal.py` |
| `manifest.webmanifest`, `sw.js`, `icon.svg` | Installable, offline-capable PWA |

---

## Project series

1. **Case study** — CIA Triad design document and LinkedIn carousel
2. **MQTT MVP** — mTLS + HMAC + replay defense, forked from an IoT externship
3. **Standalone journal** — single-file Python encrypted journal
4. **CuffedUpBoard** — this: the multi-user, browser-native version
