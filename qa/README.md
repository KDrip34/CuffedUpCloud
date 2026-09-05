# CuffedUpCloud — headless QA

Drives the real `index.html` in a headless DOM (jsdom + Node's Web Crypto) and
runs the full flow: create board → enroll two members → wrong TOTP rejected →
correct password + TOTP unlocks → post → reveal → reseal timing → tamper
rejection → lock-on-blur → idle lock → reload persistence. Timers ≥1s are
accelerated 100× so a 30 s reseal takes 300 ms.

    npm install jsdom@24
    node harness.js ../index.html        # 15 checks
    node journal_test.js ../index.html   # journal reseal survives re-render

Results, Sept 5 2026:
  V6   (live before fix)  11/14 — T4c, T5, T6 fail (reseal bugs)
  V6.2 (this index.html)  15/15 — adds T11: 3-minute open ceiling
