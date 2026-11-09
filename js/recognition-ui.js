/* Upload → recognize → preview → apply editable architecture. */
(function () {
  'use strict';
  const S = () => window.FloorplanRecognitionService;
  const R = () => window.FloorplanRecognition;
  const Rules = () => window.FloorplanOcrPostprocessRules;
  let draft = null, busy = false, calibratePts = null, rulesReturn = 'idle';

  const modal = document.createElement('div');
  modal.id = 'recogModal';
  modal.hidden = true;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'recogTitle');
  document.body.append(modal);

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function open(opts) {
    draft = null;
    calibratePts = null;
    modal.hidden = false;
    if (opts?.rules) renderRules({ from: 'idle' });
    else renderIdle();
  }

  function close() {
    if (busy) return;
    modal.hidden = true;
    draft = null;
    calibratePts = null;
    rulesReturn = 'idle';
  }

  function kindLabel(kind) {
    if (kind === 'ocr') return 'OCR';
    if (kind === 'related') return '相关';
    return '非 OCR';
  }

  function renderRules(opts) {
    rulesReturn = opts?.from || (draft ? 'preview' : 'idle');
    const cat = Rules();
    if (!cat) {
      toast('规则说明未加载');
      return;
    }
    const sections = (cat.sections || []).map(sec => {
      const rules = (sec.rules || []).map(r =>
        `<li><b>${esc(r.title)}</b><span>${esc(r.detail)}</span></li>`
      ).join('');
      return `<section class="recog-rules-sec" data-kind="${esc(sec.kind)}">
        <h3><span class="recog-rules-tag">${esc(kindLabel(sec.kind))}</span>${esc(sec.title)}
          <small>${sec.binding === 'data' ? '数据驱动 · 可直接复用' : '代码实现 · 描述供复现'}</small></h3>
        ${sec.intro ? `<p class="p-muted">${esc(sec.intro)}</p>` : ''}
        ${sec.impl ? `<p class="recog-rules-impl">${esc(sec.impl)}</p>` : ''}
        <ol class="recog-rules-list">${rules}</ol>
      </section>`;
    }).join('');
    modal.innerHTML = `<div class="recog-card recog-wide recog-rules">
      <header><h2 id="recogTitle">${esc(cat.title || 'OCR 后处理规则')}</h2>
        <button type="button" class="btn" data-recog="rules-back" aria-label="返回">返回</button></header>
      <p class="p-muted">${esc(cat.subtitle || '')} 版本 ${esc(cat.version)}。墙体/门窗几何不在此列。</p>
      <div class="p-actions recog-rules-actions">
        <button type="button" class="btn primary" data-recog="rules-copy">复制规则全文</button>
        <button type="button" class="btn" data-recog="rules-back">返回识别</button>
      </div>
      <div class="recog-rules-body">${sections}</div>
    </div>`;
  }

  async function copyRulesText() {
    const text = Rules()?.toPlainText?.();
    if (!text) { toast('没有可复制的规则'); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制 OCR 后处理规则');
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.append(ta);
      ta.select();
      try {
        document.execCommand('copy');
        toast('已复制 OCR 后处理规则');
      } catch (err) {
        toast('复制失败，请手动选择文本');
      }
      ta.remove();
    }
  }

  function renderIdle() {
    modal.innerHTML = `<div class="recog-card">
      <header><h2 id="recogTitle">从户型图自动生成</h2><button type="button" class="btn" data-recog="close" aria-label="关闭">关闭</button></header>
      <p class="p-muted">上传平面图后，自动识别墙体、房间和门窗，生成可编辑户型。请核对尺寸后再精调；识别不区分承重墙。</p>
      <label class="recog-upload">选择户型图 JPG / PNG / WebP<input type="file" id="recogFile" accept="image/png,image/jpeg,image/webp"></label>
      <p class="p-muted">也可继续使用「建立空白户型」手工绘制。</p>
      <div class="p-actions">
        <button type="button" class="btn" data-recog="rules">OCR 后处理规则</button>
        <button type="button" class="btn" data-recog="close">取消</button>
      </div>
    </div>`;
  }

  function renderBusy(msg) {
    modal.innerHTML = `<div class="recog-card"><header><h2 id="recogTitle">正在识别</h2></header>
      <p class="recog-progress" role="status">${esc(msg)}</p>
      <p class="p-muted">首次文字识别需加载本地中文模型，可能需要几秒。</p></div>`;
  }

  function defaultScaleMM(result) {
    if (result.scaleHint?.mmPerPx) return Math.round(result.scaleHint.mmPerPx * 1000) / 1000;
    // Fallback: assume typical apartment outer width ≈ 9–12 m across wall bounds.
    const bw = result.bounds[2] - result.bounds[0];
    return Math.round((10000 / Math.max(bw, 1)) * 1000) / 1000;
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  function areaStats(result, mmPerPx) {
    const scale = Number(mmPerPx) || 10;
    const pxToM2 = (px) => px * (scale * scale) / 1e6;
    const rows = (result.rooms || []).map(r => {
      const fromLabel = r.areaLabel > 0 ? Number(r.areaLabel) : null;
      const fromGeom = r.areaPx > 0 ? pxToM2(r.areaPx) : null;
      return {
        name: r.name || '空间',
        label: fromLabel,
        geom: fromGeom,
        used: fromLabel != null ? fromLabel : fromGeom
      };
    });
    const labeled = rows.filter(r => r.label != null);
    const missing = rows.filter(r => r.label == null);
    const sumLabel = labeled.reduce((s, r) => s + r.label, 0);
    const sumUsed = rows.reduce((s, r) => s + (r.used || 0), 0);
    const sumGeom = rows.reduce((s, r) => s + (r.geom || 0), 0);
    return { rows, labeled, missing, sumLabel, sumUsed, sumGeom };
  }

  function renderAreaStats(result, scale) {
    const st = areaStats(result, scale);
    if (!st.rows.length) return '';
    const items = st.rows.map(r => {
      const main = r.label != null
        ? `${r.label} m²`
        : (r.geom != null ? `约 ${round1(r.geom)} m²` : '—');
      return `<li><span class="recog-area-name">${esc(r.name)}</span><span class="recog-area-val">${main}</span></li>`;
    }).join('');
    const total = st.missing.length ? st.sumUsed : st.sumLabel;
    const totalNote = st.missing.length
      ? `含 ${st.missing.length} 间按比例估算`
      : '来自图纸标注';
    return `<div class="recog-area-stats">
      <ul class="recog-rooms recog-area-list">${items}</ul>
      <p class="recog-area-sum">面积总计 <b>${round1(total)}</b> m²<span class="recog-area-note">（${totalNote}）</span></p>
    </div>`;
  }

  function renderPreview() {
    const { result, underlaySrc } = draft;
    const scale = draft.mmPerPx ?? defaultScaleMM(result);
    draft.mmPerPx = scale;
    const arch = (() => { try { return R().toArchitecture(result, scale); } catch (e) { return null; } })();
    const known = draft.knownLength || '';
    modal.innerHTML = `<div class="recog-card recog-wide">
      <header><h2 id="recogTitle">核对识别结果</h2><button type="button" class="btn" data-recog="close" aria-label="关闭">关闭</button></header>
      <div class="recog-layout">
        <div class="recog-preview" id="recogPreview">
          <img src="${underlaySrc}" alt="户型原图">
          ${R().overlaySVG(result)}
        </div>
        <div class="recog-side">
          <p><b>${result.rooms.length}</b> 个房间 · <b>${result.walls.length}</b> 段墙 · <b>${result.openings.length}</b> 处门窗</p>
          <p class="p-muted">${result.dimensionFrame ? '已按外围比例线裁切，线外忽略' : '未找到比例线，按墙体范围裁切'}${result.compass ? ` · 指南针 <b>${esc(result.compass.facing || '北朝上')}</b>` : ' · 无指南针（默认北朝上）'}</p>
          ${renderAreaStats(result, scale)}
          <label>比例 mm / 像素<input type="number" id="recogScale" step="any" min="0.5" max="80" value="${esc(scale)}"></label>
          <p class="p-muted">${result.scaleHint ? `根据${esc(result.scaleHint.source)}估算：${result.scaleHint.values.join(' + ')} mm` : '未可靠读出尺寸标注，请用已知长度或图上两点校准。'}</p>
          <label>已知长度 / mm（选两点后使用）<input type="number" id="recogKnown" step="any" min="100" value="${esc(known)}"></label>
          <div class="p-actions">
            <button type="button" class="btn" data-recog="calibrate">在预览图选两点校准</button>
            <button type="button" class="btn" data-recog="recompute">按比例刷新预览</button>
          </div>
          ${arch ? `<p class="p-muted">生成后户型外包约 ${Math.round(arch.boundsMM[2] - arch.boundsMM[0])} × ${Math.round(arch.boundsMM[3] - arch.boundsMM[1])} mm（已去掉图面空白边）</p>` : '<p class="p-error">当前比例无效</p>'}
          <div class="recog-warnings">${(result.warnings || []).map(w => `<p>${esc(w)}</p>`).join('')}</div>
          <div class="p-actions">
            <button type="button" class="btn" data-recog="rules">OCR 后处理规则</button>
          </div>
          <div class="p-actions p-sticky">
            <button type="button" class="btn primary" data-recog="apply">生成可编辑户型</button>
            <button type="button" class="btn" data-recog="again">换一张图</button>
            <button type="button" class="btn" data-recog="close">取消</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  async function startRecognize(file) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { toast('请选择 PNG、JPG 或 WebP'); return; }
    if (file.size > 20000000) { toast('图片请小于 20 MB'); return; }
    busy = true;
    renderBusy('准备图像…');
    try {
      draft = await S().recognizeFile(file, { onProgress: msg => { if (busy) renderBusy(msg); } });
      draft.mmPerPx = defaultScaleMM(draft.result);
      busy = false;
      renderPreview();
    } catch (err) {
      busy = false;
      toast(err.message || '识别失败');
      renderIdle();
    }
  }

  function applyDraft() {
    if (!draft) return;
    const scale = Number(document.getElementById('recogScale')?.value || draft.mmPerPx);
    let built;
    try { built = R().toArchitecture(draft.result, scale); }
    catch (err) { toast(err.message); return; }
    if (!built.architecture.rooms.length && !built.architecture.walls.length) {
      toast('没有可生成的房间或墙体');
      return;
    }
    if (!confirm('用识别结果替换当前户型？现有家具、设备与点位会清空，可撤销恢复。建议先导出备份。')) return;
    const before = snap();
    const next = ProjectModel.clone(state);
    next.furniture = [];
    next.demolished = [];
    next.measures = [];
    next.layoutSchemes = ProjectModel.emptyLayoutSchemes();
    next.rooms = {};
    built.architecture.rooms.forEach(r => { next.rooms[r.id] = { name: r.name, mat: r.mat || 'wood' }; });
    Object.assign(next.project, {
      custom: true,
      verified: false,
      source: draft.result.scaleHint
        ? `图像识别（${draft.result.scaleHint.source}），待精调`
        : '图像识别，比例待精调',
      northAngle: draft.result.compass ? draft.result.compass.angleDeg : 0, // 仅 0/90/180/270
      architecture: built.architecture,
      wallInfo: built.wallInfo,
      windowInfo: built.windowInfo,
      devices: [],
      points: [],
      issues: [],
      underlay: (()=>{
        let src = draft.underlaySrc;
        if (built.cropPx && draft.canvas) {
          const cropped = R().cropCanvasTo(draft.canvas, built.cropPx);
          src = cropped.toDataURL('image/jpeg', .78);
        }
        return {
          src,
          x: built.underlay?.x ?? 0,
          y: built.underlay?.y ?? 0,
          width: built.underlay?.width ?? built.underlaySize.width,
          height: built.underlay?.height ?? built.underlaySize.height,
          opacity: 0.35,
          labelsScrubbed: true,
          labelScrubVer: 2
        };
      })()
    });
    try {
      ProjectModel.validate(next);
    } catch (err) {
      toast('生成结果未通过校验：' + err.message);
      return;
    }
    state = next;
    commit(before);
    close();
    if (typeof window.ProjectUI?.afterRecognize === 'function') window.ProjectUI.afterRecognize();
    else {
      renderAll(); fitView();
      toast(`已生成 ${built.architecture.rooms.length} 个房间、${built.architecture.walls.length} 段墙：在「户型」中点墙可改尺寸`);
    }
  }

  modal.addEventListener('click', e => {
    const btn = e.target.closest('[data-recog]');
    if (!btn) return;
    const act = btn.dataset.recog;
    if (act === 'close') close();
    if (act === 'again') { draft = null; renderIdle(); }
    if (act === 'apply') applyDraft();
    if (act === 'rules') renderRules({ from: draft ? 'preview' : 'idle' });
    if (act === 'rules-back') {
      if (rulesReturn === 'preview' && draft) renderPreview();
      else renderIdle();
    }
    if (act === 'rules-copy') copyRulesText();
    if (act === 'recompute') {
      draft.mmPerPx = Number(document.getElementById('recogScale').value);
      draft.knownLength = Number(document.getElementById('recogKnown').value) || draft.knownLength;
      renderPreview();
    }
    if (act === 'calibrate') {
      const known = Number(document.getElementById('recogKnown').value);
      if (!(known > 0)) { toast('请先填写两点之间的已知长度（mm）'); return; }
      draft.knownLength = known;
      calibratePts = [];
      toast('在预览图上依次点击两个已知距离的点');
      document.getElementById('recogPreview')?.classList.add('recog-calibrating');
    }
  });

  modal.addEventListener('change', e => {
    if (e.target.id === 'recogFile') startRecognize(e.target.files[0]);
  });

  modal.addEventListener('click', e => {
    if (!calibratePts || !draft) return;
    const box = document.getElementById('recogPreview');
    if (!box || !box.contains(e.target)) return;
    const img = box.querySelector('img');
    if (!img) return;
    const rect = img.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
    const x = (e.clientX - rect.left) / rect.width * draft.imageWidth;
    const y = (e.clientY - rect.top) / rect.height * draft.imageHeight;
    calibratePts.push({ x, y });
    if (calibratePts.length < 2) { toast('再点第二个点'); return; }
    const [a, b] = calibratePts;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    calibratePts = null;
    box.classList.remove('recog-calibrating');
    if (dist < 5) { toast('两点太近，请重试'); return; }
    draft.mmPerPx = Math.round((draft.knownLength / dist) * 1000) / 1000;
    renderPreview();
    toast('比例已按两点校准');
  }, true);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.hidden && !busy) close();
  });

  window.RecognitionUI = { open, close, openRules: () => open({ rules: true }) };
})();
