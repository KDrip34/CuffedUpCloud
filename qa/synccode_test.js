// qa/synccode_test.js — CUB7 binary sync codes (V6.3). Usage: node synccode_test.js ../index.html
//   round-trips update / full-board / invite payloads, reads legacy CUB6 + CUB6P codes,
//   survives adversarial strings, works without CompressionStream, and drives the real
//   invite-link -> join -> update-link -> merge flow across two headless devices.
const fs = require('fs'); const { JSDOM } = require('jsdom'); const { webcrypto } = require('crypto'); const zlib = require('zlib');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const check = (name, ok, detail = '') => results.push({ name, ok, detail });

async function boot(html, { storage = {}, url = 'https://kdrip34.github.io/CuffedUpCloud/', zstreams = true } = {}) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url,
    beforeParse(w) {
      Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true });
      Object.defineProperty(w, 'isSecureContext', { value: true, configurable: true });
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
      if (zstreams) { w.CompressionStream = CompressionStream; w.DecompressionStream = DecompressionStream; w.Response = Response; w.Blob = Blob; }
      w.fetch = () => Promise.reject(new Error('offline'));
      w.URL.createObjectURL = () => 'blob:x'; w.HTMLElement.prototype.scrollIntoView = () => {};
      w.confirm = () => true;
      for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
    } });
  await sleep(150); return dom;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const file = process.argv[2]; const html = fs.readFileSync(file, 'utf8');
  const A = await boot(html); let w = A.window, d = w.document, $ = id => d.getElementById(id);
  $('btnCreate').click(); await sleep(50);
  const secrets = {};
  for (const [n, p] of [['Kendrick', 'kendrick-pass-1'], ['Marcus', 'marcus-pass-1']]) {
    $('enName').value = n; $('enPw').value = p; $('btnEnroll').click(); await sleep(900);
    secrets[n] = $('totpSecret').textContent.trim();
  }
  $('btnDone').click(); await sleep(50);
  $('liWho').value = 'Marcus'; $('liPw').value = 'marcus-pass-1'; $('liCode').value = await w.totp(secrets.Marcus);
  $('btnUnlock').click(); await sleep(1200);
  const post = async (t, topic = '') => { $('draft').value = t; $('draftTopic').value = topic; $('btnPost').click(); await sleep(80); };
  await post('Movie night Friday? I can host.', 'plans');
  w.eval('replyTo = board.messages[0]'); await post('In. Bringing the projector.');
  await post('Third message, plain, ' + 'with some more words so the ciphertext is not tiny. '.repeat(2));
  $('tabJournal').click(); await sleep(30); $('journalDraft').value = 'Private entry one.'; w.eval('journalSave()'); await sleep(80);

  // ---- S1 round trips ----
  const upd = (await w.eval('buildUpdate()')).payload;
  const code7 = await w.eval('(async()=>toSyncCode(JSON.stringify((await buildUpdate()).payload)))()');
  const back = await w.fromSyncCode(code7);
  check('S1a update payload round-trips through CUB7', code7.startsWith('CUB7:') && same(back, upd), `${code7.length} chars`);
  const boardJson = w.eval('JSON.stringify(board)');
  const full7 = await w.toSyncCode(boardJson);
  check('S1b full board round-trips through CUB7', same(await w.fromSyncCode(full7), JSON.parse(boardJson)), `${full7.length} chars`);
  const inv = await w.eval('buildInvite("Kendrick")');
  const inv7 = await w.toSyncCode(JSON.stringify(inv));
  check('S1c invite round-trips through CUB7', same(await w.fromSyncCode(inv7), inv), `${inv7.length} chars`);
  check('S1d CUB7 is URL-safe (no percent-encoding growth)', encodeURIComponent(code7) === code7.replace(':', '%3A'));

  // ---- S2 legacy codes from older builds still read ----
  const updJson = JSON.stringify(upd);
  const cub6 = 'CUB6:' + zlib.gzipSync(Buffer.from(updJson)).toString('base64');
  const cub6p = 'CUB6P:' + Buffer.from(updJson).toString('base64');
  check('S2a legacy CUB6 (gzip) code still reads', same(await w.fromSyncCode(cub6), upd));
  check('S2b legacy CUB6P (plain) code still reads', same(await w.fromSyncCode(cub6p), upd));
  check('S2c raw JSON export still reads', same(await w.fromSyncCode(updJson), upd));

  // ---- S3 smaller (multi-item update: 3 messages + 1 journal entry) ----
  const ratio = code7.length / cub6.length;
  check('S3 CUB7 multi-item update code is smaller than CUB6', ratio < 0.9,
    `CUB6=${cub6.length} CUB7=${code7.length} (${Math.round((1 - ratio) * 100)}% smaller)`);

  // ---- S4 adversarial strings: anything that merely looks like bytes must survive exactly ----
  const nasty = { a: '\u0000 starts with NUL', b: 'internationalization', c: 'deadbeefdeadbeef', d: 'AAAAAAAAAAAAAAAA', e: 'abc', f: 'QUJD',
    g: 'not-base64!!!!!!!!!!', h: '0123456789abcdef0', i: [[1, 2], ['YWJjZGVmZ2hpamtsbW5vcA==', null]], j: { '12': 'x', a: 'y', '3': 'z' },
    k: [0, -1.5, true, false, null], l: 'YWJjZGVmZ2hpamtsbW5vcA=', m: '-_-_-_-_-_-_-_-_', n: 'ÄÖÜ 日本語 emoji 🔒', o: '', p: ' ', q: '\u0000b5',
    r: 'a'.repeat(1000), s: 'MDEyMzQ1Njc4OWFiY2RlZg', t: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/' };
  const nasty7 = await w.toSyncCode(JSON.stringify(nasty));
  check('S4 adversarial strings round-trip byte-for-byte', same(await w.fromSyncCode(nasty7), nasty));
  let threw = false; try { await w.fromSyncCode('CUB7:' + code7.slice(5, 40)); } catch { threw = true; }
  check('S4b truncated CUB7 code throws instead of returning garbage', threw);

  // ---- S5 no CompressionStream: plain-stored CUB7 still round-trips, and reads on a device that has it ----
  const P = await boot(html, { zstreams: false });
  const plain7 = await P.window.toSyncCode(updJson);
  check('S5 CUB7 without CompressionStream round-trips (stored plain) and reads elsewhere',
    plain7.startsWith('CUB7:') && plain7 !== code7 && same(await P.window.fromSyncCode(plain7), upd) && same(await w.fromSyncCode(plain7), upd),
    `plain=${plain7.length} deflated=${code7.length}`);
  P.window.close();

  // ---- S6 end to end: Kendrick joins a second device from the invite link, then merges an update link ----
  const inviteUrl = 'https://kdrip34.github.io/CuffedUpCloud/#i=' + encodeURIComponent(inv7);
  const B = await boot(html); const w2 = B.window, d2 = w2.document, $2 = id => d2.getElementById(id);
  $2('setupPaste').value = inviteUrl; $2('btnSetupPaste').click(); await sleep(300);
  const loginShown = !$2('login').classList.contains('hidden');
  $2('liWho').value = 'Kendrick'; $2('liPw').value = 'kendrick-pass-1'; $2('liCode').value = await w2.totp(secrets.Kendrick);
  $2('btnUnlock').click(); await sleep(1200);
  const n1 = w.eval('board.messages.length'), n2 = w2.eval('board.messages.length');
  check('S6a invite link (CUB7) joins a fresh device; history matches', loginShown && !$2('unlocked').classList.contains('hidden') && n2 === n1, `sender=${n1} joiner=${n2}`);
  w.eval('markShared(allIds())');
  await post('Fourth message, sent after Kendrick joined.');
  const single = (await w.eval('buildUpdate()')).payload;
  const single7 = await w.toSyncCode(JSON.stringify(single));
  const single6 = 'CUB6:' + zlib.gzipSync(Buffer.from(JSON.stringify(single))).toString('base64');
  const link = c => 'https://kdrip34.github.io/CuffedUpCloud/#u=' + encodeURIComponent(c);
  const r1 = link(single7).length / link(single6).length;
  check('S3b single-message update link is at least 20% shorter than CUB6', r1 < 0.8,
    `CUB6 link=${link(single6).length} CUB7 link=${link(single7).length} (${Math.round((1 - r1) * 100)}% shorter)`);
  const updUrl = link(single7);
  $2('syncPaste').value = updUrl; $2('btnMerge').click(); await sleep(300);
  const n2b = w2.eval('board.messages.length');
  const cards = d2.querySelectorAll('#messages .msg').length;
  check('S6b update link (CUB7) merges on the other device', n2b === n1 + 1 && cards === n2b, `before=${n2} after=${n2b} cards=${cards} link=${updUrl.length} chars`);
  const sealed = [...d2.querySelectorAll('#messages .msg')].find(c => c.textContent.includes('#004'));
  sealed.querySelector('.sealed').click(); await sleep(60);
  check('S6c merged message decrypts and verifies on the other device', /SIG VERIFIED · MARCUS/.test(sealed.textContent) && /Fourth message/.test(sealed.textContent));
  B.window.close(); A.window.close();

  const pass = results.filter(r => r.ok).length;
  console.log(`\n${file}\n${'='.repeat(60)}`);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '   [' + r.detail + ']' : ''}`);
  console.log(`${'-'.repeat(60)}\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('TEST ERROR', e); process.exit(2); });
