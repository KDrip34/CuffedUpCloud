const fs=require('fs'); const {JSDOM}=require('jsdom'); const {webcrypto}=require('crypto');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const file=process.argv[2]; const html=fs.readFileSync(file,'utf8');
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://kdrip34.github.io/CuffedUpCloud/',
    beforeParse(w){ Object.defineProperty(w,'crypto',{value:webcrypto}); Object.defineProperty(w,'isSecureContext',{value:true});
      w.TextEncoder=TextEncoder; w.TextDecoder=TextDecoder; w.fetch=()=>Promise.reject(new Error('offline'));
      w.URL.createObjectURL=()=>'blob:x'; w.HTMLElement.prototype.scrollIntoView=()=>{};
      const si=w.setInterval; w.setInterval=(fn,ms,...a)=>si(fn, ms>=1000?ms/100:ms, ...a); }});
  await sleep(150); const w=dom.window,d=w.document,$=id=>d.getElementById(id);
  $('btnCreate').click(); await sleep(50);
  for (const [n,p] of [['Kendrick','kendrick-pass-1'],['Marcus','marcus-pass-1']]){ $('enName').value=n;$('enPw').value=p;$('btnEnroll').click(); await sleep(900); }
  const sec=$('totpSecret').textContent.trim(); $('btnDone').click(); await sleep(50);
  $('liWho').value='Marcus';$('liPw').value='marcus-pass-1';$('liCode').value=await w.totp(sec);$('btnUnlock').click(); await sleep(1200);
  $('tabJournal').click(); await sleep(30);
  const save=async t=>{ $('journalDraft').value=t; w.eval('journalSave()'); await sleep(60); };
  await save('Entry one — ' + 'some private thoughts that take a moment to read. '.repeat(4));
  await save('Entry two — short.');
  const cards=()=>[...d.querySelectorAll('#journalEntries .msg')];
  cards()[0].querySelector('.sealed').click(); await sleep(35);
  cards()[1].querySelector('.sealed').click(); await sleep(35);
  const open=()=>d.querySelectorAll('#journalEntries .body').length;
  const a=open();
  await save('Entry three — posted while two are open.');      // re-renders the journal
  const b=open();
  console.log(`${file}: journal open before re-render=${a}, after=${b}  ->  ${a===2&&b===2?'PASS':'FAIL'} (open entries survive re-render)`);
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(2);});
