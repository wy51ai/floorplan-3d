(function () {
  'use strict';
  const C = FurnitureCatalog, E = esc;
  const dialog = document.createElement('dialog');
  dialog.id = 'furnitureLibraryDialog'; dialog.className = 'catalog-dialog p-work';
  dialog.setAttribute('aria-label','编辑家具库'); document.body.appendChild(dialog);
  let images = [], controller = null, generation = 0, loading = false;
  dialog.addEventListener('keydown', e => e.stopPropagation());
  dialog.addEventListener('close', () => { generation++; controller?.abort(); controller=null; images=[]; });
  const status = (text, error=false) => { const el = dialog.querySelector('#catalogStatus'); if(el) { el.textContent=text; el.className=error?'p-error':'p-muted'; } };
  function open() { if (!dialog.open) dialog.showModal(); list(); }
  function list() {
    generation++; controller?.abort(); controller=null; images=[]; loading=false;
    dialog.innerHTML = `<div class="catalog-heading"><h2>编辑家具库</h2><button class="btn" id="catalogClose">关闭</button></div>
      <p class="p-muted">保存在本机浏览器。修改或删除库中条目不影响已摆放的家具。</p>
      <div class="p-actions"><button class="btn primary" id="catalogAdd">＋ 新增家具</button><button class="btn" id="catalogSettings">AI 接口设置</button></div><p id="catalogStatus" role="status"></p>
      <div class="catalog-list">${LIB.map((c,ci)=>`<h3>${E(c.cat)}</h3>${c.items.map((it,ii)=>`<div class="catalog-row"><div><b>${E(it[1])}</b><small>${it[2]} × ${it[3]}${it[5]?` × ${it[5]}`:''} mm${it[5]?'':' · 高度未设'}${it[6]?.model?' · AI 尺寸模型':''}</small></div><button class="btn" data-edit="${ci}:${ii}" aria-label="编辑 ${E(it[1])}">编辑</button><button class="btn danger" data-delete="${ci}:${ii}" aria-label="删除 ${E(it[1])}">删除</button></div>`).join('')}`).join('') || '<p>家具库为空，点击新增家具开始。</p>'}</div>`;
    dialog.querySelector('#catalogClose').onclick=()=>dialog.close();
    dialog.querySelector('#catalogAdd').onclick=()=>edit();
    dialog.querySelector('#catalogSettings').onclick=()=>AiSettings.open();
    dialog.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>edit(b.dataset.edit.split(':').map(Number)));
    dialog.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{
      const [ci,ii]=b.dataset.delete.split(':').map(Number), item=LIB[ci].items[ii];
      if (!confirm(`从家具库删除「${item[1]}」？已摆放的家具会保留。`)) return;
      const next=structuredClone(LIB); next[ci].items.splice(ii,1);
      try { C.save(next); list(); status('已从家具库删除'); } catch(e) { status(e.message,true); }
    });
  }
  function edit(key) {
    const it=key?LIB[key[0]].items[key[1]]:['cabinet','',null,null,'#e2cfb4',null];
    images=[]; loading=false; const token=++generation;
    let metadata=it[6]?structuredClone(it[6]):null;
    dialog.innerHTML=`<div class="catalog-heading"><h2>${key?'编辑家具':'新增家具'}</h2><button class="btn" id="catalogBack">返回列表</button></div>
      <form id="catalogForm">
      <fieldset class="catalog-fields"><legend>多图识别与建模</legend><p class="p-muted">上传同一物品的正面、侧面或尺寸图，最多 8 张，每张不超过 10 MB。图片会发送到已配置的 AI 服务。无标注或比例参照时，尺寸仅为估算。</p>
      <label>家具图片<input id="catalogImages" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><div id="catalogPreviews" class="catalog-previews"></div>
      <label>已知尺寸 / 参考物<textarea id="catalogReference" maxlength="2000" placeholder="例如：正面宽 180 cm；第二张图有尺寸标注"></textarea></label>
      <div class="p-actions"><button type="button" class="btn" id="catalogRecognize">AI 识别并建模</button><button type="button" class="btn" id="catalogCancel" hidden>取消识别</button><button type="button" class="btn" id="catalogSettings">AI 接口设置</button></div></fieldset>
      <p id="catalogStatus" role="status" aria-live="polite"></p>
      <fieldset id="catalogDetails" class="catalog-fields"><legend>核对家具信息 · 单位 mm</legend>
      <label>名称<input id="catalogName" required maxlength="120" value="${E(it[1])}"></label>
      <div class="p-grid"><label>分类<input id="catalogCategory" required maxlength="80" list="catalogCategories" value="${E(key?LIB[key[0]].cat:'自定义')}"><datalist id="catalogCategories">${LIB.map(c=>`<option value="${E(c.cat)}">`).join('')}</datalist></label>
      <label>模型类型<select id="catalogType">${C.types.map(t=>`<option value="${t}" ${t===it[0]?'selected':''}>${E(LIB.flatMap(c=>c.items).find(i=>i[0]===t)?.[1]||t)} (${t})</option>`).join('')}</select></label></div>
      <div class="catalog-dimensions">${[['W','长（正面）',it[2]],['D','宽（进深）',it[3]],['H','高',it[5]]].map(([id,label,value])=>`<label>${label}<input id="catalog${id}" type="number" required min="1" max="50000" step="1" value="${value||''}"></label>`).join('')}</div>
      <div id="catalogModelInfo" class="catalog-model-info"></div>
      <label>内置模型颜色<input id="catalogColor" type="color" value="${it[4]}"></label>
      <p class="p-muted">AI 尺寸模型会随家具一起保存，用于 2D / 3D 展示；未生成时使用所选内置类型。请核对尺寸与结构。</p>
      <button class="btn primary" type="submit" id="catalogSave">保存到家具库</button></fieldset></form>`;
    const q=id=>dialog.querySelector('#'+id);
    function modelInfo(){
      const el=q('catalogModelInfo');
      if(!metadata){el.innerHTML='<p class="p-muted">尚无 AI 模型，识别后在此预览。</p>';return;}
      const dims=['W','D','H'].map(id=>Number(q('catalog'+id).value));
      const valid=dims.every(v=>Number.isFinite(v)&&v>=1&&v<=50000);
      const model=metadata.model;
      el.innerHTML=`<h3>${model?'AI 尺寸模型 · '+model.parts.length+' 个部件':'识别信息'}</h3>
        <p class="p-muted">${metadata.estimated?'尺寸含 AI 估算 · 请实测复核':'图片标注识别 · 请核对'}：${E(metadata.evidence)}</p>
        ${model?`<p class="p-muted">${valid?dims.join(' × ')+' mm':'尺寸未填全，当前仅展示比例模型'} · 基础几何近似</p><div id="catalogModelPreview" class="catalog-model-preview"></div><label>旋转预览<input id="catalogModelAngle" type="range" min="-180" max="180" value="35"></label><details><summary>模型部件</summary><ul>${model.parts.map(p=>`<li>${E(p.name)} · ${{box:'长方体',cylinder:'圆柱',ellipsoid:'椭球'}[p.shape]}</li>`).join('')}</ul></details><button type="button" id="catalogRemoveModel" class="btn">移除模型，使用内置类型</button>`:''}`;
      if(model){
        const sizes=valid?dims:[1,1,1];
        const draw=()=>{q('catalogModelPreview').innerHTML=FurnitureModel.preview(model,...sizes,Number(q('catalogModelAngle').value));};
        draw();q('catalogModelAngle').oninput=draw;
        q('catalogRemoveModel').onclick=()=>{metadata.model=null;modelInfo();};
      }
    }
    ['W','D','H'].forEach(id=>q('catalog'+id).addEventListener('input',modelInfo));
    modelInfo();
    q('catalogBack').onclick=list;
    q('catalogSettings').onclick=()=>AiSettings.open();
    function busy(value) {
      q('catalogDetails').disabled=value; q('catalogImages').disabled=value;
      q('catalogReference').disabled=value; q('catalogRecognize').disabled=value;
      q('catalogCancel').hidden=!value;
    }
    function previews() {
      q('catalogPreviews').innerHTML=images.map((src,i)=>`<div><img src="${src}" alt="家具参考图 ${i+1}"><button type="button" class="btn" data-remove="${i}" aria-label="移除图片 ${i+1}">移除</button></div>`).join('');
      q('catalogPreviews').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{if(controller||loading)return; images.splice(Number(b.dataset.remove),1); previews();});
    }
    q('catalogImages').onchange=async e=>{
      const files=Array.from(e.target.files); e.target.value='';
      if(images.length+files.length>8) return status('最多上传 8 张图片',true);
      if(files.some(f=>!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>10*1024*1024)) return status('请选择 PNG、JPEG 或 WebP 图片，每张不超过 10 MB',true);
      loading=true; busy(true); q('catalogCancel').hidden=true;
      try {
        const added=[];
        for(const f of files) added.push(await prepareImage(f));
        if(token!==generation)return;
        images.push(...added); previews(); status(`已准备 ${images.length} 张图片`);
      } catch(e) { if(token===generation)status(e.message,true); }
      finally { if(token===generation){loading=false; busy(false);} }
    };
    q('catalogCancel').onclick=()=>controller?.abort();
    q('catalogRecognize').onclick=async()=>{
      if(!images.length)return status('请先添加家具图片',true);
      if(!AiConfig.hasKey()){status('请先配置 AI 接口与支持图片输入的模型',true);AiSettings.open();return;}
      controller=new AbortController(); const active=controller;
      const timer=setTimeout(()=>active.abort(),120000);
      busy(true); status('正在识别尺寸并生成部件模型…');
      try {
        const r=await C.recognize(images,q('catalogReference').value,active.signal);
        if(token!==generation)return;
        q('catalogName').value=r.name; q('catalogType').value=r.type;
        q('catalogW').value=r.w??''; q('catalogD').value=r.d??''; q('catalogH').value=r.h??'';
        metadata={model:r.model,evidence:r.evidence,estimated:r.estimated}; modelInfo();
        status(`${r.modelWarning?r.modelWarning+'。':''}${r.estimated?'AI 估算 · 请实测复核':'图片标注识别 · 请核对'}：${r.evidence}${[r.w,r.d,r.h].includes(null)?'。有尺寸无法判断，请手动补充。':''}`);
      }catch(e){if(token===generation)status(e.name==='AbortError'?'识别已取消或超时，可重试或手动填写':e.message,true);}
      finally{clearTimeout(timer);if(token===generation){controller=null;busy(false);}}
    };
    q('catalogForm').onsubmit=e=>{
      e.preventDefault(); if(controller||loading)return;
      const category=q('catalogCategory').value.trim();
      const entry=[q('catalogType').value,q('catalogName').value.trim(),Number(q('catalogW').value),Number(q('catalogD').value),q('catalogColor').value,Number(q('catalogH').value)];
      if(metadata)entry[6]=structuredClone(metadata);
      if(!category)return status('请填写分类',true);
      const next=structuredClone(LIB);
      if(key)next[key[0]].items.splice(key[1],1);
      let cat=next.find(c=>c.cat===category); if(!cat){cat={cat:category,items:[]};next.push(cat);} cat.items.push(entry);
      try{C.save(next);list();status('已保存，可从左侧家具库点击或拖入户型');}catch(e){status(e.message,true);}
    };
  }
  async function prepareImage(file) {
    const bitmap=await createImageBitmap(file).catch(()=>{throw new Error('图片无法解码，请换一张有效图片');});
    try {
      const ratio=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      return canvas.toDataURL('image/jpeg',.9);
    } finally {bitmap.close();}
  }
  window.FurnitureLibrary={open,add(){if(!dialog.open)dialog.showModal();edit();}};
})();
