const {test}=require('node:test');const assert=require('node:assert/strict');const M=require('../js/project-model.js');
const template={walls:[[0,0,200,4000,'n']],windows:[],doors:[],slides:[],rooms:[{id:'r1',name:'卧室',mat:'wood',poly:[[200,0],[4000,0],[4000,4000],[200,4000]],at:[2000,2000]}]};
const fresh=()=>M.normalize({furniture:[],rooms:{},demolished:[],measures:[]},template);

test('north orientation defaults to rotating plan and persists chosen mode',()=>{
  const s=fresh();assert.equal(s.project.northMode,'plan');assert.equal(s.project.northAngle,0);
  s.project.northAngle=270;s.project.northMode='compass';
  const restored=M.normalize(JSON.parse(JSON.stringify(s)),template);
  assert.equal(restored.project.northMode,'compass');assert.equal(restored.project.northAngle,270);
  restored.project.northMode='unknown';assert.throws(()=>M.validate(restored),/北向调整方式/);
  restored.project.northMode='plan';restored.project.northAngle=45;assert.throws(()=>M.validate(restored),/北向/);
});

test('underlay accepts a data-url image and rejects other sources',()=>{
  const s=fresh();
  s.project.underlay={src:'data:image/png;base64,AAAA',x:10,y:-20,width:4000,height:3000,opacity:.35};
  M.validate(s);
  const restored=M.normalize(JSON.parse(JSON.stringify(s)),template);
  assert.equal(restored.project.underlay.width,4000);
  assert.equal(restored.project.underlay.opacity,.35);
  s.project.underlay.src='javascript:alert(1)';
  assert.throws(()=>M.validate(s),/底图/);
  s.project.underlay={src:'data:image/png;base64,AAAA',x:0,y:0,width:0,height:10,opacity:1};
  assert.throws(()=>M.validate(s),/底图/);
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
test('polygon validation rejects crossed outlines',()=>{
  assert.equal(M.polygonOK([[0,0],[100,0],[100,100],[0,100]]),true);
  assert.equal(M.polygonOK([[0,0],[100,100],[0,100],[100,0]]),false);
});
