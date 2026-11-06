// Screen finder v3: the lit screen is the largest bright region near the
// image centre, separated from the room by a darker bezel/wall. We
//  1) blur + Otsu-threshold luminance,
//  2) take the bright connected component that best covers the centre,
//  3) take its convex hull (fills dark pictures/text inside the slide and
//     bridges occluding objects such as a head or hand),
//  4) pick the 4 hull points enclosing the largest quadrilateral,
//  5) refine each side by fitting a line to the hull boundary near it.
// Sides that run along the photo edge (screen cut off) stay on the photo edge.
(function(root){
function findScreen(data,w,h){
 const N=w*h,full=()=>[{x:0,y:0},{x:w-1,y:0},{x:w-1,y:h-1},{x:0,y:h-1}];
 // luminance + 3x3 box blur (unblurred copy kept so thin bezels still block growth)
 let g=new Float32Array(N);for(let i=0;i<N;i++)g[i]=.299*data[4*i]+.587*data[4*i+1]+.114*data[4*i+2];
 const blur=(src,r)=>{const t=new Float32Array(N),o=new Float32Array(N);
  for(let y=0;y<h;y++){let s=0,c=0;for(let x=-r;x<w+r;x++){if(x+r<w&&x+r>=0){s+=src[y*w+x+r];c++}if(x-r-1>=0){s-=src[y*w+x-r-1];c--}if(x>=0&&x<w)t[y*w+x]=s/c}}
  for(let x=0;x<w;x++){let s=0,c=0;for(let y=-r;y<h+r;y++){if(y+r<h&&y+r>=0){s+=t[(y+r)*w+x];c++}if(y-r-1>=0){s-=t[(y-r-1)*w+x];c--}if(y>=0&&y<h)o[y*w+x]=s/c}}return o};
 const g0=g;g=blur(g,1);
 // Otsu threshold
 const hist=new Array(256).fill(0);for(let i=0;i<N;i++)hist[Math.min(255,g[i]|0)]++;
 let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let sb=0,wb=0,best=0,thr=128;
 for(let t=0;t<256;t++){wb+=hist[t];if(!wb)continue;const wf=N-wb;if(!wf)break;sb+=t*hist[t];const mb=sb/wb,mf=(sum-sb)/wf,v=wb*wf*(mb-mf)*(mb-mf);if(v>best){best=v;thr=t}}
 const tryThreshold=th=>{
  const mask=new Uint8Array(N);for(let i=0;i<N;i++)mask[i]=g[i]>th?1:0;
  // connected components (4-neighbour)
  const lab=new Int32Array(N),stack=new Int32Array(N),comps=[];let id=0;
  for(let s=0;s<N;s++){if(!mask[s]||lab[s])continue;id++;let sp=0,area=0,cx=0,cy=0;stack[sp++]=s;lab[s]=id;
   while(sp){const p=stack[--sp],x=p%w,y=(p-x)/w;area++;cx+=x;cy+=y;
    if(x>0&&mask[p-1]&&!lab[p-1]){lab[p-1]=id;stack[sp++]=p-1}if(x<w-1&&mask[p+1]&&!lab[p+1]){lab[p+1]=id;stack[sp++]=p+1}
    if(y>0&&mask[p-w]&&!lab[p-w]){lab[p-w]=id;stack[sp++]=p-w}if(y<h-1&&mask[p+w]&&!lab[p+w]){lab[p+w]=id;stack[sp++]=p+w}}
   comps.push({id,area,cx:cx/area,cy:cy/area})}
  // score: big and close to the centre
  let pick=null,ps=-1;for(const c of comps){if(c.area<N*.08)continue;const d=Math.hypot((c.cx-w/2)/w,(c.cy-h/2)/h),s=c.area*(1-Math.min(.9,d*1.6));if(s>ps){ps=s;pick=c}}
  if(!pick)return null;
  // hysteresis: grow the picked region into dimmer (but not dark-bezel) pixels,
  // so lighting gradients across the screen do not cut the slide in half
  let dm=0,dc=0;for(let t=0;t<=th;t++){dm+=t*hist[t];dc+=hist[t]}dm=dc?dm/dc:0;const low=dm+(th-dm)*.2;
  {let sp=0;for(let i=0;i<N;i++)if(lab[i]===pick.id)stack[sp++]=i;
   while(sp){const p=stack[--sp],x=p%w;for(const q of [x>0?p-1:-1,x<w-1?p+1:-1,p-w,p+w]){if(q<0||q>=N||lab[q]===pick.id||g0[q]<=low||g[q]<=low)continue;lab[q]=pick.id;stack[sp++]=q}}}
  // boundary points: leftmost/rightmost per row, top/bottom per column
  const pts=[];for(let y=0;y<h;y++){let a=-1,b=-1;for(let x=0;x<w;x++)if(lab[y*w+x]===pick.id){if(a<0)a=x;b=x}if(a>=0)pts.push({x:a,y},{x:b,y})}
  for(let x=0;x<w;x++){let a=-1,b=-1;for(let y=0;y<h;y++)if(lab[y*w+x]===pick.id){if(a<0)a=y;b=y}if(a>=0)pts.push({x,y:a},{x,y:b})}
  return{pts,area:pick.area}};
 let comp=tryThreshold(thr);
 if(!comp)comp=tryThreshold(thr*.8);
 if(!comp)return{points:full(),confidence:'low',found:0};
 // convex hull (monotone chain)
 const P=comp.pts.sort((a,b)=>a.x-b.x||a.y-b.y),cr=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x),lo=[],up=[];
 for(const p of P){while(lo.length>1&&cr(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p)}
 for(let i=P.length-1;i>=0;i--){const p=P[i];while(up.length>1&&cr(up[up.length-2],up[up.length-1],p)<=0)up.pop();up.push(p)}
 let hull=lo.slice(0,-1).concat(up.slice(0,-1));
 // thin the hull to <=48 points (drop near-duplicates)
 while(hull.length>48){let mi=0,md=Infinity;for(let i=0;i<hull.length;i++){const a=hull[(i-1+hull.length)%hull.length],b=hull[i],c=hull[(i+1)%hull.length],ar=Math.abs(cr(a,b,c));if(ar<md){md=ar;mi=i}}hull.splice(mi,1)}
 const n=hull.length;if(n<4)return{points:full(),confidence:'low',found:0};
 const qa=(a,b,c,d)=>Math.abs(cr(a,b,c))/2+Math.abs(cr(a,c,d))/2;
 let bq=null,ba=0;for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)for(let k=j+1;k<n;k++)for(let l=k+1;l<n;l++){const A=qa(hull[i],hull[j],hull[k],hull[l]);if(A>ba){ba=A;bq=[hull[i],hull[j],hull[k],hull[l]]}}
 // order corners TL,TR,BR,BL
 const cx=bq.reduce((s,p)=>s+p.x,0)/4,cy=bq.reduce((s,p)=>s+p.y,0)/4;
 bq.sort((a,b)=>Math.atan2(a.y-cy,a.x-cx)-Math.atan2(b.y-cy,b.x-cx)); // clockwise from left in screen coords
 let s0=0;for(let i=1;i<4;i++)if(bq[i].x+bq[i].y<bq[s0].x+bq[s0].y)s0=i;
 let q=[0,1,2,3].map(i=>bq[(s0+i)%4]);
 // refine sides: least-squares line through hull boundary points near each side, then intersect
 const fit=(pts)=>{let mx=0,my=0;pts.forEach(p=>{mx+=p.x;my+=p.y});mx/=pts.length;my/=pts.length;let sxx=0,sxy=0,syy=0;pts.forEach(p=>{const dx=p.x-mx,dy=p.y-my;sxx+=dx*dx;sxy+=dx*dy;syy+=dy*dy});const th=.5*Math.atan2(2*sxy,sxx-syy);return{px:mx,py:my,dx:Math.cos(th),dy:Math.sin(th)}};
 const lines=[];for(let i=0;i<4;i++){const a=q[i],b=q[(i+1)%4];let line={px:a.x,py:a.y,dx:b.x-a.x,dy:b.y-a.y};const L=Math.hypot(line.dx,line.dy);line.dx/=L;line.dy/=L;let ok=true;
  for(const tol of [.06,.025,.012]){const nx=-line.dy,ny=line.dx;
   const near=comp.pts.filter(p=>{const t=((p.x-a.x)*(b.x-a.x)+(p.y-a.y)*(b.y-a.y))/(L*L);return t>.12&&t<.88&&Math.abs((p.x-line.px)*nx+(p.y-line.py)*ny)<Math.max(2.5,L*tol)});
   if(near.length<8){ok=false;break}line=fit(near)}
  lines.push(ok?line:null)}
 const inter=(l1,l2)=>{const d=l1.dx*l2.dy-l1.dy*l2.dx;if(Math.abs(d)<1e-6)return null;const t=((l2.px-l1.px)*l2.dy-(l2.py-l1.py)*l2.dx)/d;return{x:l1.px+t*l1.dx,y:l1.py+t*l1.dy}};
 const refined=q.map((p,i)=>{const L1=lines[(i+3)%4],L2=lines[i];if(!L1||!L2)return p;const r=inter(L1,L2);return r&&Math.hypot(r.x-p.x,r.y-p.y)<Math.max(w,h)*.08?r:p});
 // the quad must not shrink below the region; keep a 1px outward safety margin and clamp
 const mcx=refined.reduce((s,p)=>s+p.x,0)/4,mcy=refined.reduce((s,p)=>s+p.y,0)/4;
 const points=refined.map(p=>{const dx=p.x-mcx,dy=p.y-mcy,d=Math.hypot(dx,dy)||1;return{x:Math.max(0,Math.min(w-1,p.x+dx/d*1.5)),y:Math.max(0,Math.min(h-1,p.y+dy/d*1.5))}});
 let area=0;for(let i=0;i<4;i++){const p=points[i],o=points[(i+1)%4];area+=p.x*o.y-o.x*p.y}area=Math.abs(area)/2;
 if(area<N*.12)return{points:full(),confidence:'low',found:0};
 // count sides that are real edges (not lying on the photo border)
 const onBorder=(a,b)=>(a.x<3&&b.x<3)||(a.y<3&&b.y<3)||(a.x>w-4&&b.x>w-4)||(a.y>h-4&&b.y>h-4);
 let found=0;for(let i=0;i<4;i++)if(!onBorder(points[i],points[(i+1)%4]))found++;
 return{points,confidence:found===4?'high':found>=2?'partial':'low',found};
}
root.findScreen=findScreen;if(typeof module!=='undefined')module.exports={findScreen};
})(typeof window!=='undefined'?window:globalThis);
