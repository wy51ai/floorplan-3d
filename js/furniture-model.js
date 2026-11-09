/* Declarative primitive models. Coordinates are fractions of the overall bounds. */
(function(root){
  'use strict';
  function validate(model) {
    if (!model || model.version!==1 || !Array.isArray(model.parts) || !model.parts.length || model.parts.length>48) throw new Error('尺寸模型需包含 1–48 个部件');
    for(const p of model.parts){
      if(!p || !['box','cylinder','ellipsoid'].includes(p.shape) || typeof p.name!=='string' || p.name.length>80 || !/^#[a-f0-9]{6}$/i.test(p.color) || !Array.isArray(p.position)||!Array.isArray(p.size)||p.position.length!==3||p.size.length!==3)throw new Error('模型部件格式无效');
      if(!p.position.every(v=>Number.isFinite(v)&&v>=0&&v<=1)||!p.size.every(v=>Number.isFinite(v)&&v>=.001&&v<=1))throw new Error('模型部件比例无效');
      if(p.position.some((v,i)=>v-p.size[i]/2 < -1e-6 || v+p.size[i]/2 > 1+1e-6))throw new Error('模型部件超出家具外廓');
    }
    // Require all three overall extents to match the declared outer dimensions.
    for(let i=0;i<3;i++){
      const lo=Math.min(...model.parts.map(p=>p.position[i]-p.size[i]/2));
      const hi=Math.max(...model.parts.map(p=>p.position[i]+p.size[i]/2));
      if(Math.abs(lo)>1e-4||Math.abs(hi-1)>1e-4)throw new Error('模型外廓未覆盖完整长宽高');
    }
    return model;
  }
  function clean(model){validate(model);return {version:1,parts:model.parts.map(p=>({name:p.name,shape:p.shape,position:p.position.slice(),size:p.size.slice(),color:p.color}))};}
  // Vertices and polygon faces are shared by the preview and the actual 3D scene.
  function meshes(model,w,d,h){
    validate(model);
    return model.parts.map(p=>{
      let vertices=[],faces=[];
      if(p.shape==='box'){
        vertices=[[-.5,-.5,-.5],[.5,-.5,-.5],[.5,.5,-.5],[-.5,.5,-.5],[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]];
        faces=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]];
      }else{
        const n=20, rings=p.shape==='cylinder'?2:11;
        for(let j=0;j<rings;j++){
          const latitude=-Math.PI/2+j*Math.PI/(rings-1),y=p.shape==='cylinder'?j-.5:Math.sin(latitude)/2,r=p.shape==='cylinder'?.5:Math.cos(latitude)/2;
          for(let i=0;i<n;i++){const a=i*2*Math.PI/n;vertices.push([r*Math.cos(a),y,r*Math.sin(a)]);}
        }
        for(let j=0;j<rings-1;j++)for(let i=0;i<n;i++){const a=j*n+i,b=j*n+(i+1)%n;faces.push([a,a+n,b+n,b]);}
        if(p.shape==='cylinder'){faces.push(Array.from({length:n},(_,i)=>i),Array.from({length:n},(_,i)=>2*n-1-i));}
      }
      // Model axes: x=front width, y=height, z=depth, front is +z.
      vertices=vertices.map(v=>[(p.position[0]+v[0]*p.size[0]-.5)*w,(p.position[1]+v[1]*p.size[1])*h,(p.position[2]+v[2]*p.size[2]-.5)*d]);
      return {vertices,faces,color:p.color,name:p.name};
    });
  }
  function preview(model,w,d,h,angle=35){
    const yaw=angle*Math.PI/180, tilt=.4, polys=[];
    for(const m of meshes(model,w,d,h)){
      const vs=m.vertices.map(([x,y,z])=>{const X=x*Math.cos(yaw)+z*Math.sin(yaw),Z=-x*Math.sin(yaw)+z*Math.cos(yaw);return [X,-y*Math.cos(tilt)+Z*Math.sin(tilt),Z*Math.cos(tilt)+y*Math.sin(tilt)];});
      for(const face of m.faces){
        const points=face.map(i=>vs[i]);
        const area=points.reduce((sum,p,i)=>{const next=points[(i+1)%points.length];return sum+p[0]*next[1]-next[0]*p[1];},0);
        if(area < -1e-8) polys.push({points,color:m.color});
      }
    }
    polys.sort((a,b)=>a.points.reduce((s,p)=>s+p[2],0)/a.points.length-b.points.reduce((s,p)=>s+p[2],0)/b.points.length);
    const pts=polys.flatMap(p=>p.points),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
    const x=Math.min(...xs),y=Math.min(...ys),width=Math.max(...xs)-x,height=Math.max(...ys)-y,pad=Math.max(width,height)*.09;
    return `<svg viewBox="${x-pad} ${y-pad} ${width+2*pad} ${height+2*pad}" role="img" aria-label="AI 尺寸模型预览">${polys.map(p=>`<polygon points="${p.points.map(v=>v.slice(0,2).join(',')).join(' ')}" fill="${p.color}" stroke="#334155" stroke-opacity=".22" stroke-width=".7" vector-effect="non-scaling-stroke"/>`).join('')}</svg>`;
  }
  function top(model,w,d){
    validate(model);
    return model.parts.slice().sort((a,b)=>(a.position[1]+a.size[1]/2)-(b.position[1]+b.size[1]/2)).map(p=>{
      const x=(p.position[0]-.5)*w,z=(p.position[2]-.5)*d,sw=p.size[0]*w,sd=p.size[2]*d;
      const shape=p.shape==='box'?`rect x="${x-sw/2}" y="${z-sd/2}" width="${sw}" height="${sd}"`:`ellipse cx="${x}" cy="${z}" rx="${sw/2}" ry="${sd/2}"`;
      return `<${shape} fill="${p.color}" stroke="#3d3a34" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    }).join('');
  }
  const api={validate,clean,meshes,preview,top};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FurnitureModel=api;
})(globalThis);
