// qa/qr_test.js — QR option (V6.4). Usage: node qr_test.js ../index.html
//   Decodes the app's own QR codes with jsQR (an independent decoder), then drives the real
//   flow: Show QR for an update -> "camera" reads it -> other device merges it; Show QR for an
//   invite -> other device joins from it. Also: lock hides the code, oversize links refuse.
const fs = require('fs'); const { JSDOM } = require('jsdom'); const { webcrypto } = require('crypto');
/* jsQR 1.4.0 ships a typo in its version-23 alignment table (centre 74 where ISO 18004 says 78), so it cannot read any
   23-L code from any encoder. Patch the table at load so the "camera" here matches real phone cameras. */
const jsQR = (() => {
  const src = fs.readFileSync(require.resolve('jsqr'), 'utf8').replace('alignmentPatternCenters: [6, 30, 54, 74, 102]', 'alignmentPatternCenters: [6, 30, 54, 78, 102]');
  const m = { exports: {} }; new Function('module', 'exports', 'require', src)(m, m.exports, require);
  return typeof m.exports === 'function' ? m.exports : m.exports.default;
})();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const check = (name, ok, detail = '') => results.push({ name, ok, detail });

async function boot(html, { storage = {} } = {}) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://kdrip34.github.io/CuffedUpCloud/',
    beforeParse(w) {
      Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true });
      Object.defineProperty(w, 'isSecureContext', { value: true, configurable: true });
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
      w.CompressionStream = CompressionStream; w.DecompressionStream = DecompressionStream; w.Response = Response; w.Blob = Blob;
      w.fetch = () => Promise.reject(new Error('offline'));
      w.URL.createObjectURL = () => 'blob:x'; w.HTMLElement.prototype.scrollIntoView = () => {};
      w.confirm = () => true;
      for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
    } });
  await sleep(150); return dom;
}

/* A stand-in for a phone camera: rasterise a module matrix and hand it to jsQR. */
function scanModules(mod, scale = 4, border = 4) {
  const n = mod.length, w = (n + 2 * border) * scale, px = new Uint8ClampedArray(w * w * 4);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const mx = Math.floor(x / scale) - border, my = Math.floor(y / scale) - border;
    const v = (mx >= 0 && my >= 0 && mx < n && my < n && mod[my][mx]) ? 0 : 255, i = (y * w + x) * 4;
    px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
  }
  const r = jsQR(px, w, w); return r ? r.data : null;
}
/* Read the matrix back out of the SVG the app actually put on screen. */
function modulesFromSvg(svg) {
  const vb = +svg.match(/viewBox="0 0 (\d+)/)[1], border = 4, n = vb - 2 * border;
  const mod = Array.from({ length: n }, () => new Array(n).fill(false));
  for (const m of svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) mod[+m[2] - border][+m[1] - border] = true;
  return mod;
}

(async () => {
  const file = process.argv[2]; const html = fs.readFileSync(file, 'utf8');
  const A = await boot(html); const w = A.window, d = w.document, $ = id => d.getElementById(id); const QRm = w.eval('QR');

  // ---- Q1 encoder vs an independent decoder, across sizes and both ECC levels ----
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_:/.#?=';
  let ok = 0, bad = [];
  for (const lvl of ['L', 'M']) for (const n of [1, 17, 50, 120, 300, 500, 700, 1000, 1500, 2000, 2500, 2900]) {
    let s = 'https://kdrip34.github.io/CuffedUpCloud/#u=CUB7:'; while (s.length < n) s += alpha[(s.length * 7919) % alpha.length]; s = s.slice(0, n);
    const q = QRm.encode(s, lvl);
    if (!q) { if (lvl === 'M' && n > 2331) { ok++; continue; } bad.push(`${lvl}/${n}:null`); continue; }
    if (scanModules(q.modules) === s) ok++; else bad.push(`${lvl}/${n}:v${q.version}`);
  }
  check('Q1 QR codes decode with an independent decoder (sizes 1..2900, ECC L+M)', bad.length === 0, bad.length ? bad.join(' ') : `${ok} cases`);
  const uni = 'CuffedUpCloud 🔒 ÄÖÜ 日本語 https://kdrip34.github.io/CuffedUpCloud/#u=CUB7:AQID';
  check('Q1b non-ASCII text survives the QR round trip', scanModules(QRm.encode(uni, 'M').modules) === uni);

  // ---- board setup ----
  $('btnCreate').click(); await sleep(50);
  const secrets = {};
  for (const [n, p] of [['Kendrick', 'kendrick-pass-1'], ['Marcus', 'marcus-pass-1']]) {
    $('enName').value = n; $('enPw').value = p; $('btnEnroll').click(); await sleep(900);
    secrets[n] = $('totpSecret').textContent.trim();
  }
  // ---- Q2 invite QR from the enrollment screen, before any session exists ----
  $('btnQrInviteHere').click(); await sleep(400);
  const invShown = !$('qrOverlay').classList.contains('hidden') && /Invite for Marcus/.test($('qrTitle').textContent);
  const invUrl = scanModules(modulesFromSvg($('qrSvg').innerHTML));
  check('Q2 invite QR shows on the enrollment screen and scans to an #i= link', invShown && /^https:\/\/kdrip34\.github\.io\/CuffedUpCloud\/#i=CUB7/.test(invUrl || ''), $('qrMeta').textContent);
  check('Q2b "They scanned it" is hidden for invites (nothing to mark)', $('btnQrDone').classList.contains('hidden'));
  $('btnQrClose').click();
  check('Q2c Close hides the overlay and clears the code', $('qrOverlay').classList.contains('hidden') && $('qrSvg').innerHTML === '');

  $('btnDone').click(); await sleep(50);
  $('liWho').value = 'Kendrick'; $('liPw').value = 'kendrick-pass-1'; $('liCode').value = await w.totp(secrets.Kendrick);
  $('btnUnlock').click(); await sleep(1200);
  const post = async t => { $('draft').value = t; $('btnPost').click(); await sleep(80); };
  await post('QR test — first message.');
  await post('QR test — second message, a little longer so the code has some body to it.');

  // ---- Q3 update QR: scan it, feed it to a second device that joined from the invite QR ----
  $('btnQrUpdate').click(); await sleep(400);
  const updShown = !$('qrOverlay').classList.contains('hidden') && /Board update — 2 messages/.test($('qrTitle').textContent);
  const updUrl = scanModules(modulesFromSvg($('qrSvg').innerHTML));
  const upd = updUrl ? await w.fromSyncCode(decodeURIComponent(updUrl.split('#u=')[1])) : null;
  check('Q3 update QR scans back to the exact update payload', updShown && upd && upd.t === 'u' && upd.m.length === 2, $('qrMeta').textContent);
  check('Q3b update QR is not marked shared until confirmed', /2 messages since you last shared/.test($('updateSummary').textContent));
  $('btnQrDone').click(); await sleep(50);
  check('Q3c "They scanned it" marks the update as shared and closes', $('qrOverlay').classList.contains('hidden') && /Nothing new/.test($('updateSummary').textContent) && $('btnQrUpdate').disabled);

  const B = await boot(html); const w2 = B.window, d2 = w2.document, $2 = id => d2.getElementById(id);
  $2('setupPaste').value = invUrl; $2('btnSetupPaste').click(); await sleep(300);
  $2('liWho').value = 'Marcus'; $2('liPw').value = 'marcus-pass-1'; $2('liCode').value = await w2.totp(secrets.Marcus);
  $2('btnUnlock').click(); await sleep(1200);
  const joined = !$2('unlocked').classList.contains('hidden');
  $2('syncPaste').value = updUrl; $2('btnMerge').click(); await sleep(300);
  const n2 = w2.eval('board.messages.length');
  const card = [...d2.querySelectorAll('#messages .msg')].find(c => c.textContent.includes('#002'));
  card.querySelector('.sealed').click(); await sleep(80);
  check('Q3d other device joins from the invite QR and merges the update QR', joined && n2 === 2 && /SIG VERIFIED · KENDRICK/.test(card.textContent) && /second message/.test(card.textContent), `joined=${joined} messages=${n2}`);
  B.window.close();

  // ---- Q4 lock hides the code ----
  await post('Third — to have something to show.');
  $('btnQrUpdate').click(); await sleep(400);
  const openBefore = !$('qrOverlay').classList.contains('hidden');
  w.eval('idleDeadline = Date.now() - 1'); await sleep(1200);
  check('Q4 idle lock removes the QR from the screen', openBefore && $('qrOverlay').classList.contains('hidden') && $('qrSvg').innerHTML === '' && !$('login').classList.contains('hidden'));

  // ---- Q5 oversize link refuses instead of rendering garbage ----
  $('liWho').value = 'Kendrick'; $('liPw').value = 'kendrick-pass-1'; $('liCode').value = await w.totp(secrets.Kendrick);
  $('btnUnlock').click(); await sleep(1200);
  w.showQr('big', 'https://kdrip34.github.io/CuffedUpCloud/#u=' + 'A'.repeat(3200));
  await sleep(50);
  const toast = d.querySelector('.toast');
  check('Q5 a link too long for one QR shows a warning and no code', $('qrOverlay').classList.contains('hidden') && toast && /Too much for one QR/.test(toast.textContent));
  // Escape closes
  w.showQr('esc', 'https://kdrip34.github.io/CuffedUpCloud/#u=CUB7:AQID'); await sleep(50);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  check('Q5b Escape closes the overlay', $('qrOverlay').classList.contains('hidden'));
  A.window.close();

  const pass = results.filter(r => r.ok).length;
  console.log(`\n${file}\n${'='.repeat(60)}`);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '   [' + r.detail + ']' : ''}`);
  console.log(`${'-'.repeat(60)}\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('TEST ERROR', e); process.exit(2); });
