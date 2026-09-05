const fs=require('fs'); const qrcode=require('qrcode');
eval(fs.readFileSync('/tmp/claude-0/-home-user-CuffedUpCloud/54d39fdd-9be3-518d-83fd-eb8890f85ce6/scratchpad/qr.js','utf8')+'; globalThis.QR=QR;');
let pass=0, fail=0;
for (const lvl of ['L','M']) for (let v=1; v<=40; v++){
  // pick a text length that lands exactly on version v with my encoder, using mixed bytes
  let s=null, q=null;
  for (let n=1;n<3000;n++){ const t=Array.from({length:n},(_,i)=>String.fromCharCode(33+((i*31+v*7)%90))).join(''); const e=QR.encode(t,lvl); if(e.version===v){ s=t; q=e; break; } if(e.version>v) break; }
  if(!s){ console.log('skip',lvl,v); continue; }
  // find my mask from the format bits: brute force — re-encode is deterministic, so compare against node-qrcode with each mask and accept a match
  let matched=false;
  for (let m=0;m<8 && !matched;m++){
    const ref = qrcode.create(s, {errorCorrectionLevel:lvl, version:v, maskPattern:m});
    const size=ref.modules.size; if(size!==q.modules.length){ console.log('size mismatch',lvl,v); break; }
    let same=true; for(let y=0;y<size&&same;y++)for(let x=0;x<size;x++){ if(!!ref.modules.get(y,x)!==q.modules[y][x]){ same=false; break; } }
    if(same) matched=true;
  }
  if(matched) pass++; else { fail++; console.log('MISMATCH',lvl,'v'+v,'len',s.length); }
}
console.log(`cross-check vs node-qrcode: ${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
