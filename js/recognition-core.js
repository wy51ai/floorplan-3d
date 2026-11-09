/* Local raster floor-plan reconstruction. Coordinates stay in image pixels until calibration.
 * OCR post-process steps (normalize / parse / assign) are documented in js/ocr-postprocess-rules.js
 * for in-app viewing and reuse with alternate OCR engines. */
(function (root) {
  'use strict';
  if (typeof module !== 'undefined' && typeof require === 'function' && !root.FloorplanOcrPostprocessRules) {
    try { require('./ocr-postprocess-rules.js'); } catch (_) { /* browser / worker */ }
  }
  const median = a => {
    const s = [...a].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 8;
  };
  function span(src, w, h, k, horizontal, erode) {
    const out = new Uint8Array(w * h), r = Math.floor(k / 2), outer = horizontal ? h : w, inner = horizontal ? w : h;
    for (let a = 0; a < outer; a++) {
      let sum = 0;
      const idx = b => (horizontal ? a * w + b : b * w + a);
      for (let b = 0; b <= r && b < inner; b++) sum += src[idx(b)];
      for (let b = 0; b < inner; b++) {
        out[idx(b)] = erode ? (b >= r && b + r < inner && sum === k ? 1 : 0) : (sum > 0 ? 1 : 0);
        if (b - r >= 0) sum -= src[idx(b - r)];
        if (b + r + 1 < inner) sum += src[idx(b + r + 1)];
      }
    }
    return out;
  }
  function morph(src, w, h, kx, ky, erode) { return span(span(src, w, h, kx, true, erode), w, h, ky, false, erode); }
  function opening(src, w, h, kx, ky) { return morph(morph(src, w, h, kx, ky, true), w, h, kx, ky, false); }
  function overlap1d(a0, a1, b0, b1) { return Math.min(a1, b1) - Math.max(a0, b0); }
  function components(mask, w, h) {
    const labels = new Int32Array(w * h), queue = new Int32Array(w * h), items = [];
    let id = 0;
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || labels[start]) continue;
      id++;
      let head = 0, tail = 1;
      queue[0] = start;
      labels[start] = id;
      let x0 = w, y0 = h, x1 = 0, y1 = 0, sx = 0, sy = 0, touch = false;
      while (head < tail) {
        const p = queue[head++], x = p % w, y = (p / w) | 0;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        sx += x; sy += y;
        touch ||= x === 0 || y === 0 || x === w - 1 || y === h - 1;
        const ns = [];
        if (x > 0) ns.push(p - 1);
        if (x < w - 1) ns.push(p + 1);
        if (y > 0) ns.push(p - w);
        if (y < h - 1) ns.push(p + w);
        for (const n of ns) if (mask[n] && !labels[n]) { labels[n] = id; queue[tail++] = n; }
      }
      items.push({ id, area: tail, rect: [x0, y0, x1 + 1, y1 + 1], center: [sx / tail, sy / tail], touch });
    }
    return { items, labels };
  }
  function simplify(poly, tolerance = 1.5) {
    const distance = (p, a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    const rdp = pts => {
      if (pts.length < 3) return pts;
      let max = 0, index = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const d = distance(pts[i], pts[0], pts.at(-1));
        if (d > max) { max = d; index = i; }
      }
      return max > tolerance ? [...rdp(pts.slice(0, index + 1)).slice(0, -1), ...rdp(pts.slice(index))] : [pts[0], pts.at(-1)];
    };
    if (poly.length < 5) return poly;
    const half = Math.floor(poly.length / 2);
    return [...rdp(poly.slice(0, half + 1)).slice(0, -1), ...rdp([...poly.slice(half), poly[0]]).slice(0, -1)];
  }
  function contour(labels, id, w, h, rect) {
    const edges = new Map(), stride = w + 1, key = (x, y) => y * stride + x;
    const add = (a, b) => { if (!edges.has(a)) edges.set(a, []); edges.get(a).push(b); };
    for (let y = rect[1]; y < rect[3]; y++) for (let x = rect[0]; x < rect[2]; x++) if (labels[y * w + x] === id) {
      if (y === 0 || labels[(y - 1) * w + x] !== id) add(key(x, y), key(x + 1, y));
      if (x === w - 1 || labels[y * w + x + 1] !== id) add(key(x + 1, y), key(x + 1, y + 1));
      if (y === h - 1 || labels[(y + 1) * w + x] !== id) add(key(x + 1, y + 1), key(x, y + 1));
      if (x === 0 || labels[y * w + x - 1] !== id) add(key(x, y + 1), key(x, y));
    }
    let best = [], maxArea = 0;
    while (edges.size) {
      const start = edges.keys().next().value;
      let p = start, poly = [], steps = 0;
      do {
        poly.push([p % stride, (p / stride) | 0]);
        const next = edges.get(p);
        if (!next?.length) break;
        const n = next.pop();
        if (!next.length) edges.delete(p);
        p = n;
        if (++steps > w * h) break;
      } while (p !== start);
      let area = 0;
      poly.forEach((v, i) => { const q = poly[(i + 1) % poly.length]; area += v[0] * q[1] - q[0] * v[1]; });
      if (Math.abs(area) > maxArea) { best = poly; maxArea = Math.abs(area); }
    }
    best = best.filter((p, i) => {
      const a = best[(i + best.length - 1) % best.length], b = best[(i + 1) % best.length];
      return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
    });
    return simplify(best, 1.4);
  }
  function contains(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  function rectTouchesOuter(rect, bounds, pad) {
    return rect[0] <= bounds[0] + pad || rect[1] <= bounds[1] + pad || rect[2] >= bounds[2] - pad || rect[3] >= bounds[3] - pad;
  }
  function detectCompass(data, w, h) {
    const marginX = Math.max(24, Math.floor(w * .22)), marginY = Math.max(24, Math.floor(h * .18));
    const blue = [];
    const inMargin = (x, y) => x < marginX || y < marginY || x >= w - marginX || y >= h - marginY;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!inMargin(x, y)) continue;
      const i = (y * w + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 180) continue;
      if (b > 110 && b > r + 20 && b > g + 10 && (r + g + b) / 3 < 230) blue.push([x, y]);
    }
    if (blue.length < 20) return null;
    const labels = new Int32Array(w * h), queue = new Int32Array(w * h);
    const mark = new Uint8Array(w * h);
    for (const [x, y] of blue) mark[y * w + x] = 1;
    const clusters = [];
    for (const [sx0, sy0] of blue) {
      const start = sy0 * w + sx0;
      if (!mark[start] || labels[start]) continue;
      let head = 0, tail = 1, id = clusters.length + 1;
      queue[0] = start; labels[start] = id;
      let x0 = w, y0 = h, x1 = 0, y1 = 0, sx = 0, sy = 0, n = 0;
      while (head < tail) {
        const p = queue[head++], x = p % w, y = (p / w) | 0;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        sx += x; sy += y; n++;
        for (const npos of [p - 1, p + 1, p - w, p + w, p - w - 1, p - w + 1, p + w - 1, p + w + 1]) {
          if (npos < 0 || npos >= mark.length) continue;
          if (mark[npos] && !labels[npos]) { labels[npos] = id; queue[tail++] = npos; }
        }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (n < 18 || n > Math.max(900, w * h * .01) || Math.max(bw, bh) > Math.min(w, h) * .18) continue;
      clusters.push({ n, rect: [x0, y0, x1 + 1, y1 + 1], cx: sx / n, cy: sy / n, bw, bh });
    }
    if (!clusters.length) return null;
    clusters.sort((a, b) => a.n - b.n);
    // Prefer compact needle-like clusters near corners.
    const cand = clusters.filter(c => Math.max(c.bw, c.bh) / Math.min(c.bw, c.bh) >= 1.2 || c.n < 220).sort((a, b) => {
      const corner = Math.min(a.cx, w - a.cx) + Math.min(a.cy, h - a.cy);
      const cornerB = Math.min(b.cx, w - b.cx) + Math.min(b.cy, h - b.cy);
      return corner - cornerB || a.n - b.n;
    })[0] || clusters[0];
    const pad = Math.max(8, Math.round(Math.max(cand.bw, cand.bh) * 1.2));
    let darkX = 0, darkY = 0, darkN = 0;
    for (let y = Math.max(0, cand.rect[1] - pad); y < Math.min(h, cand.rect[3] + pad); y++) {
      for (let x = Math.max(0, cand.rect[0] - pad); x < Math.min(w, cand.rect[2] + pad); x++) {
        const i = (y * w + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
        const gray = (r + g + b) / 3, chroma = Math.max(r, g, b) - Math.min(r, g, b);
        if (gray < 90 && chroma < 40) { darkX += x; darkY += y; darkN++; }
      }
    }
    const boxPad = Math.max(12, Math.round(Math.max(cand.bw, cand.bh) * .9));
    const minX = Math.min(cand.rect[0], darkN ? darkX / darkN : cand.cx);
    const minY = Math.min(cand.rect[1], darkN ? darkY / darkN : cand.cy);
    const maxX = Math.max(cand.rect[2], darkN ? darkX / darkN : cand.cx);
    const maxY = Math.max(cand.rect[3], darkN ? darkY / darkN : cand.cy);
    const bodyCx = (Math.max(0, minX - 2) + Math.min(w, maxX + 2)) / 2;
    const bodyCy = (Math.max(0, minY - 2) + Math.min(h, maxY + 2)) / 2;
    const tipX = cand.cx, tipY = cand.cy;
    const dx = tipX - bodyCx, dy = tipY - bodyCy;
    // Only keep 东南西北：0 北朝上、90 北朝右、180 北朝下、270 北朝左。
    let angleDeg = Math.atan2(dx, -dy) * 180 / Math.PI;
    if (!Number.isFinite(angleDeg) || Math.hypot(dx, dy) < 1.5) angleDeg = tipY <= bodyCy ? 0 : 180;
    while (angleDeg < 0) angleDeg += 360;
    while (angleDeg >= 360) angleDeg -= 360;
    const snapped = snapNorthCardinal(angleDeg);
    return {
      x: tipX, y: tipY,
      angleDeg: snapped.angleDeg,
      facing: snapped.facing,
      box: [Math.max(0, minX - boxPad), Math.max(0, minY - boxPad), Math.min(w, maxX + boxPad), Math.min(h, maxY + boxPad)],
      source: '图像指南针'
    };
  }
  function snapNorthCardinal(angleDeg) {
    let a = Number(angleDeg);
    if (!Number.isFinite(a)) a = 0;
    while (a < 0) a += 360;
    while (a >= 360) a -= 360;
    const opts = [
      { angleDeg: 0, facing: '北朝上' },
      { angleDeg: 90, facing: '北朝右' },
      { angleDeg: 180, facing: '北朝下' },
      { angleDeg: 270, facing: '北朝左' }
    ];
    let best = opts[0], bestD = 1e9;
    for (const o of opts) {
      const d = Math.min(Math.abs(a - o.angleDeg), 360 - Math.abs(a - o.angleDeg));
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }
  function clearRectMask(mask, w, h, rect) {
    const x0 = Math.max(0, Math.floor(rect[0])), y0 = Math.max(0, Math.floor(rect[1]));
    const x1 = Math.min(w, Math.ceil(rect[2])), y1 = Math.min(h, Math.ceil(rect[3]));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 0;
  }
  function detectDimensionFrame(dark, w, h, wallBounds) {
    // Prefer thin annotation strokes outside the thick wall cluster, not the wall edge itself.
    const row = new Float64Array(h), col = new Float64Array(w);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dark[y * w + x]) { row[y]++; col[x]++; }
    const peakBand = (arr, from, to, minHits) => {
      if (to - from < 3) return -1;
      let best = -1, bestVal = minHits - 1;
      for (let i = Math.max(0, from); i < Math.min(arr.length, to); i++) if (arr[i] > bestVal) { bestVal = arr[i]; best = i; }
      return best;
    };
    let topFrom = 0, topTo = Math.floor(h * .28), botFrom = Math.floor(h * .72), botTo = h;
    let leftFrom = 0, leftTo = Math.floor(w * .28), rightFrom = Math.floor(w * .72), rightTo = w;
    if (wallBounds) {
      const gap = Math.max(8, Math.round(Math.min(w, h) * .01));
      topTo = Math.max(topFrom + 3, wallBounds[1] - gap);
      botFrom = Math.min(h - 3, wallBounds[3] + gap);
      leftTo = Math.max(leftFrom + 3, wallBounds[0] - gap);
      rightFrom = Math.min(w - 3, wallBounds[2] + gap);
    }
    const top = peakBand(row, topFrom, topTo, w * .02);
    const bottom = peakBand(row, botFrom, botTo, w * .02);
    const left = peakBand(col, leftFrom, leftTo, h * .02);
    const right = peakBand(col, rightFrom, rightTo, h * .02);
    if (top < 0 || bottom < 0 || left < 0 || right < 0) return null;
    if (right - left < w * .2 || bottom - top < h * .2) return null;
    // Keep walls inside: frame spans the annotation lines, with a small outward pad for ticks.
    const pad = 4;
    return {
      rect: [Math.max(0, left - pad), Math.max(0, top - pad), Math.min(w, right + pad), Math.min(h, bottom + pad)],
      lines: { top, bottom, left, right },
      source: '外围尺寸/比例线'
    };
  }
  function suppressOutsidePlan(neutral, dark, w, h, bounds, thickness, compass, dimensionFrame) {
    // Once scale/dimension lines are found, ignore everything outside that frame.
    // Otherwise fall back to wall-cluster bounds. Compass patch is the only exterior keep.
    let keep;
    if (dimensionFrame?.rect) keep = dimensionFrame.rect;
    else {
      const pad = Math.max(thickness * 2.5, 10);
      keep = [bounds[0] - pad, bounds[1] - pad, bounds[2] + pad, bounds[3] + pad];
    }
    const protect = compass?.box;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const inside = x >= keep[0] && x < keep[2] && y >= keep[1] && y < keep[3];
      const keepCompass = protect && x >= protect[0] && x < protect[2] && y >= protect[1] && y < protect[3];
      if (!inside && !keepCompass) { neutral[y * w + x] = 0; dark[y * w + x] = 0; }
    }
    if (!dimensionFrame) {
      clearRectMask(neutral, w, h, [Math.floor(w * .72), 0, w, Math.floor(h * .16)]);
      clearRectMask(dark, w, h, [Math.floor(w * .72), 0, w, Math.floor(h * .16)]);
    }
  }
  function largestWallCluster(walls, thickness) {
    if (walls.length <= 1) return walls;
    const link = Math.max(thickness * 6, 28);
    const n = walls.length, parent = Uint16Array.from({ length: n }, (_, i) => i);
    const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
    const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = walls[i].rect, b = walls[j].rect;
      const gx = Math.max(0, Math.max(a[0] - b[2], b[0] - a[2]));
      const gy = Math.max(0, Math.max(a[1] - b[3], b[1] - a[3]));
      const near = gx <= link && gy <= link;
      const aligned = (a[2] > a[0] && b[2] > b[0] && overlap1d(a[0], a[2], b[0], b[2]) > -link) || (a[3] > a[1] && b[3] > b[1] && overlap1d(a[1], a[3], b[1], b[3]) > -link);
      if (near && aligned) unite(i, j);
    }
    const sizes = new Map();
    for (let i = 0; i < n; i++) { const r = find(i); sizes.set(r, (sizes.get(r) || 0) + walls[i].area); }
    let best = 0, bestArea = -1;
    for (const [k, area] of sizes) if (area > bestArea) { best = k; bestArea = area; }
    return walls.filter((_, i) => find(i) === best);
  }
  function openingTouchesRoom(op, rooms, pad) {
    const [x0, y0, x1, y1] = op.rect;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    for (const room of rooms) {
      if (contains(mx, my, room.poly)) return true;
      const r = room.rect;
      if (x0 <= r[2] + pad && x1 >= r[0] - pad && y0 <= r[3] + pad && y1 >= r[1] - pad) {
        // Opening should sit on the room perimeter, not deep inside.
        const deep = contains(mx, my, room.poly) === false && contains(
          mx + (op.axis === 'v' ? (mx < (r[0] + r[2]) / 2 ? pad : -pad) : 0),
          my + (op.axis === 'h' ? (my < (r[1] + r[3]) / 2 ? pad : -pad) : 0),
          room.poly
        );
        if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) return true;
        if (deep) return true;
      }
    }
    return rooms.some(room => {
      const r = room.rect;
      return x0 <= r[2] + pad && x1 >= r[0] - pad && y0 <= r[3] + pad && y1 >= r[1] - pad;
    });
  }
  function paintRect(out, w, h, rect, fill, pad = 0) {
    const x0 = Math.max(0, Math.floor(rect[0] - pad));
    const y0 = Math.max(0, Math.floor(rect[1] - pad));
    const x1 = Math.min(w, Math.ceil(rect[2] + pad));
    const y1 = Math.min(h, Math.ceil(rect[3] + pad));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      out[i] = fill[0]; out[i + 1] = fill[1]; out[i + 2] = fill[2]; out[i + 3] = fill[3];
    }
  }
  function bboxFromEvidence(ev) {
    if (!ev) return null;
    if (ev.bbox) return [ev.bbox.x0, ev.bbox.y0, ev.bbox.x1, ev.bbox.y1];
    if (Array.isArray(ev.rect) && ev.rect.length >= 4) return ev.rect;
    return null;
  }
  /** Collect padded rectangles covering OCR room name/area ink (and at-center fallbacks). */
  function roomLabelScrubRects(result) {
    const rects = [];
    const push = (rect, pad) => {
      if (!rect) return;
      const [x0, y0, x1, y1] = rect;
      if (!(x1 > x0 && y1 > y0)) return;
      rects.push([x0 - pad, y0 - pad, x1 + pad, y1 + pad]);
    };
    for (const room of result.rooms || []) {
      const nameBox = bboxFromEvidence(room.textEvidence);
      const areaBox = bboxFromEvidence(room.areaEvidence);
      push(nameBox, 6);
      push(areaBox, 6);
      if (nameBox && areaBox) {
        push([
          Math.min(nameBox[0], areaBox[0]),
          Math.min(nameBox[1], areaBox[1]),
          Math.max(nameBox[2], areaBox[2]),
          Math.max(nameBox[3], areaBox[3])
        ], 8);
      }
      // Fallback: printed name + area stack sits on the recognition centroid.
      if (room.at && (!nameBox || !areaBox)) {
        const [cx, cy] = room.at;
        const tw = nameBox ? Math.max(36, nameBox[2] - nameBox[0]) : 48;
        const th = areaBox ? Math.max(44, (areaBox[3] - areaBox[1]) + (nameBox ? nameBox[3] - nameBox[1] + 8 : 22)) : 56;
        push([cx - tw / 2, cy - th * 0.35, cx + tw / 2, cy + th * 0.65], 4);
      }
    }
    return rects;
  }
  /**
   * Wipe room interiors on the underlay (keep a wall rim) so printed name/area ink
   * cannot ghost behind live SVG labels after rooms are resized.
   * Component-based glyph scrub alone was too weak on gray OCR text / large labels.
   */
  function scrubRoomLabelInk(imageData, polys, bg) {
    const { width: w, height: h, data } = imageData;
    if (!polys?.length) return { width: w, height: h, data: new Uint8ClampedArray(data) };
    const out = new Uint8ClampedArray(data);
    const fill = bg || [234, 240, 245, 255];
    const margin = Math.max(4, Math.round(Math.min(w, h) * 0.006));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      for (const poly of polys) {
        if (!poly?.length || !contains(x, y, poly)) continue;
        // Keep a rim so wall strokes near the boundary are not erased.
        if (x < margin || y < margin || x >= w - margin || y >= h - margin) continue;
        let nearEdge = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const ax = poly[j][0], ay = poly[j][1], bx = poly[i][0], by = poly[i][1];
          const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
          let t = ((x - ax) * dx + (y - ay) * dy) / len2;
          t = Math.max(0, Math.min(1, t));
          const px = ax + t * dx, py = ay + t * dy;
          if ((x - px) * (x - px) + (y - py) * (y - py) <= margin * margin) { nearEdge = true; break; }
        }
        if (!nearEdge) {
          const i = (y * w + x) * 4;
          out[i] = fill[0]; out[i + 1] = fill[1]; out[i + 2] = fill[2]; out[i + 3] = fill[3];
          break;
        }
      }
    }
    return { width: w, height: h, data: out };
  }
  function cleanUnderlayImage(imageData, result, bg) {
    const { width: w, height: h, data } = imageData;
    const out = new Uint8ClampedArray(data);
    const fill = bg || [234, 240, 245, 255];
    const compass = result.compass?.box;
    let keep;
    if (result.dimensionFrame?.rect) keep = result.dimensionFrame.rect;
    else {
      const [x0, y0, x1, y1] = result.bounds || [0, 0, w, h];
      const pad = Math.max(8, (result.thickness || 8) * 1.5);
      keep = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const keepCompass = compass && x >= compass[0] && x < compass[2] && y >= compass[1] && y < compass[3];
      const inside = x >= keep[0] && x < keep[2] && y >= keep[1] && y < keep[3];
      const scrubUi = !result.dimensionFrame && x >= w * .72 && y <= h * .16;
      if ((!inside && !keepCompass) || scrubUi) {
        const i = (y * w + x) * 4;
        out[i] = fill[0]; out[i + 1] = fill[1]; out[i + 2] = fill[2]; out[i + 3] = fill[3];
      }
    }
    // Wipe printed room name/area so live SVG labels are the only ones after resize.
    for (const rect of roomLabelScrubRects(result)) paintRect(out, w, h, rect, fill, 0);
    const polys = (result.rooms || []).map(r => r.poly).filter(p => p?.length >= 3);
    if (polys.length) {
      const inked = scrubRoomLabelInk({ width: w, height: h, data: out }, polys, fill);
      return inked;
    }
    return { width: w, height: h, data: out };
  }

  function detect(image, options = {}) {
    const { width: w, height: h, data } = image;
    if (w < 32 || h < 32 || w * h > 3000000) throw new Error('请使用清晰的户型平面图（识别图像最大 300 万像素）');
    const threshold = options.threshold ?? 185, minThickness = options.thickness ?? 3;
    const length = Math.max(15, Math.round(Math.max(w, h) * .022)) | 1, thick = Math.max(1, minThickness) | 1;
    const dark = new Uint8Array(w * h), neutral = new Uint8Array(w * h);
    for (let i = 0; i < dark.length; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], gray = (r * 299 + g * 587 + b * 114) / 1000, alpha = data[i * 4 + 3] / 255;
      dark[i] = gray * alpha + 255 * (1 - alpha) < threshold ? 1 : 0;
      neutral[i] = dark[i] && Math.max(r, g, b) - Math.min(r, g, b) < (options.chroma ?? 36) ? 1 : 0;
    }
    const compass = detectCompass(data, w, h);
    // First pass finds walls; proportion lines are located outside that cluster.
    clearRectMask(neutral, w, h, [Math.floor(w * .72), 0, w, Math.floor(h * .16)]);
    clearRectMask(dark, w, h, [Math.floor(w * .72), 0, w, Math.floor(h * .16)]);
    const horizontal = opening(neutral, w, h, length, thick), vertical = opening(neutral, w, h, thick, length);
    let walls = [];
    for (const [mask, axis] of [[horizontal, 'h'], [vertical, 'v']]) for (const c of components(mask, w, h).items) {
      const rw = c.rect[2] - c.rect[0], rh = c.rect[3] - c.rect[1], long = axis === 'h' ? rw : rh, short = axis === 'h' ? rh : rw;
      if (long < length || long < short * 1.8 || c.area / (rw * rh) < .65 || short > Math.min(w, h) * .08) continue;
      walls.push({ id: 'wall-' + walls.length, rect: c.rect, axis, area: c.area });
    }
    const preliminaryThickness = median(walls.map(v => Math.min(v.rect[2] - v.rect[0], v.rect[3] - v.rect[1])));
    walls = walls.filter(v => Math.min(v.rect[2] - v.rect[0], v.rect[3] - v.rect[1]) >= Math.max(3, preliminaryThickness * .4));
    walls = largestWallCluster(walls, preliminaryThickness || 8);
    let bounds = walls.length
      ? [Math.min(...walls.map(v => v.rect[0])), Math.min(...walls.map(v => v.rect[1])), Math.max(...walls.map(v => v.rect[2])), Math.max(...walls.map(v => v.rect[3]))]
      : [0, 0, w, h];
    const dimensionFrame = detectDimensionFrame(dark, w, h, walls.length ? bounds : null);
    suppressOutsidePlan(neutral, dark, w, h, bounds, preliminaryThickness || 8, compass, dimensionFrame);
    const anchors = [...walls];
    const colors = new Uint32Array(256), covered = new Uint8Array(w * h);
    for (const wall of walls) for (let y = wall.rect[1]; y < wall.rect[3]; y++) for (let x = wall.rect[0]; x < wall.rect[2]; x++) {
      const i = y * w + x; covered[i] = 1;
      if (neutral[i]) colors[Math.round((data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3)]++;
    }
    let dominant = 0;
    for (let i = 1; i < 256; i++) if (colors[i] > colors[dominant]) dominant = i;
    const solid = new Uint8Array(w * h);
    for (let i = 0; i < solid.length; i++) if (neutral[i] && Math.abs((data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3 - dominant) < 22) solid[i] = 1;
    const rectangles = [];
    for (const horizontalScan of [true, false]) {
      const inner = horizontalScan ? w : h, outer = horizontalScan ? h : w;
      let active = new Map();
      const finish = r => {
        const rw = r[2] - r[0], rh = r[3] - r[1];
        if (Math.min(rw, rh) >= Math.max(3, preliminaryThickness * .4) && rw * rh >= Math.max(30, preliminaryThickness ** 2 * .5) && Math.max(rw, rh) <= preliminaryThickness * 5)
          rectangles.push({ rect: r, axis: rw >= rh ? 'h' : 'v', area: rw * rh });
      };
      for (let a = 0; a <= outer; a++) {
        const next = new Map();
        let start = -1;
        for (let b = 0; b <= inner; b++) {
          const on = a < outer && b < inner && solid[horizontalScan ? a * w + b : b * w + a];
          if (on && start < 0) start = b;
          if (!on && start >= 0) {
            if (b - start >= Math.max(3, preliminaryThickness * .3)) {
              const key = start + ',' + b, old = active.get(key);
              const r = old || (horizontalScan ? [start, a, b, a + 1] : [a, start, a + 1, b]);
              if (old) { r[horizontalScan ? 3 : 2] = a + 1; active.delete(key); }
              next.set(key, r);
            }
            start = -1;
          }
        }
        for (const r of active.values()) finish(r);
        active = next;
      }
    }
    rectangles.sort((a, b) => b.area - a.area);
    walls = anchors;
    for (const v of rectangles) {
      const cx = (v.rect[0] + v.rect[2]) / 2, cy = (v.rect[1] + v.rect[3]) / 2;
      if (cx < bounds[0] - 2 || cy < bounds[1] - 2 || cx > bounds[2] + 2 || cy > bounds[3] + 2) continue;
      if (walls.some(q => q.rect[0] <= v.rect[0] && q.rect[1] <= v.rect[1] && q.rect[2] >= v.rect[2] && q.rect[3] >= v.rect[3])) continue;
      walls.push(v);
    }
    walls = largestWallCluster(walls, preliminaryThickness || 8);
    walls.forEach((v, i) => v.id = 'wall-' + i);
    if (walls.length > 600) throw new Error('图像纹理干扰较多，请裁掉界面或降低识别阈值后重试');
    const thickness = preliminaryThickness;
    bounds = walls.length
      ? [Math.min(...walls.map(v => v.rect[0])), Math.min(...walls.map(v => v.rect[1])), Math.max(...walls.map(v => v.rect[2])), Math.max(...walls.map(v => v.rect[3]))]
      : bounds;
    const barrier = new Uint8Array(w * h);
    const paint = rect => {
      for (let y = Math.max(0, Math.floor(rect[1])); y < Math.min(h, Math.ceil(rect[3])); y++)
        for (let x = Math.max(0, Math.floor(rect[0])); x < Math.min(w, Math.ceil(rect[2])); x++) barrier[y * w + x] = 1;
    };
    walls.forEach(v => paint(v.rect));
    const gaps = [], maxGap = options.gap ?? Math.max(thickness * 13, Math.max(w, h) * .11);
    for (const axis of ['h', 'v']) {
      const same = walls, p = axis === 'h' ? 0 : 1, q = 1 - p;
      for (const a of same) {
        const candidates = same.filter(b => b.id !== a.id && b.rect[p] >= a.rect[p + 2] - 1 && b.rect[p] - a.rect[p + 2] <= maxGap && Math.min(a.rect[q + 2], b.rect[q + 2]) - Math.max(a.rect[q], b.rect[q]) >= Math.min(a.rect[q + 2] - a.rect[q], b.rect[q + 2] - b.rect[q]) * .45).sort((a, b) => a.rect[p] - b.rect[p]);
        const b = candidates.find(b => {
          const mid = (Math.max(a.rect[q], b.rect[q]) + Math.min(a.rect[q + 2], b.rect[q + 2])) / 2;
          return [a, b].every(v => v.axis === axis || Math.min(Math.abs(mid - v.rect[q]), Math.abs(mid - v.rect[q + 2])) <= thickness * 1.5);
        });
        if (!b) continue;
        const gap = b.rect[p] - a.rect[p + 2];
        if (gap < Math.max(4, thickness * .7)) continue;
        const cross0 = Math.max(a.rect[q], b.rect[q]), cross1 = Math.min(a.rect[q + 2], b.rect[q + 2]);
        const rect = axis === 'h' ? [a.rect[2], cross0, b.rect[0], cross1] : [cross0, a.rect[3], cross1, b.rect[1]];
        const gapThickness = cross1 - cross0, gapLength = gap;
        if (gapThickness > thickness * 2.8 || gapThickness < Math.max(3, thickness * .35)) continue;
        if (walls.some(v => v !== a && v !== b && v.rect[0] < rect[2] && v.rect[1] < rect[3] && v.rect[2] > rect[0] && v.rect[3] > rect[1])) continue;
        const existing = gaps.find(g => g.axis === axis && Math.abs(g.rect[0] - rect[0]) < 3 && Math.abs(g.rect[1] - rect[1]) < 3);
        if (existing) continue;
        let lines = 0, darkHits = 0, samples = 0;
        const crossSize = Math.floor(cross1 - cross0);
        for (let c = 0; c < crossSize; c++) {
          let hits = 0;
          for (let j = 0; j < gap; j++) {
            const x = axis === 'h' ? Math.floor(rect[0] + j) : Math.floor(cross0 + c);
            const y = axis === 'h' ? Math.floor(cross0 + c) : Math.floor(rect[1] + j);
            const d = dark[y * w + x] || 0;
            hits += d; darkHits += d; samples++;
          }
          if (hits / gap > .7) lines++;
        }
        // Alignment alone is not evidence of a wall. Long blank spans can cross
        // an entire room (e.g. kitchen jamb -> opposite wall nib).
        const darkRatio = samples ? darkHits / samples : 1;
        const exteriorGap = rectTouchesOuter(rect, bounds, Math.max(thickness * 2.2, 24));
        const emptyLong = gapLength >= Math.max(thickness * 8, 90) && lines < 2 && darkRatio < .35;
        if (emptyLong) continue;
        const type = lines >= 2 || (exteriorGap && gapLength > thickness * 4) || (gapLength > thickness * 8 && darkRatio < .45)
          ? 'window' : 'door';
        gaps.push({ id: 'opening-' + gaps.length, rect, axis, type, review: true, gapLength, gapThickness });
        paint(rect);
      }
    }
    // Windows drawn inside continuous wall bands (white runs) are missed by gap-between-segments.
    for (const wall of walls) {
      const [x0, y0, x1, y1] = wall.rect;
      const axis = wall.axis;
      const long = axis === 'h' ? x1 - x0 : y1 - y0;
      const short = axis === 'h' ? y1 - y0 : x1 - x0;
      if (long < thickness * 8 || short < Math.max(3, thickness * .35)) continue;
      // Only scan walls that sit on / near the outer hull — interior partitions create false lights.
      if (!rectTouchesOuter(wall.rect, bounds, Math.max(thickness * 2.5, 28))) continue;
      const along0 = axis === 'h' ? x0 : y0, along1 = axis === 'h' ? x1 : y1;
      // Expand cross band slightly so thin window slits inside thick walls are visible.
      const cross0 = Math.max(0, (axis === 'h' ? y0 : x0) - 1);
      const cross1 = Math.min(axis === 'h' ? h : w, (axis === 'h' ? y1 : x1) + 1);
      const crossSize = Math.max(1, cross1 - cross0);
      let run = -1;
      const flush = (end) => {
        if (run < 0) return;
        const len = end - run;
        if (len < Math.max(thickness * 2.5, 32) || len > long * .85) { run = -1; return; }
        const rect = axis === 'h' ? [run, y0, end, y1] : [x0, run, x1, end];
        if (gaps.some(g => overlap1d(g.rect[0], g.rect[2], rect[0], rect[2]) > len * .5 && overlap1d(g.rect[1], g.rect[3], rect[1], rect[3]) > short * .4)) {
          run = -1; return;
        }
        gaps.push({ id: 'opening-' + gaps.length, rect, axis, type: 'window', review: true, gapLength: len, gapThickness: short, inWall: true });
        run = -1;
      };
      for (let t = along0; t <= along1; t++) {
        let light = 0, internalLight = 0, firstDark = -1, lastDark = -1;
        for (let c = cross0; c < cross1; c++) {
          const x = axis === 'h' ? t : c, y = axis === 'h' ? c : t;
          if (x >= 0 && y >= 0 && x < w && y < h) {
            if (!dark[y * w + x]) light++;
            else { if (firstDark < 0) firstDark = c; lastDark = c; }
          }
        }
        // A narrower solid wall leaves white pixels along one edge of its bbox.
        // Only a light slit bounded by ink on both sides is an in-wall opening.
        for (let c = firstDark + 1; firstDark >= 0 && c < lastDark; c++) {
          const x = axis === 'h' ? t : c, y = axis === 'h' ? c : t;
          if (!dark[y * w + x]) internalLight++;
        }
        const isLight = light / crossSize >= .42 && internalLight / crossSize >= .3;
        if (isLight && run < 0) run = t;
        if (!isLight) flush(t);
      }
      flush(along1);
    }
    // Thin balcony glazing / railings are often 1–2px and missed by thick-wall opening().
    // Attach long neutral strokes that touch the wall barrier so indented balconies seal off exterior.
    {
      const minRun = Math.max(36, Math.round(thickness * 2.5));
      const touchPad = 2;
      const shellPad = Math.max(thickness * 7, 110);
      const touchesBarrier = (x0, y0, x1, y1) => {
        for (let y = Math.max(0, y0 - touchPad); y < Math.min(h, y1 + touchPad); y++)
          for (let x = Math.max(0, x0 - touchPad); x < Math.min(w, x1 + touchPad); x++)
            if (barrier[y * w + x]) return true;
        return false;
      };
      const thinRuns = [];
      for (let y = Math.max(0, bounds[1] - 2); y < Math.min(h, bounds[3] + 2); y++) {
        let run = -1;
        for (let x = Math.max(0, bounds[0] - 2); x <= Math.min(w, bounds[2] + 2); x++) {
          const on = x < w && neutral[y * w + x] && !barrier[y * w + x];
          if (on && run < 0) run = x;
          if ((!on || x === Math.min(w, bounds[2] + 2)) && run >= 0) {
            const x1 = on ? x + 1 : x;
            if (x1 - run >= minRun && touchesBarrier(run, y, x1, y + 1)) thinRuns.push({ axis: 'h', rect: [run, y, x1, y + 1] });
            run = -1;
          }
        }
      }
      for (let x = Math.max(0, bounds[0] - 2); x < Math.min(w, bounds[2] + 2); x++) {
        let run = -1;
        for (let y = Math.max(0, bounds[1] - 2); y <= Math.min(h, bounds[3] + 2); y++) {
          const on = y < h && neutral[y * w + x] && !barrier[y * w + x];
          if (on && run < 0) run = y;
          if ((!on || y === Math.min(h, bounds[3] + 2)) && run >= 0) {
            const y1 = on ? y + 1 : y;
            if (y1 - run >= minRun && touchesBarrier(x, run, x + 1, y1)) thinRuns.push({ axis: 'v', rect: [x, run, x + 1, y1] });
            run = -1;
          }
        }
      }
      const half = Math.max(3, Math.round(thickness * 0.35));
      const isShellStroke = (tw) => {
        const [x0, y0, x1, y1] = tw.rect;
        const nearTop = y0 <= bounds[1] + shellPad, nearBot = y1 >= bounds[3] - shellPad;
        const nearLeft = x0 <= bounds[0] + shellPad, nearRight = x1 >= bounds[2] - shellPad;
        // Prefer strokes on the facing outer edge; allow indented balcony rails on the right/bottom notch.
        if (tw.axis === 'h') return nearTop || nearBot || (nearRight && y1 >= bounds[3] - shellPad * 1.6);
        return nearLeft || nearRight || (nearBot && x1 >= bounds[2] - shellPad * 1.6);
      };
      for (const tw of thinRuns) {
        paint(tw.rect);
        // Only promote shell-adjacent strokes to drawable walls/windows (skip interior furniture edges).
        if (!isShellStroke(tw)) continue;
        let rect;
        if (tw.axis === 'h') {
          const mid = (tw.rect[1] + tw.rect[3]) / 2;
          rect = [tw.rect[0], Math.max(0, Math.floor(mid - half)), tw.rect[2], Math.min(h, Math.ceil(mid + half))];
        } else {
          const mid = (tw.rect[0] + tw.rect[2]) / 2;
          rect = [Math.max(0, Math.floor(mid - half)), tw.rect[1], Math.min(w, Math.ceil(mid + half)), tw.rect[3]];
        }
        if (walls.some(v => v.rect[0] <= rect[0] + 1 && v.rect[1] <= rect[1] + 1 && v.rect[2] >= rect[2] - 1 && v.rect[3] >= rect[3] - 1)) continue;
        walls.push({ id: 'wall-' + walls.length, rect, axis: tw.axis, area: (rect[2] - rect[0]) * (rect[3] - rect[1]), thin: true });
        paint(rect);
        const gapLength = tw.axis === 'h' ? tw.rect[2] - tw.rect[0] : tw.rect[3] - tw.rect[1];
        if (gapLength >= Math.max(thickness * 3, 40) && !gaps.some(g =>
          overlap1d(g.rect[0], g.rect[2], rect[0], rect[2]) > gapLength * .4 &&
          overlap1d(g.rect[1], g.rect[3], rect[1], rect[3]) > half * .5
        )) {
          gaps.push({
            id: 'opening-' + gaps.length, rect, axis: tw.axis, type: 'window', review: true,
            gapLength, gapThickness: half * 2, inWall: true, thin: true
          });
        }
      }
    }
    // Close a bit more aggressively so balcony glazing / thin outer walls seal off the exterior corridor.
    const sealed = morph(morph(barrier, w, h, 5, 5, false), w, h, 3, 3, true), free = new Uint8Array(w * h);
    for (let i = 0; i < free.length; i++) free[i] = sealed[i] ? 0 : 1;
    // Clear everything outside wall/frame bounds, then flood from the bounds rim so the
    // outer corridor cannot become a room. Rooms that only open through sealed openings stay.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (x < bounds[0] || y < bounds[1] || x >= bounds[2] || y >= bounds[3]) free[y * w + x] = 0;
    }
    const exterior = new Uint8Array(w * h);
    {
      const qx = [], qy = [];
      const tryPush = (x, y) => {
        if (x < bounds[0] || y < bounds[1] || x >= bounds[2] || y >= bounds[3]) return;
        const i = y * w + x;
        if (!free[i] || exterior[i]) return;
        exterior[i] = 1; qx.push(x); qy.push(y);
      };
      for (let x = bounds[0]; x < bounds[2]; x++) { tryPush(x, bounds[1]); tryPush(x, bounds[3] - 1); }
      for (let y = bounds[1]; y < bounds[3]; y++) { tryPush(bounds[0], y); tryPush(bounds[2] - 1, y); }
      for (let qi = 0; qi < qx.length; qi++) {
        const x = qx[qi], y = qy[qi];
        tryPush(x + 1, y); tryPush(x - 1, y); tryPush(x, y + 1); tryPush(x, y - 1);
      }
      for (let i = 0; i < free.length; i++) if (exterior[i]) free[i] = 0;
    }
    const cc = components(free, w, h), minArea = options.minArea ?? Math.max(250, thickness * thickness * 8), rooms = [];
    const boundsArea = Math.max(1, (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]));
    const bw = bounds[2] - bounds[0], bh = bounds[3] - bounds[1];
    for (const c of cc.items) {
      if (c.touch || c.area < minArea || c.area > w * h * .8) continue;
      const poly = contour(cc.labels, c.id, w, h, c.rect);
      if (poly.length < 3 || poly.length > 190) continue;
      let center = c.center, best = Infinity;
      for (let y = c.rect[1]; y < c.rect[3]; y++) for (let x = c.rect[0]; x < c.rect[2]; x++) if (cc.labels[y * w + x] === c.id) {
        const dist = (x - c.center[0]) ** 2 + (y - c.center[1]) ** 2;
        if (dist < best) { best = dist; center = [x + .5, y + .5]; }
      }
      rooms.push({ id: 'room-' + rooms.length, name: '空间 ' + (rooms.length + 1), poly, at: center, areaPx: c.area, rect: c.rect, review: true });
    }
    // Drop wrapping outer free-space shells (edge corridor / full-plan leftover), keep real rooms.
    // Only discard a region when it contains other room centers — area alone must not kill a sole living room or balcony.
    const wrapsOthers = (room) => rooms.some(other => other !== room && other.areaPx < room.areaPx * .95 && contains(other.at[0], other.at[1], room.poly));
    const nearlyFullBox = (room) => (room.rect[2] - room.rect[0]) >= bw * .85 && (room.rect[3] - room.rect[1]) >= bh * .85;
    const kept = rooms.filter(room => {
      if (wrapsOthers(room)) return false;
      if (nearlyFullBox(room) && room.areaPx > boundsArea * .28 && rooms.length > 1) return false;
      return true;
    });
    rooms.length = 0;
    kept.forEach((r, i) => { r.id = 'room-' + i; r.name = '空间 ' + (i + 1); rooms.push(r); });
    // Only drop extremely tiny noise blobs; keep pipe wells / 玄关 so kitchen partitions stay correct.
    if (rooms.length > 2) {
      const areas = rooms.map(r => r.areaPx).sort((a, b) => a - b);
      const med = areas[Math.floor(areas.length / 2)];
      const filtered = rooms.filter(r => r.areaPx >= Math.max(minArea, med * 0.12));
      if (filtered.length >= 2) {
        rooms.length = 0;
        filtered.forEach((r, i) => { r.id = 'room-' + i; r.name = '空间 ' + (i + 1); rooms.push(r); });
      }
    }
    const pad = Math.max(thickness * 1.8, 8);
    const roomsTouched = (op) => rooms.filter(room => {
      const [x0, y0, x1, y1] = op.rect;
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const r = room.rect;
      if (!(x0 <= r[2] + pad && x1 >= r[0] - pad && y0 <= r[3] + pad && y1 >= r[1] - pad)) return false;
      // Prefer rooms whose interior lies on one side of the opening.
      const inset = Math.max(pad, thickness);
      if (op.axis === 'h') {
        return contains(mx, my - inset, room.poly) || contains(mx, my + inset, room.poly) || contains(mx, my, room.poly);
      }
      return contains(mx - inset, my, room.poly) || contains(mx + inset, my, room.poly) || contains(mx, my, room.poly);
    });
    let openings = gaps.filter(g => roomsTouched(g).length >= 1 || openingTouchesRoom(g, rooms, pad));
    const onExterior = (x, y) => {
      const ix = Math.round(x), iy = Math.round(y);
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) return true;
      if (exterior[iy * w + ix]) return true;
      return rectTouchesOuter([ix, iy, ix + 1, iy + 1], bounds, pad);
    };
    for (const g of openings) {
      const touched = roomsTouched(g);
      const outer = rectTouchesOuter(g.rect, bounds, Math.max(pad, thickness * 2));
      if (touched.length >= 2) {
        g.type = 'door';
      } else if (outer) {
        g.type = 'window';
      } else if (touched.length === 1) {
        const room = touched[0];
        const mx = (g.rect[0] + g.rect[2]) / 2, my = (g.rect[1] + g.rect[3]) / 2;
        const inset = Math.max(pad, thickness * 1.2);
        let outward;
        if (g.axis === 'h') {
          const up = contains(mx, my - inset, room.poly);
          outward = up ? [mx, my + inset] : [mx, my - inset];
        } else {
          const left = contains(mx - inset, my, room.poly);
          outward = left ? [mx + inset, my] : [mx - inset, my];
        }
        const hitsOther = rooms.some(r => r !== room && contains(outward[0], outward[1], r.poly));
        // Short interior gaps are doors; longer gaps facing flooded exterior are windows (indented facade).
        if (hitsOther) g.type = 'door';
        else if ((g.inWall || g.gapLength >= thickness * 5) && onExterior(outward[0], outward[1])) g.type = 'window';
        else g.type = 'door';
      } else if (g.inWall) {
        g.type = 'window';
      } else if (g.type === 'window' && g.gapLength < thickness * 6) {
        g.type = 'door';
      }
    }
    openings.forEach((g, i) => g.id = 'opening-' + i);
    return {
      width: w, height: h, walls, openings, rooms, thickness, bounds, compass, dimensionFrame,
      options: { threshold, thickness: thick, gap: maxGap },
      warnings: [
        ...(!walls.length ? ['未找到可靠的横竖墙段。'] : []),
        ...(!rooms.length ? ['未识别出闭合空间，可调整开口连接距离或在生成后补齐墙段。'] : []),
        ...(dimensionFrame
          ? ['已识别外围尺寸/比例线，线外内容不再参与户型生成。']
          : ['未稳定识别外围比例线，已用墙体范围近似裁切；请核对线外是否混入干扰。']),
        ...(compass ? ['已识别指南针：' + compass.facing + '（只区分东南西北）。'] : ['未识别到指南针，默认北朝上。']),
        '门窗类型及开启方向为图像推测，需对照原图精调。',
        '识别结果不区分承重墙；尺寸需现场复核后确认。'
      ]
    };

  }
  function normalizeOcrText(text) {
    return String(text || '')
      .replace(/\s+/g, '')
      .replace(/[，,]/g, '')
      .replace(/㎡/g, 'm²')
      .replace(/m[il1]\b/gi, 'm²')
      .replace(/mi$/i, 'm²')
      .replace(/m2$/i, 'm²');
  }
  function parseRoomArea(text) {
    const t = normalizeOcrText(text);
    // 9.14m² / 4.18m / 30.06 / 17.39m²
    let m = t.match(/(\d{1,2}\.\d{1,2})\s*(?:m²|m)?/i);
    if (m) {
      const v = Number(m[1]);
      if (v >= 1.5 && v <= 120) return v;
    }
    // OCR dropped the decimal: 418m → 4.18, 728m → 7.28, 682m → 6.82
    m = t.match(/^(\d)(\d{2})\s*(?:m²|m)?$/i);
    if (m) {
      const v = Number(m[1] + '.' + m[2]);
      if (v >= 1.5 && v <= 120) return v;
    }
    // 1739m → 17.39 (4 digits with trailing m)
    m = t.match(/^(\d{2})(\d{2})\s*(?:m²|m)$/i);
    if (m) {
      const v = Number(m[1] + '.' + m[2]);
      if (v >= 1.5 && v <= 120) return v;
    }
    // Broken OCR: 7了.28mi
    m = t.match(/(\d)[^\d.]{0,3}(\.\d{2})\s*(?:m²|m)?/i);
    if (m) {
      const v = Number(m[1] + m[2]);
      if (v >= 1.5 && v <= 120) return v;
    }
    return null;
  }
  function parseRoomName(text) {
    const t = normalizeOcrText(text);
    // Alias table lives in FloorplanOcrPostprocessRules (UI + export source of truth).
    const rules = root.FloorplanOcrPostprocessRules?.roomNameRegexRules?.() || [
      ['客餐厅', /客餐厅|客\s*餐\s*厅/],
      ['卫生间', /卫生间|卫浴|洗手间|洗澡间/],
      ['厨房', /厨房|后房/],
      ['阳台', /阳台|晾台|露台/],
      ['主卧', /主卧|主卧室/],
      ['次卧', /次卧|次卧室/],
      ['卧室', /卧室/],
      ['客厅', /客厅/],
      ['餐厅', /餐厅/],
      ['书房', /书房/],
      ['玄关', /玄关|门厅/],
      ['储藏', /储藏|储物|家居仓/],
      ['衣帽间', /衣帽间|衣帽/],
      ['过道', /过道|走廊/],
      ['洗衣', /洗衣房|洗衣/]
    ];
    for (const [name, re] of rules) if (re.test(t)) return name;
    return null;
  }
  function enrich(result, words) {
    const raw = (words || []).map(o => ({
      text: normalizeOcrText(o.text),
      confidence: o.confidence ?? 0,
      bbox: o.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 }
    })).filter(o => o.text);
    // Deduplicate OCR hits that share the same text and nearly same box.
    const list = [];
    for (const o of raw) {
      const cx = (o.bbox.x0 + o.bbox.x1) / 2, cy = (o.bbox.y0 + o.bbox.y1) / 2;
      if (list.some(v => v.text === o.text && Math.hypot(cx - (v.bbox.x0 + v.bbox.x1) / 2, cy - (v.bbox.y0 + v.bbox.y1) / 2) < 18)) continue;
      list.push(o);
    }
    // Merge nearby fragments in the same room label block (名称 + 面积 / 面积小数被拆开).
    const merged = list.slice();
    const pushMerge = (a, b, text) => {
      if (!parseRoomName(text) && parseRoomArea(text) == null) return;
      merged.push({
        text,
        confidence: Math.max(a.confidence, b.confidence, 40),
        bbox: {
          x0: Math.min(a.bbox.x0, b.bbox.x0), y0: Math.min(a.bbox.y0, b.bbox.y0),
          x1: Math.max(a.bbox.x1, b.bbox.x1), y1: Math.max(a.bbox.y1, b.bbox.y1)
        }
      });
    };
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const acx = (a.bbox.x0 + a.bbox.x1) / 2, acy = (a.bbox.y0 + a.bbox.y1) / 2;
        const bcx = (b.bbox.x0 + b.bbox.x1) / 2, bcy = (b.bbox.y0 + b.bbox.y1) / 2;
        if (Math.hypot(acx - bcx, acy - bcy) > 48) continue;
        const top = acy <= bcy ? a : b, bot = acy <= bcy ? b : a;
        const left = acx <= bcx ? a : b, right = acx <= bcx ? b : a;
        pushMerge(a, b, top.text + bot.text);
        pushMerge(a, b, left.text + right.text);
        // 4 + 18m → 4.18m when decimal point was lost
        if (/^\d$/.test(left.text) && /^\d{2}(?:m²|m)?$/i.test(right.text)) {
          pushMerge(a, b, left.text + '.' + right.text);
        }
      }
    }
    const roomOfPoint = (x, y) => {
      const hits = result.rooms.filter(r => contains(x, y, r.poly));
      if (!hits.length) {
        // Soft fallback: nearest room center within a short range (OCR often sits on furniture texture).
        let best = null, bestD = 55;
        for (const r of result.rooms) {
          const d = Math.hypot(x - r.at[0], y - r.at[1]);
          if (d < bestD) { bestD = d; best = r; }
        }
        return best;
      }
      return hits.sort((a, b) => a.areaPx - b.areaPx)[0];
    };
    const usedNames = new Set();
    const nameHits = merged.map(o => {
      const name = parseRoomName(o.text);
      if (!name) return null;
      // Accept low-confidence when the text itself is a clean room noun.
      if (o.confidence < 15 && o.text.length > name.length + 2) return null;
      return { ...o, name, cx: (o.bbox.x0 + o.bbox.x1) / 2, cy: (o.bbox.y0 + o.bbox.y1) / 2 };
    }).filter(Boolean).sort((a, b) => b.confidence - a.confidence || b.name.length - a.name.length);
    for (const label of nameHits) {
      const room = roomOfPoint(label.cx, label.cy);
      if (!room || usedNames.has(room.id)) continue;
      // Don't overwrite a longer/more specific name with a shorter one.
      if (room.textEvidence && String(room.name).length > label.name.length) continue;
      room.name = label.name;
      room.textEvidence = label;
      usedNames.add(room.id);
    }
    const areaHits = merged.map(o => {
      const area = parseRoomArea(o.text);
      if (area == null) return null;
      // Ignore bare integers that are likely wall dimensions (e.g. 1022).
      if (!/\d\.\d/.test(o.text) && !/(?:m²|m)/i.test(o.text) && area >= 100) return null;
      // Area-like tokens keep working even when Tesseract confidence is 0.
      return { ...o, area, cx: (o.bbox.x0 + o.bbox.x1) / 2, cy: (o.bbox.y0 + o.bbox.y1) / 2 };
    }).filter(Boolean).sort((a, b) => b.confidence - a.confidence);
    for (const hit of areaHits) {
      let room = roomOfPoint(hit.cx, hit.cy);
      // Area numbers sit just below the room title; if point misses poly, try a few px upward.
      if (!room) room = roomOfPoint(hit.cx, hit.cy - 18);
      if (!room || room.areaLabel != null) continue;
      room.areaLabel = hit.area;
      room.areaEvidence = hit;
      hit._used = true;
    }
    // If a named room still lacks area, take the nearest unused area hit beneath the name.
    for (const room of result.rooms) {
      if (room.areaLabel != null || !room.textEvidence) continue;
      const nx = room.textEvidence.cx, ny = room.textEvidence.cy;
      let best = null, bestD = 70;
      for (const hit of areaHits) {
        if (hit._used) continue;
        const d = Math.hypot(hit.cx - nx, hit.cy - ny);
        if (hit.cy + 6 < ny) continue; // area is usually below the title
        if (d < bestD) { bestD = d; best = hit; }
      }
      if (best) {
        room.areaLabel = best.area;
        room.areaEvidence = best;
        best._used = true;
      }
    }
    for (const room of result.rooms) {
      if (room.areaEvidence) room.areaEvidence._used = true;
    }
    result.scaleHint = estimateScale(result, list) || estimateScaleFromAreas(result.rooms);
    // Labels outside every polygon: attach to a nearby wall-bounded room when possible,
    // otherwise synthesize a placeholder (open balconies historically fell through here).
    const orphanNames = nameHits.filter(l => !result.rooms.some(r => contains(l.cx, l.cy, r.poly)));
    for (const label of orphanNames) {
      if (result.rooms.some(r => r.name === label.name && r.textEvidence)) continue;
      const nearBound = roomOfPoint(label.cx, label.cy);
      if (nearBound && !nearBound.synthetic && (!nearBound.textEvidence || /^空间/.test(nearBound.name))) {
        nearBound.name = label.name;
        nearBound.textEvidence = label;
        continue;
      }
      const nearArea = areaHits.find(h => !h._used && Math.hypot(h.cx - label.cx, h.cy - label.cy) < 55);
      const mm = (result.scaleHint && result.scaleHint.mmPerPx) || 10;
      const neighbor = result.rooms
        .map(r => ({ r, d: Math.hypot(label.cx - r.at[0], label.cy - r.at[1]) }))
        .sort((a, b) => a.d - b.d)[0]?.r;
      let rw = Math.max(70, (label.bbox.x1 - label.bbox.x0) * 3);
      let rh = Math.max(80, (label.bbox.y1 - label.bbox.y0) * 5);
      let x0 = label.cx - rw / 2, y0 = label.cy - rh * 0.35;
      // Prefer a rect snapped to the nearest room edge, sized from the area label when available.
      if (neighbor && nearArea) {
        let nr = neighbor.rect;
        if (!nr && neighbor.poly?.length) {
          const xs = neighbor.poly.map(p => p[0]), ys = neighbor.poly.map(p => p[1]);
          nr = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        }
        if (nr) {
          const [nx0, ny0, nx1, ny1] = nr;
          const targetPx = Math.max(1200, nearArea.area * 1e6 / (mm * mm));
          const below = label.cy >= (ny0 + ny1) / 2;
          const right = label.cx >= (nx0 + nx1) / 2;
          if (below) {
            rw = Math.max(60, Math.min(nx1 - nx0, Math.sqrt(targetPx * 1.2)));
            rh = Math.max(60, targetPx / rw);
            x0 = right ? nx1 - rw : nx0;
            y0 = ny1;
          } else if (right) {
            rh = Math.max(60, Math.min(ny1 - ny0, Math.sqrt(targetPx * 1.2)));
            rw = Math.max(60, targetPx / rh);
            x0 = nx1;
            y0 = Math.min(Math.max(ny0, label.cy - rh / 2), ny1 - rh);
          } else {
            rh = Math.max(60, Math.min(ny1 - ny0, Math.sqrt(targetPx * 1.2)));
            rw = Math.max(60, targetPx / rh);
            x0 = nx0 - rw;
            y0 = Math.min(Math.max(ny0, label.cy - rh / 2), ny1 - rh);
          }
        }
      }
      const rect = [x0, y0, x0 + rw, y0 + rh];
      const poly = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]];
      const room = {
        id: 'room-' + result.rooms.length,
        name: label.name,
        poly, at: [label.cx, label.cy],
        areaPx: nearArea ? Math.round(nearArea.area * 1e6 / (mm * mm)) : Math.round(rw * rh * 0.7),
        rect, review: true, textEvidence: label, synthetic: true
      };
      if (nearArea) { room.areaLabel = nearArea.area; room.areaEvidence = nearArea; nearArea._used = true; }
      result.rooms.push(room);
    }
    // Bathroom often loses the noun but keeps the area — name small unlabeled rooms by typical size.
    for (const room of result.rooms) {
      if (room.areaLabel == null || !/^空间/.test(room.name)) continue;
      if (room.areaLabel >= 3.5 && room.areaLabel <= 6.5 && room.areaPx < 25000) room.name = '卫生间';
    }
    // Tiny unlabeled room beside kitchen is usually 玄关 / 管道井.
    const kitchen = result.rooms.find(r => r.name === '厨房');
    if (kitchen) {
      for (const room of result.rooms) {
        if (!/^空间/.test(room.name) || room.areaPx > kitchen.areaPx * 0.7) continue;
        const dx = Math.abs(room.at[0] - kitchen.at[0]);
        const dy = Math.abs(room.at[1] - kitchen.at[1]);
        if (dy < (kitchen.rect[3] - kitchen.rect[1]) && dx < (kitchen.rect[2] - kitchen.rect[0]) * 1.2) {
          room.name = '玄关';
        }
      }
    }
    result.words = list;
    if (!result.scaleHint) result.scaleHint = estimateScaleFromAreas(result.rooms);
    return result;
  }
  function estimateScaleFromAreas(rooms) {
    const ratios = [];
    for (const r of rooms || []) {
      if (!(r.areaLabel > 1.5) || !(r.areaPx > 200)) continue;
      ratios.push(1000 * Math.sqrt(r.areaLabel / r.areaPx));
    }
    if (ratios.length < 2) return null;
    const mmPerPx = median(ratios);
    if (!(mmPerPx > 2 && mmPerPx < 40)) return null;
    return { mmPerPx, axis: 'area', values: ratios.map(v => Math.round(v * 100) / 100), source: '房间面积标注反推' };
  }
  function estimateScale(result, words) {
    const nums = [];
    for (const o of words || []) {
      const text = String(o.text || '');
      for (const m of text.matchAll(/\b(\d{3,5})\b/g)) {
        const value = Number(m[1]);
        if (value < 600 || value > 20000) continue;
        const cx = (o.bbox.x0 + o.bbox.x1) / 2, cy = (o.bbox.y0 + o.bbox.y1) / 2;
        nums.push({ value, cx, cy, bbox: o.bbox });
      }
    }
    if (!nums.length || !result.bounds) return null;
    const [x0, y0, x1, y1] = result.bounds;
    const bw = x1 - x0, bh = y1 - y0;
    const bottom = nums.filter(n => n.cy > y1 - bh * .18 && n.cx > x0 - 40 && n.cx < x1 + 40).sort((a, b) => a.cx - b.cx);
    const right = nums.filter(n => n.cx > x1 - bw * .18 && n.cy > y0 - 40 && n.cy < y1 + 40).sort((a, b) => a.cy - b.cy);
    const candidates = [];
    if (bottom.length >= 2) {
      const sum = bottom.reduce((s, n) => s + n.value, 0);
      candidates.push({ mmPerPx: sum / bw, axis: 'x', values: bottom.map(n => n.value), source: '底部尺寸标注合计' });
    }
    if (right.length >= 2) {
      const sum = right.reduce((s, n) => s + n.value, 0);
      candidates.push({ mmPerPx: sum / bh, axis: 'y', values: right.map(n => n.value), source: '右侧尺寸标注合计' });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => Math.abs(a.mmPerPx - 10) - Math.abs(b.mmPerPx - 10));
    const best = candidates[0];
    if (!(best.mmPerPx > 2 && best.mmPerPx < 40)) return null;
    return best;
  }
  function roundMM(v) { return Math.round(v / 10) * 10; }
  function doorFromOpening(op, scale, index) {
    const [x0, y0, x1, y1] = op.rect.map((v, i) => roundMM(v * scale));
    const axis = op.axis;
    const len = axis === 'h' ? Math.max(100, x1 - x0) : Math.max(100, y1 - y0);
    let h, c, o;
    if (axis === 'h') {
      h = [x0, y0];
      c = [1, 0];
      o = [0, 1];
    } else {
      h = [x0, y0];
      c = [0, 1];
      o = [1, 0];
    }
    return {
      id: 'door' + index,
      name: '门 ' + index,
      rect: [x0, y0, x1, y1],
      h, c, o, len, height: 2100,
      source: '图像识别，开启方向待精调',
      verified: false
    };
  }
  /**
   * Insert wall rects for wall-thickness gaps between adjacent rooms that are not
   * already covered by walls or openings. Fixes white “stuck wall” paper strips
   * (e.g. between 玄关 and 厨房) when recognition sealed a barrier without a wall.
   * Mutates architecture.walls. Returns number of walls added.
   */
  function fillMissingPartitionWalls(arch) {
    const rooms = arch.rooms || [], walls = arch.walls || [];
    if (rooms.length < 2) return 0;
    const openings = [
      ...(arch.windows || []).map(w => w.slice ? w.slice(0, 4) : w.rect || w),
      ...(arch.doors || []).map(d => d.rect || d),
      ...(arch.slides || []).map(d => d.rect || d)
    ].filter(r => Array.isArray(r) && r.length >= 4 && r[2] > r[0] && r[3] > r[1]);
    const boxes = rooms.map(r => {
      const xs = r.poly.map(p => p[0]), ys = r.poly.map(p => p[1]);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    });
    const thicks = walls.map(w => Math.min(w[2] - w[0], w[3] - w[1])).filter(t => t > 0).sort((a, b) => a - b);
    const medT = thicks.length ? thicks[Math.floor(thicks.length / 2)] : 240;
    const minT = Math.max(30, medT * 0.35);
    const maxT = Math.max(minT + 20, medT * 2.8);
    const minSpan = Math.max(120, medT * 2.5);
    const covers = (rects, x, y) => rects.some(r => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]);
    const wallRects = () => walls.map(w => [w[0], w[1], w[2], w[3]]);
    let added = 0;
    const tryGap = (x0, y0, x1, y1) => {
      const gw = x1 - x0, gh = y1 - y0;
      if (gw < 1 || gh < 1) return;
      const thin = Math.min(gw, gh), span = Math.max(gw, gh);
      if (thin < minT || thin > maxT || span < minSpan) return;
      let hitW = 0, hitO = 0, tot = 0;
      const step = Math.max(8, Math.round(Math.min(thin, span) / 8));
      for (let y = y0 + step * 0.5; y < y1; y += step) {
        for (let x = x0 + step * 0.5; x < x1; x += step) {
          tot++;
          if (covers(wallRects(), x, y)) hitW++;
          if (covers(openings, x, y)) hitO++;
        }
      }
      if (!tot) return;
      // Already walled, or mostly an intentional door/window opening — leave alone.
      if (hitW / tot >= 0.55 || hitO / tot >= 0.35) return;
      const id = 'w' + walls.length + '_seal' + added;
      walls.push([Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1), 'n', id]);
      added++;
    };
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const yOverlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        const xOverlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        if (a.x1 <= b.x0 && yOverlap >= minSpan) tryGap(a.x1, Math.max(a.y0, b.y0), b.x0, Math.min(a.y1, b.y1));
        else if (b.x1 <= a.x0 && yOverlap >= minSpan) tryGap(b.x1, Math.max(a.y0, b.y0), a.x0, Math.min(a.y1, b.y1));
        if (a.y1 <= b.y0 && xOverlap >= minSpan) tryGap(Math.max(a.x0, b.x0), a.y1, Math.min(a.x1, b.x1), b.y0);
        else if (b.y1 <= a.y0 && xOverlap >= minSpan) tryGap(Math.max(a.x0, b.x0), b.y1, Math.min(a.x1, b.x1), a.y0);
      }
    }
    return added;
  }
  function toArchitecture(result, mmPerPx) {
    const scale = Number(mmPerPx);
    if (!(scale > 0.5 && scale < 80)) throw new Error('比例无效，请填写已知长度或使用图上两点校准');
    const walls = result.walls.map((w, i) => {
      const r = w.rect.map((v, idx) => roundMM(v * scale));
      if (r[2] <= r[0]) r[2] = r[0] + roundMM(Math.max(scale, result.thickness * scale));
      if (r[3] <= r[1]) r[3] = r[1] + roundMM(Math.max(scale, result.thickness * scale));
      return [r[0], r[1], r[2], r[3], 'n', 'w' + i];
    });
    const windows = [], doors = [], slides = [];
    let wi = 0, di = 0, si = 0;
    for (const op of result.openings || []) {
      const r = op.rect.map(v => roundMM(v * scale));
      if (r[2] <= r[0] || r[3] <= r[1]) continue;
      const long = Math.max(r[2] - r[0], r[3] - r[1]);
      const kind = op.type || (rectTouchesOuter(op.rect, result.bounds, Math.max(result.thickness * 1.8, 8)) ? 'window' : 'door');
      if (kind === 'window') {
        windows.push([r[0], r[1], r[2], r[3], 'win' + (++wi)]);
      } else if (long >= 1600) {
        slides.push({ id: 'slide' + (++si), name: '推拉门 ' + si, rect: r, v: op.axis === 'v', source: '图像识别，待精调', verified: false });
      } else {
        doors.push(doorFromOpening(op, scale, ++di));
      }
    }
    const usedNames = new Map();
    const rooms = (result.rooms || []).map((room, i) => {
      let name = room.name || ('空间 ' + (i + 1));
      const count = usedNames.get(name) || 0;
      usedNames.set(name, count + 1);
      if (count) name = name + (count + 1);
      let poly = room.poly.map(([x, y]) => [roundMM(x * scale), roundMM(y * scale)]);
      poly = poly.filter((p, idx) => {
        const q = poly[(idx + poly.length - 1) % poly.length];
        return p[0] !== q[0] || p[1] !== q[1];
      });
      // Drop collinear middle points after quantization.
      poly = poly.filter((p, idx) => {
        const a = poly[(idx + poly.length - 1) % poly.length], b = poly[(idx + 1) % poly.length];
        return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
      });
      if (poly.length < 3) return null;
      const at = [roundMM(room.at[0] * scale), roundMM(room.at[1] * scale)];
      return {
        id: 'r' + (i + 1),
        name,
        mat: /卫|浴/.test(name) ? 'tile600' : /厨/.test(name) ? 'tile800' : 'wood',
        poly, at,
        source: '图像识别，待精调',
        verified: false
      };
    }).filter(Boolean);
    // Room polygons are derived from temporary flood-fill barriers, including
    // openings. Their bounding-box gaps must not create additional physical walls.
    // Carve every accepted opening out of the detected walls before rendering.
    const openingRects = [...windows, ...doors.map(d => d.rect), ...slides.map(d => d.rect)];
    let pieces = walls.map(w => w.slice(0, 4));
    for (const cut of openingRects) {
      pieces = pieces.flatMap(r => {
        const x0 = Math.max(r[0], cut[0]), y0 = Math.max(r[1], cut[1]);
        const x1 = Math.min(r[2], cut[2]), y1 = Math.min(r[3], cut[3]);
        if (x0 >= x1 || y0 >= y1) return [r];
        return [[r[0], r[1], r[2], y0], [r[0], y1, r[2], r[3]],
          [r[0], y0, x0, y1], [x1, y0, r[2], y1]]
          .filter(p => p[2] > p[0] && p[3] > p[1]);
      });
    }
    walls.length = 0;
    pieces.forEach((r, i) => walls.push([...r, 'u', 'w' + i]));
    const wallInfo = Object.fromEntries(walls.map(w => [w[5], { source: '图像识别，待精调', verified: false }]));
    const windowInfo = Object.fromEntries(windows.map(w => [w[4], { source: '图像识别，待精调', verified: false, sill: 900, head: 2400 }]));
    const pts = [
      ...walls.flatMap(w => [[w[0], w[1]], [w[2], w[3]]]),
      ...windows.flatMap(w => [[w[0], w[1]], [w[2], w[3]]]),
      ...doors.flatMap(d => [[d.rect[0], d.rect[1]], [d.rect[2], d.rect[3]]]),
      ...slides.flatMap(d => [[d.rect[0], d.rect[1]], [d.rect[2], d.rect[3]]]),
      ...rooms.flatMap(r => r.poly)
    ];
    let bx0 = pts.length ? Math.min(...pts.map(p => p[0])) : 0;
    let by0 = pts.length ? Math.min(...pts.map(p => p[1])) : 0;
    let bx1 = pts.length ? Math.max(...pts.map(p => p[0])) : 1000;
    let by1 = pts.length ? Math.max(...pts.map(p => p[1])) : 1000;
    // 把户型挪到原点附近，避免整图边距变成平面里的空白。
    const ox = bx0, oy = by0;
    const shiftRect = r => { r[0] -= ox; r[1] -= oy; r[2] -= ox; r[3] -= oy; };
    walls.forEach(shiftRect);
    windows.forEach(shiftRect);
    doors.forEach(d => { shiftRect(d.rect); d.h = [d.h[0] - ox, d.h[1] - oy]; });
    slides.forEach(d => shiftRect(d.rect));
    rooms.forEach(r => {
      r.poly = r.poly.map(([x, y]) => [x - ox, y - oy]);
      r.at = [r.at[0] - ox, r.at[1] - oy];
    });
    bx1 -= ox; by1 -= oy; bx0 = 0; by0 = 0;
    // 底图只裁墙体外包（加一点边），不再铺整张原图。
    const padPx = Math.max(4, Math.round((result.thickness || 8) * 1.2));
    const srcBounds = result.bounds || [0, 0, result.width, result.height];
    const cropPx = [
      Math.max(0, Math.floor(srcBounds[0] - padPx)),
      Math.max(0, Math.floor(srcBounds[1] - padPx)),
      Math.min(result.width, Math.ceil(srcBounds[2] + padPx)),
      Math.min(result.height, Math.ceil(srcBounds[3] + padPx))
    ];
    const underlayX = roundMM(cropPx[0] * scale) - ox;
    const underlayY = roundMM(cropPx[1] * scale) - oy;
    return {
      architecture: { walls, windows, doors, slides, rooms },
      wallInfo, windowInfo,
      mmPerPx: scale,
      boundsMM: [bx0, by0, bx1, by1],
      cropPx,
      underlay: {
        x: underlayX,
        y: underlayY,
        width: roundMM((cropPx[2] - cropPx[0]) * scale),
        height: roundMM((cropPx[3] - cropPx[1]) * scale)
      },
      underlaySize: {
        width: roundMM((cropPx[2] - cropPx[0]) * scale),
        height: roundMM((cropPx[3] - cropPx[1]) * scale)
      }
    };
  }
  function cropCanvasTo(canvas, crop) {
    const [x0, y0, x1, y1] = crop;
    const w = Math.max(1, Math.round(x1 - x0)), h = Math.max(1, Math.round(y1 - y0));
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    out.getContext('2d').drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
    return out;
  }
  function overlaySVG(result, options = {}) {
    const w = result.width, h = result.height, fs = Math.max(14, w / 55);
    const rooms = (result.rooms || []).map(r => {
      const pts = r.poly.map(v => v.join(',')).join(' ');
      return '<polygon points="' + pts + '" fill="#52aa7860" stroke="#22755d" stroke-width="2"/>'
        + '<text x="' + r.at[0] + '" y="' + r.at[1] + '" text-anchor="middle" font-size="' + fs + '" fill="#20394f">' + escapeXml(r.name) + '</text>';
    }).join('');
    const walls = (result.walls || []).map(v => {
      const r = v.rect;
      return '<rect x="' + r[0] + '" y="' + r[1] + '" width="' + (r[2] - r[0]) + '" height="' + (r[3] - r[1]) + '" fill="#246b9aaa"/>';
    }).join('');
    const openings = (result.openings || []).map(v => {
      const r = v.rect, fill = v.type === 'window' ? '#ff6b6baa' : '#c44dffaa';
      return '<rect x="' + r[0] + '" y="' + r[1] + '" width="' + (r[2] - r[0]) + '" height="' + (r[3] - r[1]) + '" fill="' + fill + '"/>';
    }).join('');
    let frame = '';
    if (result.dimensionFrame?.rect) {
      const r = result.dimensionFrame.rect;
      frame = '<rect x="' + r[0] + '" y="' + r[1] + '" width="' + (r[2] - r[0]) + '" height="' + (r[3] - r[1]) + '" fill="none" stroke="#a16a16" stroke-width="2" stroke-dasharray="8 6" opacity=".85"/>'
        + '<text x="' + (r[0] + 8) + '" y="' + (r[1] - 8) + '" font-size="' + Math.max(12, w / 70) + '" fill="#a16a16">比例线范围</text>';
    }
    let compass = '';
    if (result.compass) {
      const c = result.compass, size = Math.max(18, Math.min(w, h) * .035);
      compass = '<g transform="translate(' + c.x + ' ' + c.y + ') rotate(' + c.angleDeg + ')">'
        + '<circle r="' + (size * 1.15) + '" fill="#ffffffcc" stroke="#246b9a" stroke-width="2"/>'
        + '<polygon points="0,' + (-size) + ' ' + (size * .35) + ',' + (size * .55) + ' 0,' + (size * .2) + ' ' + (-size * .35) + ',' + (size * .55) + '" fill="#246b9a"/>'
        + '<text y="' + (-size - 6) + '" text-anchor="middle" font-size="' + Math.max(12, size * .7) + '" fill="#246b9a" font-weight="700">N</text>'
        + '</g>';
    }
    const cls = options.className || 'recog-overlay';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" class="' + cls + '" aria-hidden="true">' + frame + walls + rooms + openings + compass + '</svg>';
  }
  function escapeXml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  root.FloorplanRecognition = { detect, enrich, contains, median, estimateScale, toArchitecture, fillMissingPartitionWalls, overlaySVG, rectTouchesOuter, detectCompass, detectDimensionFrame, cleanUnderlayImage, scrubRoomLabelInk, roomLabelScrubRects, cropCanvasTo, snapNorthCardinal };
  if (typeof module !== 'undefined') module.exports = root.FloorplanRecognition;
})(globalThis);
