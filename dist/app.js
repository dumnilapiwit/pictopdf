'use strict';
// PictoPDF app. Photos are kept as compressed JPEG blobs (not decoded canvases)
// so dozens of photos fit in phone memory; only the photo being edited is decoded.
const $=id=>document.getElementById(id),items=[];
let current=null,mode='original',drag=-1,busy=false,cache={it:null,can:null},previewCache=null,previewTimer=0;
const status=t=>$('status').textContent=t;
const MAX_SIDE=1800,MAX_FILES=60;
const full=(w,h)=>[{x:0,y:0},{x:w-1,y:0},{x:w-1,y:h-1},{x:0,y:h-1}];
// Synchronous toDataURL encoding: async toBlob can be deferred ~1 s per call by
// the browser's idle scheduling, which made a 60-page export take minutes.
const canvasToBlob=async(c,q=.92)=>{const u=c.toDataURL('image/jpeg',q),i=u.indexOf(',');if(i<0||!u.startsWith('data:image/jpeg'))throw Error('encode');
 const s=atob(u.slice(i+1)),b=new Uint8Array(s.length);for(let k=0;k<s.length;k++)b[k]=s.charCodeAt(k);return new Blob([b],{type:'image/jpeg'})};
const tick=()=>new Promise(r=>setTimeout(r,0));

async function decode(blob){
 if(window.createImageBitmap){try{return await createImageBitmap(blob)}catch{}}
 const url=URL.createObjectURL(blob);
 try{return await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(Error('decode'));i.src=url})}
 finally{URL.revokeObjectURL(url)}
}
// Decoded canvas for an item. keep=true makes it the single cached (current) one.
async function canvasFor(it,keep){
 if(cache.it===it)return cache.can;
 const bmp=await decode(it.blob),c=document.createElement('canvas');c.width=it.w;c.height=it.h;c.getContext('2d').drawImage(bmp,0,0);bmp.close?.();
 if(keep){if(cache.can)cache.can.width=cache.can.height=1;cache={it,can:c};previewCache=null}
 return c;
}
async function makeThumb(src){
 const t=document.createElement('canvas'),s=200/Math.max(src.width,src.height);t.width=Math.round(src.width*s);t.height=Math.round(src.height*s);
 t.getContext('2d').drawImage(src,0,0,t.width,t.height);const url=URL.createObjectURL(await canvasToBlob(t,.7));t.width=t.height=1;return url;
}
function hintFor(it){return it.detection==='high'?'พบกรอบครบ 4 ด้าน · ตรวจมุมก่อนบันทึก':it.detection==='partial'?'พบกรอบบางด้าน ขอบที่หลุดนอกภาพจะชิดขอบรูป · ลากจุดแก้ได้':'ยังไม่มั่นใจในกรอบ จึงเก็บภาพเต็มไว้ · ลากจุดทั้งสี่เพื่อปรับขอบ'}

function draw(){
 if(!current||cache.it!==current)return;
 const c=$('editor'),ctx=c.getContext('2d'),src=cache.can;
 if(mode==='preview'){if(!previewCache)previewCache=process(current,src);const out=previewCache;c.width=out.width;c.height=out.height;ctx.drawImage(out,0,0);return}
 c.width=src.width;c.height=src.height;ctx.drawImage(src,0,0);
 const p=current.points,r=c.width/40;
 ctx.beginPath();p.forEach((q,i)=>i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y));ctx.closePath();
 ctx.fillStyle='rgba(186,242,138,.12)';ctx.fill();ctx.strokeStyle='#baf28a';ctx.lineWidth=c.width/260;ctx.stroke();
 p.forEach((q,i)=>{ctx.beginPath();ctx.arc(q.x,q.y,r,0,Math.PI*2);ctx.fillStyle='rgba(36,77,64,.85)';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=c.width/400;ctx.stroke();
  ctx.fillStyle='white';ctx.font=`${r}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(i+1,q.x,q.y)});
}
const invalidate=()=>{previewCache=null};
function schedulePreview(){invalidate();if(mode!=='preview')return;clearTimeout(previewTimer);previewTimer=setTimeout(()=>{try{draw()}catch(e){status(e.message)}},120)}
function setMode(m){
 mode=m;$('original').classList.toggle('active',m==='original');$('preview').classList.toggle('active',m==='preview');
 try{draw()}catch(e){mode='original';$('original').classList.add('active');$('preview').classList.remove('active');draw();status(e.message)}
}
async function select(it){
 current=it;$('name').textContent=it.name;$('hint').textContent=hintFor(it);$('brightness').value=it.b;$('contrast').value=it.c;$('clean').checked=it.clean!==false;render();
 await canvasFor(it,true);if(current!==it)return;setMode('original');
}
function render(){
 $('workspace').hidden=!items.length;$('count').textContent=`${items.length} หน้า`;$('list').replaceChildren();
 items.forEach((it,i)=>{
  const card=document.createElement('div');card.className='card'+(it===current?' selected':'');
  const choose=document.createElement('button');choose.className='choose';const img=document.createElement('img');img.src=it.thumb;img.alt=`สไลด์หน้า ${i+1}`;
  const label=document.createElement('span');label.textContent=`${i+1}. ${it.name}`;choose.append(img,label);choose.onclick=()=>select(it);card.append(choose);
  const controls=document.createElement('div');
  for(const [text,fn,disabled,title] of [['↑',()=>move(i,-1),i===0,'เลื่อนขึ้น'],['↓',()=>move(i,1),i===items.length-1,'เลื่อนลง'],['ลบ',()=>removeAt(i),false,'ลบหน้านี้']]){
   const b=document.createElement('button');b.textContent=text;b.title=title;b.setAttribute('aria-label',title);b.className='secondary';b.disabled=disabled;b.onclick=fn;controls.append(b)}
  card.append(controls);$('list').append(card)});
}
function removeAt(i){
 const it=items[i];items.splice(i,1);URL.revokeObjectURL(it.thumb);
 if(cache.it===it){cache.can.width=cache.can.height=1;cache={it:null,can:null}}
 if(current===it){current=items[Math.min(i,items.length-1)]||null;if(current){select(current);return}}
 render();
}
function move(i,d){[items[i],items[i+d]]=[items[i+d],items[i]];render()}
function detectOn(it,src){
 const scale=Math.min(1,480/Math.max(src.width,src.height)),c=document.createElement('canvas');c.width=Math.round(src.width*scale);c.height=Math.round(src.height*scale);
 const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(src,0,0,c.width,c.height);
 const r=findScreen(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height);
 it.points=r.points.map(p=>({x:p.x*(it.w-1)/(c.width-1),y:p.y*(it.h-1)/(c.height-1)}));it.detection=r.confidence;c.width=c.height=1;
 return r.confidence!=='low';
}
async function add(files){
 if(busy)return;files=Array.from(files);busy=true;$('export').disabled=true;const failed=[];let skipped=0;
 try{
  for(const f of files){
   if(items.length>=MAX_FILES){skipped++;continue}
   status(`กำลังเปิดรูป ${items.length+1}… (${f.name})`);
   try{
    const bmp=await decode(f),scale=Math.min(1,MAX_SIDE/Math.max(bmp.width,bmp.height)),can=document.createElement('canvas');
    can.width=Math.round(bmp.width*scale);can.height=Math.round(bmp.height*scale);can.getContext('2d').drawImage(bmp,0,0,can.width,can.height);bmp.close?.();
    const it={name:f.name,w:can.width,h:can.height,points:full(can.width,can.height),b:0,c:100,clean:true,detection:'low'};
    detectOn(it,can);it.blob=await canvasToBlob(can,.92);it.thumb=await makeThumb(can);can.width=can.height=1;items.push(it);
   }catch{failed.push(f.name)}
   await tick();
  }
  if(items.length&&!current)await select(items[0]);else render();
  let msg=`พร้อม ${items.length} รูป · ตรวจจุดมุมทั้งสี่ก่อนบันทึก`;
  if(failed.length)msg+=` · เปิดไม่ได้ ${failed.length} รูป (${failed.slice(0,3).join(', ')}${failed.length>3?'…':''}) — ถ้าเป็นไฟล์ HEIC ให้แปลงเป็น JPG ก่อน`;
  if(skipped)msg+=` · ข้าม ${skipped} รูป (สูงสุด ${MAX_FILES} รูป)`;
  status(msg);
 }finally{busy=false;$('export').disabled=false;$('files').value=''}
}
$('files').onchange=e=>add(e.target.files);
$('drop').ondragover=e=>e.preventDefault();$('drop').ondrop=e=>{e.preventDefault();add(e.dataTransfer.files)};
window.addEventListener('beforeunload',e=>{if(items.length){e.preventDefault();e.returnValue=''}});

const c=$('editor');
function pos(e){const r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*c.width/r.width,y:(e.clientY-r.top)*c.height/r.height}}
c.onpointerdown=e=>{
 if(!current||mode!=='original'||cache.it!==current)return;const p=pos(e);let distance=Infinity;
 current.points.forEach((q,i)=>{const d=Math.hypot(p.x-q.x,p.y-q.y);if(d<distance){distance=d;drag=i}});
 // generous touch target: fingers are less precise than a mouse
 const r=c.getBoundingClientRect(),limit=(e.pointerType==='touch'?48:28)*c.width/r.width;
 if(distance>limit){drag=-1;return}c.setPointerCapture(e.pointerId);e.preventDefault();
};
c.onpointermove=e=>{if(drag<0)return;const p=pos(e);current.points[drag]={x:Math.max(0,Math.min(c.width-1,p.x)),y:Math.max(0,Math.min(c.height-1,p.y))};invalidate();draw()};
c.onpointerup=c.onpointercancel=()=>drag=-1;
$('original').onclick=()=>setMode('original');$('preview').onclick=()=>setMode('preview');
$('reset').onclick=()=>{if(!current)return;current.points=full(current.w,current.h);invalidate();setMode('original')};
$('detect').onclick=async()=>{
 const it=current;if(!it)return;status('กำลังหาขอบ…');const ok=detectOn(it,await canvasFor(it,true));invalidate();
 if(current===it){$('hint').textContent=hintFor(it);setMode('original')}
 status(ok?'ปรับตามกรอบจอแล้ว · กรุณาตรวจด้านที่ขอบจออยู่นอกภาพ':'ยังไม่มั่นใจ จึงเก็บภาพเต็มไว้ ลากมุมเองได้');
};
for(const id of ['brightness','contrast'])$(id).oninput=()=>{if(!current)return;current[id==='brightness'?'b':'c']=+$(id).value;schedulePreview()};
$('clean').onchange=()=>{if(!current)return;current.clean=$('clean').checked;schedulePreview()};
$('rotate').onclick=async()=>{
 const it=current;if(!it||busy)return;const im=await canvasFor(it,true),out=document.createElement('canvas');out.width=im.height;out.height=im.width;
 const ctx=out.getContext('2d');ctx.translate(out.width,0);ctx.rotate(Math.PI/2);ctx.drawImage(im,0,0);
 const p=it.points.map(q=>({x:im.height-1-q.y,y:q.x}));it.points=[p[3],p[0],p[1],p[2]];it.w=out.width;it.h=out.height;
 it.blob=await canvasToBlob(out,.92);URL.revokeObjectURL(it.thumb);it.thumb=await makeThumb(out);
 im.width=im.height=1;cache={it,can:out};invalidate();render();draw();
};

function solve(a,b){for(let i=0;i<8;i++){let k=i;for(let j=i+1;j<8;j++)if(Math.abs(a[j][i])>Math.abs(a[k][i]))k=j;[a[i],a[k]]=[a[k],a[i]];[b[i],b[k]]=[b[k],b[i]];const v=a[i][i];if(Math.abs(v)<1e-9)throw Error('กรุณาจัดจุดมุมให้เป็นสี่เหลี่ยม ไม่ไขว้กัน');for(let j=i;j<8;j++)a[i][j]/=v;b[i]/=v;for(let k=0;k<8;k++)if(k!==i){const v=a[k][i];for(let j=i;j<8;j++)a[k][j]-=v*a[i][j];b[k]-=v*b[i]}}return b}
// Perspective-correct the quad (homography + bilinear sampling), then clean and adjust.
function process(it,src){
 const p=it.points;let sign=0;
 for(let i=0;i<4;i++){const a=p[i],b=p[(i+1)%4],d=p[(i+2)%4],cross=(b.x-a.x)*(d.y-b.y)-(b.y-a.y)*(d.x-b.x);if(Math.abs(cross)<20||sign&&Math.sign(cross)!==sign)throw Error('กรุณาจัดจุดมุมให้เป็นสี่เหลี่ยม ไม่ไขว้กัน');sign=Math.sign(cross)}
 const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);let w=Math.round(Math.max(dist(p[0],p[1]),dist(p[3],p[2]))),h=Math.round(Math.max(dist(p[0],p[3]),dist(p[1],p[2])));w=Math.max(32,w);h=Math.max(32,h);
 const a=[],b=[];[[0,0],[w-1,0],[w-1,h-1],[0,h-1]].forEach(([x,y],i)=>{const q=p[i];a.push([x,y,1,0,0,0,-x*q.x,-y*q.x],[0,0,0,x,y,1,-x*q.y,-y*q.y]);b.push(q.x,q.y)});
 const m=solve(a,b),source=src.getContext('2d',{willReadFrequently:true}).getImageData(0,0,src.width,src.height).data,out=document.createElement('canvas');out.width=w;out.height=h;
 const ctx=out.getContext('2d'),result=ctx.createImageData(w,h),data=result.data,sw=src.width,sh=src.height;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const z=m[6]*x+m[7]*y+1,sx=Math.max(0,Math.min(sw-1,(m[0]*x+m[1]*y+m[2])/z)),sy=Math.max(0,Math.min(sh-1,(m[3]*x+m[4]*y+m[5])/z)),x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(sw-1,x0+1),y1=Math.min(sh-1,y0+1),fx=sx-x0,fy=sy-y0,k=(y*w+x)*4;
  for(let j=0;j<3;j++)data[k+j]=source[(y0*sw+x0)*4+j]*(1-fx)*(1-fy)+source[(y0*sw+x1)*4+j]*fx*(1-fy)+source[(y1*sw+x0)*4+j]*(1-fx)*fy+source[(y1*sw+x1)*4+j]*fx*fy;data[k+3]=255}
 if(it.clean!==false)autoClean(data,w,h);
 if(it.b!==0||it.c!==100)for(let i=0;i<data.length;i+=4)for(let j=0;j<3;j++)data[i+j]=(data[i+j]-128)*it.c/100+128+it.b;
 ctx.putImageData(result,0,0);return out;
}

// Auto-clean: flatten uneven screen lighting and colour cast so the slide background
// becomes white and text/lines become crisp. Estimates the local background per
// channel (block 92nd percentile -> dilate -> blur), divides it out, then sets a
// black/white point. Large dark pictures are protected by a floor on the estimate.
function autoClean(d,w,h){
 const B=Math.max(8,Math.round(Math.max(w,h)/48)),gw=Math.ceil(w/B),gh=Math.ceil(h/B),N=gw*gh;
 const bg=[0,1,2].map(()=>new Float32Array(N));
 for(let gy=0;gy<gh;gy++)for(let gx=0;gx<gw;gx++){const vals=[[],[],[]];
  for(let y=gy*B;y<Math.min(h,(gy+1)*B);y+=2)for(let x=gx*B;x<Math.min(w,(gx+1)*B);x+=2){const k=4*(y*w+x);for(let j=0;j<3;j++)vals[j].push(d[k+j])}
  for(let j=0;j<3;j++){const v=vals[j].sort((a,b)=>a-b);bg[j][gy*gw+gx]=v[Math.floor(v.length*.92)]||255}}
 const filt=(a,r,op)=>{const o=new Float32Array(N);for(let y=0;y<gh;y++)for(let x=0;x<gw;x++){let m=0,c=0;for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=gw||yy>=gh)continue;const v=a[yy*gw+xx];if(op==='max')m=Math.max(m,v);else{m+=v;c++}}o[y*gw+x]=op==='max'?m:m/c}return o};
 for(let j=0;j<3;j++){const s=[...bg[j]].sort((a,b)=>a-b),white=s[Math.floor(N*.85)],floor=white*.6;const a=filt(bg[j],2,'max');for(let i=0;i<N;i++)a[i]=Math.max(floor,a[i]);bg[j]=filt(filt(filt(a,2,'mean'),2,'mean'),2,'mean')}
 const at=(a,x,y)=>{const fx=Math.max(0,Math.min(gw-1,x/B-.5)),fy=Math.max(0,Math.min(gh-1,y/B-.5)),x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(gw-1,x0+1),y1=Math.min(gh-1,y0+1),tx=fx-x0,ty=fy-y0;return a[y0*gw+x0]*(1-tx)*(1-ty)+a[y0*gw+x1]*tx*(1-ty)+a[y1*gw+x0]*(1-tx)*ty+a[y1*gw+x1]*tx*ty};
 const hist=new Uint32Array(256);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=4*(y*w+x);let l=0;for(let j=0;j<3;j++){const v=Math.min(255,d[k+j]/Math.max(1,at(bg[j],x,y))*250);d[k+j]=v;l+=v}hist[Math.round(l/3)]++}
 let acc=0,bp=0;for(;bp<255;bp++){acc+=hist[bp];if(acc>w*h*.005)break}bp=Math.min(bp,90);
 const lut=new Uint8ClampedArray(256);for(let v=0;v<256;v++){const t=Math.max(0,(v-bp)/(232-bp));lut[v]=255*Math.pow(Math.min(1,t),1.15)}
 for(let i=0;i<d.length;i+=4){const r=lut[d[i]],g=lut[d[i+1]],b=lut[d[i+2]],mx=Math.max(r,g,b),mn=Math.min(r,g,b);
  if(mn>200&&mx-mn<40){const m=(r+g+b)/3,k=(mn-200)/55;d[i]=r+(m-r)*k;d[i+1]=g+(m-g)*k;d[i+2]=b+(m-b)*k}else{d[i]=r;d[i+1]=g;d[i+2]=b}}
}

// Minimal binary PDF writer: embeds each processed JPEG, no server upload.
async function makePDF(pages){const encoder=new TextEncoder(),parts=[],offsets=[0];let size=0;const put=s=>{const d=typeof s==='string'?encoder.encode(s):s;parts.push(d);size+=d.length},obj=(id,s)=>{offsets[id]=size;put(`${id} 0 obj\n${s}\nendobj\n`)};put('%PDF-1.4\n');obj(1,'<< /Type /Catalog /Pages 2 0 R >>');obj(2,`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] >>`);for(let i=0;i<pages.length;i++){const {bytes,w,h}=pages[i],id=3+i*3,pw=842,ph=595,scale=Math.min(pw/w,ph/h),dw=w*scale,dh=h*scale,stream=`q ${dw.toFixed(3)} 0 0 ${dh.toFixed(3)} ${((pw-dw)/2).toFixed(3)} ${((ph-dh)/2).toFixed(3)} cm /Im0 Do Q`;obj(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`);offsets[id+1]=size;put(`${id+1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`);put(bytes);put('\nendstream\nendobj\n');obj(id+2,`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`)}const start=size;put(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);for(let i=1;i<offsets.length;i++)put(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);put(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`);return new Blob(parts,{type:'application/pdf'})}

let readyURL=null,readyFile=null;
$('share').onclick=async()=>{if(!readyFile)return;try{if(navigator.canShare?.({files:[readyFile]}))await navigator.share({files:[readyFile],title:'สมุดสไลด์'});else window.open(readyURL,'_blank','noopener')}catch(e){if(e.name!=='AbortError')status('แชร์ไม่สำเร็จ กรุณาใช้ปุ่มบันทึก PDF หรือเปิด PDF')}};
$('export').onclick=async()=>{
 if(busy||!items.length)return;busy=true;$('export').disabled=true;$('upload').inert=true;$('list').inert=true;document.querySelector('article').inert=true;
 const snapshot=items.slice(),pages=[];$('downloadPanel').hidden=true;
 try{
  for(let i=0;i<snapshot.length;i++){
   status(`กำลังสร้าง PDF หน้า ${i+1} / ${snapshot.length} · กรุณาเปิดหน้านี้ไว้`);await new Promise(r=>setTimeout(r,30));
   const it=snapshot[i],src=await canvasFor(it,false);let out;
   try{out=process(it,src)}catch(e){await select(it);throw Error(`หน้า ${i+1}: ${e.message}`)}
   finally{if(src!==cache.can)src.width=src.height=1}
   const w=out.width,h=out.height,blob=await canvasToBlob(out,.88).catch(()=>null);out.width=out.height=1;
   if(!blob)throw Error(`สร้างภาพหน้า ${i+1} ไม่สำเร็จ กรุณาแบ่งรูปเป็นชุดเล็กลง`);
   pages.push({bytes:new Uint8Array(await blob.arrayBuffer()),w,h});
  }
  if(pages.length!==snapshot.length)throw Error('จำนวนหน้าไม่ตรง กรุณาสร้างใหม่');
  const pdf=await makePDF(pages);if(readyURL)URL.revokeObjectURL(readyURL);readyURL=URL.createObjectURL(pdf);
  const d=new Date(),z=n=>String(n).padStart(2,'0'),filename=`PictoPDF-${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}-${snapshot.length}p.pdf`;
  readyFile=new File([pdf],filename,{type:'application/pdf'});
  $('savePDF').href=readyURL;$('savePDF').download=filename;$('openPDF').href=readyURL;
  $('downloadInfo').textContent=`พร้อมบันทึก ${snapshot.length} หน้า · ${(pdf.size/1048576).toFixed(1)} MB`;
  $('share').hidden=!navigator.canShare?.({files:[readyFile]});$('downloadPanel').hidden=false;$('downloadPanel').scrollIntoView({behavior:'smooth',block:'center'});
  status('สร้างไฟล์ครบแล้ว กรุณากด “บันทึก PDF” ด้านล่าง · บน iPhone ใช้ปุ่มแชร์ → บันทึกไปยัง Files');
 }catch(e){status(e.message||'สร้างไฟล์ไม่สำเร็จ กรุณาลองลดจำนวนรูป')}
 finally{busy=false;$('export').disabled=false;$('upload').inert=false;$('list').inert=false;document.querySelector('article').inert=false}
};
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(()=>{});
