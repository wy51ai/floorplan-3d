const {test}=require('node:test');const assert=require('node:assert/strict');const FM=require('../js/furniture-model.js');
const model={version:1,parts:[{name:'主体',shape:'box',position:[.5,.5,.5],size:[1,1,1],color:'#aabbcc'}]};
test('primitive model meshes match declared dimensions for every supported shape',()=>{
 for(const shape of ['box','cylinder','ellipsoid']){const m=structuredClone(model);m.parts[0].shape=shape;const vs=FM.meshes(m,2000,800,900)[0].vertices;for(const [axis,lo,hi] of [[0,-1000,1000],[1,0,900],[2,-400,400]]){assert(Math.abs(Math.min(...vs.map(v=>v[axis]))-lo)<1e-8);assert(Math.abs(Math.max(...vs.map(v=>v[axis]))-hi)<1e-8);}}
});
test('reject malformed, oversized or unsafe model parts before rendering',()=>{
 for(const mutate of [m=>m.parts[0].shape='script',m=>m.parts[0].color='url(x)',m=>m.parts[0].position[0]=NaN,m=>m.parts[0].size[1]=2,m=>m.parts=Array(49).fill(m.parts[0]),m=>m.parts[0].size[2]=.5]){const m=structuredClone(model);mutate(m);assert.throws(()=>FM.validate(m));}
 assert.equal(FM.clean({...model,script:'bad'}).script,undefined);
});
