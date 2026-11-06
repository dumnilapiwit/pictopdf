'use strict';
// Image tools: compress (smaller files) and convert (change format).
// Everything runs in the browser; output files have EXIF/GPS stripped because
// they are re-encoded from a canvas.
const $=id=>document.getElementById(id);
const MODE=window.PICTO_MODE==='convert'?'convert':'compress';
const MAX_FILES=100;
const files=[];let busy=false,zipURL=null;
const status=t=>$('status').textContent=t;
const fmtSize=b=>b<1024?b+' B':b<1048576?(b/1024).toFixed(0)+' KB':(b/1048576).toFixed(1)+' MB';
const EXT={'image/jpeg':'jpg','image/webp':'webp','image/png':'png'};

if(MODE==='compress'){
 document.title='PictoPDF · บีบอัดรูป';
 $('eyebrow').textContent='COMPRESS IMAGES';
 $('headline').innerHTML='ลดขนาดรูป<br>ให้ส่งและอัปโหลดง่าย<span>.</span>';
 $('lede').innerHTML='ลดขนาดไฟล์รูปโดยยังดูคมชัด เหมาะกับส่งงาน แนบอีเมล หรืออัปโหลดเว็บที่จำกัดขนาด<br>ปรับคุณภาพและขนาดภาพได้ตามต้องการ';
 $('dropTitle').textContent='เพิ่มรูปที่ต้องการบีบอัด';
 $('maxSide').value='1920';
}else{
 document.title='PictoPDF · แปลงไฟล์รูป';
 $('eyebrow').textContent='CONVERT IMAGES';
 $('headline').innerHTML='แปลงไฟล์รูป<br>JPG · PNG · WebP<span>.</span>';
 $('lede').innerHTML='เปลี่ยนนามสกุลรูปได้หลายไฟล์พร้อมกัน รวมถึงรูป HEIC จาก iPhone<br>ในเบราว์เซอร์ที่เปิดไฟล์ HEIC ได้ เช่น Safari';
 $('dropTitle').textContent='เพิ่มรูปที่ต้องการแปลง';
 $('format').value='image/png';$('quality').value=90;
}
// WebP encoding is not available in every browser (older Safari): detect once
const webpOK=(()=>{try{const c=document.createElement('canvas');c.width=c.height=2;return c.toDataURL('image/webp').startsWith('data:image/webp')}catch{return false}})();
if(!webpOK){const o=$('format').querySelector('option[value="image/webp"]');o.disabled=true;o.textContent+=' — เบราว์เซอร์นี้ไม่รองรับ'}
function syncQuality(){$('qualityOut').textContent=$('quality').value;$('qualityWrap').hidden=$('format').value==='image/png'}
$('quality').oninput=syncQuality;$('format').onchange=()=>{syncQuality();markStale()};$('maxSide').onchange=markStale;$('quality').onchange=markStale;syncQuality();

async function decode(blob){
 if(window.createImageBitmap){try{return await createImageBitmap(blob)}catch{}}
 const url=URL.createObjectURL(blob);
 try{return await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(Error('decode'));i.src=url})}finally{URL.revokeObjectURL(url)}
}
function dataURLToBlob(u){const i=u.indexOf(','),type=u.slice(5,u.indexOf(';')),s=atob(u.slice(i+1)),b=new Uint8Array(s.length);for(let k=0;k<s.length;k++)b[k]=s.charCodeAt(k);return new Blob([b],{type})}
const baseName=n=>n.replace(/\.[^.]+$/,'')||'image';

function render(){
 $('results').hidden=!files.length;$('fileList').replaceChildren();
 let before=0,after=0,done=0;
 for(const f of files){
  const li=document.createElement('li');li.className='fileRow';
  const img=document.createElement('img');img.alt='';img.src=f.thumb||'';li.append(img);
  const info=document.createElement('div');info.className='fileInfo';
  const name=document.createElement(f.out?'a':'span');name.textContent=f.out?f.out.name:f.file.name;
  if(f.out){name.href=f.out.url;name.download=f.out.name;name.className='fileName'}else name.className='fileName';
  const meta=document.createElement('small');
  if(f.error)meta.textContent=f.error;
  else if(f.out){const d=f.out.size-f.file.size,pct=Math.round(-d/f.file.size*100);meta.textContent=`${fmtSize(f.file.size)} → ${fmtSize(f.out.size)} · ${f.out.w}×${f.out.h}`+(MODE==='compress'?(f.out.keptOriginal?' · ต้นฉบับเล็กกว่าอยู่แล้ว ใช้ไฟล์เดิม':` · เล็กลง ${pct}%`):'');before+=f.file.size;after+=f.out.size;done++}
  else meta.textContent=`${fmtSize(f.file.size)} · รอทำงาน`;
  info.append(name,meta);li.append(info);
  const rm=document.createElement('button');rm.className='secondary';rm.textContent='ลบ';rm.setAttribute('aria-label','ลบ '+f.file.name);rm.onclick=()=>{if(busy)return;release(f);files.splice(files.indexOf(f),1);markStale();render()};li.append(rm);
  $('fileList').append(li);
 }
 $('summary').textContent=done?`${done}/${files.length} ไฟล์ · ${fmtSize(before)} → ${fmtSize(after)}`:`${files.length} ไฟล์`;
 $('bulk').hidden=!(done&&done===files.filter(f=>!f.error).length&&done>0);
}
function release(f){if(f.out)URL.revokeObjectURL(f.out.url);if(f.thumb)URL.revokeObjectURL(f.thumb);f.out=null}
function markStale(){let any=false;for(const f of files)if(f.out){URL.revokeObjectURL(f.out.url);f.out=null;any=true}if(zipURL){URL.revokeObjectURL(zipURL);zipURL=null}if(any){status('เปลี่ยนตัวเลือกแล้ว · กด "เริ่มทำงาน" อีกครั้ง');render()}}

async function add(list){
 if(busy)return;let skipped=0;
 for(const file of Array.from(list)){if(files.length>=MAX_FILES){skipped++;continue}
  const f={file};files.push(f);
  try{const bmp=await decode(file),c=document.createElement('canvas'),s=120/Math.max(bmp.width,bmp.height);c.width=Math.max(1,Math.round(bmp.width*s));c.height=Math.max(1,Math.round(bmp.height*s));c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);bmp.close?.();f.thumb=URL.createObjectURL(dataURLToBlob(c.toDataURL('image/jpeg',.7)))}
  catch{f.error='เปิดไฟล์นี้ไม่ได้ (ถ้าเป็น HEIC ให้ลองเปิดหน้านี้ใน Safari)'}
 }
 render();status(`เพิ่มแล้ว ${files.length} ไฟล์ · ตั้งค่าแล้วกด "เริ่มทำงาน"`+(skipped?` · ข้าม ${skipped} ไฟล์ (สูงสุด ${MAX_FILES})`:''));
 $('files').value='';$('results').scrollIntoView({behavior:'smooth',block:'start'});
}
$('files').onchange=e=>add(e.target.files);
$('drop').ondragover=e=>e.preventDefault();$('drop').ondrop=e=>{e.preventDefault();add(e.dataTransfer.files)};

$('run').onclick=async()=>{
 if(busy||!files.length)return;busy=true;$('run').disabled=true;$('clearAll').disabled=true;markStale();
 const type=$('format').value,q=+$('quality').value/100,maxSide=+$('maxSide').value;
 try{
  let i=0;for(const f of files){i++;if(f.error&&!f.thumb)continue;f.error=null;status(`กำลังทำ ${i} / ${files.length} · ${f.file.name}`);await new Promise(r=>setTimeout(r,0));
   try{
    const bmp=await decode(f.file),s=maxSide?Math.min(1,maxSide/Math.max(bmp.width,bmp.height)):1,c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(bmp.width*s));c.height=Math.max(1,Math.round(bmp.height*s));const ctx=c.getContext('2d');
    if(type==='image/jpeg'){ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height)} // JPG has no transparency
    ctx.imageSmoothingQuality='high';ctx.drawImage(bmp,0,0,c.width,c.height);bmp.close?.();
    let blob=dataURLToBlob(c.toDataURL(type,q));const w=c.width,h=c.height;c.width=c.height=1;
    let name=`${baseName(f.file.name)}.${EXT[type]}`,keptOriginal=false;
    // compressing must never make a file bigger: keep the original when it wins
    if(MODE==='compress'&&blob.size>=f.file.size&&f.file.type===type&&!maxSide){blob=f.file;name=f.file.name;keptOriginal=true}
    f.out={url:URL.createObjectURL(blob),blob,name,size:blob.size,w,h,keptOriginal};
   }catch{f.error='แปลงไฟล์นี้ไม่สำเร็จ'}
  }
  // de-duplicate output names (e.g. a.png and a.jpg both -> a.webp)
  const seen=new Map();for(const f of files)if(f.out){const n=f.out.name,k=n.toLowerCase(),c=seen.get(k)||0;seen.set(k,c+1);if(c)f.out.name=n.replace(/(\.[^.]+)$/,`-${c+1}$1`)}
  const outs=files.filter(f=>f.out);
  if(outs.length){const zip=makeZip(await Promise.all(outs.map(async f=>({name:f.out.name,data:new Uint8Array(await f.out.blob.arrayBuffer())}))));zipURL=URL.createObjectURL(zip);
   const label=MODE==='compress'?'compressed':'converted';$('zip').href=zipURL;$('zip').download=`PictoPDF-${label}-${outs.length}.zip`;
   const shareFiles=outs.map(f=>new File([f.out.blob],f.out.name,{type:f.out.blob.type}));$('share').hidden=!navigator.canShare?.({files:shareFiles});$('share').onclick=async()=>{try{await navigator.share({files:shareFiles})}catch(e){if(e.name!=='AbortError')status('แชร์ไม่สำเร็จ กรุณาใช้ปุ่มบันทึก')}}}
  render();const failed=files.filter(f=>f.error).length;
  status(`เสร็จแล้ว ${outs.length} ไฟล์`+(failed?` · ไม่สำเร็จ ${failed} ไฟล์`:'')+' · บน iPhone ใช้ "แชร์ / บันทึกลงรูปภาพ"');
 }finally{busy=false;$('run').disabled=false;$('clearAll').disabled=false}
};
$('clearAll').onclick=()=>{if(busy||!files.length)return;if(!confirm(`ลบทั้งหมด ${files.length} ไฟล์? รูปต้นฉบับในเครื่องจะไม่ถูกลบ`))return;for(const f of files)release(f);files.length=0;markStale();render();status('ลบทั้งหมดแล้ว · เลือกรูปชุดใหม่ได้เลย')};
window.addEventListener('beforeunload',e=>{if(files.some(f=>f.out)){e.preventDefault();e.returnValue=''}});

// Minimal ZIP writer (stored, no compression: images are already compressed).
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
const crc32=d=>{let c=0xFFFFFFFF;for(let i=0;i<d.length;i++)c=CRC[(c^d[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0};
function makeZip(entries){
 const enc=new TextEncoder(),parts=[],central=[];let off=0;
 const d=new Date(),dosT=(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1),dosD=((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate();
 for(const e of entries){const name=enc.encode(e.name),crc=crc32(e.data),size=e.data.length;
  const lh=new DataView(new ArrayBuffer(30));lh.setUint32(0,0x04034b50,true);lh.setUint16(4,20,true);lh.setUint16(6,0x0800,true);lh.setUint16(8,0,true);lh.setUint16(10,dosT,true);lh.setUint16(12,dosD,true);lh.setUint32(14,crc,true);lh.setUint32(18,size,true);lh.setUint32(22,size,true);lh.setUint16(26,name.length,true);lh.setUint16(28,0,true);
  parts.push(new Uint8Array(lh.buffer),name,e.data);
  const ch=new DataView(new ArrayBuffer(46));ch.setUint32(0,0x02014b50,true);ch.setUint16(4,20,true);ch.setUint16(6,20,true);ch.setUint16(8,0x0800,true);ch.setUint16(10,0,true);ch.setUint16(12,dosT,true);ch.setUint16(14,dosD,true);ch.setUint32(16,crc,true);ch.setUint32(20,size,true);ch.setUint32(24,size,true);ch.setUint16(28,name.length,true);ch.setUint32(42,off,true);
  central.push(new Uint8Array(ch.buffer),name);off+=30+name.length+size}
 const cSize=central.reduce((s,p)=>s+p.length,0),end=new DataView(new ArrayBuffer(22));end.setUint32(0,0x06054b50,true);end.setUint16(8,entries.length,true);end.setUint16(10,entries.length,true);end.setUint32(12,cSize,true);end.setUint32(16,off,true);
 return new Blob([...parts,...central,new Uint8Array(end.buffer)],{type:'application/zip'});
}
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(()=>{});
