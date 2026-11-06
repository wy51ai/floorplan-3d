const {test}=require('node:test');const assert=require('node:assert/strict');const M=require('../js/project-model.js');
const template={walls:[[0,0,200,4000,'n']],windows:[],doors:[],slides:[],rooms:[{id:'r1',name:'卧室',mat:'wood',poly:[[200,0],[4000,0],[4000,4000],[200,4000]],at:[2000,2000]}]};
const fresh=()=>M.normalize({furniture:[],rooms:{},demolished:[],measures:[]},template);
const device=()=>({id:'device1',name:'电动窗帘',need:'自动开合',model:'',roomId:'r1',x:3000,y:1000,needs:['power']});
const point=()=>({id:'P001',name:'窗帘电源',kind:'power',x:3000,y:1000,z:null,roomId:'r1',wallId:'w0',circuit:'',note:'',deviceIds:['device1'],controls:[],status:'planned'});
test('legacy plans migrate without changing furniture, geometry gets stable IDs',()=>{const s=fresh();assert.equal(s.schemaVersion,2);assert.equal(s.project.architecture.walls[0][5],'w0');assert.equal(s.rooms.r1.name,'卧室');assert.equal(s.project.verified,false);assert.equal(template.walls[0].length,5);});
test('backup round trip preserves images, points, geometry and frozen versions',()=>{const s=fresh();s.project.devices.push(device());s.project.points.push(point());s.project.underlay={src:'data:image/png;base64,AAAA',x:0,y:0,width:1000,height:1000,opacity:.5};const data=M.clone(s);s.project.versions.push({id:'v1',name:'交底一版',date:'2026-11-06',note:'测试',data});assert.deepEqual(M.normalize(JSON.parse(JSON.stringify(s)),template),s);});
test('missing prerequisite disappears only after linking correct point kind',()=>{const s=fresh();s.project.devices.push(device());assert(M.checks(s).some(c=>c.level==='missing'&&c.target==='device1'));s.project.points.push({...point(),kind:'network'});assert(M.checks(s).some(c=>c.title==='电动窗帘缺少电源预留'));s.project.points[0].kind='power';assert(!M.checks(s).some(c=>c.title==='电动窗帘缺少电源预留'));assert(M.checks(s).some(c=>c.title.includes('未填写安装高度')));});
test('deleted walls and control targets generate actionable errors',()=>{const s=fresh();s.project.points.push({...point(),controls:['absent']});s.project.architecture.walls=[];const c=M.checks(s);assert(c.some(c=>c.title.includes('墙体已移除')));assert(c.some(c=>c.title.includes('控制目标不存在')));});
test('rotated furniture collision uses oriented footprint, touching is not collision',()=>{assert.equal(M.overlap([[0,0],[1,0],[1,1],[0,1]],[[1,0],[2,0],[2,1],[1,1]]),false);const s=fresh();s.furniture.push({id:'f1',type:'bed',name:'床',cx:250,cy:500,w:300,d:1000,rot:45,color:'#fff'});assert(M.checks(s).some(c=>c.level==='error'&&c.target==='f1'));s.furniture[0].cx=2000;assert(!M.checks(s).some(c=>c.level==='error'&&c.target==='f1'));});
test('unsafe or malformed backups are rejected before state replacement',()=>{for(const change of [s=>s.project.height=NaN,s=>s.project.architecture.rooms[0].poly=[[0,0],[1,1],[0,1],[1,0]],s=>s.project.architecture.walls[0][5]='"><script>',s=>s.project.points.push({...point(),z:-10}),s=>s.project.underlay={src:'javascript:alert(1)',x:0,y:0,width:1,height:1,opacity:1}]){const s=fresh();change(s);assert.throws(()=>M.validate(s));}});
test('unknown walls remain unconfirmed and forbidden demolitions are reported',()=>{const s=fresh();s.project.architecture.walls[0][4]='u';s.demolished=['w0'];assert(M.checks(s).some(c=>c.title.includes('性质待确认')));assert(M.checks(s).some(c=>c.level==='error'&&c.title.includes('拆改')));});
test('polygon validation rejects collinear, repeated, and self-touching boundaries',()=>{assert(M.polygonOK([[0,0],[100,0],[100,100],[0,100]]));for(const poly of [[[0,0],[1,0],[2,0]],[[0,0],[100,0],[100,100],[0,0]],[[0,0],[100,100],[0,100],[100,0]]])assert(!M.polygonOK(poly));});
test('deleting a shared partition wall merges the two rooms into one bbox',()=>{
  const s=M.normalize({furniture:[],rooms:{
    left:{name:'客厅',mat:'wood'},right:{name:'餐厅',mat:'tile800'}
  },demolished:[],measures:[]},{
    walls:[[1980,0,2180,4000,'n','part'],[ -200,-200,200,4200,'e','outer']],
    windows:[],doors:[],slides:[],
    rooms:[
      {id:'left',name:'客厅',mat:'wood',poly:[[0,0],[1980,0],[1980,4000],[0,4000]],at:[990,2000]},
      {id:'right',name:'餐厅',mat:'tile800',poly:[[2180,0],[5000,0],[5000,4000],[2180,4000]],at:[3590,2000]}
    ]
  });
  const adj=M.roomsAdjacentToWall(s.project.architecture.rooms,s.project.architecture.walls[0]);
  assert.equal(adj.length,2);
  const result=M.deleteWallAndMergeRooms(s, 'part');
  assert.equal(result.deleted,true);
  assert.equal(result.merged,true);
  assert.equal(s.project.architecture.walls.some(w=>w[5]==='part'),false);
  assert.equal(s.project.architecture.rooms.length,1);
  // Keeps the larger room (right) and folds the smaller into its bbox union.
  assert.equal(s.project.architecture.rooms[0].id,'right');
  assert.equal(s.rooms.right.name,'餐厅 / 客厅');
  assert.equal(s.rooms.left,undefined);
  assert.deepEqual(s.project.architecture.rooms[0].poly,[[0,0],[5000,0],[5000,4000],[0,4000]]);
});
test('deleting an outer wall with one adjacent room does not invent a merge',()=>{
  const s=fresh();
  const result=M.deleteWallAndMergeRooms(s,s.project.architecture.walls[0][5]);
  assert.equal(result.deleted,true);
  assert.equal(result.merged,false);
  assert.equal(s.project.architecture.rooms.length,1);
});
test('door opening overlapping a wall is reported, an actual gap is clear',()=>{const s=fresh();s.project.architecture.doors.push({id:'door1',name:'卧室门',rect:[0,1000,200,1900],h:[200,1000],c:[0,1],o:[1,0],len:900,height:2100});assert(M.checks(s).some(c=>c.target==='door1'&&c.level==='error'));s.project.architecture.walls=[[0,0,200,1000,'n','w0'],[0,1900,200,4000,'n','w1']];assert(!M.checks(s).some(c=>c.target==='door1'&&c.title.includes('重叠')));});
test('implausible finished height, duplicate point IDs and malformed dates are rejected',()=>{let s=fresh();s.project.height=1800;s.project.floorFinish=100;assert.throws(()=>M.validate(s));s=fresh();s.project.points=[point(),point()];assert.throws(()=>M.validate(s));s=fresh();s.project.versions=[{id:'v1',name:'x',note:'',date:'oops',data:fresh()}];assert.throws(()=>M.validate(s));});


test('north orientation defaults to rotating plan and persists chosen mode',()=>{
  const s=fresh();assert.equal(s.project.northMode,'plan');
  s.project.northAngle=270;s.project.northMode='compass';
  const restored=M.normalize(JSON.parse(JSON.stringify(s)),template);
  assert.equal(restored.project.northMode,'compass');assert.equal(restored.project.northAngle,270);
  restored.project.northMode='unknown';assert.throws(()=>M.validate(restored),/北向调整方式/);
});

const notchPoly=()=>[[800,0],[2400,0],[2400,2400],[0,2400],[0,800],[800,800]];
test('inset room edge moves locally without scaling the room bounds',()=>{
  const poly=notchPoly();
  assert.deepEqual(M.moveRoomBoundary(poly,'edge',4,300,200),[[800,0],[2400,0],[2400,2400],[0,2400],[0,1000],[800,1000]]);
  assert.deepEqual(M.moveRoomBoundary(poly,'edge',5,200,300),[[1000,0],[2400,0],[2400,2400],[0,2400],[0,800],[1000,800]]);
  assert.deepEqual(poly,notchPoly());
});
test('inset corner changes its width and depth while preserving orthogonal neighbors',()=>{
  assert.deepEqual(M.moveRoomBoundary(notchPoly(),'vertex',5,200,100),[[1000,0],[2400,0],[2400,2400],[0,2400],[0,900],[1000,900]]);
  assert.equal(M.moveRoomBoundary(notchPoly(),'vertex',5,2000,0),null);
  assert.equal(M.moveRoomBoundary(notchPoly(),'edge',4,0,-800),null);
});
test('actual shared segment is locked without locking unrelated notch edges',()=>{
  const room={id:'bath',poly:notchPoly()},other={id:'bed',poly:[[2600,0],[4000,0],[4000,2400],[2600,2400]]};
  const locks=M.sharedRoomEdges(room,[room,other],240);
  assert.deepEqual(locks,[false,true,false,false,false,false]);
  assert.deepEqual(M.moveRoomBoundary(room.poly,'edge',1,200,0,locks),room.poly);
  assert.deepEqual(M.moveRoomBoundary(room.poly,'vertex',2,200,100,locks),[[800,0],[2400,0],[2400,2500],[0,2500],[0,800],[800,800]]);
  assert.notDeepEqual(M.moveRoomBoundary(room.poly,'vertex',5,200,100,locks),room.poly);
});

test('local boundary edit preserves unrelated measured fractional coordinates',()=>{
  const poly=notchPoly().map(([x,y])=>[x+.25,y+.5]);
  const moved=M.moveRoomBoundary(poly,'edge',4,0,100);
  assert.deepEqual(moved.slice(0,4),poly.slice(0,4));
  assert.deepEqual(moved[5],[800.25,900.5]);
});
