const {test}=require('node:test');
const assert=require('node:assert/strict');
const Rules=require('../js/ocr-postprocess-rules.js');
const R=require('../js/recognition-core.js');

function solidRect(w,h,rects){
  const data=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=255;data[i+3]=255;}
  for(const [x0,y0,x1,y1] of rects){
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=20;}
  }
  return {width:w,height:h,data};
}

test('detects a rectangular room from raster walls',()=>{
  // Inner walls only; leave margins empty so no false outer scale frame is inferred.
  const walls=[[80,70,260,82],[80,200,140,212],[170,200,260,212],[80,70,92,212],[248,70,260,212]];
  const img=solidRect(340,280,walls);
  const r=R.detect(img,{threshold:100,thickness:3,gap:80,minArea:200});
  assert.ok(r.walls.length>=4);
  assert.ok(r.rooms.length>=1);
  assert.ok(r.openings.length>=1);
});

test('toArchitecture converts pixels to editable mm geometry',()=>{
  const result={
    width:200,height:200,thickness:8,bounds:[10,10,190,190],
    walls:[{rect:[10,10,190,18],axis:'h'},{rect:[10,182,190,190],axis:'h'},{rect:[10,10,18,190],axis:'v'},{rect:[182,10,190,190],axis:'v'}],
    openings:[{rect:[80,182,120,190],axis:'h',type:'door'},{rect:[10,60,18,120],axis:'v',type:'window'}],
    rooms:[{name:'卧室',poly:[[18,18],[182,18],[182,182],[18,182]],at:[100,100],areaPx:1000}]
  };
  const built=R.toArchitecture(result,10);
  assert.equal(built.architecture.rooms[0].name,'卧室');
  assert.equal(built.architecture.walls.length,6);
  const cuts=[...built.architecture.windows,...built.architecture.doors.map(d=>d.rect)];
  assert.ok(built.architecture.walls.every(w=>w[4]==='u'));
  assert.ok(built.architecture.walls.every(w=>cuts.every(r=>
    Math.min(w[2],r[2])<=Math.max(w[0],r[0]) || Math.min(w[3],r[3])<=Math.max(w[1],r[1]))));
  assert.ok(built.architecture.windows.length>=1);
  assert.ok(built.architecture.doors.length>=1);
  assert.equal(built.architecture.rooms[0].poly[0][0]%10,0);
});

test('fillMissingPartitionWalls seals white strip between 玄关 and 厨房',()=>{
  // Two rooms with a 240mm gap and no wall — the “stuck white wall” artifact.
  const arch={
    walls:[[0,0,5000,240,'e','w0'],[0,3000,5000,3240,'e','w1'],[0,0,240,3240,'e','w2'],[4760,0,5000,3240,'e','w3']],
    windows:[], doors:[], slides:[],
    rooms:[
      {id:'r1',name:'玄关',poly:[[240,240],[1800,240],[1800,3000],[240,3000]],at:[1000,1600]},
      {id:'r2',name:'厨房',poly:[[2040,240],[4760,240],[4760,3000],[2040,3000]],at:[3400,1600]}
    ]
  };
  const before=arch.walls.length;
  const n=R.fillMissingPartitionWalls(arch);
  assert.ok(n>=1,'expected a sealed partition wall');
  assert.equal(arch.walls.length,before+n);
  const seal=arch.walls.find(w=>w[0]===1800&&w[2]===2040);
  assert.ok(seal,'expected wall covering the 玄关–厨房 gap');
  assert.ok(seal[3]-seal[1]>=2000);
  // Second pass should be a no-op once covered.
  assert.equal(R.fillMissingPartitionWalls(arch),0);
});

test('OCR postprocess rules catalog exports reusable aliases',()=>{
  assert.ok(Rules.roomNameAliases.some(a=>a.name==='厨房'&&a.patterns.includes('后房')));
  const text=Rules.toPlainText();
  assert.match(text,/OCR 后处理规则/);
  assert.match(text,/房间名称解析/);
  assert.match(text,/不属于 OCR 后处理/);
  assert.equal(Rules.roomNameRegexRules()[0][0],'客餐厅');
});

test('enrich assigns OCR room names inside polygons',()=>{
  const result={rooms:[{name:'空间 1',poly:[[0,0],[100,0],[100,100],[0,100]],at:[50,50],areaPx:4000}],bounds:[0,0,100,100],walls:[],openings:[]};
  R.enrich(result,[{text:'厨房',confidence:80,bbox:{x0:40,y0:40,x1:60,y1:55}}]);
  assert.equal(result.rooms[0].name,'厨房');
});

test('enrich parses messy area OCR and kitchen misread',()=>{
  const result={
    rooms:[
      {id:'room-0',name:'空间 1',poly:[[0,0],[80,0],[80,60],[0,60]],at:[40,30],areaPx:9000},
      {id:'room-1',name:'空间 2',poly:[[90,0],[180,0],[180,90],[90,90]],at:[135,45],areaPx:20000},
      {id:'room-2',name:'空间 3',poly:[[0,70],[70,70],[70,120],[0,120]],at:[35,95],areaPx:5000}
    ],
    bounds:[0,0,200,140],walls:[],openings:[]
  };
  R.enrich(result,[
    {text:'后房',confidence:70,bbox:{x0:30,y0:20,x1:55,y1:34}},
    {text:'9.14',confidence:85,bbox:{x0:28,y0:36,x1:55,y1:48}},
    {text:'客餐厅',confidence:90,bbox:{x0:110,y0:30,x1:150,y1:44}},
    {text:'30.06mi',confidence:42,bbox:{x0:108,y0:48,x1:152,y1:60}},
    {text:'418m',confidence:35,bbox:{x0:20,y0:90,x1:50,y1:104}},
    {text:'阳台',confidence:82,bbox:{x0:200,y0:100,x1:230,y1:114}},
    {text:'6.82m',confidence:76,bbox:{x0:200,y0:118,x1:236,y1:132}}
  ]);
  assert.equal(result.rooms[0].name,'厨房');
  assert.equal(result.rooms[0].areaLabel,9.14);
  assert.equal(result.rooms[1].name,'客餐厅');
  assert.equal(result.rooms[1].areaLabel,30.06);
  assert.equal(result.rooms[2].name,'卫生间');
  assert.equal(result.rooms[2].areaLabel,4.18);
  const bal=result.rooms.find(r=>r.name==='阳台');
  assert.ok(bal);
  assert.equal(bal.areaLabel,6.82);
  assert.ok(result.scaleHint && result.scaleHint.mmPerPx > 2);
});

test('overlay SVG includes rooms and openings',()=>{
  const svg=R.overlaySVG({width:100,height:80,walls:[{rect:[0,0,100,8]}],rooms:[{name:'客厅',poly:[[8,8],[90,8],[90,70],[8,70]],at:[40,40]}],openings:[{rect:[40,0,70,8],type:'window'}]});
  assert.match(svg,/客厅/);
  assert.match(svg,/polygon/);
});

test('cleanUnderlayImage scrubs OCR room name and area labels',()=>{
  const w=120,h=100,data=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=245;data[i+3]=255;}
  // Fake printed「厨房 / 9.14」ink near room center.
  for(let y=40;y<52;y++)for(let x=48;x<72;x++){const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=25;}
  for(let y=54;y<64;y++)for(let x=50;x<70;x++){const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=30;}
  const result={
    bounds:[10,10,110,90], thickness:6,
    rooms:[{
      name:'厨房', at:[60,50], poly:[[20,20],[100,20],[100,80],[20,80]],
      textEvidence:{bbox:{x0:48,y0:40,x1:72,y1:52}},
      areaEvidence:{bbox:{x0:50,y0:54,x1:70,y1:64}, area:9.14}
    }]
  };
  const cleaned=R.cleanUnderlayImage({width:w,height:h,data}, result, [234,240,245,255]);
  const nameInk=(46*w+55)*4, areaInk=(58*w+60)*4;
  assert.equal(cleaned.data[nameInk],234);
  assert.equal(cleaned.data[areaInk],234);
  const rects=R.roomLabelScrubRects(result);
  assert.ok(rects.length>=2);
});

test('detectCompass keeps north tip and cleanUnderlay preserves it',()=>{
  const w=160,h=160,data=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=245;data[i+3]=255;}
  // Place compass in top-left margin: dark body below blue N tip.
  for(let y=34;y<70;y++)for(let x=22;x<30;x++){const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=30;}
  for(let y=18;y<36;y++)for(let x=20;x<32;x++){const i=(y*w+x)*4;data[i]=60;data[i+1]=120;data[i+2]=220;}
  const c=R.detectCompass(data,w,h);
  assert.ok(c);
  assert.ok(c.angleDeg < 30 || c.angleDeg > 330, 'expected near 0, got '+c.angleDeg);
  const cleaned=R.cleanUnderlayImage({width:w,height:h,data}, {bounds:[50,50,140,140],thickness:6,compass:c}, [234,240,245,255]);
  const tip=(Math.round(c.y)*w+Math.round(c.x))*4;
  assert.ok(cleaned.data[tip+2] > cleaned.data[tip]+20);
  // Exterior UI-like pixel outside bounds should be scrubbed.
  const scrubbed=(10*w+140)*4;
  assert.equal(cleaned.data[scrubbed],234);
});

test('detectDimensionFrame prefers outer scale lines and exterior is ignored',()=>{
  const w=200,h=220,data=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=250;data[i+3]=255;}
  // outer dimension lines
  for(let x=30;x<170;x++)for(const y of [20,200]){const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=20;}
  for(let y=20;y<201;y++)for(const x of [30,169]){const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=20;}
  // thick inner walls forming a room
  for(let x=50;x<150;x++)for(const y of [50,51,52,53,140,141,142,143]){const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=25;}
  for(let y=50;y<144;y++)for(const x of [50,51,52,53,146,147,148,149]){const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=25;}
  // exterior chrome noise outside frame
  for(let y=5;y<15;y++)for(let x=175;x<195;x++){const i=(y*w+x)*4;data[i]=20;data[i+1]=20;data[i+2]=20;}
  const img={width:w,height:h,data};
  const r=R.detect(img,{threshold:120,thickness:3,gap:40,minArea:80});
  assert.ok(r.dimensionFrame, 'should find scale frame');
  assert.ok(r.dimensionFrame.rect[0] >= 25 && r.dimensionFrame.rect[2] <= 175);
  assert.ok(r.rooms.length >= 1);
  const cleaned=R.cleanUnderlayImage(img,r,[234,240,245,255]);
  const noise=(8*w+180)*4;
  assert.equal(cleaned.data[noise],234);
});

test('snapNorthCardinal only keeps NESW',()=>{
  assert.equal(R.snapNorthCardinal(348).angleDeg,0);
  assert.equal(R.snapNorthCardinal(10).facing,'北朝上');
  assert.equal(R.snapNorthCardinal(95).angleDeg,90);
  assert.equal(R.snapNorthCardinal(200).facing,'北朝下');
  assert.equal(R.snapNorthCardinal(300).angleDeg,270);
});

test('thin outer glazing seals an indented balcony pocket',()=>{
  // L-shaped thick walls with a bottom-right balcony closed only by 1px glazing.
  const walls=[
    // main box outer shell (open bottom-right notch)
    [40,40,220,52],[40,40,52,200],[40,188,140,200],[208,40,220,140],
    // balcony left / top (shared with living)
    [140,140,152,200],[140,140,220,152],
  ];
  const img=solidRect(260,230,walls);
  // 1px balcony glazing: right + bottom of pocket [152..208] x [152..200]
  for(let y=152;y<200;y++){const i=(y*260+208)*4;img.data[i]=img.data[i+1]=img.data[i+2]=40;}
  for(let x=152;x<=208;x++){const i=(199*260+x)*4;img.data[i]=img.data[i+1]=img.data[i+2]=40;}
  const r=R.detect(img,{threshold:100,thickness:3,gap:60,minArea:200});
  const bal=r.rooms.find(room=>room.at[0]>160&&room.at[1]>155);
  assert.ok(bal,'expected balcony free-space room');
  assert.ok(bal.areaPx>800 && bal.areaPx<6000, 'balcony area '+bal.areaPx);
  assert.equal(!!bal.synthetic,false);
  assert.ok(r.walls.some(w=>w.thin),'expected promoted thin shell wall');
});

test('outer shell room is discarded and bedroom labels stay exclusive',()=>{
  const rooms=[
    {id:'room-0',name:'空间 1',areaPx:200000,rect:[0,0,100,100],poly:[[0,0],[100,0],[100,100],[0,100]],at:[50,50]},
    {id:'room-1',name:'空间 2',areaPx:5000,rect:[10,10,40,40],poly:[[10,10],[40,10],[40,40],[10,40]],at:[25,25]},
    {id:'room-2',name:'空间 3',areaPx:8000,rect:[55,55,90,90],poly:[[55,55],[90,55],[90,90],[55,90]],at:[70,70]}
  ];
  const kept=rooms.filter(room=>!rooms.some(other=>other!==room&&other.areaPx<room.areaPx*.95&&R.contains(other.at[0],other.at[1],room.poly)));
  assert.equal(kept.length,2);
  const enriched=R.enrich({rooms:kept.map((r,i)=>({...r,id:'room-'+i})),bounds:[0,0,100,100],walls:[],openings:[]},[
    {text:'卧室',confidence:95,bbox:{x0:20,y0:20,x1:30,y1:28}},
    {text:'客餐厅',confidence:90,bbox:{x0:65,y0:65,x1:80,y1:75}},
    {text:'卧室',confidence:88,bbox:{x0:66,y0:66,x1:78,y1:74}}
  ]);
  assert.equal(enriched.rooms[0].name,'卧室');
  assert.equal(enriched.rooms[1].name,'客餐厅');
});


test('aligned jambs do not create a wall across a blank room',()=>{
  const image=solidRect(400,400,[
    [60,60,340,72],[60,320,340,332],[60,60,72,332],[328,60,340,332],
    [130,60,142,96],[130,300,160,312]
  ]);
  const r=R.detect(image,{threshold:100,gap:250,minArea:200});
  assert.equal(r.rooms.length,1);
  assert.ok(!r.walls.some(w=>w.rect[0]<=136 && w.rect[2]>136 && w.rect[1]<=180 && w.rect[3]>180));
  assert.ok(!r.openings.some(o=>o.rect[0]<=136 && o.rect[2]>136 && o.rect[1]<=180 && o.rect[3]>180));
});

test('a change in solid wall thickness is not an in-wall opening',()=>{
  const image=solidRect(400,400,[
    [60,60,340,74],[60,320,340,334],[60,60,74,334],[326,60,340,334],
    [180,60,194,110],[180,110,188,280],[180,280,194,334]
  ]);
  const r=R.detect(image,{threshold:100,minArea:200});
  assert.ok(!r.openings.some(o=>o.inWall && o.rect[0]<=184 && o.rect[2]>184 && o.rect[1]<240 && o.rect[3]>140));
});

test('white slit bounded by wall ink still becomes an opening',()=>{
  const image=solidRect(400,400,[[60,60,340,74],[60,320,340,334],[60,60,74,334],[326,60,340,334]]);
  for(let y=64;y<70;y++)for(let x=120;x<200;x++){
    const i=(y*400+x)*4;image.data[i]=image.data[i+1]=image.data[i+2]=255;
  }
  const r=R.detect(image,{threshold:100,minArea:200});
  assert.ok(r.openings.some(o=>o.inWall && o.rect[0]<=150 && o.rect[2]>150 && o.rect[1]<=67 && o.rect[3]>67));
});

test('room bounding boxes cannot invent physical partitions during conversion',()=>{
  const r={width:400,height:400,thickness:12,bounds:[20,20,380,380],
    walls:[{rect:[20,20,380,32],axis:'h'}],openings:[],
    rooms:[
      {poly:[[32,32],[180,32],[180,360],[32,360]],at:[100,200]},
      {poly:[[192,32],[368,32],[368,360],[192,360]],at:[280,200]}
    ]};
  assert.equal(R.toArchitecture(r,10).architecture.walls.length,1);
});
