# CuffedUpCloud — headless QA

Drives the real `index.html` in a headless DOM (jsdom + Node's Web Crypto) and
runs the full flow: create board → enroll two members → wrong TOTP rejected →
correct password + TOTP unlocks → post → reveal → reseal timing → tamper
rejection → lock-on-blur → idle lock → reload persistence. Timers ≥1s are
accelerated 100× so a 30 s reseal takes 300 ms.

    npm install jsdom@24
    node harness.js ../index.html        # 15 checks
    node journal_test.js ../index.html   # journal reseal survives re-render
    node synccode_test.js ../index.html  # 15 checks: CUB7 binary sync codes (V6.3)

Results, Sept 5 2026:
  V6   (live before fix)  11/14 — T4c, T5, T6 fail (reseal bugs)
  V6.2 (this index.html)  15/15 — adds T11: 3-minute open ceiling

V6.3 (Sept 5 2026) — CUB7 binary sync codes. Lossless transport encoding of the
same JSON: raw bytes for ciphertext/sigs/hashes/ids, one-byte tokens for known
keys, ms ints for timestamps, base64url once. CUB6/CUB6P/CUB5 still read.
Measured update-link length, 15-word messages (CUB6 -> CUB7):
  1 msg 746 -> 494 chars (34% shorter)   3 msgs 1366 -> 1096 (20%)   5 msgs 1984 -> 1666 (16%)
The floor is the crypto itself: ~132 bytes/message of signature, hash, nonce, tag, id.
