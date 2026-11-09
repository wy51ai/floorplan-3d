/* Shared project data and deterministic checks. No DOM or network dependencies. */
(function (root) {
  'use strict';
  const FM = typeof module !== 'undefined' && module.exports ? require('./furniture-model.js') : root.FurnitureModel;
  const clone = x => JSON.parse(JSON.stringify(x));
  const uid = prefix => prefix + '-' + (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
  const KINDS = {
    power: {label:'电源',color:'#bd572f',symbol:'电'}, control:{label:'开关 / 控制',color:'#9b6ab0',symbol:'控'},
    light:{label:'灯位',color:'#ac831d',symbol:'灯'}, network:{label:'网络',color:'#246b9a',symbol:'网'},
    water:{label:'给水',color:'#25847a',symbol:'水'}, drain:{label:'排水',color:'#53677e',symbol:'排'}, sensor:{label:'传感器',color:'#637b35',symbol:'感'}
  };
  const PRESETS = {
    curtain:{label:'电动窗帘',needs:['power']}, robot:{label:'上下水扫地机',needs:['power','water','drain']},
    desk:{label:'书桌工作位',needs:['power','network']}, fridge:{label:'冰箱',needs:['power']},
    camera:{label:'摄像头（独立供电）',needs:['power']}, ap:{label:'吸顶 AP（PoE）',needs:['network']},
    smartlight:{label:'智能灯',needs:['light','control']}, custom:{label:'自定义设备',needs:[]}
  };
  const finite = (x,min=-100000,max=100000) => typeof x === 'number' && Number.isFinite(x) && x>=min && x<=max;
  const assert = (ok,msg) => { if(!ok) throw new Error(msg); };
  function polygonOK(poly) {
    if(!Array.isArray(poly)||poly.length<3||poly.length>200||!poly.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>finite(v)))) return false;
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const on=(a,b,p)=>Math.abs(cross(a,b,p))<1e-8&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);
    let area=0;
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length]; if(a[0]===b[0]&&a[1]===b[1])return false;
      area+=a[0]*b[1]-b[0]*a[1];
      for(let j=i+1;j<poly.length;j++){
        if(j===i+1||(i===0&&j===poly.length-1))continue;
        const c=poly[j],d=poly[(j+1)%poly.length];
        if((cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))return false;
      }
    }
    return Math.abs(area)>1;
  }
  // Locks follow actual polygon segments, including inset corners, rather than the bbox.
  function sharedRoomEdges(room, rooms, tolerance=240){
    const poly=room.poly;
    const signed=poly.reduce((s,a,i)=>{const b=poly[(i+1)%poly.length];return s+a[0]*b[1]-b[0]*a[1];},0);
    return poly.map((a,i)=>{
      const b=poly[(i+1)%poly.length], axis=a[0]===b[0]?0:a[1]===b[1]?1:null;
      if(axis===null)return false;
      const along=1-axis, len=Math.abs(b[along]-a[along]);
      const outward=(axis===0?b[1]-a[1]:a[0]-b[0])*Math.sign(signed);
      return rooms.some(other=>other.id!==room.id&&other.poly.some((c,j)=>{
        const d=other.poly[(j+1)%other.poly.length];
        if(c[axis]!==d[axis])return false;
        const gap=c[axis]-a[axis], overlap=Math.min(Math.max(a[along],b[along]),Math.max(c[along],d[along]))-Math.max(Math.min(a[along],b[along]),Math.min(c[along],d[along]));
        return gap*outward>=0 && Math.abs(gap)<=tolerance && overlap>=Math.min(400,len*.5,Math.abs(d[along]-c[along])*.5) && overlap>0;
      }));
    });
  }
  function moveRoomBoundary(poly, kind, index, dx, dy, locked=[]){
    if(!['edge','vertex'].includes(kind)||!Number.isInteger(index)||index<0||index>=poly.length)return null;
    const n=poly.length, prev=(index+n-1)%n, next=(index+1)%n;
    const axis=i=>poly[i][0]===poly[(i+1)%n][0]?0:poly[i][1]===poly[(i+1)%n][1]?1:null;
    const shift=(coord,delta)=>{
      const out=poly.map(p=>p.slice());
      if(kind==='edge'){
        if(axis(index)!==null&&axis(index)!==coord)return out;
        out[index][coord]+=delta;out[next][coord]+=delta;
      }else{
        out[index][coord]+=delta;
        // Keep each orthogonal neighbor on the same line as the dragged corner.
        if(axis(prev)===coord)out[prev][coord]+=delta;
        if(axis(index)===coord)out[next][coord]+=delta;
      }
      return out;
    };
    const shifts=[dx,dy].map((delta,coord)=>{
      const candidate=shift(coord,Math.round(delta/10)*10);
      const crossesLock=locked.some((lock,i)=>lock&&(axis(i)===coord||axis(i)===null)&&
        (candidate[i][coord]!==poly[i][coord]||candidate[(i+1)%n][coord]!==poly[(i+1)%n][coord]));
      return crossesLock?poly:candidate;
    });
    const out=poly.map((p,i)=>[shifts[0][i][0],shifts[1][i][1]]);
    // Reject collapsed/reversed edges and intersections; retain the last valid shape.
    for(let i=0;i<n;i++){
      const j=(i+1)%n, a=poly[i], b=poly[j], c=out[i], d=out[j];
      if(Math.hypot(d[0]-c[0],d[1]-c[1])<10 || (b[0]-a[0])*(d[0]-c[0])+(b[1]-a[1])*(d[1]-c[1])<=0)return null;
    }
    return polygonOK(out)?out:null;
  }
  const SCHEME_KEYS = ['1','2'];
  const SCHEME_KEY_ALIASES = {A:'1', B:'2', '1':'1', '2':'2'};
  function emptyLayoutSchemes(){ return {active:null, '1':null, '2':null}; }
  function captureLayoutScheme(furniture){
    return {savedAt:new Date().toISOString(), furniture:clone(furniture||[])};
  }
  function readSchemeSlot(raw, key){
    const aliases=key==='1'?['1','A']:['2','B'];
    for(const alias of aliases){
      const slot=raw[alias]??raw.slots?.[alias];
      if(slot==null) continue;
      if(typeof slot!=='object'||!Array.isArray(slot.furniture)) continue;
      return {savedAt:typeof slot.savedAt==='string'?slot.savedAt:new Date(0).toISOString(), furniture:clone(slot.furniture)};
    }
    return null;
  }
  function normalizeLayoutSchemes(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw)) return emptyLayoutSchemes();
    const out=emptyLayoutSchemes();
    const activeRaw=raw.active;
    if(activeRaw!=null&&SCHEME_KEY_ALIASES[activeRaw]) out.active=SCHEME_KEY_ALIASES[activeRaw];
    for(const key of SCHEME_KEYS) out[key]=readSchemeSlot(raw, key);
    if(out.active&&!out[out.active]) out.active=null;
    return out;
  }
  function validateFurnitureList(list, label){
    const text=(v,n=4000)=>typeof v==='string'&&v.length<=n;
    const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
    const listOk=(v,n=3000)=>Array.isArray(v)&&v.length<=n;
    const unique=xs=>new Set(xs).size===xs.length;
    if (Array.isArray(list)) for (const f of list) { if(f?.layer!=null)assert(f.layer==='ceiling','布置图层无效');if(f?.ceilingDrop!=null)assert(finite(f.ceilingDrop,0,10000),'顶面距离无效');if(f?.curtainLength!=null)assert(finite(f.curtainLength,100,10000),'窗帘长度无效'); if (f?.model != null) { FM.validate(f.model); assert(finite(f.h,1,50000),'AI 模型需有效高度'); } if(f?.modelEvidence!=null) assert(text(f.modelEvidence,2000),'模型依据过长'); }
    assert(listOk(list)&&list.every(f=>id(f.id)&&text(f.name,120)&&text(f.type,100)&&/^#[a-fA-F0-9]{3,8}$/.test(f.color)&&['cx','cy'].every(k=>finite(f[k]))&&finite(f.w,1,50000)&&finite(f.d,1,50000)&&(f.h==null||finite(f.h,1,50000))&&finite(f.rot,-36000,36000))&&unique(list.map(f=>f.id)),label||'家具尺寸或编号无效');
  }
  function validateLayoutSchemes(schemes){
    assert(schemes&&typeof schemes==='object'&&!Array.isArray(schemes),'装修方案槽格式无效');
    assert(schemes.active===null||schemes.active===undefined||SCHEME_KEYS.includes(schemes.active),'当前方案槽无效');
    for(const key of SCHEME_KEYS){
      const slot=schemes[key];
      if(slot==null) continue;
      assert(slot&&typeof slot==='object'&&!Array.isArray(slot),'装修方案槽格式无效');
      assert(typeof slot.savedAt==='string'&&slot.savedAt.length<=100&&Number.isFinite(Date.parse(slot.savedAt)),'方案保存时间无效');
      validateFurnitureList(slot.furniture,'方案'+key+'家具无效');
    }
    if(schemes.active&&!schemes[schemes.active]) assert(false,'当前方案槽为空');
  }
  function normalize(raw, template) {
    assert(raw && typeof raw==='object' && Array.isArray(raw.furniture),'方案缺少家具数组');
    assert(!raw.schemaVersion||raw.schemaVersion<=2,'此备份版本较新，请使用更新的应用打开');
    const s=clone(raw);     s.schemaVersion=2; s.demolished ||= []; s.measures ||= []; s.rooms ||= {};
    s.measures.forEach((m,i)=>{ if(!m.id) m.id='m'+i+'_'+Date.now().toString(36); });
    s.layoutSchemes=normalizeLayoutSchemes(s.layoutSchemes);
    const arch=clone(template);
    arch.walls.forEach((w,i)=>{w[5] ||= 'w'+i;});
    arch.windows.forEach((w,i)=>{w[4] ||= 'win'+i;});
    arch.slides.forEach((d,i)=>{d.id ||= 'slide'+i;});
    arch.doors.forEach((d,i)=>{d.id ||= 'door'+i; d.height ||= 2100;});
    const defaults={name:'我的装修项目',height:2800,floorFinish:0,wallFinish:0,source:'待实测',verified:false,custom:false,architecture:arch,wallInfo:{},windowInfo:{},devices:[],points:[],issues:[],versions:[],underlay:null,northAngle:0,northMode:'plan'};
    s.project=Object.assign(defaults,s.project||{});
    {const a=Number(s.project.northAngle)||0; const opts=[0,90,180,270]; s.project.northAngle=opts.reduce((b,x)=>Math.min(Math.abs(((a%360)+360)%360-x),360-Math.abs(((a%360)+360)%360-x))<Math.min(Math.abs(((a%360)+360)%360-b),360-Math.abs(((a%360)+360)%360-b))?x:b);}
    s.project.architecture.slides.forEach((d,i)=>{d.id ||= 'slide'+i;});
    s.project.architecture.rooms.forEach(r=>{r.at ||= [r.poly.reduce((v,t)=>v+t[0],0)/r.poly.length,r.poly.reduce((v,t)=>v+t[1],0)/r.poly.length];s.rooms[r.id] ||= {name:r.name,mat:r.mat||'wood'};});
    validate(s); return s;
  }
  function validate(s, depth=0) {
    assert(s.schemaVersion===2,'不支持的项目版本');
    const p=s.project; assert(p && typeof p==='object','缺少项目数据');
    const text=(v,n=4000)=>typeof v==='string'&&v.length<=n;
    const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
    const list=(v,n=3000)=>Array.isArray(v)&&v.length<=n;
    const rect=r=>Array.isArray(r)&&r.slice(0,4).length===4&&r.slice(0,4).every(v=>finite(v))&&r[2]>r[0]&&r[3]>r[1];
    assert(text(p.name,120)&&text(p.source)&&finite(p.height,1800,10000)&&finite(p.floorFinish,0,1000)&&finite(p.wallFinish,0,500)&&p.height-p.floorFinish>=1800,'项目名称、层高或完成面数值无效');
    assert(p.northMode===undefined||['plan','compass'].includes(p.northMode),'北向调整方式无效');
    assert(p.northAngle===undefined||[0,90,180,270].includes(p.northAngle),'北向只支持东南西北四个方向');
    assert(p.pointSerial===undefined||(Number.isSafeInteger(p.pointSerial)&&p.pointSerial>=0&&p.pointSerial<10000000),'点位编号计数无效');
    const a=p.architecture; assert(a&&list(a.walls)&&list(a.windows)&&list(a.doors)&&list(a.slides)&&list(a.rooms,300),'户型数据格式不正确');
    const unique = xs => new Set(xs).size===xs.length;
    assert(a.walls.every(w=>rect(w)&&['b','e','n','low','u'].includes(w[4])&&id(w[5]))&&unique(a.walls.map(w=>w[5])),'墙体坐标、性质或编号无效');
    assert(a.windows.every(w=>rect(w)&&id(w[4]))&&unique(a.windows.map(w=>w[4])),'窗户尺寸或编号无效');
    const vec=v=>Array.isArray(v)&&v.length===2&&v.every(x=>finite(x,-1,1))&&Math.abs(v[0])+Math.abs(v[1])===1;
    assert(a.doors.every(d=>id(d.id)&&text(d.name,120)&&rect(d.rect)&&Array.isArray(d.h)&&d.h.length===2&&d.h.every(v=>finite(v))&&vec(d.c)&&vec(d.o)&&d.c[0]*d.o[0]+d.c[1]*d.o[1]===0&&finite(d.len,100,6000)&&finite(d.height,100,10000))&&unique(a.doors.map(d=>d.id)),'门的尺寸或方向无效');
    assert(a.slides.every(d=>rect(d.rect)&&typeof d.v==='boolean'&&id(d.id))&&unique(a.slides.map(d=>d.id)),'推拉门格式无效');
    assert(a.rooms.every(r=>id(r.id)&&text(r.name,120)&&polygonOK(r.poly)&&(!r.at||(r.at.length===2&&r.at.every(v=>finite(v))))&&(!r.source||text(r.source)))&&unique(a.rooms.map(r=>r.id)),'房间轮廓不能交叉，且至少需要三个有效顶点');
    assert(s.rooms&&typeof s.rooms==='object'&&a.rooms.every(r=>s.rooms[r.id]&&text(s.rooms[r.id].name,120)&&['wood','walnut','tile800','tile600','marble','antislip','terrazzo','carpet'].includes(s.rooms[r.id].mat)),'房间名称或地面材料无效');
    validateFurnitureList(s.furniture,'家具尺寸或编号无效');
    for(const f of s.furniture.filter(f=>f.layer==='ceiling'))assert((f.ceilingDrop||0)+(f.h||100)+(f.curtainLength||0)<=p.height-p.floorFinish,'设备或窗帘超过室内净高，请调整高度');
    if(s.layoutSchemes===undefined) s.layoutSchemes=emptyLayoutSchemes();
    validateLayoutSchemes(s.layoutSchemes);
    assert(list(s.demolished)&&s.demolished.every(id),'拆改记录无效');
    assert(list(s.measures)&&s.measures.every(m=>m.a&&m.b&&[m.a.x,m.a.y,m.b.x,m.b.y].every(v=>finite(v))&&id(m.id))&&unique(s.measures.map(m=>m.id)),'测量数据无效');
    assert(list(p.devices)&&p.devices.every(d=>id(d.id)&&text(d.name,120)&&text(d.need)&&text(d.model,200)&&text(d.roomId,100)&&finite(d.x)&&finite(d.y)&&list(d.needs,10)&&d.needs.every(k=>Object.hasOwn(KINDS,k)))&&unique(p.devices.map(d=>d.id)),'设备信息无效');
    assert(list(p.points)&&p.points.every(q=>id(q.id)&&text(q.name,120)&&Object.hasOwn(KINDS,q.kind)&&finite(q.x)&&finite(q.y)&&(q.z===null||finite(q.z,0,10000))&&text(q.roomId,100)&&text(q.wallId,100)&&text(q.circuit,120)&&text(q.note)&&list(q.deviceIds,100)&&q.deviceIds.every(id)&&list(q.controls,100)&&q.controls.every(id)&&['planned','confirmed','installed','accepted'].includes(q.status))&&unique(p.points.map(q=>q.id)),'点位信息、安装高度或关联格式无效');
    for(const map of [p.wallInfo,p.windowInfo]) { assert(map&&typeof map==='object'&&!Array.isArray(map),'尺寸依据格式无效'); for(const v of Object.values(map))assert(v&&text(v.source)&&typeof v.verified==='boolean','尺寸依据格式无效'); }
    for(const v of Object.values(p.windowInfo)){if(v.sill!==undefined||v.head!==undefined)assert(finite(v.sill,0,10000)&&finite(v.head,1,10000)&&v.head>v.sill,'窗台和窗顶高度无效');}
    assert(list(p.issues,1000)&&p.issues.every(i=>id(i.id)&&text(i.title,200)&&text(i.note)&&text(i.owner,120)&&text(i.target,100)&&['open','working','done'].includes(i.status)&&(!i.photo||/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(i.photo))),'现场问题数据无效');
    assert(list(p.versions,12),'最多保留 12 个交底版本，请先备份');
    if(depth===0)for(const v of p.versions){assert(id(v.id)&&text(v.name,120)&&text(v.note)&&text(v.date,100)&&Number.isFinite(Date.parse(v.date))&&v.data&&v.data.project.versions.length===0,'交底版本无效');validate(v.data,1);}
    if(p.underlay){const u=p.underlay; assert(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(u.src)&&finite(u.x)&&finite(u.y)&&finite(u.width,1,100000)&&finite(u.height,1,100000)&&finite(u.opacity,0,1),'底图格式无效');}
    assert(JSON.stringify(s).length<35000000,'项目超过 35 MB，请减少图片或历史版本');
    return s;
  }
  function inside(x,y,poly){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if(((a[1]>y)!==(b[1]>y))&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;}
  function footprint(f){const a=f.rot*Math.PI/180;return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>[f.cx+x*f.w/2*Math.cos(a)-y*f.d/2*Math.sin(a),f.cy+x*f.w/2*Math.sin(a)+y*f.d/2*Math.cos(a)]);}
  function overlap(a,b){for(const p of [a,b])for(let i=0;i<p.length;i++){const q=p[i],r=p[(i+1)%p.length],n=[q[1]-r[1],r[0]-q[0]],pa=a.map(v=>v[0]*n[0]+v[1]*n[1]),pb=b.map(v=>v[0]*n[0]+v[1]*n[1]);if(Math.max(...pa)<=Math.min(...pb)+.01||Math.max(...pb)<=Math.min(...pa)+.01)return false;}return true;}
  // Exact rotated footprint against solid wall rectangles; touching is allowed.
  function furniturePlacement(f, architecture, demolished=[]) {
    const fp=footprint(f);
    const wall=(architecture.walls||[]).find(w=>!demolished.includes(w[5])&&overlap(fp,[[w[0],w[1]],[w[2],w[1]],[w[2],w[3]],[w[0],w[3]]]));
    if(wall)return {ok:false,reason:'放不下：家具超出墙间可用空间或与墙体重叠',wallId:wall[5]};
    return {ok:true};
  }
  function resolveFurniturePlacement(f, architecture, demolished=[]) {
    const walls=(architecture.walls||[]).filter(w=>!demolished.includes(w[5]));
    const fp=footprint(f), xs=fp.map(p=>p[0]), ys=fp.map(p=>p[1]);
    const hw=(Math.max(...xs)-Math.min(...xs))/2, hh=(Math.max(...ys)-Math.min(...ys))/2;
    let tooWide=false;
    for(const axis of [0,1]){
      const center=axis===0?f.cx:f.cy, cross=axis===0?f.cy:f.cx;
      const half=axis===0?hw:hh;
      const relevant=walls.filter(w=>w[1-axis]<=cross&&w[3-axis]>=cross);
      const lower=relevant.filter(w=>w[axis+2]<=center).sort((a,b)=>b[axis+2]-a[axis+2])[0];
      const upper=relevant.filter(w=>w[axis]>=center).sort((a,b)=>a[axis]-b[axis])[0];
      if(lower&&upper){
        const gap=upper[axis]-lower[axis+2],excess=2*half-gap;
        if(excess>.01)tooWide=true;
      }
    }
    if(furniturePlacement(f,architecture,demolished).ok)return {ok:true,cx:f.cx,cy:f.cy,moved:false,message:''};
    const queue=[{cx:f.cx,cy:f.cy}],seen=new Set(),limit=Math.max(5000,Math.hypot(f.w,f.d)*2);
    for(let count=0;queue.length&&count<256;count++){
      queue.sort((a,b)=>Math.hypot(a.cx-f.cx,a.cy-f.cy)-Math.hypot(b.cx-f.cx,b.cy-f.cy));
      const candidate=queue.shift(),key=`${candidate.cx.toFixed(4)}:${candidate.cy.toFixed(4)}`;
      if(seen.has(key)){count--;continue;}seen.add(key);
      const placed={...f,...candidate},poly=footprint(placed);
      const hits=walls.filter(w=>overlap(poly,[[w[0],w[1]],[w[2],w[1]],[w[2],w[3]],[w[0],w[3]]]));
      if(!hits.length)return {ok:true,...candidate,moved:true,message:tooWide?'这里放不下啦':'已自动移到墙边'};
      for(const w of hits){
        const options=[{cx:w[0]-hw,cy:candidate.cy},{cx:w[2]+hw,cy:candidate.cy},{cx:candidate.cx,cy:w[1]-hh},{cx:candidate.cx,cy:w[3]+hh}];
        for(const next of options)if(Math.hypot(next.cx-f.cx,next.cy-f.cy)<=limit&&!seen.has(`${next.cx.toFixed(4)}:${next.cy.toFixed(4)}`))queue.push(next);
      }
      if(queue.length>1024)queue.length=1024;
    }
    return {ok:false,message:'这里放不下啦'};
  }
  function bboxOf(poly){const xs=poly.map(p=>p[0]),ys=poly.map(p=>p[1]);return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];}
  function bboxUnionPoly(a,b){const [ax0,ay0,ax1,ay1]=bboxOf(a),[bx0,by0,bx1,by1]=bboxOf(b);const x0=Math.min(ax0,bx0),y0=Math.min(ay0,by0),x1=Math.max(ax1,bx1),y1=Math.max(ay1,by1);return [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];}
  function mergeRoomNames(a,b){const na=String(a||'').trim(),nb=String(b||'').trim();if(!na)return nb||'合并空间';if(!nb||na===nb)return na;if(na.includes(nb))return na;if(nb.includes(na))return nb;return na+' / '+nb;}
  /** Rooms whose interior bbox shares a side with this wall segment (partition between them). */
  function roomsAdjacentToWall(rooms, wall, tol){
    if(!wall||!Array.isArray(rooms))return [];
    const [x0,y0,x1,y1]=wall; const tw=x1-x0, th=y1-y0; if(!(tw>0&&th>0))return [];
    const thick=Math.min(tw,th); const gap=tol??Math.max(100,Math.min(420,thick*2.8));
    const vert=tw<=th; const minOverlap=400; const hit=[];
    for(const r of rooms){
      if(!r?.poly?.length)continue;
      const [rx0,ry0,rx1,ry1]=bboxOf(r.poly);
      if(vert){
        const yOverlap=Math.min(y1,ry1)-Math.max(y0,ry0); if(yOverlap<minOverlap)continue;
        if(Math.abs(rx1-x0)<=gap||(rx1<=x0+2&&x0-rx1<=gap))hit.push(r);
        else if(Math.abs(rx0-x1)<=gap||(rx0>=x1-2&&rx0-x1<=gap))hit.push(r);
      }else{
        const xOverlap=Math.min(x1,rx1)-Math.max(x0,rx0); if(xOverlap<minOverlap)continue;
        if(Math.abs(ry1-y0)<=gap||(ry1<=y0+2&&y0-ry1<=gap))hit.push(r);
        else if(Math.abs(ry0-y1)<=gap||(ry0>=y1-2&&ry0-y1<=gap))hit.push(r);
      }
    }
    const seen=new Set(); return hit.filter(r=>{if(seen.has(r.id))return false; seen.add(r.id); return true;});
  }
  /**
   * Remove a wall segment; if ≥2 rooms sat on opposite sides of it, union them into one room.
   * Mutates state. Returns {deleted, merged, keptId, removedIds, name}.
   */
  function deleteWallAndMergeRooms(s, wallId){
    const a=s.project.architecture; const wall=a.walls.find(w=>w[5]===wallId);
    if(!wall)return {deleted:false, merged:false, keptId:null, removedIds:[], name:''};
    const thick=Math.min(wall[2]-wall[0], wall[3]-wall[1]);
    const adj=roomsAdjacentToWall(a.rooms, wall, Math.max(100, Math.min(420, thick*2.8)));
    a.walls=a.walls.filter(w=>w[5]!==wallId);
    if(s.project.wallInfo)delete s.project.wallInfo[wallId];
    s.demolished=(s.demolished||[]).filter(v=>v!==wallId);
    s.project.custom=true;
    a.doors.forEach(d=>{if(d.wallId===wallId)d.wallId='';});
    (s.project.points||[]).forEach(q=>{if(q.wallId===wallId)q.wallId='';});
    if(adj.length<2)return {deleted:true, merged:false, keptId:null, removedIds:[], name:''};
    // Keep the larger room; fold others into its bbox union.
    const ordered=adj.slice().sort((p,q)=>{
      const ap=Math.abs((bboxOf(p.poly)[2]-bboxOf(p.poly)[0])*(bboxOf(p.poly)[3]-bboxOf(p.poly)[1]));
      const aq=Math.abs((bboxOf(q.poly)[2]-bboxOf(q.poly)[0])*(bboxOf(q.poly)[3]-bboxOf(q.poly)[1]));
      return aq-ap;
    });
    const keep=ordered[0]; const removedIds=[]; let name=s.rooms[keep.id]?.name||keep.name||'';
    for(let i=1;i<ordered.length;i++){
      const other=ordered[i];
      const poly=bboxUnionPoly(keep.poly, other.poly);
      if(!polygonOK(poly))continue;
      keep.poly=poly;
      keep.at=[poly.reduce((v,t)=>v+t[0],0)/poly.length, poly.reduce((v,t)=>v+t[1],0)/poly.length];
      name=mergeRoomNames(name, s.rooms[other.id]?.name||other.name);
      keep.name=name;
      if(s.rooms[keep.id])s.rooms[keep.id].name=name;
      const otherMat=s.rooms[other.id]?.mat; if(otherMat&&s.rooms[keep.id]&&!s.rooms[keep.id].mat)s.rooms[keep.id].mat=otherMat;
      a.rooms=a.rooms.filter(r=>r.id!==other.id);
      delete s.rooms[other.id];
      removedIds.push(other.id);
      (s.project.points||[]).forEach(q=>{if(q.roomId===other.id)q.roomId=keep.id;});
      (s.project.devices||[]).forEach(d=>{if(d.roomId===other.id)d.roomId=keep.id;});
    }
    return {deleted:true, merged:removedIds.length>0, keptId:keep.id, removedIds, name};
  }
  function checks(s){
    const p=s.project,a=p.architecture, out=[];
    const add=(level,target,title,detail)=>out.push({id:level+':'+target+':'+title,level,target,title,detail});
    if(!p.verified)add('review','project','户型尚未复核','当前来源：'+p.source+'。将现场复量结果录入后再确认。');
    if(!a.rooms.length)add('review','project','尚未建立房间','先录入房间轮廓，再分配设备和点位。');
    a.rooms.forEach(r=>{if(!r.verified)add('review',r.id,s.rooms[r.id].name+'轮廓未复核',r.source||'房间轮廓未记录现场量房来源。');});
    a.walls.forEach(w=>{const info=p.wallInfo[w[5]];if(w[4]==='u')add('review',w[5],'墙体性质待确认','请记录结构图或专业确认依据；当前禁止标记拆除。');if(!info?.verified)add('review',w[5],'墙体尺寸未复核',info?.source||'尚未记录量房来源');if(s.demolished.includes(w[5])&&['u','b','e'].includes(w[4]))add('error',w[5],'拆改记录与墙体性质冲突','撤销此拆改记录并核实墙体依据。');});
    a.windows.forEach(w=>{if(p.windowInfo[w[4]]?.head>p.height-p.floorFinish)add('error',w[4],'窗顶超过完成后净高','复核层高、完成层厚度和窗顶高度。');if(!p.windowInfo[w[4]]?.verified)add('review',w[4],'窗户尺寸未复核','补充窗台、窗顶高度与实测来源。');});
    a.doors.forEach(d=>{if(!d.verified)add('review',d.id,'门洞尺寸未复核','复核洞口、门高与开启方向。');if(d.height>p.height-p.floorFinish)add('error',d.id,'门高超过完成后净高','检查层高、地面完成层厚度和门洞高度。');});
    const rectPoly=r=>[[r[0],r[1]],[r[2],r[1]],[r[2],r[3]],[r[0],r[3]]];
    [...a.doors.map(d=>({id:d.id,name:d.name,rect:d.rect})),...a.windows.map(w=>({id:w[4],name:w[4],rect:w})),...a.slides.map(d=>({id:d.id,name:d.name||'推拉门',rect:d.rect}))].forEach(o=>{
      if(a.walls.some(w=>!s.demolished.includes(w[5])&&overlap(rectPoly(o.rect),rectPoly(w))))add('error',o.id,o.name+'洞口与墙段重叠','需编辑相邻墙段，为门窗留出真实洞口；仅添加门窗不会自动切墙。');
    });
    p.devices.forEach(d=>{
      d.needs.forEach(k=>{if(!p.points.some(q=>q.deviceIds.includes(d.id)&&q.kind===k))add('missing',d.id,d.name+'缺少'+KINDS[k].label+'预留','需求：'+(d.need||'未说明')+'。按实际设备安装资料确认后关联点位。');});
      if(!d.model)add('review',d.id,d.name+'型号未确定','安装尺寸和供电等条件需要按选定型号复核。');
      if(!a.rooms.some(r=>r.id===d.roomId&&inside(d.x,d.y,r.poly)))add('review',d.id,d.name+'位置与房间不一致','检查设备坐标或所属房间。');
    });
    p.points.forEach(q=>{
      const serviceDevices=q.deviceIds.map(id=>p.devices.find(d=>d.id===id)).filter(Boolean);
      if(serviceDevices.some(d=>d.roomId!==q.roomId))add('review',q.id,q.name+'与设备不在同一房间','可能是跨房间供给，也可能是位置变更遗漏；请确认关系。');
      if(q.wallId){const wall=a.walls.find(w=>w[5]===q.wallId);if(wall){const distance=Math.hypot(Math.max(wall[0]-q.x,0,q.x-wall[2]),Math.max(wall[1]-q.y,0,q.y-wall[3]));if(distance>100)add('review',q.id,q.name+'偏离关联墙面',`距墙段约 ${Math.round(distance)} mm。100 mm 仅为编辑提醒阈值，请核对安装位置。`);}}
      if(q.z===null)add('missing',q.id,q.name+'未填写安装高度','高度以装修完成地面为基准，按设备和现场方案填写。');
      else if(q.z>p.height-p.floorFinish)add('error',q.id,q.name+'高于室内净高','检查点位高度与完成地面基准。');
      if(!q.roomId||!a.rooms.some(r=>r.id===q.roomId))add('missing',q.id,q.name+'未关联有效房间','选择施工清单归属房间。');
      if(q.wallId&&!a.walls.some(w=>w[5]===q.wallId&&!s.demolished.includes(w[5])))add('error',q.id,q.name+'关联墙体已移除','重新确定墙面，已施工点位需要变更确认。');
      for(const id of q.deviceIds)if(!p.devices.some(d=>d.id===id))add('error',q.id,q.name+'关联设备不存在','重新选择关联设备。');
      for(const id of q.controls)if(!p.points.some(t=>t.id===id))add('error',q.id,q.name+'控制目标不存在','重新选择目标灯位或点位。');
      if(q.kind==='power'&&!q.circuit)add('review',q.id,q.name+'回路待确认','与施工人员确认后记录回路名称；本工具不计算电气回路规格。');
      if(['control','sensor'].includes(q.kind)&&!q.controls.length)add('review',q.id,q.name+'未说明控制目标','关联目标点位，或在备注中记录独立用途。');
    });
    s.furniture.forEach(f=>{
      const fp=footprint(f);
      const wall=a.walls.find(w=>!s.demolished.includes(w[5])&&overlap(fp,[[w[0],w[1]],[w[2],w[1]],[w[2],w[3]],[w[0],w[3]]]));
      if(wall)add('error',f.id,f.name+'与墙体相交','按平面外轮廓计算；检查家具尺寸与位置。');
      if(!a.rooms.some(r=>inside(f.cx,f.cy,r.poly)))add('review',f.id,f.name+'中心位于房间外','核实房间轮廓与家具位置。');
      const door=a.doors.find(d=>{const fan=[d.h];for(let t=0;t<=16;t++){const angle=t/16*Math.PI/2;fan.push([d.h[0]+d.len*(d.c[0]*Math.cos(angle)+d.o[0]*Math.sin(angle)),d.h[1]+d.len*(d.c[1]*Math.cos(angle)+d.o[1]*Math.sin(angle))]);}return overlap(fp,fan);});
      if(door)add('review',f.id,f.name+'可能影响'+door.name+'开启','平面开启扇区与家具重叠；需结合家具高度、门型和现场复核。');
    });
    return out;
  }
  root.ProjectModel={clone,uid,KINDS,PRESETS,SCHEME_KEYS,emptyLayoutSchemes,captureLayoutScheme,normalizeLayoutSchemes,normalize,validate,checks,inside,footprint,overlap,furniturePlacement,resolveFurniturePlacement,polygonOK,sharedRoomEdges,moveRoomBoundary,bboxOf,bboxUnionPoly,mergeRoomNames,roomsAdjacentToWall,deleteWallAndMergeRooms};
  if(typeof module!=='undefined')module.exports=root.ProjectModel;
})(globalThis);
