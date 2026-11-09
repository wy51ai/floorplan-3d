/* Renovation workspaces, sharing the existing 2D/3D scene and history. */
(function(){
  'use strict';
  const M=ProjectModel, E=esc;
  let tab='site', selected=null, placing=null, first=null, checkLevel='all', roomFilter='', kindFilter='', dirtyStorage=false;
  const titles={site:'户型',layout:'布置',services:'设备点位',checks:'检查',delivery:'交底'};
  const localDate=value=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value))+'（北京时间）';
  const statusNames={planned:'待确认',confirmed:'已确认',installed:'已施工',accepted:'已验收'};
  const nav=document.createElement('nav');nav.id='projectNav';nav.setAttribute('aria-label','装修工作区');
  nav.innerHTML='<span class="wordmark">筑家</span>'+Object.entries(titles).map(([k,v])=>`<button class="btn" data-workspace="${k}" aria-selected="${k===tab}">${v}</button>`).join('')+'<span id="saveState">本机自动保存 · 请定期备份</span>';
  document.querySelector('header').prepend(nav);
  const more=document.createElement('button');more.className='btn mobile-tools';more.type='button';more.textContent='更多工具';more.setAttribute('aria-expanded','false');document.querySelector('header').append(more);more.onclick=()=>{const open=document.body.classList.toggle('mobile-tools-open');more.textContent=open?'收起工具':'更多工具';more.setAttribute('aria-expanded',String(open));};
  const hint=document.createElement('div');hint.id='placementHint';hint.hidden=true;$('#stage').append(hint);
  const safeNum=(value,fallback=0)=>value===''?fallback:Number(value);
  const input=(label,name,value,type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${E(value??'')}" ${extra}></label>`;
  const num=(label,name,value,extra='')=>input(label,name,value,'number','step="any" '+extra);
  const areaInput=(label,name,value)=>`<label>${label}<textarea name="${name}" maxlength="4000">${E(value||'')}</textarea></label>`;
  const selectInput=(label,name,value,options)=>`<label>${label}<select name="${name}">${options.map(([k,v])=>`<option value="${E(k)}" ${String(value)===String(k)?'selected':''}>${E(v)}</option>`).join('')}</select></label>`;
  const checkbox=(label,name,checked)=>`<label><input type="checkbox" name="${name}" ${checked?'checked':''}>${label}</label>`;
  const button=(label,action,attrs='',primary=false)=>`<button type="button" class="btn ${primary?'primary':''}" data-action="${action}" ${attrs}>${label}</button>`;
  const form=(kind,body)=>`<form data-form="${kind}">${body}<div class="p-error" role="alert"></div><div class="p-actions p-sticky"><button class="btn primary" type="submit">保存修改</button>${kind!=='project'?button('返回列表','back'):''}</div></form>`;
  const roomOptions=()=>[['','待分配'],...ROOMS.map(r=>[r.id,state.rooms[r.id].name])];
  const roomsSelect=(id)=>selectInput('所属房间','roomId',id,roomOptions());
  const row=(a,b)=>`<div class="p-row">${a}${b}</div>`;
  const sourceFields=o=>areaInput('尺寸 / 性质依据','source',o.source||'')+checkbox('已现场复核并确认依据','verified',o.verified);
  function transact(fn){const before=snap(),next=M.clone(state);fn(next);M.validate(next);state=next;ui.sel=null;commit(before);renderAll();}
  function actionError(err){const el=$('#panel .p-error');if(el)el.textContent=err.message;toast(err.message||'操作未完成');}
  function ensureSite(){
    if(tab==='site')return;
    tab='site'; document.body.dataset.workspace='site';
  }
  function ensureWallEdit(){
    ensureSite();
    if(ui.wallEdit)return true;
    if(typeof setWallEdit==='function'){setWallEdit(true,{silent:true});return !!ui.wallEdit;}
    ui.wallEdit=true; if(typeof syncPlanClass==='function')syncPlanClass(); return true;
  }
  function clearWallSelection(){if(selected?.type==='wall')selected=null;}
  function selectWall(id){
    if(!ensureWallEdit()){toast('请先开启「墙体编辑」');return;}
    const same=selected?.type==='wall'&&selected.id===id&&ui.sel?.kind==='wall'&&ui.sel.id===id&&tab==='site';
    selected={type:'wall',id}; ui.sel={kind:'wall',id}; tab='site'; document.body.dataset.workspace='site';
    if(same){renderSel();return;}
    renderAll(); document.querySelector('aside.right').scrollTop=0; drawer('panel',true);
  }
  function focusTarget(id){
    let x,y;const p=state.project,a=p.architecture;
    const q=p.points.find(v=>v.id===id),d=p.devices.find(v=>v.id===id),f=state.furniture.find(v=>v.id===id),w=a.walls.find(v=>v[5]===id),win=a.windows.find(v=>v[4]===id),door=a.doors.find(v=>v.id===id),r=a.rooms.find(v=>v.id===id),slide=a.slides.find(v=>v.id===id);
    if(q||d){const o=q||d;x=o.x;y=o.y;selected={type:q?'point':'device',id};tab='services';if(ui.sel?.kind==='wall')ui.sel=null;}
    else if(w||win){const o=w||win;x=(o[0]+o[2])/2;y=(o[1]+o[3])/2;selected={type:w?'wall':'window',id};tab='site';if(w){ensureWallEdit();ui.sel={kind:'wall',id};}else if(ui.sel?.kind==='wall')ui.sel=null;}
    else if(slide){x=(slide.rect[0]+slide.rect[2])/2;y=(slide.rect[1]+slide.rect[3])/2;selected={type:'slide',id};tab='site';if(ui.sel?.kind==='wall')ui.sel=null;}
    else if(door){[x,y]=door.h;selected={type:'door',id};tab='site';if(ui.sel?.kind==='wall')ui.sel=null;}
    else if(r){[x,y]=r.at;selected={type:'room',id};tab='site';ui.sel={kind:'room',id};}
    else if(f){x=f.cx;y=f.cy;tab='layout';document.body.dataset.workspace='layout';if(typeof leavePlanEditMode==='function')leavePlanEditMode();ui.sel={kind:'furn',id};selected=null;}
    else{tab='site';selected=null;if(ui.sel?.kind==='wall'||ui.sel?.kind==='room')ui.sel=null;}
    if(x!==undefined){({x,y}=planViewPoint({x,y}));view.s=Math.max(view.s,.12);view.x0=x-svg.clientWidth/2/view.s;view.y0=y-svg.clientHeight/2/view.s;applyView();}
    if(is3D())setView('2d');renderAll();drawer('panel',true);
  }
  function cancelPlacement(){placing=null;first=null;hint.hidden=true;svg.style.cursor='';}
  function place(type,id){if(is3D()){toast('请先切换到 2D 平面后定位');return;}placing={type,id};first=null;hint.hidden=false;hint.textContent=type==='calibrate'?'依次点击底图上两个已知距离的点 · Esc 取消':type==='wall'?'依次点击墙体矩形的两个对角 · Esc 取消':'点击图纸确定位置 · Esc 取消';svg.style.cursor='crosshair';if(narrow())drawer(null);}
  function projectForm(){const p=state.project;return form('project',
    input('项目名称','name',p.name,'text','required maxlength="120"')+row(num('层高 / mm','height',p.height,'min="1800" max="10000" required'),num('地面完成层 / mm','floorFinish',p.floorFinish,'min="0" max="1000" required'))+row(num('墙面完成层参考厚度 / mm','wallFinish',p.wallFinish,'min="0" max="500" required'),selectInput('原图北向角 / °','northAngle',p.northAngle??0,[[0,'0° · 北朝上'],[90,'90° · 北朝右'],[180,'180° · 北朝下'],[270,'270° · 北朝左']]))+
    selectInput('北向调整方式','northMode',p.northMode||'plan',[['plan','旋转户型，北向固定'],['compass','户型固定，旋转指北针']])+
    '<p class="p-muted">原始轮廓以量房坐标录入。墙面完成层暂作交底记录，不自动缩减房间轮廓；最终净尺寸须复测。北向角表示原图中正北的方向。选择旋转户型时，图纸反向旋转使北朝上；选择旋转指北针时，保留原图朝向。2D、3D 与日照同步，原始尺寸坐标不变。</p>'+sourceFields(p));}
  function sitePanel(){
    const p=state.project,a=p.architecture;
    if(selected){const id=selected.id;
      if(selected.type==='wall'||selected.type==='window'){
        const wall=selected.type==='wall',o=(wall?a.walls:a.windows).find(v=>v[wall?5:4]===id);if(!o){selected=null;return sitePanel();}
        const info=(wall?p.wallInfo:p.windowInfo)[id]||{};
        return `<h2>${wall?'墙体':'窗户'}属性</h2><p class="p-code">${E(id)}</p>`+form(selected.type,
          row(num('左上 X / mm','x0',o[0],'required'),num('左上 Y / mm','y0',o[1],'required'))+row(num('右下 X / mm','x1',o[2],'required'),num('右下 Y / mm','y1',o[3],'required'))+
          (wall?selectInput('墙体性质','kind',o[4],[['u','待确认'],['b','承重墙'],['e','外墙'],['n','非承重墙'],['low','矮墙']]):row(num('窗台高 / mm','sill',info.sill??900,'min="0" required'),num('窗顶高 / mm','head',info.head??2400,'min="1" required')))+sourceFields(info)+
          '<p class="p-muted">编辑尺寸不会自动移动邻接门窗和点位，保存后请检查相邻关系。'+(wall?'删除隔墙会把两侧房间合并为一间（可撤销）。与工具栏「拆改墙体」不同：拆改只标记拟拆除。':'')+'</p>'+`<div class="p-actions">${button(wall?'删除墙段（可合并房间）':'删除图中对象','delete',`data-type="${selected.type}" data-id="${E(id)}"`)}</div>`);
      }
      if(selected.type==='room'){
        const r=a.rooms.find(v=>v.id===id),slide=a.slides.find(v=>v.id===id);if(!r){selected=null;return sitePanel();}
        return '<h2>房间轮廓</h2>'+form('room',input('房间名称','name',state.rooms[id].name,'text','required maxlength="120"')+areaInput('轮廓顶点 / mm · 每行 X,Y','poly',r.poly.map(v=>v.join(',')).join('\n'))+sourceFields(r)+ '<p class="p-muted">按顺时针或逆时针录入，不要重复首点。轮廓与墙体分别编辑，修改后请核对墙体。</p>'+button('删除房间轮廓','delete',`data-type="room" data-id="${E(id)}"`));
      }
      if(selected.type==='slide'){
        const d=a.slides.find(v=>v.id===id);if(!d){selected=null;return sitePanel();}
        return '<h2>推拉门洞口</h2>'+form('slide',input('名称','name',d.name||'推拉门','text','required maxlength="120"')+row(num('左上 X / mm','x0',d.rect[0],'required'),num('左上 Y / mm','y0',d.rect[1],'required'))+row(num('右下 X / mm','x1',d.rect[2],'required'),num('右下 Y / mm','y1',d.rect[3],'required'))+selectInput('轨道方向','v',String(d.v),[['true','竖向'],['false','横向']])+sourceFields(d)+button('删除推拉门','delete',`data-type="slide" data-id="${E(id)}"`));
      }
      if(selected.type==='door'){
        const d=a.doors.find(v=>v.id===id);if(!d){selected=null;return sitePanel();}
        const dirs=[['1,0','向右'],['-1,0','向左'],['0,1','向下'],['0,-1','向上']];
        return '<h2>门洞与开启方向</h2>'+form('door',input('名称','name',d.name,'text','required maxlength="120"')+row(num('铰点 X / mm','hx',d.h[0],'required'),num('铰点 Y / mm','hy',d.h[1],'required'))+row(num('门宽 / mm','len',d.len,'min="100" max="6000" required'),num('门高 / mm','height',d.height,'min="100" max="10000" required'))+row(selectInput('关闭方向','c',d.c.join(','),dirs),selectInput('开启方向','o',d.o.join(','),dirs))+row(num('洞口左上 X','x0',d.rect[0],'required'),num('洞口左上 Y','y0',d.rect[1],'required'))+row(num('洞口右下 X','x1',d.rect[2],'required'),num('洞口右下 Y','y1',d.rect[3],'required'))+sourceFields(d)+'<p class="p-muted">门洞需落在墙段间的空隙，本工具不自动切割相交墙体。</p>'+button('删除门','delete',`data-type="door" data-id="${E(id)}"`));
      }
    }
    return '<div class="p-kicker">SURVEY / 量房依据</div><h2>从真实尺寸开始</h2><p class="p-muted">'+(p.custom?'当前为自定义户型。':'当前是原项目示例户型，尚非你家的实测图。')+'优先上传户型图自动生成，再精调；也可空白绘制。橙色墙段表示性质待确认。墙体默认锁定：改墙请开工具栏「墙体编辑」；「拆改墙体」只标记拟拆除、不删墙不合并房间。</p>'+projectForm()+
      `<div class="p-actions">${button('上传户型图识别','recognize','',true)}${button('OCR 后处理规则','ocr-rules')}${button('建立空白户型','blank')}</div>`+
      '<p class="p-muted">「OCR 后处理规则」列出文字清理、房间名/面积解析与归属方式，便于换用其他 OCR 时复用。</p>'+
      '<h3>添加空间与构件</h3>'+`<div class="p-actions">${button('矩形房间','new-room')}${button('绘制墙段','draw-wall')}${button('添加窗','new-window')}${button('添加门','new-door')}${button('推拉门','new-slide')}</div>`+
      '<details><summary>全部构件 · '+(a.rooms.length+a.walls.length+a.windows.length+a.doors.length+a.slides.length)+'</summary><div class="p-list">'+a.rooms.map(r=>item(state.rooms[r.id].name,'房间 · '+(r.verified?'已复核':'待复核'),'room',r.id)).join('')+a.walls.map(w=>item(w[5],({'b':'承重','e':'外墙','u':'待确认','n':'非承重','low':'矮墙'})[w[4]],'wall',w[5])).join('')+a.windows.map(w=>item(w[4],'窗户','window',w[4])).join('')+a.doors.map(d=>item(d.name,'门洞','door',d.id)).join('')+a.slides.map(d=>item(d.name||'推拉门','推拉门洞口','slide',d.id)).join('')+'</div></details>'+underlayPanel();
  }
  function item(name,sub,type,id){return `<button class="p-item" data-action="edit" data-type="${type}" data-id="${E(id)}"><b>${E(name)}</b><small>${E(sub)}</small></button>`;}
  function underlayPanel(){const u=state.project.underlay;return '<h3>户型底图</h3><p class="p-muted">底图可单独上传作对照；完整自动生成请用「上传户型图识别」。按两个已知点校准比例。</p><label>上传 JPG / PNG / WebP<input type="file" id="underlayFile" accept="image/png,image/jpeg,image/webp"></label>'+(u?form('underlay',row(num('底图 X / mm','x',u.x),num('底图 Y / mm','y',u.y))+row(num('宽度 / mm','width',u.width,'min="1" required'),num('透明度 0–1','opacity',u.opacity,'min="0" max="1" step="0.05" required'))+num('校准参考距离 / mm','distance',1000,'min="1"')+`<div class="p-actions">${button('在图上选两点校准','calibrate')}${button('移除底图','remove-underlay')}</div>`):'');}
  function devicePanel(d){return `<h2>${E(d.name)}</h2><p class="p-code">${E(d.id)}</p>`+form('device',input('名称','name',d.name,'text','required maxlength="120"')+roomsSelect(d.roomId)+areaInput('生活需求 / 安装条件','need',d.need)+input('型号 / 安装资料说明','model',d.model,'text','maxlength="200"')+row(num('X / mm','x',d.x,'required'),num('Y / mm','y',d.y,'required'))+'<h3>需要哪些预留</h3><p class="p-muted">模板仅作起点，请按实际产品调整。</p>'+Object.entries(M.KINDS).map(([k,v])=>checkbox(v.label,'need-'+k,d.needs.includes(k))).join('')+`<div class="p-actions">${button('在图上重新定位','place',`data-type="device" data-id="${d.id}"`)}${button('补齐关联点位草稿','generate',`data-id="${d.id}"`)}${button('删除设备','delete',`data-type="device" data-id="${d.id}"`)}</div>`);}
  function pointPanel(q){const p=state.project;return `<h2>${E(q.name)}</h2><p class="p-code">${E(q.id)}</p>`+form('point',input('名称','name',q.name,'text','required maxlength="120"')+selectInput('类别','kind',q.kind,Object.entries(M.KINDS).map(([k,v])=>[k,v.label]))+roomsSelect(q.roomId)+row(num('X / mm','x',q.x,'required'),num('Y / mm','y',q.y,'required'))+num('距完成地面高度 / mm（空白=待定）','z',q.z,'min="0" max="10000"')+selectInput('所属墙面','wallId',q.wallId,[['','不依附墙面 / 待定'],...WALLS.map(w=>[w[5],w[5]])])+input('回路名称 / PoE 来源等','circuit',q.circuit,'text','maxlength="120"')+selectInput('施工状态','status',q.status,Object.entries(statusNames))+areaInput('施工备注 / 验收记录','note',q.note)+'<h3>服务哪些设备</h3><div class="p-links">'+(p.devices.map(d=>checkbox(E(d.name),'device-'+d.id,q.deviceIds.includes(d.id))).join('')||'<p class="p-muted">先添加设备，再建立关联。</p>')+'</div><h3>控制目标</h3><div class="p-links">'+(p.points.filter(t=>t.id!==q.id).map(t=>checkbox(E(t.name),'control-'+t.id,q.controls.includes(t.id))).join('')||'<p class="p-muted">暂无其他点位。</p>')+'</div>'+`<div class="p-actions">${button('在图上重新定位','place',`data-type="point" data-id="${q.id}"`)}${button('删除点位','delete',`data-type="point" data-id="${q.id}"`)}</div>`);}
  function servicePanel(){const p=state.project;
    if(selected?.type==='device'){const d=p.devices.find(d=>d.id===selected.id);if(d)return devicePanel(d);selected=null;}
    if(selected?.type==='point'){const q=p.points.find(q=>q.id===selected.id);if(q)return pointPanel(q);selected=null;}
    return '<div class="p-kicker">SERVICES / 设备与预留</div><h2>每个需求都有落点</h2><p class="p-muted">先列设备，再关联预留。图上圆点为施工点位，方框为设备位置。</p>'+selectInput('设备模板','preset','curtain',Object.entries(M.PRESETS).map(([k,v])=>[k,v.label]))+`<div class="p-actions">${button('添加设备需求','new-device','',true)}</div>`+selectInput('新增点位类别','newKind','power',Object.entries(M.KINDS).map(([k,v])=>[k,v.label]))+`<div class="p-actions">${button('在图上添加点位','new-point')}</div>`+
      '<hr class="p-divider">'+selectInput('图纸 / 清单房间筛选','roomFilter',roomFilter,[['','全部房间'],...roomOptions().slice(1)])+selectInput('点位图层','kindFilter',kindFilter,[['','全部类别'],...Object.entries(M.KINDS).map(([k,v])=>[k,v.label])])+'<h3>设备需求 · '+p.devices.length+'</h3>'+(p.devices.filter(d=>!roomFilter||d.roomId===roomFilter).map(d=>item(d.name,d.model||'型号待定','device',d.id)).join('')||'<div class="p-empty">添加一个真实需求，例如“卧室窗帘自动开合”。</div>')+'<h3>施工点位 · '+p.points.length+'</h3>'+(visiblePoints().map(q=>item(q.name,`${M.KINDS[q.kind].label} · ${q.z===null?'高度待定':q.z+' mm'} · ${statusNames[q.status]}`,'point',q.id)).join('')||'<div class="p-empty">点位需要记录坐标、高度及其服务的设备。</div>');
  }
  function checkPanel(){const all=M.checks(state),shown=all.filter(c=>checkLevel==='all'||c.level===checkLevel);return '<div class="p-kicker">REVIEW / 逐项复核</div><h2>设计检查</h2><p class="p-muted">只检查已录入的数据与已覆盖规则。未发现问题不代表通过施工验收。</p>'+selectInput('问题类型','checkLevel',checkLevel,[['all',`全部 ${all.length}`],['error','尺寸 / 关联冲突'],['missing','预留缺失'],['review','需要人工复核']])+shown.map(c=>`<article class="p-check ${c.level}"><span class="p-badge ${c.level}">${{error:'冲突',missing:'漏项',review:'待复核'}[c.level]}</span><b>${E(c.title)}</b><p class="p-muted">${E(c.detail)}</p>${button('定位并处理','focus',`data-id="${E(c.target)}"`)} ${button('记录现场问题','new-issue',`data-target="${E(c.target)}" data-title="${E(c.title)}"`)}</article>`).join('')+(shown.length?'':'<div class="p-empty">当前筛选下没有发现问题。请继续核实现场尺寸与产品安装资料。</div>');}
  function issuePanel(i){return '<h2>现场问题与复核</h2>'+form('issue',input('问题标题','title',i.title,'text','required maxlength="200"')+input('关联对象编号','target',i.target,'text','maxlength="100"')+input('责任人','owner',i.owner,'text','maxlength="120"')+selectInput('处理状态','status',i.status,[['open','待处理'],['working','处理中'],['done','已复核关闭']])+areaInput('问题 / 整改 / 实测结果','note',i.note)+`<label>现场照片<input type="file" id="issuePhoto" accept="image/png,image/jpeg,image/webp"></label>${i.photo?`<img class="p-photo" src="${i.photo}" alt="现场证据">${button('删除照片','remove-photo')}`:''}`+button('删除问题','delete',`data-type="issue" data-id="${i.id}"`));}
  function deliveryPanel(){const p=state.project;if(selected?.type==='issue'){const i=p.issues.find(v=>v.id===selected.id);if(i)return issuePanel(i);selected=null;}
    return '<div class="p-kicker">HANDOVER / 同一版图纸</div><h2>交底与项目备份</h2><p class="p-muted">按房间和工种导出带编号的图与清单，交底前保存版本。导出资料为尺寸交底辅助，不按打印图量尺。</p>'+selectInput('导出房间','roomFilter',roomFilter,[['','全屋'],...roomOptions().slice(1)])+selectInput('导出工种 / 点位类别','kindFilter',kindFilter,[['','全部点位'],...Object.entries(M.KINDS).map(([k,v])=>[k,v.label])])+`<div class="p-actions">${button('预览 / 打印交底','print','',true)}${button('导出交底 HTML','html')}${button('完整项目备份','backup')}${button('恢复项目备份','import')}</div>`+
      '<h3>冻结交底版本</h3>'+input('版本名称','versionName','水电交底版','text','maxlength="120"')+areaInput('本次变更 / 交底说明','versionNote','')+`<div class="p-actions">${button('保存当前版本','version')}</div>`+'<div class="p-list">'+p.versions.slice().reverse().map(v=>`<div class="p-item"><b>${E(v.name)}</b><small>${E(localDate(v.date))} · ${E(v.note)}</small><div class="p-actions">${button('查看此版交底','version-print',`data-id="${v.id}"`)}${button('恢复此版','restore-version',`data-id="${v.id}"`)}${button('删除版本','delete-version',`data-id="${v.id}"`)}</div></div>`).join('')+'</div><h3>现场问题 · '+p.issues.filter(i=>i.status!=='done').length+' 项未关闭</h3>'+button('新增问题 / 验收记录','new-issue')+p.issues.map(i=>item(i.title,({open:'待处理',working:'处理中',done:'已复核关闭'})[i.status]+' · '+(i.owner||'未指派'),'issue',i.id)).join('')+'<p class="p-muted">数据保存在当前浏览器。JSON 备份包含完整户型、底图、点位、照片和版本；HTML 交底资料用于查看与打印，不能恢复编辑。</p>';
  }
  function panel(){
    // Let index.html own the right panel while a measure line is selected (delete / details).
    if(ui.sel?.kind==='measure') return false;
    if(tab==='layout'){
      if(window.AiLayout?.isOpen()){window.AiLayout.render();return true;}
      return false;
    }
    if(window.AiLayout?.isOpen())window.AiLayout.close({silent:true});
    $('#panel').innerHTML='<div class="p-work">'+({site:sitePanel,services:servicePanel,checks:checkPanel,delivery:deliveryPanel}[tab])()+'</div>';return true;
  }
  function visiblePoints(){return state.project.points.filter(q=>(!roomFilter||q.roomId===roomFilter)&&(!kindFilter||q.kind===kindFilter));}
  /** Scrub version: v1 glyph scrub was too weak; v2 fills room interiors on the underlay. */
  const UNDERLAY_LABEL_SCRUB_VER=2;
  /** Paint underlay image + opaque room masks (masks hide any leftover OCR ink under live labels). */
  function paintUnderlay(){
    const u=state.project.underlay;
    if(!u){$('#gUnderlay').innerHTML='';return;}
    const mask=ROOMS.map(r=>{
      const pts=(r.poly||[]).map(v=>v.join(',')).join(' ');
      return pts?`<polygon points="${pts}" fill="#f7f4ee" opacity=".97"/>`:'';
    }).join('');
    $('#gUnderlay').innerHTML=`<image href="${u.src}" x="${u.x}" y="${u.y}" width="${u.width}" height="${u.height}" opacity="${u.opacity}"/>${mask}`;
  }
  /** One-shot: erase printed room name/area ink from an already-applied underlay so ghosts cannot linger after resize. */
  function scrubExistingUnderlayLabels(){
    const u=state.project.underlay, R=window.FloorplanRecognition;
    if(!u||u.labelScrubVer===UNDERLAY_LABEL_SCRUB_VER||u._labelScrubbing||!R?.scrubRoomLabelInk||!ROOMS.length)return;
    u._labelScrubbing=true;
    const img=new Image();
    img.onload=()=>{
      try{
        const c=document.createElement('canvas');
        c.width=img.naturalWidth||img.width; c.height=img.naturalHeight||img.height;
        if(c.width<8||c.height<8){u.labelsScrubbed=true;u.labelScrubVer=UNDERLAY_LABEL_SCRUB_VER;u._labelScrubbing=false;paintUnderlay();return;}
        const ctx=c.getContext('2d');
        ctx.drawImage(img,0,0);
        const sx=c.width/Math.max(1,u.width), sy=c.height/Math.max(1,u.height);
        const polys=ROOMS.map(r=>(r.poly||[]).map(([x,y])=>[(x-u.x)*sx,(y-u.y)*sy])).filter(p=>p.length>=3);
        const src=ctx.getImageData(0,0,c.width,c.height);
        const cleaned=R.scrubRoomLabelInk(src,polys);
        ctx.putImageData(new ImageData(cleaned.data,cleaned.width,cleaned.height),0,0);
        // Prefer jpeg to keep localStorage size in check; fall back if canvas is tainted somehow.
        let nextSrc;
        try{nextSrc=c.toDataURL('image/jpeg',.78);}catch(_){u._labelScrubbing=false;return;}
        if(state.project.underlay!==u){u._labelScrubbing=false;return;}
        u.src=nextSrc; u.labelsScrubbed=true; u.labelScrubVer=UNDERLAY_LABEL_SCRUB_VER; u._labelScrubbing=false;
        if(typeof ProjectModel?.validate==='function'){
          try{ProjectModel.validate(state);}catch(_){/* keep scrubbed src; validate may fail for unrelated reasons */}
        }
        if(typeof save==='function')try{save();}catch(_){}
        paintUnderlay();
      }catch(_){u._labelScrubbing=false;}
    };
    img.onerror=()=>{u._labelScrubbing=false;};
    img.src=u.src;
  }
  /** One-shot: turn white paper strips between rooms into real wall segments. */
  let partitionHealDone=false;
  function healMissingPartitions(){
    if(partitionHealDone||!state.project.custom)return;
    partitionHealDone=true;
    const R=window.FloorplanRecognition, a=state.project.architecture;
    if(!R?.fillMissingPartitionWalls||!a?.rooms?.length)return;
    const before=a.walls.length;
    const n=R.fillMissingPartitionWalls(a);
    if(!n)return;
    a.walls.slice(before).forEach(w=>{
      state.project.wallInfo[w[5]]||={source:'补全房间间空隙隔墙',verified:false};
    });
    // renderAll draws walls before ProjectUI.render; re-sync so the new grey wall shows now.
    if(typeof syncArchitecture==='function')syncArchitecture();
    if(typeof renderWalls==='function')renderWalls();
    if(typeof save==='function')try{save();}catch(_){}
  }
  function render(){
    document.body.dataset.workspace=tab;

    nav.querySelectorAll('[data-workspace]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.workspace===tab)));
    const p=state.project;
    document.querySelector('.brand b').textContent=p.name;
    document.querySelector('.brand b').removeAttribute('data-en');
    const north=Number.isFinite(p.northAngle)?p.northAngle:0;
    const facing= (p.northMode||'plan')==='plan' ? '北朝上 · 户型已定向' : {0:'北朝上',90:'北朝右',180:'北朝下',270:'北朝左'}[([0,90,180,270].includes(north)?north:0)]||'北朝上';
    $('#subtitle').textContent=`${p.custom?'自定义户型':'示例户型'} · ${p.verified?'已复核':'待实测复核'} · ${facing} · 尺寸 mm`;
    healMissingPartitions();
    const u=p.underlay;
    paintUnderlay();
    // Re-scrub when missing or on older scrub versions (v1 left ghost ink under translucent rooms).
    if(u&&u.labelScrubVer!==UNDERLAY_LABEL_SCRUB_VER)scrubExistingUnderlayLabels();
    // Persistent north arrow: classic cartographic N (filled north / open south), sheet-corner, away from walls.
    const displayBounds=planViewBounds(), m=Math.min(displayBounds.w,displayBounds.h);
    const nx=displayBounds.x+Math.max(90,m*0.005), ny=displayBounds.y+Math.max(220,m*0.015), ns=Math.max(72,m*0.012);
    const sw=Math.max(7,ns*0.065);
    const northSvg=`<g id="gNorth" pointer-events="none" transform="translate(${nx} ${ny}) rotate(${(p.northMode||'plan')==='compass'?north:0})"><polygon points="0,${-ns} ${ns*.42},0 ${-ns*.42},0" fill="#1a1a1a"/><polygon points="0,${ns} ${ns*.42},0 ${-ns*.42},0" fill="#fff" stroke="#1a1a1a" stroke-width="${sw}" stroke-linejoin="miter"/><text y="${-ns-ns*.2}" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="${ns*.46}" fill="#1a1a1a" font-weight="700">N</text></g>`;
    const existingNorth=$('#gNorth'); if(existingNorth) existingNorth.remove();
    svg.insertAdjacentHTML('beforeend', northSvg);
    // Keep rooms opaque so underlay printed labels never show through as ghosts.
    // Underlay stays visible only outside / in gaps (and at its own opacity).
    $('#gRooms').style.opacity='1';
    const show=tab!=='layout';
    $('#gServices').innerHTML=(show?p.devices.filter(d=>!roomFilter||d.roomId===roomFilter).map(d=>`<g data-device="${d.id}" transform="translate(${d.x} ${d.y})"><rect x="-95" y="-95" width="190" height="190" rx="25" fill="#ffffff" stroke="#246b9a" stroke-width="2" vector-effect="non-scaling-stroke"/><text y="-140" font-size="135" text-anchor="middle" fill="#246b9a" paint-order="stroke" stroke="white" stroke-width="22">${E(d.name)}</text></g>`).join('')+visiblePoints().map(q=>`<g data-point="${q.id}" transform="translate(${q.x} ${q.y})" class="${selected?.id===q.id?'p-picked':''}"><circle r="90" fill="${M.KINDS[q.kind].color}" stroke="white" stroke-width="1.5" vector-effect="non-scaling-stroke"/><text y="40" font-size="120" text-anchor="middle" fill="white" pointer-events="none">${M.KINDS[q.kind].symbol}</text><text x="115" y="45" font-size="120" fill="${M.KINDS[q.kind].color}" paint-order="stroke" stroke="white" stroke-width="22" pointer-events="none">${E(q.name)}</text></g>`).join(''):'');
    if(selected?.type==='wall'||selected?.type==='window'){const r=(selected.type==='wall'?WALLS:WINS).find(w=>w[selected.type==='wall'?5:4]===selected.id);if(r)$('#gServices').insertAdjacentHTML('beforeend',`<g pointer-events="none"><rect x="${r[0]-30}" y="${r[1]-30}" width="${r[2]-r[0]+60}" height="${r[3]-r[1]+60}" fill="none" stroke="#246b9a" stroke-width="3" vector-effect="non-scaling-stroke"/><text x="${(r[0]+r[2])/2}" y="${r[1]-130}" font-size="140" text-anchor="middle" fill="#246b9a">${r[2]-r[0]} × ${r[3]-r[1]} mm</text></g>`);}
  }
  function saved(ok){dirtyStorage=!ok;$('#saveState').textContent=ok?'已保存到本机 · 请定期备份':'未持久保存！请导出备份';$('#saveState').classList.toggle('unsaved',!ok);}
  const oldOpen=renderOpenings;
  renderOpenings=function(){oldOpen();if(state.project.custom){const g=$('#gOpen');const path=g.querySelector('path[d^="M3350"]');path?.remove();g.querySelector('text[x="3380"]')?.remove();}};
  window.ProjectUI={panel,render,saved,cancelPlacement,focusTarget,selectWall,clearWallSelection,workspace:()=>tab,editPoint3D(id){tab='services';selected={type:'point',id};if(ui.sel?.kind==='wall'||ui.sel?.kind==='room')ui.sel=null;if(typeof leavePlanEditMode==='function')leavePlanEditMode();renderAll();document.querySelector('aside.right').scrollTop=0;drawer('panel',true);},afterRecognize(){selected=null;ui.sel=null;roomFilter='';kindFilter='';tab='site';document.body.dataset.workspace='site';cancelPlacement();if(ui.tool!=='select')setTool('select');if(typeof setWallEdit==='function')setWallEdit(false,{silent:true,force:true});renderAll();fitView();drawer('panel',true);const tip=$('#tip');if(tip&&typeof TIPS==='function')tip.textContent=TIPS()['2d']||tip.textContent;const nW=(state.project.architecture.walls||[]).length,nR=(state.project.architecture.rooms||[]).length;toast(`已生成 ${nR} 个房间、${nW} 段墙：可在本页拖房间改尺寸；改墙请开「墙体编辑」（默认关闭）。布置家具请切「布置」。「拆改」只标记拟拆除`);}};
  const originalSelect=select;
  select=function(sel){
    if(sel?.kind==='furn'){
      tab='layout';selected=null;document.body.dataset.workspace='layout';
      if(typeof leavePlanEditMode==='function')leavePlanEditMode();
      if(window.AiLayout?.isOpen())window.AiLayout.close({silent:true});
    } else if(sel?.kind==='room'){
      // 户型页：同步右侧量房属性；布置页：仅地面材料面板，不改几何
      if(tab==='site') selected={type:'room',id:sel.id};
      else selected=null;
    } else if(sel?.kind==='wall'){
      ensureSite();document.body.dataset.workspace='site';
      selected={type:'wall',id:sel.id};
    } else if(!sel||(sel.kind!=='wall'&&sel.kind!=='room')){
      if(selected?.type==='wall'||selected?.type==='room')selected=null;
    }
    originalSelect(sel);render();
    const tip=$('#tip'); if(tip&&typeof TIPS==='function'&&!is3D()) tip.textContent=TIPS()['2d'];
  };
  const originalAdd=addItem;
  addItem=function(...args){
    tab='layout';selected=null;document.body.dataset.workspace='layout';
    if(typeof leavePlanEditMode==='function')leavePlanEditMode();
    if(window.AiLayout?.isOpen())window.AiLayout.close({silent:true});
    originalAdd(...args);
  };
  nav.addEventListener('click',e=>{
    const b=e.target.closest('[data-workspace]');if(!b)return;
    cancelPlacement();
    const next=b.dataset.workspace;
    tab=next;selected=null;ui.sel=null;
    if(tab!=='layout'&&ceilingMode){ceilingMode=false;document.body.classList.remove('ceiling-mode');$('#ceilingView').classList.remove('on');buildLib();}
    document.body.dataset.workspace=tab;
    if(tab!=='site'&&typeof leavePlanEditMode==='function')leavePlanEditMode();
    if(tab!=='layout'&&window.AiLayout?.isOpen())window.AiLayout.close({silent:true});
    renderAll();
    const tip=$('#tip'); if(tip&&typeof TIPS==='function'&&!is3D()) tip.textContent=TIPS()['2d'];
    document.querySelector('aside.right').scrollTop=0;drawer('panel',true);
  });
  $('#panel').addEventListener('submit',e=>{const f=e.target.closest('form[data-form]');if(!f)return;e.preventDefault();
    const v=new FormData(f),get=k=>String(v.get(k)||''),n=k=>safeNum(get(k)),checked=k=>v.has(k),kind=f.dataset.form,id=selected?.id;
    try{transact(s=>{const p=s.project,a=p.architecture;
      const source={source:get('source'),verified:checked('verified')};
      if(kind==='project'){const north=([0,90,180,270].includes(n('northAngle'))?n('northAngle'):0);Object.assign(p,{name:get('name'),height:n('height'),floorFinish:n('floorFinish'),wallFinish:n('wallFinish'),northAngle:north,northMode:get('northMode'),...source});if(p.height-p.floorFinish<1800)throw new Error('装修完成后净高不能小于 1800 mm');}
      if(kind==='wall'||kind==='window'){
        const wall=kind==='wall',arr=wall?a.walls:a.windows,idx=arr.findIndex(o=>o[wall?5:4]===id),coords=['x0','y0','x1','y1'].map(n);
        if(wall){arr[idx]=[...coords,get('kind'),id];p.wallInfo[id]=source;}
        else {if(n('head')<=n('sill')||n('head')>p.height-p.floorFinish)throw new Error('窗顶须高于窗台，且不超过完成后净高');arr[idx]=[...coords,id];p.windowInfo[id]={...source,sill:n('sill'),head:n('head')};}
        p.custom=true;
      }
      if(kind==='room'){const r=a.rooms.find(r=>r.id===id),poly=get('poly').trim().split(/\n+/).map(l=>l.trim().split(/[,，\s]+/).map(Number));if(!M.polygonOK(poly))throw new Error('请输入至少三个不交叉的顶点，每行 X,Y');r.poly=poly;r.at=[poly.reduce((v,t)=>v+t[0],0)/poly.length,poly.reduce((v,t)=>v+t[1],0)/poly.length];Object.assign(r,source,{name:get('name')});s.rooms[id].name=get('name');p.custom=true;}
      if(kind==='slide'){Object.assign(a.slides.find(d=>d.id===id),{name:get('name'),rect:['x0','y0','x1','y1'].map(n),v:get('v')==='true',...source});p.custom=true;}
      if(kind==='door'){Object.assign(a.doors.find(d=>d.id===id),{name:get('name'),h:[n('hx'),n('hy')],len:n('len'),height:n('height'),c:get('c').split(',').map(Number),o:get('o').split(',').map(Number),rect:['x0','y0','x1','y1'].map(n),...source});p.custom=true;}
      if(kind==='device'){const d=p.devices.find(d=>d.id===id);Object.assign(d,{name:get('name'),roomId:get('roomId'),need:get('need'),model:get('model'),x:n('x'),y:n('y'),needs:Object.keys(M.KINDS).filter(k=>checked('need-'+k))});}
      if(kind==='point'){const q=p.points.find(q=>q.id===id);const moved=q.x!==n('x')||q.y!==n('y')||q.z!==(get('z')===''?null:n('z'));Object.assign(q,{name:get('name'),kind:get('kind'),roomId:get('roomId'),x:n('x'),y:n('y'),z:get('z')===''?null:n('z'),wallId:get('wallId'),circuit:get('circuit'),status:get('status'),note:get('note'),deviceIds:p.devices.filter(d=>checked('device-'+d.id)).map(d=>d.id),controls:p.points.filter(t=>t.id!==id&&checked('control-'+t.id)).map(t=>t.id)});if(moved&&['installed','accepted'].includes(q.status)){q.status='planned';q.note+='\n位置已修改，需重新确认施工变更。';}}
      if(kind==='issue'){Object.assign(p.issues.find(i=>i.id===id),{title:get('title'),target:get('target'),owner:get('owner'),status:get('status'),note:get('note')});}
      if(kind==='underlay'){const u=p.underlay,k=n('width')/u.width;Object.assign(u,{x:n('x'),y:n('y'),width:n('width'),height:u.height*k,opacity:n('opacity')});}
    });toast(dirtyStorage?'当前修改尚未持久保存，请备份':'修改已保存');}catch(err){actionError(err);}
  });
  function roomAt(x,y){return ROOMS.find(r=>M.inside(x,y,r.poly))?.id||'';}
  function newPoint(s,kind,x,y,deviceId){const p=s.project,id='P'+String(p.pointSerial=(p.pointSerial||0)+1).padStart(3,'0');let nextId=id;while(p.points.some(q=>q.id===nextId)){nextId='P'+String(++p.pointSerial).padStart(3,'0');}const q={id:nextId,name:nextId+' '+M.KINDS[kind].label,kind,x,y,z:null,roomId:roomAt(x,y),wallId:'',circuit:'',note:'',deviceIds:deviceId?[deviceId]:[],controls:[],status:'planned'};p.points.push(q);return q;}
  function addRoomDialog(){
    document.querySelector('aside.right').scrollTop=0;
    $('#panel').innerHTML='<div class="p-work"><h2>添加矩形房间</h2><p class="p-muted">生成房间轮廓、四周墙体和一处门洞；墙体性质均为待确认。与其他房间共用的墙需随后合并或删除重复墙段。</p><form id="newRoomForm">'+input('房间名称','name','新房间','text','required maxlength="120"')+row(num('左上 X / mm','x',0,'required'),num('左上 Y / mm','y',0,'required'))+row(num('室内宽 / mm','width',3600,'min="1200" max="30000" required'),num('室内深 / mm','depth',4200,'min="1200" max="30000" required'))+num('墙厚 / mm','thickness',200,'min="50" max="1000" required')+'<div class="p-error" role="alert"></div><div class="p-actions"><button type="submit" class="btn primary">生成房间与墙体</button>'+button('返回','back')+'</div></form></div>';
    $('#newRoomForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),x=+f.get('x'),y=+f.get('y'),w=+f.get('width'),h=+f.get('depth'),t=+f.get('thickness'),id=M.uid('room');try{transact(s=>{const a=s.project.architecture,len=Math.min(900,w/3),mid=x+w/2;
      const r={id,name:String(f.get('name')),poly:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],at:[x+w/2,y+h/2],mat:'wood',source:'手动录入，待实测',verified:false};a.rooms.push(r);s.rooms[id]={name:r.name,mat:'wood'};
      [[x-t,y-t,x+w+t,y],[x-t,y,x,y+h+t],[x+w,y,x+w+t,y+h+t],[x,y+h,mid-len/2,y+h+t],[mid+len/2,y+h,x+w,y+h+t]].forEach(v=>a.walls.push([...v,'u',M.uid('wall')]));
      a.doors.push({id:M.uid('door'),name:r.name+'门',rect:[mid-len/2,y+h,mid+len/2,y+h+t],h:[mid-len/2,y+h],c:[1,0],o:[0,-1],len,height:2100,source:'待实测',verified:false});s.project.custom=true;selected={type:'room',id};
    });fitView();}catch(err){actionError(err);}};
  }
  async function imageData(file){
    if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('请选择 PNG、JPG 或 WebP 图片');if(file.size>15000000)throw new Error('原图请小于 15 MB');
    const url=URL.createObjectURL(file);try{const im=new Image();im.src=url;await im.decode();const scale=Math.min(1,1600/Math.max(im.width,im.height)),cv=document.createElement('canvas');cv.width=Math.round(im.width*scale);cv.height=Math.round(im.height*scale);cv.getContext('2d').drawImage(im,0,0,cv.width,cv.height);return {src:cv.toDataURL('image/jpeg',.78),ratio:im.height/im.width};}finally{URL.revokeObjectURL(url);}
  }
  $('#panel').addEventListener('change',async e=>{
    const name=e.target.name;if(['roomFilter','kindFilter','checkLevel'].includes(name)){if(name==='roomFilter')roomFilter=e.target.value;if(name==='kindFilter')kindFilter=e.target.value;if(name==='checkLevel')checkLevel=e.target.value;renderAll();}
    if(e.target.id==='underlayFile'||e.target.id==='issuePhoto')try{const targetId=selected?.id,isUnderlay=e.target.id==='underlayFile',data=await imageData(e.target.files[0]);transact(s=>{if(isUnderlay)s.project.underlay={src:data.src,x:0,y:0,width:10000,height:10000*data.ratio,opacity:.5};else{s.project.issues.find(i=>i.id===targetId).photo=data.src;}});}catch(err){actionError(err);}
  });
  $('#panel').addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b)return;const act=b.dataset.action,id=b.dataset.id,type=b.dataset.type;
    try{
      if(act==='back'){selected=null;if(ui.sel?.kind==='wall')ui.sel=null;renderAll();document.querySelector('aside.right').scrollTop=0;}
      if(act==='edit'){
        if(type==='wall'&&!ensureWallEdit()){toast('请先开启「墙体编辑」');return;}
        if(type==='room'||type==='wall'||type==='window'||type==='door'||type==='slide')ensureSite();
        selected={type,id};
        ui.sel=type==='wall'?{kind:'wall',id}:type==='room'?{kind:'room',id}:(ui.sel?.kind==='wall'||ui.sel?.kind==='room'?null:ui.sel);
        renderAll();document.querySelector('aside.right').scrollTop=0;
      }
      if(act==='focus')focusTarget(id);
      if(act==='recognize'){window.RecognitionUI?.open();return;}
      if(act==='ocr-rules'){window.RecognitionUI?.openRules?.()||window.RecognitionUI?.open({rules:true});return;}
      if(act==='blank'){if(!confirm('建立空白户型？当前方案可撤销恢复，建议先导出备份。'))return;transact(s=>{s.furniture=[];s.rooms={};s.demolished=[];s.measures=[];s.layoutSchemes=M.emptyLayoutSchemes();Object.assign(s.project,{custom:true,verified:false,source:'待实测',architecture:{walls:[],windows:[],doors:[],slides:[],rooms:[]},wallInfo:{},windowInfo:{},devices:[],points:[],issues:[],underlay:null});});selected=null;roomFilter='';kindFilter='';fitView();renderAll();}
      if(act==='new-room')addRoomDialog();
      if(act==='draw-wall'){ensureWallEdit();place('wall');}
      if(act==='new-window'){const id=M.uid('win');transact(s=>{s.project.architecture.windows.push([0,0,1200,200,id]);s.project.windowInfo[id]={source:'待实测',verified:false,sill:900,head:2400};s.project.custom=true;selected={type:'window',id};});}
      if(act==='new-slide'){const id=M.uid('slide');transact(s=>{s.project.architecture.slides.push({id,name:'推拉门',rect:[0,0,1800,200],v:false,source:'待实测',verified:false});s.project.custom=true;selected={type:'slide',id};});}
      if(act==='new-door'){const id=M.uid('door');transact(s=>{s.project.architecture.doors.push({id,name:'新门',rect:[0,0,900,200],h:[0,0],c:[1,0],o:[0,1],len:900,height:2100,source:'待实测',verified:false});s.project.custom=true;selected={type:'door',id};});}
      if(act==='new-device'){document.querySelector('aside.right').scrollTop=0;const preset=$('#panel [name=preset]').value,t=M.PRESETS[preset],id=M.uid('device'),r=ROOMS.find(r=>r.id===roomFilter)||ROOMS[0],pos=r?.at||[0,0];transact(s=>{s.project.devices.push({id,name:t.label,kind:preset,need:'',model:'',roomId:r?.id||'',x:pos[0],y:pos[1],needs:[...t.needs]});selected={type:'device',id};});}
      if(act==='new-point'){const kind=$('#panel [name=newKind]').value;place('new-point',kind);}
      if(act==='place')place(type,id);
      if(act==='generate'){transact(s=>{const d=s.project.devices.find(d=>d.id===id);let n=0;d.needs.forEach(k=>{if(!s.project.points.some(q=>q.kind===k&&q.deviceIds.includes(id))){const q=newPoint(s,k,d.x+200*(++n),d.y,id);q.roomId=d.roomId;q.note='根据设备需求生成的草稿，位置和高度待现场确认。';}});});toast('已补齐缺失点位草稿，请逐个确认位置和高度');}
      if(act==='delete'){
        if(type==='wall'){
          if(!ui.wallEdit&&!ensureWallEdit()){toast('请先开启「墙体编辑」');return;}
          if(typeof deleteWallById==='function'){deleteWallById(id);selected=null;return;}
        }
        if(!confirm('删除该对象？相关设备和施工点位将保留，失效关联会在检查中提示。可撤销恢复。'))return;
        transact(s=>{const p=s.project,a=p.architecture;if(type==='window'){a.windows=a.windows.filter(w=>w[4]!==id);delete p.windowInfo[id];p.custom=true;}if(type==='room'){a.rooms=a.rooms.filter(r=>r.id!==id);delete s.rooms[id];p.custom=true;}if(type==='slide'){a.slides=a.slides.filter(d=>d.id!==id);p.custom=true;}if(type==='door'){a.doors=a.doors.filter(d=>d.id!==id);p.custom=true;}if(type==='point')p.points=p.points.filter(q=>q.id!==id);if(type==='device')p.devices=p.devices.filter(d=>d.id!==id);if(type==='issue')p.issues=p.issues.filter(i=>i.id!==id);selected=null;});
      }
      if(act==='calibrate'){const distance=+$('#panel [name=distance]').value;if(!Number.isFinite(distance)||distance<=0)throw new Error('请输入已知参考距离');place('calibrate',distance);}
      if(act==='remove-underlay')transact(s=>s.project.underlay=null);
      if(act==='remove-photo')transact(s=>s.project.issues.find(i=>i.id===selected.id).photo='');
      if(act==='backup')backup();
      if(act==='import')$('#fileIn').click();
      if(act==='print'||act==='html')exportHandover(state,null,act==='print');
      if(act==='version'){
        const name=$('#panel [name=versionName]').value.trim(),note=$('#panel [name=versionNote]').value;if(!name)throw new Error('请输入版本名称');
        transact(s=>{if(s.project.versions.length>=12)throw new Error('最多保留 12 版，请备份后删除旧版');const data=M.clone(s);data.project.versions=[];s.project.versions.push({id:M.uid('version'),name,note,date:new Date().toISOString(),data});});toast('交底版本已冻结');
      }
      if(act==='version-print'){const v=state.project.versions.find(v=>v.id===id);exportHandover(v.data,v,true);}
      if(act==='restore-version'){const v=state.project.versions.find(v=>v.id===id);if(!confirm('恢复此交底版本？当前版本列表会保留，本次恢复可撤销。'))return;const versions=M.clone(state.project.versions);transact(s=>{Object.keys(s).forEach(k=>delete s[k]);Object.assign(s,M.clone(v.data));s.project.versions=versions;});selected=null;fitView();}
      if(act==='delete-version'){if(confirm('删除这个冻结版本？可撤销恢复。'))transact(s=>s.project.versions=s.project.versions.filter(v=>v.id!==id));}
      if(act==='new-issue'){document.querySelector('aside.right').scrollTop=0;const id=M.uid('issue');transact(s=>{s.project.issues.push({id,title:b.dataset.title||'现场复核',target:b.dataset.target||'',owner:'',note:'',status:'open',photo:''});selected={type:'issue',id};tab='delivery';});}
    }catch(err){actionError(err);}
  });
  svg.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    const hitPoint=e.target.closest('[data-point]'),hitDevice=e.target.closest('[data-device]');
    // 房间/墙体交给主平面交互（户型页可拖边改尺寸）；此处只拦点位/设备与放置
    if(!placing && !(hitPoint||hitDevice))return;
    e.stopImmediatePropagation();e.preventDefault();const pt=toMM(e),x=Math.round(pt.x/10)*10,y=Math.round(pt.y/10)*10;
    try{
      if(placing){const cmd=placing;
        if(['calibrate','wall'].includes(cmd.type)&&!first){first={x,y};hint.textContent='点击第二个参考点 · Esc 取消';return;}
        transact(s=>{
          if(cmd.type==='new-point'){const q=newPoint(s,cmd.id,x,y);selected={type:'point',id:q.id};tab='services';}
          if(cmd.type==='device'||cmd.type==='point'){const q=s.project[cmd.type==='device'?'devices':'points'].find(q=>q.id===cmd.id);if(!q)throw new Error('对象已不存在');q.x=x;q.y=y;q.roomId=roomAt(x,y);if(cmd.type==='point'&&['installed','accepted'].includes(q.status)){q.status='planned';q.note+='\n位置变更，需重新确认施工。';}}
          if(cmd.type==='wall'){const id=M.uid('wall');s.project.architecture.walls.push([Math.min(x,first.x),Math.min(y,first.y),Math.max(x,first.x),Math.max(y,first.y),'u',id]);s.project.custom=true;selected={type:'wall',id};ui.sel={kind:'wall',id};}
          if(cmd.type==='calibrate'){const dist=Math.hypot(x-first.x,y-first.y);if(dist<10)throw new Error('两点太近，请重新选择');const u=s.project.underlay,k=cmd.id/dist;u.x=first.x+(u.x-first.x)*k;u.y=first.y+(u.y-first.y)*k;u.width*=k;u.height*=k;}
        });cancelPlacement();drawer('panel',true);return;
      }
      if(hitPoint){selected={type:'point',id:hitPoint.dataset.point};tab='services';if(typeof leavePlanEditMode==='function')leavePlanEditMode();ui.sel=null;}
      else if(hitDevice){selected={type:'device',id:hitDevice.dataset.device};tab='services';if(typeof leavePlanEditMode==='function')leavePlanEditMode();ui.sel=null;}
      renderAll();document.querySelector('aside.right').scrollTop=0;drawer('panel',true);
    }catch(err){actionError(err);cancelPlacement();}
  },true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){cancelPlacement();}if(e.target.matches('textarea,select'))e.stopImmediatePropagation();},true);
  window.addEventListener('beforeunload',e=>{if(dirtyStorage){e.preventDefault();e.returnValue='';}});
  function backup(){download((state.project.name||'装修项目')+'-完整备份.json',new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));}
  $('#exportJson').textContent='完整项目备份';$('#exportJson').removeAttribute('data-en');$('#exportJson').onclick=backup;
  $('#fileIn').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>35000000)throw new Error('备份文件请小于 35 MB');const raw=JSON.parse(await file.text()),next=fixState(raw);if(!confirm('载入此项目备份？当前方案可撤销恢复。'))return;const before=snap();state=next;selected=null;ui.sel=null;roomFilter='';kindFilter='';cancelPlacement();commit(before);renderAll();fitView();toast('项目已完整恢复');}catch(err){toast('导入失败：'+err.message);}};
  function handoverHTML(s,version){
    const p=s.project,a=p.architecture,room=a.rooms.find(r=>r.id===roomFilter),roomName=room?s.rooms[room.id].name:'全屋';
    const points=p.points.filter(q=>(!room||q.roomId===room.id)&&(!kindFilter||q.kind===kindFilter));
    const devices=p.devices.filter(d=>!room||d.roomId===room.id);
    const coords=room?room.poly:[...a.rooms.flatMap(r=>r.poly),...a.walls.flatMap(w=>[[w[0],w[1]],[w[2],w[3]]]),...points.map(q=>[q.x,q.y])];
    const xs=coords.map(p=>p[0]),ys=coords.map(p=>p[1]),bx=(xs.length?Math.min(...xs):0)-800,by=(ys.length?Math.min(...ys):0)-800,bw=(xs.length?Math.max(...xs)-Math.min(...xs):4000)+1600,bh=(ys.length?Math.max(...ys)-Math.min(...ys):4000)+1600;
    const fontsize=Math.max(bw/100,70),mark=Math.max(bw/180,55);
    const diagram=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bx} ${by} ${bw} ${bh}" role="img" aria-label="${E(roomName)}点位交底图"><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="white"/>`+
      a.rooms.map(r=>`<polygon points="${r.poly.map(v=>v.join(',')).join(' ')}" fill="${r.id===room?.id?'#e9f3fa':'#f5f7f9'}" stroke="#bac9d5" stroke-width="8"/>${r.at?`<text x="${r.at[0]}" y="${r.at[1]}" text-anchor="middle" font-size="${fontsize*1.5}" fill="#566e80">${E(s.rooms[r.id].name)}</text>`:''}`).join('')+
      s.furniture.map(f=>`<polygon points="${M.footprint(f).map(v=>v.join(',')).join(' ')}" fill="#eef1f4" stroke="#99aab6" stroke-width="10"/><text x="${f.cx}" y="${f.cy}" text-anchor="middle" font-size="${fontsize}" fill="#657b8e">${E(f.name)}</text>`).join('')+
      a.walls.map(w=>`<rect x="${w[0]}" y="${w[1]}" width="${w[2]-w[0]}" height="${w[3]-w[1]}" fill="${s.demolished.includes(w[5])?'#fae4dc':w[4]==='u'?'#d0b477':'#526474'}"/>`).join('')+
      a.windows.map(w=>`<rect x="${w[0]}" y="${w[1]}" width="${w[2]-w[0]}" height="${w[3]-w[1]}" fill="#c7e6f8" stroke="#246b9a" stroke-width="12"/>`).join('')+
      a.doors.map(d=>{const end=[d.h[0]+d.o[0]*d.len,d.h[1]+d.o[1]*d.len],closed=[d.h[0]+d.c[0]*d.len,d.h[1]+d.c[1]*d.len],sweep=d.o[0]*d.c[1]-d.o[1]*d.c[0]>0?1:0;return `<path d="M${d.h.join(' ')} L${end.join(' ')} A${d.len} ${d.len} 0 0 ${sweep} ${closed.join(' ')}" fill="none" stroke="#567082" stroke-width="12"/>`;}).join('')+
      a.slides.map(d=>`<rect x="${d.rect[0]}" y="${d.rect[1]}" width="${d.rect[2]-d.rect[0]}" height="${d.rect[3]-d.rect[1]}" fill="none" stroke="#246b9a" stroke-width="12"/>`).join('')+
      points.map(q=>`<circle cx="${q.x}" cy="${q.y}" r="${mark}" fill="${M.KINDS[q.kind].color}"/><text x="${q.x+mark*1.4}" y="${q.y+fontsize/3}" font-size="${fontsize*1.2}" fill="${M.KINDS[q.kind].color}" stroke="white" stroke-width="25" paint-order="stroke">${E(q.id)}</text>`).join('')+'</svg>';
    const table=(heads,rows)=>`<table><thead><tr>${heads.map(h=>`<th>${E(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>'<tr>'+r.map(v=>`<td>${E(v??'—')}</td>`).join('')+'</tr>').join('')||`<tr><td colspan="${heads.length}">暂无记录</td></tr>`}</tbody></table>`;
    const checks=M.checks(s),targets=new Set([...points.map(q=>q.id),...devices.map(d=>d.id)]);
    const subset=checks.filter(c=>!room||targets.has(c.target)||c.target==='project'||a.walls.some(w=>w[5]===c.target)||a.doors.some(d=>d.id===c.target)||a.windows.some(w=>w[4]===c.target));
    const pointRows=points.map(q=>[q.id,q.name,M.KINDS[q.kind].label,s.rooms[q.roomId]?.name||'待分配',`${q.x}, ${q.y}`,q.z===null?'待定':q.z+' mm',q.wallId||'待定 / 无',q.circuit||'待确认',q.deviceIds.map(id=>p.devices.find(d=>d.id===id)?.name||id+'（缺失）').join('、'),q.controls.join('、'),statusNames[q.status],q.note]);
    const title=p.name+' · '+(version?.name||'当前编辑稿');
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${E(title)}</title><style>
      *{box-sizing:border-box}body{font:14px/1.6 -apple-system,'PingFang SC',sans-serif;color:#20394f;margin:32px auto;padding:0 28px;max-width:1400px}h1{font-size:26px;margin:12px 0}h2{font-size:18px;margin:28px 0 10px;border-bottom:2px solid #246b9a;padding-bottom:6px}p{white-space:pre-wrap}small{color:#657b8e}svg{width:100%;max-height:650px;border:1px solid #d9e3ec}table{border-collapse:collapse;width:100%;font-size:11px;table-layout:fixed}th,td{border:1px solid #ccd8e2;padding:6px;text-align:left;word-break:break-word;white-space:pre-wrap}th{background:#edf4f9}thead{display:table-header-group}tr{break-inside:avoid}button{background:#246b9a;color:white;border:0;border-radius:4px;padding:10px 18px;cursor:pointer}.note{background:#eef5fa;padding:12px}.photo{max-width:400px;max-height:250px}.legend{display:flex;gap:16px;flex-wrap:wrap}.legend span{font-weight:600}@page{size:A4 landscape;margin:12mm}@media print{body{margin:0;padding:0;font-size:11px;max-width:none}button{display:none}svg{max-height:160mm}h2{break-after:avoid}table{font-size:9px}a{color:inherit}}
      </style><button onclick="window.print()">打印 / 保存为 PDF</button><small>　筑家 · 装修交底辅助资料</small><h1>${E(title)}</h1><p>${E(roomName)} / ${E(kindFilter?M.KINDS[kindFilter].label:'全部工种')}　日期：${E(localDate(version?.date||new Date().toISOString()))}</p><p>${E(version?.note||'尚未冻结为交底版本，请核对后再施工。')}</p><div class="note">尺寸单位 mm，点位高度以装修完成地面为基准。图为示意，不按打印比例量尺，以标注数值和现场复测为准。未录入的条件未参与检查。墙面完成层仅记录参考厚度，未自动扣减平面轮廓。</div>
      <h2>点位图</h2>${diagram}<p class="legend">${Object.entries(M.KINDS).map(([k,v])=>`<span style="color:${v.color}">${v.symbol} ${v.label}</span>`).join('')}</p><p>层高 ${p.height} mm · 地面完成层 ${p.floorFinish} mm · 墙面完成层参考 ${p.wallFinish} mm · 户型依据：${E(p.source)} · ${p.verified?'已复核':'待复核'}</p>
      <h2>施工点位清单 · ${points.length}</h2>${table(['编号','名称','类别','房间','坐标 X,Y','完成面高度','墙面','回路 / 来源','服务设备','控制目标','状态','备注 / 验收'],pointRows)}
      <h2>设备与生活需求</h2>${table(['设备','房间','需求','型号 / 安装依据','所需预留'],devices.map(d=>[d.name,s.rooms[d.roomId]?.name||'待分配',d.need,d.model||'待确定',d.needs.map(k=>M.KINDS[k].label).join('、')]))}
      <h2>尺寸依据（全屋构件）</h2>${table(['对象','尺寸 / 坐标 mm','依据','复核'],[...a.rooms.map(r=>[s.rooms[r.id].name,r.poly.map(v=>v.join(',')).join(' / '),r.source||'待实测',r.verified?'已复核':'待复核']),...a.walls.map(w=>[w[5]+(s.demolished.includes(w[5])?'（拟拆除）':''),w.slice(0,4).join(', '),p.wallInfo[w[5]]?.source||'待实测',p.wallInfo[w[5]]?.verified?'已复核':'待复核']),...a.windows.map(w=>[w[4],w.slice(0,4).join(', ')+` / 窗台 ${p.windowInfo[w[4]]?.sill??'待定'} / 窗顶 ${p.windowInfo[w[4]]?.head??'待定'}`,p.windowInfo[w[4]]?.source||'待实测',p.windowInfo[w[4]]?.verified?'已复核':'待复核']),...a.doors.map(d=>[d.name,`${d.len} × ${d.height}`,d.source||'待实测',d.verified?'已复核':'待复核'])])}
      <h2>待处理与待确认 · ${subset.length}</h2>${table(['类型','对象','检查结果','处理依据'],subset.map(c=>[({error:'冲突',missing:'漏项',review:'待复核'})[c.level],c.target,c.title,c.detail]))}
      <h2>现场问题与验收证据（全屋）</h2>${table(['问题','关联对象','责任人','状态','整改 / 实测记录'],p.issues.map(i=>[i.title,i.target,i.owner,({open:'待处理',working:'处理中',done:'已复核关闭'})[i.status],i.note]))}${p.issues.filter(i=>i.photo).map(i=>`<p>${E(i.title)}</p><img class="photo" src="${i.photo}" alt="${E(i.title)}">`).join('')}
      <h2>现场验收记录</h2>${table(['检查事项','结果 / 实测值','复核人 / 日期'],['水路与排水功能','电源与回路（由施工人员检验）','防水与完成面尺寸','网络通断与供电','窗帘、灯光与控制关系','断网后的手动控制'].map(t=>[t,'□ 待核实　□ 通过　□ 整改','']))}<p><small>检查规则来自项目已录入条件与装修注意事项的产品化整理；不代替结构、电气等专业设计和现场验收。</small></p></html>`;
  }
  function exportHandover(s,version,preview){const html=handoverHTML(s,version);if(!preview){download(s.project.name+'-交底资料.html',new Blob([html],{type:'text/html;charset=utf-8'}));return;}const win=window.open('about:blank','_blank');if(!win){toast('浏览器阻止了预览窗口，请允许弹窗或导出交底 HTML');return;}win.opener=null;win.document.open();win.document.write(html);win.document.close();}
  // Read-only debug/export hooks also allow deterministic regression checks.
  window.ProjectUI.handoverHTML=handoverHTML;
  renderAll();
})();
