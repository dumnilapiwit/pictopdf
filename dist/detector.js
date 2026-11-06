// Screen finder v4.
// The slide is a bright region whose border is a straight, consistent
// bright-inside / darker-outside edge. Rooms add other bright things (white
// tables, projector fabric, LED walls), so we:
//  1) blur + Otsu luminance threshold, and also several higher thresholds;
//  2) for each, take the bright connected component near the centre and grow it
//     into dimmer screen pixels (hysteresis) for uneven lighting;
//  3) build two candidate quads per region:
//     - "hull": largest quad on the convex hull, sides refined by line fits
//       (robust to dark pictures inside the slide and occluding heads/hands);
//     - "sides": RANSAC line per side, corner where the straight run ends
//       (cuts off a table or fabric merged into the region);
//     - "lines": strongest straight edge lines (Hough), every combination
//       (finds a slide panel inside an LED wall; used only if clearly better);
//  4) score each candidate by edge evidence along its sides and keep the best.
// Sides on the photo border (screen cut off) are kept on the border.
(function(root){
// core: run the whole search on one brightness-like channel g0; returns best candidate
function core(g0,w,h){
 const N=w*h;
 // 3x3 box blur (unblurred copy kept so thin bezels still block growth)
 const blur=(src,r)=>{const t=new Float32Array(N),o=new Float32Array(N);
  for(let y=0;y<h;y++){let s=0,c=0;for(let x=-r;x<w+r;x++){if(x+r<w&&x+r>=0){s+=src[y*w+x+r];c++}if(x-r-1>=0){s-=src[y*w+x-r-1];c--}if(x>=0&&x<w)t[y*w+x]=s/c}}
  for(let x=0;x<w;x++){let s=0,c=0;for(let y=-r;y<h+r;y++){if(y+r<h&&y+r>=0){s+=t[(y+r)*w+x];c++}if(y-r-1>=0){s-=t[(y-r-1)*w+x];c--}if(y>=0&&y<h)o[y*w+x]=s/c}}return o};
 const g=blur(g0,1);
 const hist=new Array(256).fill(0);for(let i=0;i<N;i++)hist[Math.min(255,g[i]|0)]++;
 let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let sb=0,wb=0,bv=0,thr=128;
 for(let t=0;t<256;t++){wb+=hist[t];if(!wb)continue;const wf=N-wb;if(!wf)break;sb+=t*hist[t];const mb=sb/wb,mf=(sum-sb)/wf,v=wb*wf*(mb-mf)*(mb-mf);if(v>bv){bv=v;thr=t}}
 const pct=q=>{let a=0;for(let t=0;t<256;t++){a+=hist[t];if(a>=N*q)return t}return 255};

 // ---- bright region at threshold th --------------------------------------
 const lab=new Int32Array(N),stack=new Int32Array(N);
 function region(th){
  lab.fill(0);const comps=[];let id=0;
  for(let s=0;s<N;s++){if(g[s]<=th||lab[s])continue;id++;let sp=0,area=0,cx=0,cy=0;stack[sp++]=s;lab[s]=id;
   while(sp){const p=stack[--sp],x=p%w,y=(p-x)/w;area++;cx+=x;cy+=y;
    if(x>0&&g[p-1]>th&&!lab[p-1]){lab[p-1]=id;stack[sp++]=p-1}if(x<w-1&&g[p+1]>th&&!lab[p+1]){lab[p+1]=id;stack[sp++]=p+1}
    if(y>0&&g[p-w]>th&&!lab[p-w]){lab[p-w]=id;stack[sp++]=p-w}if(y<h-1&&g[p+w]>th&&!lab[p+w]){lab[p+w]=id;stack[sp++]=p+w}}
   comps.push({id,area,cx:cx/area,cy:cy/area})}
  let pick=null,ps=-1;for(const c of comps){if(c.area<N*.06)continue;const d=Math.hypot((c.cx-w/2)/w,(c.cy-h/2)/h),s=c.area*(1-Math.min(.9,d*1.6));if(s>ps){ps=s;pick=c}}
  if(!pick)return null;
  let dm=0,dc=0;for(let t=0;t<=th;t++){dm+=t*hist[t];dc+=hist[t]}dm=dc?dm/dc:0;const lo=dm+(th-dm)*.2;
  {let sp=0;for(let i=0;i<N;i++)if(lab[i]===pick.id)stack[sp++]=i;
   while(sp){const p=stack[--sp],x=p%w;for(const q of [x>0?p-1:-1,x<w-1?p+1:-1,p-w,p+w]){if(q<0||q>=N||lab[q]===pick.id||g0[q]<=lo||g[q]<=lo)continue;lab[q]=pick.id;stack[sp++]=q}}}
  const rowL=new Int32Array(h).fill(-1),rowR=new Int32Array(h).fill(-1),colT=new Int32Array(w).fill(-1),colB=new Int32Array(w).fill(-1);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(lab[y*w+x]===pick.id){if(rowL[y]<0)rowL[y]=x;rowR[y]=x;if(colT[x]<0)colT[x]=y;colB[x]=y}
  const pts=[];for(let y=0;y<h;y++)if(rowL[y]>=0)pts.push({x:rowL[y],y},{x:rowR[y],y});for(let x=0;x<w;x++)if(colT[x]>=0)pts.push({x,y:colT[x]},{x,y:colB[x]});
  return{pts,rowL,rowR,colT,colB};
 }

 // ---- candidate A: convex-hull quad ---------------------------------------
 const cr=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
 const fitLine=pts=>{let mx=0,my=0;pts.forEach(p=>{mx+=p.x;my+=p.y});mx/=pts.length;my/=pts.length;let sxx=0,sxy=0,syy=0;pts.forEach(p=>{const dx=p.x-mx,dy=p.y-my;sxx+=dx*dx;sxy+=dx*dy;syy+=dy*dy});const th=.5*Math.atan2(2*sxy,sxx-syy);return{px:mx,py:my,dx:Math.cos(th),dy:Math.sin(th)}};
 const inter=(l1,l2)=>{const d=l1.dx*l2.dy-l1.dy*l2.dx;if(Math.abs(d)<1e-6)return null;const t=((l2.px-l1.px)*l2.dy-(l2.py-l1.py)*l2.dx)/d;return{x:l1.px+t*l1.dx,y:l1.py+t*l1.dy}};
 function hullQuad(reg){
  const P=reg.pts.slice().sort((a,b)=>a.x-b.x||a.y-b.y),lo=[],up=[];
  for(const p of P){while(lo.length>1&&cr(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p)}
  for(let i=P.length-1;i>=0;i--){const p=P[i];while(up.length>1&&cr(up[up.length-2],up[up.length-1],p)<=0)up.pop();up.push(p)}
  const hull=lo.slice(0,-1).concat(up.slice(0,-1));
  while(hull.length>40){let mi=0,md=Infinity;for(let i=0;i<hull.length;i++){const ar=Math.abs(cr(hull[(i-1+hull.length)%hull.length],hull[i],hull[(i+1)%hull.length]));if(ar<md){md=ar;mi=i}}hull.splice(mi,1)}
  const n=hull.length;if(n<4)return null;
  const qa=(a,b,c,d)=>Math.abs(cr(a,b,c))/2+Math.abs(cr(a,c,d))/2;
  let bq=null,ba=0;for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)for(let k=j+1;k<n;k++)for(let l=k+1;l<n;l++){const A=qa(hull[i],hull[j],hull[k],hull[l]);if(A>ba){ba=A;bq=[hull[i],hull[j],hull[k],hull[l]]}}
  const q=order(bq);
  const lines=[];for(let i=0;i<4;i++){const a=q[i],b=q[(i+1)%4];let line={px:a.x,py:a.y,dx:b.x-a.x,dy:b.y-a.y};const L=Math.hypot(line.dx,line.dy);line.dx/=L;line.dy/=L;let ok=true;
   for(const tol of [.06,.025,.012]){const nx=-line.dy,ny=line.dx;
    const near=reg.pts.filter(p=>{const t=((p.x-a.x)*(b.x-a.x)+(p.y-a.y)*(b.y-a.y))/(L*L);return t>.12&&t<.88&&Math.abs((p.x-line.px)*nx+(p.y-line.py)*ny)<Math.max(2.5,L*tol)});
    if(near.length<8){ok=false;break}line=fitLine(near)}
   lines.push(ok?line:null)}
  return q.map((p,i)=>{const L1=lines[(i+3)%4],L2=lines[i];if(!L1||!L2)return p;const r=inter(L1,L2);return r&&Math.hypot(r.x-p.x,r.y-p.y)<Math.max(w,h)*.08?r:p});
 }
 function order(q){const cx=q.reduce((s,p)=>s+p.x,0)/4,cy=q.reduce((s,p)=>s+p.y,0)/4;q=q.slice().sort((a,b)=>Math.atan2(a.y-cy,a.x-cx)-Math.atan2(b.y-cy,b.x-cx));let s0=0;for(let i=1;i<4;i++)if(q[i].x+q[i].y<q[s0].x+q[s0].y)s0=i;return[0,1,2,3].map(i=>q[(s0+i)%4])}

 // ---- candidate B: straight-side RANSAC quad ------------------------------
 let seed=12345;const rnd=()=>(seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff;
 function ransac(pts,span){
  if(pts.length<20)return null;const tol=Math.max(1.5,Math.max(w,h)*.006);let best=null;
  for(let it=0;it<250;it++){const p=pts[(rnd()*pts.length)|0],q=pts[(rnd()*pts.length)|0];if(Math.abs(p.t-q.t)<span*.15)continue;
   const a=(q.v-p.v)/(q.t-p.t),b=p.v-a*p.t;if(Math.abs(a)>.6)continue;let n=0;for(const r of pts)if(Math.abs(r.v-(a*r.t+b))<=tol)n++;if(!best||n>best.n)best={a,b,n}}
  if(!best)return null;
  let inl=pts.filter(r=>Math.abs(r.v-(best.a*r.t+best.b))<=tol);let st=0,sv=0,stt=0,stv=0;for(const r of inl){st+=r.t;sv+=r.v;stt+=r.t*r.t;stv+=r.t*r.v}
  const m=inl.length,den=m*stt-st*st;if(den>1e-6){best.a=(m*stv-st*sv)/den;best.b=(sv-best.a*st)/m}
  inl=pts.filter(r=>Math.abs(r.v-(best.a*r.t+best.b))<=tol*1.3).map(r=>r.t).sort((x,y)=>x-y);
  let bs=0,be=-1,s=0;const gap=span*.06;for(let i=1;i<=inl.length;i++){if(i===inl.length||inl[i]-inl[i-1]>gap){if(i-1-s>be-bs){bs=s;be=i-1}s=i}}
  if(be<0)return null;const t0=inl[bs],t1=inl[be],count=be-bs+1;
  if(t1-t0<span*.25||count<(t1-t0)*.45)return null;
  return{a:best.a,b:best.b,t0,t1};
 }
 function sidesQuad(reg){
  const L=[],R=[],T=[],B=[];let nL=0,nR=0,nT=0,nB=0;
  for(let y=0;y<h;y++){if(reg.rowL[y]<0)continue;nL++;nR++;if(reg.rowL[y]>1)L.push({t:y,v:reg.rowL[y]});if(reg.rowR[y]<w-2)R.push({t:y,v:reg.rowR[y]})}
  for(let x=0;x<w;x++){if(reg.colT[x]<0)continue;nT++;nB++;if(reg.colT[x]>1)T.push({t:x,v:reg.colT[x]});if(reg.colB[x]<h-2)B.push({t:x,v:reg.colB[x]})}
  const cut=(k,n)=>n>0&&k<n*.6;
  const sl=cut(L.length,nL)?null:ransac(L,h),sr=cut(R.length,nR)?null:ransac(R,h),st=cut(T.length,nT)?null:ransac(T,w),sb=cut(B.length,nB)?null:ransac(B,w);
  const meet=(v,hz)=>{const y=(hz.a*v.b+hz.b)/(1-hz.a*v.a);return{x:v.a*y+v.b,y}};
  const corner=(v,hz,vs,hs,dx,dy)=>v&&hz?meet(v,hz):v?{x:v.a*(vs?v.t0:v.t1)+v.b,y:vs?v.t0:v.t1}:hz?{x:hs?hz.t0:hz.t1,y:hz.a*(hs?hz.t0:hz.t1)+hz.b}:{x:dx,y:dy};
  const q=[corner(sl,st,1,1,0,0),corner(sr,st,1,0,w-1,0),corner(sr,sb,0,0,w-1,h-1),corner(sl,sb,0,1,0,h-1)];
  q.forEach(p=>{if(p.x<8)p.x=0;if(p.y<8)p.y=0;if(p.x>w-9)p.x=w-1;if(p.y>h-9)p.y=h-1});
  return [st,sr,sb,sl].filter(Boolean).length>=2?q:null;
 }

 // ---- scoring by edge evidence --------------------------------------------
 const gs=(x,y)=>{x=Math.round(x);y=Math.round(y);return x<0||y<0||x>=w||y>=h?null:g[y*w+x]};
 const onBorder=(a,b)=>(a.x<3&&b.x<3)||(a.y<3&&b.y<3)||(a.x>w-4&&b.x>w-4)||(a.y>h-4&&b.y>h-4);
 function score(q){
  let area=0,sign=0;for(let i=0;i<4;i++){const a=q[i],b=q[(i+1)%4],c=q[(i+2)%4],k=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);if(sign&&Math.sign(k)!==sign)return null;sign=Math.sign(k);area+=a.x*b.y-b.x*a.y}
  area=Math.abs(area)/2;if(area<N*.1)return null;
  const cx=q.reduce((s,p)=>s+p.x,0)/4,cy=q.reduce((s,p)=>s+p.y,0)/4;let real=0,tot=0,weak=0;
  for(let i=0;i<4;i++){const a=q[i],b=q[(i+1)%4];if(onBorder(a,b))continue;const L=Math.hypot(b.x-a.x,b.y-a.y);let nx=-(b.y-a.y)/L,ny=(b.x-a.x)/L;if((a.x-cx)*nx+(a.y-cy)*ny<0){nx=-nx;ny=-ny}
   let n=0,good=0,acc=0;for(let t=.06;t<=.94;t+=2/L){const x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t,vi=gs(x-nx*3,y-ny*3),vo=gs(x+nx*3,y+ny*3);if(vi===null||vo===null)continue;n++;const d=vi-vo;acc+=Math.max(-30,Math.min(50,d));if(d>10)good++}
   if(n<10)continue;real++;const ss=(acc/n)*(good/n);tot+=ss;if(ss<3)weak++}
  if(real<2)return null;
  return{s:tot/real*Math.pow(area/N,.3)*(1+.08*real)*Math.pow(.3,weak),real};
 }

 let best=null;const tried=new Set();
 for(const th0 of [thr,thr*1.12,thr*1.25,pct(.7),pct(.82),pct(.9)]){const th=Math.min(245,Math.round(th0));if(tried.has(th))continue;tried.add(th);
  const reg=region(th);if(!reg)continue;
  for(const [m,q] of [['hull',hullQuad(reg)],['sides',sidesQuad(reg)]]){if(!q)continue;
   const pts=q.map(p=>({x:Math.max(0,Math.min(w-1,p.x)),y:Math.max(0,Math.min(h-1,p.y))}));const sc=score(pts);
   if(sc&&(!best||sc.s>best.s))best={...sc,pts,m,th}}}
 const regionBest=best;best=null;
 // ---- candidate C: straight lines (Hough) -----------------------------------
 // Like a document scanner: find the strongest near-vertical and near-horizontal
 // edge lines, try every left/right/top/bottom combination and keep the quad with
 // the best edge evidence. Finds a slide panel even when it touches other
 // bright areas, as long as its border is a crisp straight edge.
 {
  const gx=new Float32Array(N),gy=new Float32Array(N);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;
   gx[i]=(g[i-w+1]+2*g[i+1]+g[i+w+1])-(g[i-w-1]+2*g[i-1]+g[i+w-1]);gy[i]=(g[i+w-1]+2*g[i+w]+g[i+w+1])-(g[i-w-1]+2*g[i-w]+g[i-w+1])}
  const SL=[];for(let a=-.35;a<=.351;a+=.025)SL.push(a);
  function hough(vertical){
   const len=vertical?h:w,dep=vertical?w:h,off=Math.round(dep*.15),nb=dep+2*off,acc=new Float32Array(SL.length*nb);
   for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x,ax=Math.abs(gx[i]),ay=Math.abs(gy[i]),m=vertical?ax:ay;if(m<60||m<(vertical?ay:ax)*1.5)continue;
    const t=vertical?y-len/2:x-len/2,v=vertical?x:y;for(let s=0;s<SL.length;s++){const b=Math.round(v-SL[s]*t)+off;if(b>=0&&b<nb)acc[s*nb+b]+=Math.min(m,400)}}
   const peaks=[];const used=new Uint8Array(acc.length);
   for(let k=0;k<10;k++){let bi=-1,bv=0;for(let i=0;i<acc.length;i++)if(!used[i]&&acc[i]>bv){bv=acc[i];bi=i}if(bi<0||bv<len*60*.25)break;
    const s=(bi/nb)|0,b=bi%nb-off;peaks.push({a:SL[s],b:b-SL[s]*len/2});
    for(let s2=0;s2<SL.length;s2++)for(let d=-8;d<=8;d++){const bb=bi%nb+d+Math.round((SL[s]-SL[s2])*0);if(bb>=0&&bb<nb&&Math.abs(s2-s)<=5)used[s2*nb+bb]=1}}
   peaks.push({a:0,b:0,border:1},{a:0,b:dep-1,border:1});return peaks}
  const V=hough(true),H=hough(false),mid=(l,len)=>l.a*len/2+l.b;
  const meet=(v,hz)=>{const y=(hz.a*v.b+hz.b)/(1-hz.a*v.a);return{x:v.a*y+v.b,y}};
  for(const L of V)for(const R of V){if(mid(R,h)-mid(L,h)<w*.3)continue;
   for(const T of H)for(const B of H){if(mid(B,w)-mid(T,w)<h*.3)continue;
    const q=[meet(L,T),meet(R,T),meet(R,B),meet(L,B)];if(q.some(p=>p.x<-6||p.y<-6||p.x>w+5||p.y>h+5))continue;
    const pts=q.map(p=>({x:Math.max(0,Math.min(w-1,p.x)),y:Math.max(0,Math.min(h-1,p.y))}));const sc=score(pts);
    if(sc&&(!best||sc.s>best.s))best={...sc,pts,m:'lines'}}}
 }
 // region quads hug the real screen border more reliably; lines must win clearly
 if(regionBest&&(!best||best.s<regionBest.s*1.3))best=regionBest;
 return best;
}
function findScreen(data,w,h){
 const N=w*h,full=()=>[{x:0,y:0},{x:w-1,y:0},{x:w-1,y:h-1},{x:0,y:h-1}];
 const lum=new Float32Array(N);for(let i=0;i<N;i++)lum[i]=.299*data[4*i]+.587*data[4*i+1]+.114*data[4*i+2];
 // Pass 1: bright slide on a darker surround (projector, most screens).
 // Pass 2: inverted, i.e. a dark TV body/bezel on a lighter wall. This frames
 // the whole TV, which works even when the slide itself has a black background.
 const A=core(lum,w,h),inv=new Float32Array(N);for(let i=0;i<N;i++)inv[i]=255-lum[i];
 const B=core(inv,w,h);
 const best=B&&(!A||B.s>A.s*1.3)?{...B,m:B.m+'/tv'}:A;
 if(!best||best.s<1.5)return{points:full(),confidence:'low',found:0};
 const onBorder=(a,b)=>(a.x<3&&b.x<3)||(a.y<3&&b.y<3)||(a.x>w-4&&b.x>w-4)||(a.y>h-4&&b.y>h-4);
 let found=0;for(let i=0;i<4;i++)if(!onBorder(best.pts[i],best.pts[(i+1)%4]))found++;
 return{points:best.pts,confidence:found===4?'high':found>=2?'partial':'low',found,method:best.m};
}
root.findScreen=findScreen;if(typeof module!=='undefined')module.exports={findScreen};
})(typeof window!=='undefined'?window:globalThis);
