/* Site workspace: recognition, underlay, north, and blank-plan tools. */
(function () {
  'use strict';
  const M = ProjectModel, E = esc;
  let selected = null, placing = null, first = null;
  const nav = document.createElement('nav');
  nav.id = 'projectNav';
  nav.setAttribute('aria-label', '户型');
  nav.innerHTML = '<span class="wordmark">筑家</span><button class="btn" type="button" data-workspace="site" aria-selected="true">户型</button><span id="saveState">本机自动保存 · 请定期备份</span>';
  document.querySelector('header').prepend(nav);
  const hint = document.createElement('div');
  hint.id = 'placementHint';
  hint.hidden = true;
  $('#stage').append(hint);
  document.body.dataset.workspace = 'site';

  const input = (label, name, value, type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${E(value ?? '')}" ${extra}></label>`;
  const num = (label, name, value, extra = '') => input(label, name, value, 'number', 'step="any" ' + extra);
  const areaInput = (label, name, value) => `<label>${label}<textarea name="${name}" maxlength="4000">${E(value || '')}</textarea></label>`;
  const selectInput = (label, name, value, options) => `<label>${label}<select name="${name}">${options.map(([k, v]) => `<option value="${E(k)}" ${String(value) === String(k) ? 'selected' : ''}>${E(v)}</option>`).join('')}</select></label>`;
  const checkbox = (label, name, checked) => `<label><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}>${label}</label>`;
  const button = (label, action, attrs = '', primary = false) => `<button type="button" class="btn ${primary ? 'primary' : ''}" data-action="${action}" ${attrs}>${label}</button>`;
  const row = (a, b) => `<div class="p-row">${a}${b}</div>`;
  const safeNum = (value, fallback = 0) => value === '' ? fallback : Number(value);

  function transact(fn) {
    const before = snap(), next = M.clone(state);
    fn(next);
    M.validate(next);
    state = next;
    ui.sel = null;
    commit(before);
    renderAll();
  }
  function actionError(err) {
    const el = $('#panel .p-error');
    if (el) el.textContent = err.message;
    toast(err.message || '操作未完成');
  }
  function cancelPlacement() {
    placing = null; first = null; hint.hidden = true; svg.style.cursor = '';
  }
  function place(type, id) {
    if (typeof is3D === 'function' && is3D()) { toast('请先切换到 2D 平面后定位'); return; }
    placing = { type, id };
    first = null;
    hint.hidden = false;
    hint.textContent = type === 'calibrate' ? '依次点击底图上两个已知距离的点 · Esc 取消' : '依次点击墙体矩形的两个对角 · Esc 取消';
    svg.style.cursor = 'crosshair';
    if (narrow()) drawer(null);
  }
  function projectForm() {
    const p = state.project;
    return `<form data-form="project">${
      input('项目名称', 'name', p.name, 'text', 'required maxlength="120"')
    }${row(
      num('层高 / mm', 'height', p.height, 'min="1800" max="10000" required'),
      num('地面完成层 / mm', 'floorFinish', p.floorFinish, 'min="0" max="1000" required')
    )}${row(
      num('墙面完成层参考厚度 / mm', 'wallFinish', p.wallFinish, 'min="0" max="500" required'),
      selectInput('原图北向角 / °', 'northAngle', p.northAngle ?? 0, [[0, '0° · 北朝上'], [90, '90° · 北朝右'], [180, '180° · 北朝下'], [270, '270° · 北朝左']])
    )}${selectInput('北向调整方式', 'northMode', p.northMode || 'plan', [['plan', '旋转户型，北向固定'], ['compass', '户型固定，旋转指北针']])}
    <p class="p-muted">北向角是原图里正北的方向。旋转户型时图纸反向转，使北朝上；旋转指北针时保留原图朝向。2D 与 3D 日照一起变，原始坐标不变。</p>
    ${areaInput('尺寸依据', 'source', p.source || '')}${checkbox('已现场复核', 'verified', !!p.verified)}
    <div class="p-error" role="alert"></div>
    <div class="p-actions p-sticky"><button class="btn primary" type="submit">保存修改</button></div></form>`;
  }
  function underlayPanel() {
    const u = state.project.underlay;
    return '<h3>户型底图</h3><p class="p-muted">底图可单独上传作对照；完整自动生成请用「上传户型图识别」。按两个已知点校准比例。</p><label>上传 JPG / PNG / WebP<input type="file" id="underlayFile" accept="image/png,image/jpeg,image/webp"></label>' +
      (u ? `<form data-form="underlay">${row(num('底图 X / mm', 'x', u.x), num('底图 Y / mm', 'y', u.y))}${row(num('宽度 / mm', 'width', u.width, 'min="1" required'), num('透明度 0–1', 'opacity', u.opacity, 'min="0" max="1" step="0.05" required'))}${num('校准参考距离 / mm', 'distance', 1000, 'min="1"')}<div class="p-actions">${button('在图上选两点校准', 'calibrate')}${button('移除底图', 'remove-underlay')}</div><div class="p-error" role="alert"></div><div class="p-actions p-sticky"><button class="btn primary" type="submit">保存修改</button></div></form>` : '');
  }
  function sitePanel() {
    const p = state.project;
    return '<div class="p-kicker">SURVEY / 量房依据</div><h2>从户型图开始</h2><p class="p-muted">' +
      (p.custom ? '当前为识别或自建户型。' : '当前是示例户型。上传你家的图后会替换墙和房间，家具布置仍可继续编辑。') +
      '</p>' + projectForm() +
      `<div class="p-actions">${button('上传户型图识别', 'recognize', '', true)}${button('OCR 后处理规则', 'ocr-rules')}${button('建立空白户型', 'blank')}</div>` +
      `<div class="p-actions">${button('绘制墙段', 'draw-wall')}</div>` +
      underlayPanel();
  }
  function panel() {
    if (ui.sel?.kind === 'furn' || ui.sel?.kind === 'room' || ui.sel?.kind === 'measure') return false;
    $('#panel').innerHTML = '<div class="p-work">' + sitePanel() + '</div>';
    return true;
  }
  const UNDERLAY_LABEL_SCRUB_VER = 2;
  function paintUnderlay() {
    const u = state.project.underlay, host = $('#gUnderlay');
    if (!host) return;
    if (!u) { host.innerHTML = ''; return; }
    const mask = ROOMS.map(r => {
      const pts = (r.poly || []).map(v => v.join(',')).join(' ');
      return pts ? `<polygon points="${pts}" fill="#f7f4ee" opacity=".97"/>` : '';
    }).join('');
    host.innerHTML = `<image href="${u.src}" x="${u.x}" y="${u.y}" width="${u.width}" height="${u.height}" opacity="${u.opacity}"/>${mask}`;
  }
  function scrubExistingUnderlayLabels() {
    const u = state.project.underlay, R = window.FloorplanRecognition;
    if (!u || u.labelScrubVer === UNDERLAY_LABEL_SCRUB_VER || u._labelScrubbing || !R?.scrubRoomLabelInk || !ROOMS.length) return;
    u._labelScrubbing = true;
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
        if (c.width < 8 || c.height < 8) { u.labelScrubVer = UNDERLAY_LABEL_SCRUB_VER; u._labelScrubbing = false; paintUnderlay(); return; }
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const sx = c.width / Math.max(1, u.width), sy = c.height / Math.max(1, u.height);
        const polys = ROOMS.map(r => (r.poly || []).map(([x, y]) => [(x - u.x) * sx, (y - u.y) * sy])).filter(p => p.length >= 3);
        const src = ctx.getImageData(0, 0, c.width, c.height);
        const cleaned = R.scrubRoomLabelInk(src, polys);
        ctx.putImageData(new ImageData(cleaned.data, cleaned.width, cleaned.height), 0, 0);
        let nextSrc;
        try { nextSrc = c.toDataURL('image/jpeg', .78); } catch (_) { u._labelScrubbing = false; return; }
        if (state.project.underlay !== u) { u._labelScrubbing = false; return; }
        u.src = nextSrc; u.labelsScrubbed = true; u.labelScrubVer = UNDERLAY_LABEL_SCRUB_VER; u._labelScrubbing = false;
        try { M.validate(state); } catch (_) {}
        if (typeof save === 'function') try { save(); } catch (_) {}
        paintUnderlay();
      } catch (_) { u._labelScrubbing = false; }
    };
    img.onerror = () => { u._labelScrubbing = false; };
    img.src = u.src;
  }
  let partitionHealDone = false;
  function healMissingPartitions() {
    if (partitionHealDone || !state.project.custom) return;
    partitionHealDone = true;
    const R = window.FloorplanRecognition, a = state.project.architecture;
    if (!R?.fillMissingPartitionWalls || !a?.rooms?.length) return;
    const before = a.walls.length;
    const n = R.fillMissingPartitionWalls(a);
    if (!n) return;
    a.walls.slice(before).forEach(w => { state.project.wallInfo[w[5]] ||= { source: '补全房间间空隙隔墙', verified: false }; });
    if (typeof syncArchitecture === 'function') syncArchitecture();
    if (typeof renderWalls === 'function') renderWalls();
    if (typeof save === 'function') try { save(); } catch (_) {}
  }
  function focusTarget(id) {
    const r = state.project.architecture.rooms.find(v => v.id === id);
    if (!r) return;
    selected = { type: 'room', id };
    ui.sel = { kind: 'room', id };
    document.body.dataset.workspace = 'site';
    const at = r.at || [0, 0];
    const q = planViewPoint({ x: at[0], y: at[1] });
    view.s = Math.max(view.s, .12);
    view.x0 = q.x - svg.clientWidth / 2 / view.s;
    view.y0 = q.y - svg.clientHeight / 2 / view.s;
    applyView();
    renderAll();
    if (typeof drawer === 'function') drawer('panel', true);
  }
  function render() {
    document.body.dataset.workspace = 'site';
    nav.querySelector('[data-workspace="site"]')?.setAttribute('aria-selected', 'true');
    const p = state.project;
    const north = Number.isFinite(p.northAngle) ? p.northAngle : 0;
    const facing = (p.northMode || 'plan') === 'plan'
      ? '北朝上 · 户型已定向'
      : ({ 0: '北朝上', 90: '北朝右', 180: '北朝下', 270: '北朝左' }[([0, 90, 180, 270].includes(north) ? north : 0)] || '北朝上');
    const subtitle = $('#subtitle');
    if (subtitle) subtitle.textContent = `${p.custom ? '自定义户型' : '示例户型'} · ${p.verified ? '已复核' : '待实测复核'} · ${facing} · 尺寸 mm`;
    healMissingPartitions();
    paintUnderlay();
    if (p.underlay && p.underlay.labelScrubVer !== UNDERLAY_LABEL_SCRUB_VER) scrubExistingUnderlayLabels();
    const displayBounds = planViewBounds(), m = Math.min(displayBounds.w, displayBounds.h);
    const nx = displayBounds.x + Math.max(90, m * 0.005), ny = displayBounds.y + Math.max(220, m * 0.015), ns = Math.max(72, m * 0.012);
    const sw = Math.max(7, ns * 0.065);
    const northSvg = `<g id="gNorth" pointer-events="none" transform="translate(${nx} ${ny}) rotate(${(p.northMode || 'plan') === 'compass' ? north : 0})"><polygon points="0,${-ns} ${ns * .42},0 ${-ns * .42},0" fill="#1a1a1a"/><polygon points="0,${ns} ${ns * .42},0 ${-ns * .42},0" fill="#fff" stroke="#1a1a1a" stroke-width="${sw}" stroke-linejoin="miter"/><text y="${-ns - ns * .2}" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="${ns * .46}" fill="#1a1a1a" font-weight="700">N</text></g>`;
    $('#gNorth')?.remove();
    svg.insertAdjacentHTML('beforeend', northSvg);
    const rooms = $('#gRooms'); if (rooms) rooms.style.opacity = '1';
    const services = $('#gServices'); if (services) services.innerHTML = '';
  }
  function saved(ok) {
    const el = $('#saveState');
    if (!el) return;
    el.textContent = ok ? '已保存到本机 · 请定期备份' : '未持久保存！请导出备份';
    el.classList.toggle('unsaved', !ok);
  }
  window.ProjectUI = {
    panel, render, saved, cancelPlacement, focusTarget,
    workspace: () => 'site',
    clearWallSelection() { if (selected?.type === 'wall') selected = null; },
    selectWall(id) { selected = { type: 'wall', id }; ui.sel = { kind: 'wall', id }; renderAll(); },
    afterRecognize() {
      selected = null; ui.sel = null; partitionHealDone = false;
      document.body.dataset.workspace = 'site';
      cancelPlacement();
      if (ui.tool !== 'select' && typeof setTool === 'function') setTool('select');
      renderAll();
      fitView();
      if (typeof drawer === 'function') drawer('panel', true);
      const nW = (state.project.architecture.walls || []).length, nR = (state.project.architecture.rooms || []).length;
      toast(`已生成 ${nR} 个房间、${nW} 段墙。可拖房间边界改尺寸，家具仍在左侧库里。`);
    }
  };

  $('#panel').addEventListener('submit', e => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    const v = new FormData(f), get = k => String(v.get(k) || ''), n = k => safeNum(get(k)), checked = k => v.has(k), kind = f.dataset.form;
    try {
      transact(s => {
        const p = s.project;
        if (kind === 'project') {
          const north = [0, 90, 180, 270].includes(n('northAngle')) ? n('northAngle') : 0;
          Object.assign(p, { name: get('name'), height: n('height'), floorFinish: n('floorFinish'), wallFinish: n('wallFinish'), northAngle: north, northMode: get('northMode'), source: get('source'), verified: checked('verified') });
          if (p.height - p.floorFinish < 1800) throw new Error('装修完成后净高不能小于 1800 mm');
        }
        if (kind === 'underlay') {
          const u = p.underlay, k = n('width') / u.width;
          Object.assign(u, { x: n('x'), y: n('y'), width: n('width'), height: u.height * k, opacity: n('opacity') });
        }
      });
      toast('修改已保存');
    } catch (err) { actionError(err); }
  });

  async function imageData(file) {
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPG 或 WebP 图片');
    if (file.size > 15000000) throw new Error('原图请小于 15 MB');
    const url = URL.createObjectURL(file);
    try {
      const im = new Image(); im.src = url; await im.decode();
      const scale = Math.min(1, 1600 / Math.max(im.width, im.height)), cv = document.createElement('canvas');
      cv.width = Math.round(im.width * scale); cv.height = Math.round(im.height * scale);
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      return { src: cv.toDataURL('image/jpeg', .78), ratio: im.height / im.width };
    } finally { URL.revokeObjectURL(url); }
  }
  $('#panel').addEventListener('change', async e => {
    if (e.target.id !== 'underlayFile') return;
    try {
      const data = await imageData(e.target.files[0]);
      transact(s => { s.project.underlay = { src: data.src, x: 0, y: 0, width: 10000, height: 10000 * data.ratio, opacity: .5 }; });
    } catch (err) { actionError(err); }
  });
  $('#panel').addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const act = b.dataset.action;
    try {
      if (act === 'recognize') { window.RecognitionUI?.open(); return; }
      if (act === 'ocr-rules') { window.RecognitionUI?.openRules?.() || window.RecognitionUI?.open({ rules: true }); return; }
      if (act === 'blank') {
        if (!confirm('建立空白户型？当前方案可撤销恢复，建议先导出备份。')) return;
        transact(s => {
          s.furniture = []; s.rooms = {}; s.demolished = []; s.measures = [];
          s.layoutSchemes = M.emptyLayoutSchemes();
          Object.assign(s.project, { custom: true, verified: false, source: '待实测', architecture: { walls: [], windows: [], doors: [], slides: [], rooms: [] }, wallInfo: {}, windowInfo: {}, devices: [], points: [], issues: [], underlay: null });
        });
        selected = null; fitView();
      }
      if (act === 'draw-wall') place('wall');
      if (act === 'calibrate') {
        const distance = +$('#panel [name=distance]').value;
        if (!Number.isFinite(distance) || distance <= 0) throw new Error('请输入已知参考距离');
        place('calibrate', distance);
      }
      if (act === 'remove-underlay') transact(s => { s.project.underlay = null; });
    } catch (err) { actionError(err); }
  });
  svg.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !placing) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const pt = toMM(e), x = Math.round(pt.x / 10) * 10, y = Math.round(pt.y / 10) * 10;
    try {
      const cmd = placing;
      if (['calibrate', 'wall'].includes(cmd.type) && !first) { first = { x, y }; hint.textContent = '点击第二个点 · Esc 取消'; return; }
      transact(s => {
        if (cmd.type === 'wall') {
          const id = M.uid('wall');
          const rect = [Math.min(x, first.x), Math.min(y, first.y), Math.max(x, first.x), Math.max(y, first.y)];
          if (!(rect[2] > rect[0] && rect[3] > rect[1])) throw new Error('请点出有面积的墙段');
          s.project.architecture.walls.push([...rect, 'u', id]);
          s.project.wallInfo[id] = { source: '手绘', verified: false };
          s.project.custom = true;
          selected = { type: 'wall', id };
        }
        if (cmd.type === 'calibrate') {
          const dist = Math.hypot(x - first.x, y - first.y);
          if (dist < 10) throw new Error('两点太近，请重新选择');
          const u = s.project.underlay, k = cmd.id / dist;
          u.x = first.x + (u.x - first.x) * k; u.y = first.y + (u.y - first.y) * k; u.width *= k; u.height *= k;
        }
      });
      cancelPlacement();
    } catch (err) { actionError(err); cancelPlacement(); }
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') cancelPlacement();
    if (e.target.matches && e.target.matches('textarea,select')) e.stopImmediatePropagation();
  }, true);

  renderAll();
})();
