/* AI帮你装 — local interview → brief → heuristic multi-step furniture planner.
 * Uses only LIB catalog items; places via mutate/pushOut so undo works. */
(function () {
  'use strict';
  const M = ProjectModel;
  const E = typeof esc === 'function' ? esc : s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const QUESTIONS = [
    { key: 'family', label: '家庭成员', prompt: '家里几口人？有没有老人或小孩要特别照顾？', placeholder: '例如：三口之家，有学龄儿童' },
    { key: 'style', label: '风格偏好', prompt: '更倾向哪种风格？可以说「现代简约」「北欧」「原木温馨」「轻奢」或自己的描述。', placeholder: '例如：现代简约、偏暖色' },
    { key: 'priorities', label: '布置重点', prompt: '布置时最在意什么？可选：收纳、会客、孩子活动、办公学习、采光通透——也可以自由说。', placeholder: '例如：收纳 + 会客' },
    { key: 'pain', label: '需求与痛点', prompt: '有没有特别痛点或必做项？（如：客厅要大沙发、卧室要书桌、厨房尽量简洁……）没有就回「没有」。', placeholder: '例如：客厅要三人沙发，主卧要衣柜' },
  ];

  const SKIP_RE = /直接做|按标准|跳过|随便|默认|不用问|直接生成|标准来|一键/;

  const DEFAULT_BRIEF = {
    family: '三口之家（标准默认）',
    style: '现代简约',
    priorities: '收纳、会客',
    pain: '无特别痛点，按常见家庭布置',
  };

  let open = false;
  let phase = 'idle'; // idle | interview | brief | running | done | config
  let qIndex = 0;
  let brief = { ...DEFAULT_BRIEF };
  let messages = [];
  let statusLine = '';
  let lastPlan = null;

  function roomName(r) {
    return (state.rooms[r.id] && state.rooms[r.id].name) || r.name || r.id;
  }

  function classifyRoom(r) {
    const n = roomName(r);
    if (/卫|浴/.test(n)) return 'bath';
    if (/厨/.test(n)) return 'kitchen';
    if (/餐/.test(n)) return 'dining';
    if (/客|厅|起居/.test(n) && !/餐/.test(n)) return 'living';
    if (/洗衣/.test(n)) return 'laundry';
    if (/阳台|露台/.test(n)) return 'balcony';
    if (/过道|走廊|玄关|门厅/.test(n)) return 'hall';
    if (/飘窗/.test(n)) return 'bay';
    if (/卧|房|睡/.test(n)) return 'bedroom';
    return 'other';
  }

  function libFind(type, nameIncludes) {
    for (const cat of LIB) {
      for (const it of cat.items) {
        if (it[0] !== type) continue;
        if (!nameIncludes || nameIncludes.some(s => it[1].includes(s))) return it;
      }
    }
    return null;
  }

  function libAny(types) {
    for (const t of types) {
      const it = libFind(t);
      if (it) return it;
    }
    return null;
  }

  function pushMsg(role, text, meta) {
    messages.push({ role, text, meta: meta || null, t: Date.now() });
  }

  function resetSession(standard) {
    messages = [];
    brief = { ...DEFAULT_BRIEF };
    qIndex = 0;
    lastPlan = null;
    statusLine = '';
    if (standard) {
      phase = 'brief';
      pushMsg('ai', '好的，按标准家庭方案来：三口之家 · 现代简约 · 兼顾收纳与会客。可直接改下面的需求卡片，再点「开始布置」。');
    } else {
      phase = 'interview';
      pushMsg('ai', '我来帮你装——先聊几句需求和痛点（也可直接说「按标准来」跳过访谈）。');
      pushMsg('ai', QUESTIONS[0].prompt);
    }
  }

  function openPanel(standard) {
    open = true;
    ui.sel = null;
    resetSession(!!standard);
    drawer('panel', true);
    renderAll();
  }

  function openConfigPanel() { window.AiSettings.open(); }

  function closePanel(opts) {
    const was = open;
    open = false;
    phase = 'idle';
    if (was && opts?.rerender !== false && opts?.silent !== true) renderAll();
  }

  function isOpen() { return open; }

  function applyBriefFromAnswers() {
    /* brief already filled during interview */
  }

  function detectSkip(text) {
    return SKIP_RE.test(String(text || '').trim());
  }

  function handleUserText(raw) {
    const text = String(raw || '').trim();
    if (!text) return;
    pushMsg('user', text);

    if (phase === 'interview') {
      if (detectSkip(text)) {
        brief = { ...DEFAULT_BRIEF };
        phase = 'brief';
        pushMsg('ai', '收到，走标准流程。下面是可编辑的需求简报，确认后点「开始布置」，也可改完再「重新生成」。');
        render();
        return;
      }
      const q = QUESTIONS[qIndex];
      brief[q.key] = text;
      qIndex += 1;
      if (qIndex >= QUESTIONS.length) {
        phase = 'brief';
        applyBriefFromAnswers();
        pushMsg('ai', '需求已整理成简报。可直接改卡片内容，再点「开始布置」；之后改完也能「重新生成」。');
      } else {
        pushMsg('ai', QUESTIONS[qIndex].prompt);
      }
      render();
      return;
    }

    if (phase === 'brief' || phase === 'done') {
      if (detectSkip(text) || /开始|生成|布置|确认/.test(text)) {
        runPipeline();
        return;
      }
      if (/重新/.test(text)) {
        runPipeline();
        return;
      }
      // Free-form tweak: append to pain
      brief.pain = (brief.pain && brief.pain !== DEFAULT_BRIEF.pain ? brief.pain + '；' : '') + text;
      pushMsg('ai', '已记入「需求与痛点」，可继续改卡片，或点「开始布置 / 重新生成」。');
      render();
    }
  }

  /* ---------- Placement geometry ---------- */

  function roomBBox(poly) {
    return bbox(poly);
  }

  function roomCenter(poly) {
    const [x0, y0, x1, y1] = roomBBox(poly);
    return [(x0 + x1) / 2, (y0 + y1) / 2];
  }

  function insetPoint(poly, cx, cy, margin) {
    const [x0, y0, x1, y1] = roomBBox(poly);
    return [
      Math.max(x0 + margin, Math.min(x1 - margin, cx)),
      Math.max(y0 + margin, Math.min(y1 - margin, cy)),
    ];
  }

  function wallHit(f) {
    return !M.furniturePlacement(f,state.project.architecture,state.demolished).ok;
  }

  function furnOverlap(f, others) {
    const fp = M.footprint(f);
    // Rugs are floor layers — other items may sit on them.
    return others.some(o => {
      if (o.type === 'rug' || f.type === 'rug') return false;
      return M.overlap(fp, M.footprint(o));
    });
  }

  function centerInside(f, poly) {
    return M.inside(f.cx, f.cy, poly);
  }

  function tryPlace(it, cx, cy, rot, poly, placed, margin) {
    const [type, name, w, d, color] = it;
    const f = {
      id: uid(), type, name,
      cx: Math.round(cx / 10) * 10,
      cy: Math.round(cy / 10) * 10,
      w, d, rot: norm(rot || 0), color,
    };
    if (it[5]) f.h = it[5];
    if (it[6]?.model) f.model = structuredClone(it[6].model);
    if (it[6]?.evidence) f.modelEvidence = it[6].evidence;
    pushOut(f);
    const m = margin || Math.max(w, d) * 0.35;
    [f.cx, f.cy] = insetPoint(poly, f.cx, f.cy, m * 0.25);
    if (!centerInside(f, poly)) return null;
    if (wallHit(f)) {
      // nudge toward room center once
      const [rcx, rcy] = roomCenter(poly);
      f.cx = Math.round((f.cx * 0.7 + rcx * 0.3) / 10) * 10;
      f.cy = Math.round((f.cy * 0.7 + rcy * 0.3) / 10) * 10;
      pushOut(f);
      if (!centerInside(f, poly) || wallHit(f)) return null;
    }
    if (furnOverlap(f, placed)) return null;
    return f;
  }

  function placeNearWall(it, poly, side, placed, offset) {
    // side: 'n'|'s'|'e'|'w' — item faces into room (back to wall)
    const [x0, y0, x1, y1] = roomBBox(poly);
    const [type, name, w, d] = it;
    const pad = 80 + (offset || 0);
    let cx, cy, rot;
    if (side === 'n') { cx = (x0 + x1) / 2; cy = y0 + d / 2 + pad; rot = 0; }
    else if (side === 's') { cx = (x0 + x1) / 2; cy = y1 - d / 2 - pad; rot = 180; }
    else if (side === 'w') { cx = x0 + d / 2 + pad; cy = (y0 + y1) / 2; rot = 270; }
    else { cx = x1 - d / 2 - pad; cy = (y0 + y1) / 2; rot = 90; }
    // Prefer longer wall for large items
    const rw = x1 - x0, rh = y1 - y0;
    if ((side === 'n' || side === 's') && w > rw - 200) return null;
    if ((side === 'e' || side === 'w') && w > rh - 200) return null;
    return tryPlace(it, cx, cy, rot, poly, placed);
  }

  function placeCenter(it, poly, placed, rot) {
    const [cx, cy] = roomCenter(poly);
    return tryPlace(it, cx, cy, rot || 0, poly, placed);
  }

  function longestSides(poly) {
    const [x0, y0, x1, y1] = roomBBox(poly);
    const rw = x1 - x0, rh = y1 - y0;
    if (rw >= rh) return { long: ['n', 's'], short: ['w', 'e'] };
    return { long: ['w', 'e'], short: ['n', 's'] };
  }

  function firstFit(it, poly, sides, placed) {
    for (const s of sides) {
      const f = placeNearWall(it, poly, s, placed);
      if (f) return f;
    }
    return placeCenter(it, poly, placed);
  }

  function preferBedSize(briefText, room) {
    const t = (briefText.family || '') + (briefText.pain || '') + (room ? roomName(room) : '');
    if (/小孩|儿童|单人/.test(t) && !/主卧|夫妻/.test(room ? roomName(room) : '')) return libFind('bed', ['单人']) || libFind('bed', ['1.5']);
    if (/子女|次卧/.test(room ? roomName(room) : '') || /1\.5|150/.test(t)) return libFind('bed', ['1.5']) || libFind('bed');
    return libFind('bed', ['1.8']) || libFind('bed');
  }

  function preferSofa(briefText) {
    const t = (briefText.family || '') + (briefText.pain || '') + (briefText.priorities || '');
    if (/转角/.test(t)) return libFind('cornersofa') || libFind('sofa', ['三人']);
    if (/双人沙发|两人/.test(t)) return libFind('sofa', ['双人']) || libFind('sofa');
    return libFind('sofa', ['三人']) || libFind('sofa');
  }

  /* ---------- Per-room planners ---------- */

  function planLiving(room, briefText, placed) {
    const poly = room.poly;
    const out = [];
    const sides = longestSides(poly);
    const sofa = preferSofa(briefText);
    const tvstand = libFind('tvstand');
    const tv = libFind('tv', ['55']) || libFind('tv');
    const coffee = libFind('coffeetable');
    const rug = libFind('rug');
    const plant = libFind('plant', ['绿植']) || libFind('plant');
    const chair = libFind('armchair');
    const lamp = libFind('floorlamp');

    let sofaF = null;
    if (sofa) {
      for (const s of sides.long) {
        sofaF = placeNearWall(sofa, poly, s, placed.concat(out));
        if (sofaF) break;
      }
      if (!sofaF) sofaF = placeCenter(sofa, poly, placed.concat(out), 0);
      if (sofaF) out.push(sofaF);
    }

    const opposite = { n: 's', s: 'n', e: 'w', w: 'e' };
    const sofaSide = sofaF ? (() => {
      const [x0, y0, x1, y1] = roomBBox(poly);
      const dyN = Math.abs(sofaF.cy - y0), dyS = Math.abs(y1 - sofaF.cy);
      const dxW = Math.abs(sofaF.cx - x0), dxE = Math.abs(x1 - sofaF.cx);
      const m = Math.min(dyN, dyS, dxW, dxE);
      if (m === dyN) return 'n'; if (m === dyS) return 's'; if (m === dxW) return 'w'; return 'e';
    })() : sides.long[0];

    if (tvstand) {
      const f = placeNearWall(tvstand, poly, opposite[sofaSide], placed.concat(out));
      if (f) out.push(f);
    }
    if (rug) {
      const f = placeCenter(rug, poly, placed.concat(out), sofaF ? sofaF.rot : 0);
      if (f) out.unshift(f); // rugs under
    }
    if (tv) {
      const stand = out.find(f => f.type === 'tvstand');
      if (stand) {
        // TV shares the stand footprint (wall-mounted / on cabinet) — skip overlap vs stand.
        const f = {
          id: uid(), type: tv[0], name: tv[1],
          cx: stand.cx, cy: stand.cy, w: tv[2], d: tv[3], rot: stand.rot, color: tv[4],
        };
        if (centerInside(f, poly) && !wallHit(f)) out.push(f);
      }
    }
    if (coffee) {
      const [rcx, rcy] = roomCenter(poly);
      let f = tryPlace(coffee, rcx, rcy, sofaF ? sofaF.rot : 0, poly, placed.concat(out));
      if (!f && sofaF) {
        const a = sofaF.rot * Math.PI / 180;
        f = tryPlace(coffee, sofaF.cx - Math.sin(a) * 900, sofaF.cy + Math.cos(a) * 900, sofaF.rot, poly, placed.concat(out));
      }
      if (f) out.push(f);
    }
    if (chair) {
      const f = firstFit(chair, poly, sides.short, placed.concat(out));
      if (f) out.push(f);
    }
    if (plant) {
      const [x0, y0, x1, y1] = roomBBox(poly);
      const f = tryPlace(plant, x1 - 400, y1 - 400, 0, poly, placed.concat(out));
      if (f) out.push(f);
    }
    if (lamp && /采光|氛围|灯/.test((briefText.pain || '') + (briefText.priorities || ''))) {
      const f = firstFit(lamp, poly, sides.short.slice().reverse(), placed.concat(out));
      if (f) out.push(f);
    }
    return out;
  }

  function planBedroom(room, briefText, placed) {
    const poly = room.poly;
    const out = [];
    const sides = longestSides(poly);
    const bed = preferBedSize(briefText, room);
    const ns = libFind('nightstand');
    const wardrobeSmall = libFind('wardrobe', ['小']);
    const wardrobe = libFind('wardrobe', ['衣柜']) || libFind('wardrobe');
    const wantDesk = /办公|学习|书桌|小孩|儿童|子女/.test((briefText.priorities || '') + (briefText.pain || '') + roomName(room));
    const desk = wantDesk ? (libFind('desk', ['书']) || libFind('desk')) : null;
    const chair = libFind('chair');
    const dresser = libFind('dresser');

    let bedF = null;
    if (bed) {
      // headboard against a short wall often works; try both
      for (const s of [...sides.short, ...sides.long]) {
        bedF = placeNearWall(bed, poly, s, placed.concat(out));
        if (bedF) break;
      }
      if (!bedF) bedF = placeCenter(bed, poly, placed.concat(out));
      if (bedF) out.push(bedF);
    }

    if (ns && bedF) {
      const a = bedF.rot * Math.PI / 180;
      const alongX = Math.cos(a), alongY = Math.sin(a);
      const half = bedF.w / 2 + 80 + ns[2] / 2;
      for (const sign of [-1, 1]) {
        const f = tryPlace(ns, bedF.cx + alongX * half * sign, bedF.cy + alongY * half * sign, bedF.rot, poly, placed.concat(out));
        if (f) out.push(f);
      }
    }

    // Prefer wardrobe; fall back to smaller SKU then dresser.
    let stored = false;
    for (const w of [area(poly) < 11 ? wardrobeSmall : wardrobe, wardrobe, wardrobeSmall]) {
      if (!w || stored) continue;
      const f = firstFit(w, poly, [...sides.long, ...sides.short], placed.concat(out));
      if (f) { out.push(f); stored = true; }
    }
    if (desk) {
      const f = firstFit(desk, poly, sides.long.slice().reverse(), placed.concat(out));
      if (f) {
        out.push(f);
        if (chair) {
          const ca = f.rot * Math.PI / 180;
          const fx = Math.sin(ca), fy = -Math.cos(ca); // in front of desk
          const c = tryPlace(chair, f.cx + fx * 500, f.cy + fy * 500, f.rot + 180, poly, placed.concat(out));
          if (c) out.push(c);
        }
      }
    } else if (!stored && dresser) {
      const f = firstFit(dresser, poly, sides.short, placed.concat(out));
      if (f) out.push(f);
    }
    return out;
  }

  function planDining(room, briefText, placed) {
    const poly = room.poly;
    const out = [];
    const family = briefText.family || '';
    const big = /[四五六七八]口|六人|多人/.test(family);
    const table = big ? (libFind('table', ['六人']) || libFind('table')) : (libFind('table', ['餐桌']) || libFind('table'));
    const chair = libFind('chair', ['餐']) || libFind('chair');
    const cabinet = libFind('cabinet', ['餐边']) || libFind('cabinet');
    const fridge = libFind('fridge', ['冰箱']) || libFind('fridge');

    let tableF = null;
    if (table) {
      tableF = placeCenter(table, poly, placed.concat(out), 0);
      if (tableF) out.push(tableF);
    }
    if (chair && tableF) {
      const offsets = [
        [0, -(tableF.d / 2 + 280), 0],
        [0, tableF.d / 2 + 280, 180],
        [-(tableF.w / 2 + 280), 0, 90],
        [tableF.w / 2 + 280, 0, 270],
      ];
      const n = big ? 4 : Math.min(4, /两口|二人/.test(family) ? 2 : 4);
      for (let i = 0; i < n; i++) {
        const [dx, dy, rot] = offsets[i];
        const f = tryPlace(chair, tableF.cx + dx, tableF.cy + dy, rot, poly, placed.concat(out));
        if (f) out.push(f);
      }
    }
    if (cabinet) {
      const f = firstFit(cabinet, poly, longestSides(poly).long, placed.concat(out));
      if (f) out.push(f);
    }
    if (fridge && area(poly) > 8) {
      const f = firstFit(fridge, poly, longestSides(poly).short, placed.concat(out));
      if (f) out.push(f);
    }
    return out;
  }

  function planKitchen(room, briefText, placed) {
    const poly = room.poly;
    const out = [];
    // Minimal: wall counters + stove/sink if they fit; skip island unless pain asks
    const counter = libFind('counter');
    const stove = libFind('stove');
    const sink = libFind('ksink');
    const fridge = libFind('fridge', ['冰箱']) || libFind('fridge');
    const island = /岛台/.test(briefText.pain || '') ? libFind('island') : null;
    const sides = longestSides(poly);

    if (counter) {
      let c = placeNearWall(counter, poly, sides.long[0], placed.concat(out));
      if (c) out.push(c);
      if (area(poly) > 7) {
        c = placeNearWall(counter, poly, sides.long[1] || sides.short[0], placed.concat(out));
        if (c) out.push(c);
      }
    }
    if (stove) {
      const f = firstFit(stove, poly, sides.long, placed.concat(out));
      if (f) out.push(f);
    }
    if (sink) {
      const f = firstFit(sink, poly, sides.long.slice().reverse(), placed.concat(out));
      if (f) out.push(f);
    }
    if (fridge) {
      const f = firstFit(fridge, poly, sides.short, placed.concat(out));
      if (f) out.push(f);
    }
    if (island) {
      const f = placeCenter(island, poly, placed.concat(out));
      if (f) out.push(f);
    }
    return out;
  }

  function planBath(room, briefText, placed) {
    const poly = room.poly;
    const out = [];
    const sides = longestSides(poly);
    const toilet = libFind('toilet');
    const vanity = area(poly) > 5 ? (libFind('vanity', ['双']) || libFind('vanity')) : libFind('vanity');
    const shower = libFind('shower');
    const tub = area(poly) > 7 && /浴缸/.test(briefText.pain || '') ? libFind('bathtub') : null;
    const cabinet = libFind('cabinet', ['储物']) || libFind('cabinet');

    if (toilet) {
      const f = firstFit(toilet, poly, sides.short, placed.concat(out));
      if (f) out.push(f);
    }
    if (vanity) {
      const f = firstFit(vanity, poly, sides.long, placed.concat(out));
      if (f) out.push(f);
    }
    if (shower) {
      const [x0, y0, x1, y1] = roomBBox(poly);
      const f = tryPlace(shower, x0 + 500, y0 + 500, 0, poly, placed.concat(out));
      if (f) out.push(f);
      else {
        const g = firstFit(shower, poly, sides.long.slice().reverse(), placed.concat(out));
        if (g) out.push(g);
      }
    }
    if (tub) {
      const f = firstFit(tub, poly, sides.long, placed.concat(out));
      if (f) out.push(f);
    }
    if (cabinet && area(poly) > 4) {
      const f = firstFit(cabinet, poly, sides.short.slice().reverse(), placed.concat(out));
      if (f) out.push(f);
    }
    return out;
  }

  function planLaundry(room, briefText, placed) {
    const poly = room.poly;
    const out = [];
    const washer = libFind('washer');
    const dryer = /烘干/.test(briefText.pain || '') ? libFind('dryer') : null;
    const cabinet = libFind('cabinet') || libFind('shoecab');
    const heater = libFind('waterheater');
    const sides = longestSides(poly);
    if (washer) {
      const f = firstFit(washer, poly, sides.long, placed.concat(out));
      if (f) out.push(f);
    }
    if (dryer) {
      const f = firstFit(dryer, poly, sides.long, placed.concat(out));
      if (f) out.push(f);
    }
    if (cabinet) {
      const f = firstFit(cabinet, poly, sides.short, placed.concat(out));
      if (f) out.push(f);
    }
    if (heater) {
      const f = firstFit(heater, poly, sides.short.slice().reverse(), placed.concat(out));
      if (f) out.push(f);
    }
    return out;
  }

  function planBalcony(room, briefText, placed) {
    const poly = room.poly;
    const out = [];
    const plant = libFind('plant', ['大']) || libFind('plant');
    const plant2 = libFind('plant', ['绿植']) || libFind('plant');
    const table = libFind('roundtable') || libAny(['sidetable', 'coffeetable']);
    const chair = libFind('armchair', ['阅读']) || libFind('armchair');
    const storage = libFind('cabinet') || libFind('shoecab');

    if (table) {
      const f = placeCenter(table, poly, placed.concat(out));
      if (f) out.push(f);
    }
    if (chair) {
      const [rcx, rcy] = roomCenter(poly);
      const f = tryPlace(chair, rcx, rcy - 700, 0, poly, placed.concat(out));
      if (f) out.push(f);
      const f2 = tryPlace(chair, rcx, rcy + 700, 180, poly, placed.concat(out));
      if (f2) out.push(f2);
    }
    if (plant) {
      const [x0, y0, x1, y1] = roomBBox(poly);
      const f = tryPlace(plant, x1 - 350, y1 - 350, 0, poly, placed.concat(out));
      if (f) out.push(f);
    }
    if (plant2 && area(poly) > 6) {
      const [x0, y0] = roomBBox(poly);
      const f = tryPlace(plant2, x0 + 350, y0 + 350, 0, poly, placed.concat(out));
      if (f) out.push(f);
    }
    if (storage && /收纳/.test(briefText.priorities || '')) {
      const f = firstFit(storage, poly, longestSides(poly).long, placed.concat(out));
      if (f) out.push(f);
    }
    return out;
  }

  function planHall(room, briefText, placed) {
    const poly = room.poly;
    const out = [];
    const shoe = libFind('shoecab', ['玄关']) || libFind('shoecab');
    if (shoe && area(poly) > 2) {
      const f = firstFit(shoe, poly, longestSides(poly).long, placed.concat(out));
      if (f) out.push(f);
    }
    return out;
  }

  const PLANNERS = {
    living: planLiving,
    bedroom: planBedroom,
    dining: planDining,
    kitchen: planKitchen,
    bath: planBath,
    laundry: planLaundry,
    balcony: planBalcony,
    hall: planHall,
  };

  function zoningNote(rooms) {
    const groups = {};
    rooms.forEach(r => {
      const k = classifyRoom(r);
      (groups[k] = groups[k] || []).push(roomName(r));
    });
    const labels = {
      living: '会客起居', bedroom: '睡眠休息', dining: '用餐', kitchen: '备餐厨事',
      bath: '盥洗卫浴', laundry: '家务洗衣', balcony: '休闲阳台', hall: '通行收纳', bay: '飘窗', other: '其他',
    };
    return Object.entries(groups)
      .filter(([k]) => k !== 'bay')
      .map(([k, names]) => `${labels[k] || k}：${names.join('、')}`)
      .join('；');
  }

  function furnishableRooms() {
    return ROOMS.filter(r => r.counted !== false && classifyRoom(r) !== 'bay');
  }

  function buildPlan(briefText) {
    const rooms = furnishableRooms();
    const zoning = zoningNote(rooms);
    const byRoom = [];
    let placed = [];
    for (const room of rooms) {
      const kind = classifyRoom(room);
      const planner = PLANNERS[kind];
      if (!planner) {
        byRoom.push({ id: room.id, name: roomName(room), kind, items: [] });
        continue;
      }
      const items = planner(room, briefText, placed) || [];
      placed = placed.concat(items);
      byRoom.push({ id: room.id, name: roomName(room), kind, items });
    }
    return { zoning, byRoom, items: placed };
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function runPipeline() {
    if (phase === 'running') return;
    phase = 'running';
    statusLine = '空间功能分区中…';
    pushMsg('ai', '开始多步布置：① 分区规划 → ② 按房间选品落位（仅使用家具库现有尺寸）。');
    render();

    await sleep(280);
    let plan;
    try {
      plan = buildPlan(brief);
      lastPlan = plan;
      statusLine = '分区完成，正在摆放家具…';
      pushMsg('ai', '分区草案：' + plan.zoning);
      render();
      await sleep(320);

      const count = plan.items.length;
      if (!count) {
        phase = 'brief';
        statusLine = '';
        pushMsg('ai', '没有找到可布置的房间或合适家具，请先确认户型里有房间轮廓。');
        render();
        return;
      }

      // Single undoable commit: replace furniture with planned set
      mutate(() => {
        const ceilingItems=state.furniture.filter(f=>f.layer==='ceiling');
        state.furniture = plan.items.map(f => {
          if (f.type === 'rug') return f;
          return f;
        });
        // rugs first for draw order
        state.furniture.push(...ceilingItems);
        const rugs = state.furniture.filter(f => f.type === 'rug');
        const rest = state.furniture.filter(f => f.type !== 'rug');
        state.furniture = rugs.concat(rest);
      });

      phase = 'done';
      statusLine = '';
      const summary = plan.byRoom
        .filter(r => r.items.length)
        .map(r => `${r.name} ${r.items.length} 件`)
        .join(' · ');
      pushMsg('ai', `已布置 ${count} 件家具（全部来自家具库）。${summary}。请用顶栏「方案 1 / 2」切换，点「保存」写入当前槽；也可改简报后「重新生成」，或「撤销」恢复上一版。`);
      toast(`AI帮你装完成：已布置 ${count} 件，可用顶栏保存到方案槽`);
      render();
    } catch (err) {
      phase = 'brief';
      statusLine = '';
      pushMsg('ai', '布置未完成：' + (err.message || String(err)));
      toast('AI布置失败：' + (err.message || '未知错误'));
      render();
    }
  }

  /* ---------- UI ---------- */

  function briefCardsHtml() {
    return `<div class="ai-brief">${QUESTIONS.map(q => `
      <label class="ai-card"><span>${E(q.label)}</span>
        <textarea data-brief="${q.key}" rows="2" maxlength="400">${E(brief[q.key] || '')}</textarea>
      </label>`).join('')}</div>`;
  }

  function messagesHtml() {
    return `<div class="ai-chat" id="aiChatLog">${messages.map(m =>
      `<div class="ai-msg ${m.role === 'user' ? 'user' : 'bot'}"><b>${m.role === 'user' ? '你' : 'AI'}</b><p>${E(m.text)}</p></div>`
    ).join('')}</div>`;
  }

  function render() {
    if (!open) return;
    const p = $('#panel');
    if (!p) return;

    const showBrief = phase === 'brief' || phase === 'done' || phase === 'running';
    const busy = phase === 'running';
    const cfgSummary = window.AiConfig ? window.AiConfig.statusSummary() : '配置模块未加载';
    p.innerHTML = `<div class="p-work ai-layout">
      <div class="p-kicker">LAYOUT / AI帮你装</div>
      <h2>AI帮你装</h2>
      <p class="p-muted">访谈收集需求与痛点 → 可编辑简报 → 分区与选品落位。家具仅来自左侧家具库；一次写入，可撤销。</p>
      <p class="ai-cfg-line"><span>${E(cfgSummary)}</span>
        <button type="button" class="btn" id="aiOpenCfg" ${busy ? 'disabled' : ''}>接口设置</button>
      </p>
      ${messagesHtml()}
      ${statusLine ? `<p class="ai-status">${E(statusLine)}</p>` : ''}
      ${showBrief ? `<h3>需求简报</h3>${briefCardsHtml()}` : ''}
      <div class="ai-composer">
        <textarea id="aiInput" rows="2" maxlength="500" placeholder="${phase === 'interview' ? E(QUESTIONS[qIndex]?.placeholder || '输入回答…') : '补充需求，或输入「开始布置」'}" ${busy ? 'disabled' : ''}></textarea>
        <div class="p-actions">
          <button type="button" class="btn primary" id="aiSend" ${busy ? 'disabled' : ''}>发送</button>
          <button type="button" class="btn" id="aiSkip" ${busy || phase === 'done' ? 'disabled' : ''}>按标准来</button>
          ${showBrief ? `<button type="button" class="btn primary" id="aiGo" ${busy ? 'disabled' : ''}>${phase === 'done' ? '重新生成' : '开始布置'}</button>` : ''}
          <button type="button" class="btn" id="aiAskLlm" ${busy ? 'disabled' : ''} title="用当前接口向模型提问（不落位）">问模型</button>
          <button type="button" class="btn" id="aiClose">关闭</button>
        </div>
      </div>
      ${lastPlan && phase === 'done' ? `<p class="p-muted">上次分区：${E(lastPlan.zoning)}</p>` : ''}
      ${phase === 'done' && typeof layoutSchemesHtml === 'function' ? layoutSchemesHtml() : ''}
    </div>`;

    const log = $('#aiChatLog');
    if (log) log.scrollTop = log.scrollHeight;

    const input = $('#aiInput');
    const send = () => {
      const v = input?.value || '';
      if (input) input.value = '';
      handleUserText(v);
    };
    $('#aiSend')?.addEventListener('click', send);
    input?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    $('#aiSkip')?.addEventListener('click', () => {
      pushMsg('user', '按标准来');
      brief = { ...DEFAULT_BRIEF };
      phase = 'brief';
      pushMsg('ai', '已套用标准默认。可改简报，再点「开始布置」。');
      render();
    });
    $('#aiGo')?.addEventListener('click', () => {
      // sync brief from cards
      p.querySelectorAll('[data-brief]').forEach(el => { brief[el.dataset.brief] = el.value.trim() || brief[el.dataset.brief]; });
      runPipeline();
    });
    $('#aiOpenCfg')?.addEventListener('click', openConfigPanel);
    $('#aiAskLlm')?.addEventListener('click', () => askModelStub(input));
    $('#aiClose')?.addEventListener('click', closePanel);
    p.querySelectorAll('[data-brief]').forEach(el => {
      el.addEventListener('change', () => { brief[el.dataset.brief] = el.value; });
    });
    if (phase === 'done' && typeof bindLayoutSchemes === 'function') bindLayoutSchemes(p);
  }

  /** Optional stub: one-shot chat via AiClient (does not place furniture). */
  async function askModelStub(inputEl) {
    if (!window.AiClient || !window.AiConfig) {
      toast('AI 客户端未加载');
      return;
    }
    if (!window.AiConfig.hasKey()) {
      toast('请先在接口设置中填写 API Key');
      openConfigPanel();
      return;
    }
    const text = (inputEl?.value || '').trim();
    if (!text) {
      toast('请先输入要问模型的内容');
      return;
    }
    if (inputEl) inputEl.value = '';
    pushMsg('user', text);
    statusLine = '正在请求模型…';
    render();
    try {
      const briefText = QUESTIONS.map(q => `${q.label}：${brief[q.key] || ''}`).join('\n');
      const config = window.AiClient.requireConfig();
      const r = await window.AiClient.chatCompletions({
        config,
        messages: [
          {
            role: 'system',
            content: '你是室内布置助手。结合用户需求简报给出简洁中文建议，不要输出 JSON。当前简报：\n' + briefText,
          },
          { role: 'user', content: text },
        ],
        max_tokens: window.AiClient.usesCompletionTokens(config.model) ? 8192 : 600,
      });
      statusLine = '';
      pushMsg('ai', r.content.trim() || '（模型无返回内容）');
      render();
    } catch (err) {
      statusLine = '';
      pushMsg('ai', '模型调用失败：' + (err.message || String(err)));
      toast(err.message || '模型调用失败');
      render();
    }
  }

  function entryHtml() {
    const summary = window.AiConfig ? window.AiConfig.statusSummary() : '';
    return `<section class="ai-entry">
      <div class="p-kicker">AI / 智能布置</div>
      <h3>AI帮你装</h3>
      <p class="p-muted">聊聊需求与痛点，或直接按标准方案，自动从家具库摆进各房间。</p>
      ${summary ? `<p class="ai-cfg-line"><span>${E(summary)}</span></p>` : ''}
      <div class="p-actions">
        <button type="button" class="btn primary" id="aiOpen">开始访谈</button>
        <button type="button" class="btn" id="aiOpenStd">按标准来</button>
        <button type="button" class="btn" id="aiOpenCfgEntry">接口设置</button>
      </div>
    </section>`;
  }

  function bindEntry() {
    $('#aiOpen')?.addEventListener('click', () => openPanel(false));
    $('#aiOpenStd')?.addEventListener('click', () => openPanel(true));
    $('#aiOpenCfgEntry')?.addEventListener('click', openConfigPanel);
  }

  // Hook overview panel to show entry on 布置
  const origOverview = overviewPanel;
  overviewPanel = function () {
    return entryHtml() + origOverview();
  };
  const origBind = bindOverview;
  bindOverview = function () {
    origBind();
    bindEntry();
  };

  window.AiLayout = {
    open: openPanel,
    openConfig: openConfigPanel,
    close: closePanel,
    isOpen,
    render,
    /* test hook */
    _buildPlan: buildPlan,
    _classify: classifyRoom,
  };
})();
