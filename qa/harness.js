// qa/harness.js — drives the real page in jsdom. Usage: node harness.js <file.html>
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { webcrypto } = require('crypto');

const SPEED = 100;                    // timers ≥1s run 100× faster (30s → 300ms)
const sleepReal = ms => new Promise(r => setTimeout(r, ms));
const simSec = s => sleepReal(Math.ceil(s * 1000 / SPEED) + 5);   // wait s simulated seconds

async function boot(html, storage = {}) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://kdrip34.github.io/CuffedUpCloud/',
    beforeParse(w) {
      Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true });
      Object.defineProperty(w, 'isSecureContext', { value: true, configurable: true });
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
      w.fetch = () => Promise.reject(new Error('offline'));
      w.URL.createObjectURL = () => 'blob:fake'; w.URL.revokeObjectURL = () => {};
      w.HTMLElement.prototype.scrollIntoView = () => {};
      const si = w.setInterval, st = w.setTimeout;
      w.setInterval = (fn, ms, ...a) => si(fn, ms >= 1000 ? ms / SPEED : ms, ...a);
      w.setTimeout  = (fn, ms, ...a) => st(fn, ms >= 1000 ? ms / SPEED : ms, ...a);
      for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
    },
  });
  await sleepReal(150);
  return dom;
}

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); };

async function run(file) {
  const html = fs.readFileSync(file, 'utf8');
  let dom = await boot(html);
  let w = dom.window, d = w.document;
  const $ = id => d.getElementById(id);
  const vis = id => !$(id).classList.contains('hidden');
  const openBodies = () => d.querySelectorAll('#messages .body').length;
  const sealedCards = () => d.querySelectorAll('#messages .sealed').length;
  const click = id => $(id).click();

  // ---- T1 create board + enroll two members ----
  click('btnCreate'); await sleepReal(50);
  const secrets = {};
  for (const [name, pw] of [['Kendrick', 'kendrick-pass-1'], ['Marcus', 'marcus-pass-1']]) {
    $('enName').value = name; $('enPw').value = pw; click('btnEnroll');
    await sleepReal(900);                                    // PBKDF2 ×2 + keygen
    secrets[name] = $('totpSecret').textContent.trim();
  }
  check('T1 enroll two members (TOTP secrets issued)', secrets.Kendrick.length >= 16 && secrets.Marcus.length >= 16);
  click('btnDone'); await sleepReal(50);
  check('T1 login screen shown after enrollment', vis('login'));

  // ---- T2 wrong code rejected, right code accepted ----
  $('liWho').value = 'Marcus'; $('liPw').value = 'marcus-pass-1'; $('liCode').value = '000000';
  click('btnUnlock'); await sleepReal(900);
  check('T2 wrong TOTP code rejected', vis('login') && /failed/i.test($('loginErr').textContent));
  $('liCode').value = await w.totp(secrets.Marcus);
  click('btnUnlock'); await sleepReal(1200);
  check('T2 correct password + TOTP unlocks board', vis('unlocked') && !vis('login'));

  // ---- T3 post three messages ----
  const post = async t => { $('draft').value = t; click('btnPost'); await sleepReal(60); };
  await post('Message A — short.');
  await post('Message B — ' + 'a fairly long message that takes a while to read. '.repeat(6));
  await post('Message C — ' + 'a medium message that needs a little more time to read than the short ones do. '.repeat(3));  // ~48 words → 46s
  check('T3 three messages posted, all sealed', sealedCards() === 3 && openBodies() === 0);

  // ---- T4 reveal A, then 20s later reveal B and C; A expires at 30s ----
  const cards = () => [...d.querySelectorAll('#messages .msg')];
  const revealCard = async i => { const s = cards()[i].querySelector('.sealed'); if (s) s.click(); await sleepReal(35); };
  await revealCard(2);                                        // newest-first: index 2 = A? verify below
  const firstOpen = openBodies();
  check('T4a first reveal decrypts + shows SIG VERIFIED',
    firstOpen === 1 && /SIG VERIFIED · MARCUS/.test(d.querySelector('#messages .badges')?.textContent || ''));
  await simSec(10);
  await revealCard(0); await revealCard(1);
  check('T4b three messages open at once', openBodies() === 3, `open=${openBodies()}`);
  await simSec(20);                                           // A (32s) expires; B (51s) and C (46s) must not
  check('T4c ONLY the expired message re-seals (others stay open)', openBodies() === 2, `open=${openBodies()} (expected 2)`);

  // ---- T5 posting while messages are open should not re-seal them ----
  const before = openBodies();
  await post('Message D — posted while reading.');
  check('T5 posting a new message keeps open messages open', openBodies() === before && before > 0,
    `open before=${before} after=${openBodies()}`);

  // ---- T6 independent countdowns: X opened ~24s before Y; X expires ~6s into Y's life.
  //      Y (~48 words = 46s) must be open at Y+10 and Y+23, and sealed by Y+51.
  await simSec(40);                                           // drain everything from T4/T5
  const shortIdx = cards().findIndex(c => c.textContent.includes('#003'));   // Message C (short)
  const otherIdx = shortIdx === 0 ? 1 : 0;
  await revealCard(otherIdx);                                 // X
  await simSec(20);
  await revealCard(shortIdx);                                 // Y at Y+0
  await simSec(10);
  const y10 = !!cards()[shortIdx].querySelector('.body');     // X expired ~Y+6; Y must survive it
  await simSec(12);
  const y23 = !!cards()[shortIdx].querySelector('.body');
  await simSec(28);
  const y51 = !!cards()[shortIdx].querySelector('.body');
  check('T6 each open message keeps its own countdown', y10 && y23 && !y51,
    `Y open at +10s=${y10}, +23s=${y23}, sealed by +51s=${!y51}`);

  // ---- T11 hard ceiling: tapping keeps a message open, but never past 180s ----
  await simSec(60);                                           // drain
  await post('Message E — ' + 'a very long message so its natural countdown is the full 120 seconds. '.repeat(12));  // >120 words
  await revealCard(0);                                        // newest-first → E
  let stillOpen = true, tapped = 0;
  for (let t = 0; t < 8 && stillOpen; t++){                    // tap every 20s → 160s of taps
    await simSec(20);
    const body = cards()[0].querySelector('.body');
    if (body){ body.click(); tapped++; } else stillOpen = false;
  }
  const openAt165 = !!cards()[0].querySelector('.body');
  const elapsedAt165 = w.eval('(()=>{ const r=[...revealed.values()][0]; return r ? r.elapsed : -1; })()');
  await simSec(50);                                           // nominal ~215s: ceiling (180) passed, natural expiry (last tap+120s=280) not
  const openAt215 = !!cards()[0].querySelector('.body');
  check('T11 tap-to-extend works but the 3-minute ceiling still seals it', tapped >= 7 && openAt165 && !openAt215,
    `taps=${tapped}, ticks at nominal 165s=${elapsedAt165}, open at 165s=${openAt165}, open at ~215s=${openAt215}`);

  // ---- T7 tampered ciphertext is rejected ----
  const m = w.eval('board.messages[0]');
  const ct = m.enc.ct; m.enc.ct = ct.slice(0, -4) + (ct.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  w.eval('renderMessages()'); await sleepReal(50);
  const tamperedIdx = cards().findIndex(c => c.textContent.includes('#001'));
  await revealCard(tamperedIdx >= 0 ? tamperedIdx : 0);
  const failBadge = [...d.querySelectorAll('#messages .badge-fail')].length > 0;
  check('T7 tampered message fails verification and is not shown', failBadge && /Verification failed/.test($('messages').textContent));
  m.enc.ct = ct;

  // ---- T8 lock on losing focus ----
  Object.defineProperty(d, 'hidden', { value: true, configurable: true });
  d.dispatchEvent(new w.Event('visibilitychange')); await sleepReal(50);
  check('T8 app locks when it loses focus', vis('login') && !vis('unlocked') && /lost focus/i.test($('loginErr').textContent));
  Object.defineProperty(d, 'hidden', { value: false, configurable: true });

  // ---- T9 idle timeout ----
  $('liWho').value = 'Marcus'; $('liPw').value = 'marcus-pass-1'; $('liCode').value = await w.totp(secrets.Marcus);
  click('btnUnlock'); await sleepReal(1200);
  w.eval('idleDeadline = Date.now() - 1'); await sleepReal(700);
  check('T9 idle timeout locks the board', vis('login') && /idle/i.test($('loginErr').textContent));

  // ---- T10 persistence: reload page, board resumes from localStorage, login still works ----
  const saved = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); saved[k] = w.localStorage.getItem(k); }
  dom.window.close();
  dom = await boot(html, saved); w = dom.window; d = w.document;
  const $2 = id => d.getElementById(id);
  const resumed = !$2('login').classList.contains('hidden');
  $2('liWho').value = 'Kendrick'; $2('liPw').value = 'kendrick-pass-1'; $2('liCode').value = await w.totp(secrets.Kendrick);
  $2('btnUnlock').click(); await sleepReal(1200);
  const n = d.querySelectorAll('#messages .msg').length;
  check('T10 board persists across reload and other member can log in', resumed && !$2('unlocked').classList.contains('hidden') && n >= 5, `cards=${n}`);
  dom.window.close();

  const pass = results.filter(r => r.ok).length;
  console.log(`\n${file}\n${'='.repeat(60)}`);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '   [' + r.detail + ']' : ''}`);
  console.log(`${'-'.repeat(60)}\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}

run(process.argv[2]).catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
