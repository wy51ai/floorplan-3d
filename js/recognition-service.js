/* Browser-side floorplan recognition: worker detect + optional local OCR. */
(function (root) {
  'use strict';
  const R = () => root.FloorplanRecognition;
  let worker = null, workerReady = false, ocrWorker = null, seq = 0;
  const pending = new Map();

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker('js/recognition-worker.js');
    worker.onmessage = e => {
      const { id, result, error } = e.data || {};
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      if (error) job.reject(new Error(error));
      else job.resolve(result);
    };
    worker.onerror = e => {
      for (const [, job] of pending) job.reject(new Error(e.message || '识别线程失败'));
      pending.clear();
      worker = null;
    };
    workerReady = true;
    return worker;
  }

  function detectAsync(imageData, options = {}) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      try {
        const w = ensureWorker();
        // Structured clone ImageData / typed buffers.
        w.postMessage({ id, image: { width: imageData.width, height: imageData.height, data: imageData.data }, options });
      } catch (err) {
        pending.delete(id);
        try { resolve(R().detect(imageData, options)); }
        catch (e) { reject(e); }
      }
    });
  }

  async function loadImageBitmap(fileOrUrl) {
    if (typeof fileOrUrl === 'string') {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.src = fileOrUrl;
      await im.decode();
      return im;
    }
    const url = URL.createObjectURL(fileOrUrl);
    try {
      const im = new Image();
      im.src = url;
      await im.decode();
      return im;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function toCanvas(image, maxSide = 1600) {
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(image.width * scale));
    cv.height = Math.max(1, Math.round(image.height * scale));
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, cv.width, cv.height);
    return { canvas: cv, ctx, scale, imageData: ctx.getImageData(0, 0, cv.width, cv.height) };
  }

  function compressUnderlay(canvas, quality = .78) {
    return canvas.toDataURL('image/jpeg', quality);
  }

  async function ensureOCR() {
    if (ocrWorker) return ocrWorker;
    if (!root.Tesseract?.createWorker) throw new Error('OCR 库未加载');
    const langPath = 'node_modules/@tesseract.js-data/chi_sim/4.0.0_best_int';
    ocrWorker = await root.Tesseract.createWorker('chi_sim', 1, {
      workerPath: 'node_modules/tesseract.js/dist/worker.min.js',
      corePath: 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
      langPath,
      cachePath: undefined,
      logger: () => {}
    });
    await ocrWorker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
    return ocrWorker;
  }

  function collectWords(data, scale = 1) {
    const words = [];
    const walk = node => {
      if (!node) return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node.words) walk(node.words);
      if (node.lines) walk(node.lines);
      if (node.paragraphs) walk(node.paragraphs);
      if (node.blocks) walk(node.blocks);
      if (node.text && node.bbox && (node.confidence != null || node.words)) {
        const text = String(node.text).trim();
        if (text && text.length <= 40) {
          words.push({
            text,
            confidence: node.confidence ?? 0,
            bbox: {
              x0: node.bbox.x0 / scale, y0: node.bbox.y0 / scale,
              x1: node.bbox.x1 / scale, y1: node.bbox.y1 / scale
            }
          });
        }
      }
    };
    walk(data);
    // Prefer leaf words when available.
    if (data.words?.length) {
      return data.words.filter(w => w.text?.trim()).map(w => ({
        text: String(w.text).trim(),
        confidence: w.confidence ?? 0,
        bbox: { x0: w.bbox.x0 / scale, y0: w.bbox.y0 / scale, x1: w.bbox.x1 / scale, y1: w.bbox.y1 / scale }
      }));
    }
    return words;
  }

  function prepOcrCanvas(sourceCanvas, scale = 2) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(sourceCanvas.width * scale));
    cv.height = Math.max(1, Math.round(sourceCanvas.height * scale));
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(sourceCanvas, 0, 0, cv.width, cv.height);
    const pixels = ctx.getImageData(0, 0, cv.width, cv.height);
    // Mild contrast stretch instead of hard binarize — keeps labels on wood / stone fills.
    for (let i = 0; i < pixels.data.length; i += 4) {
      let v = (pixels.data[i] * 0.3 + pixels.data[i + 1] * 0.59 + pixels.data[i + 2] * 0.11);
      v = v < 90 ? 0 : v > 200 ? 255 : (v - 90) * (255 / 110);
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v;
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    return cv;
  }

  function prepOcrCanvasHard(sourceCanvas, scale = 2) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(sourceCanvas.width * scale));
    cv.height = Math.max(1, Math.round(sourceCanvas.height * scale));
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sourceCanvas, 0, 0, cv.width, cv.height);
    const pixels = ctx.getImageData(0, 0, cv.width, cv.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const v = (pixels.data[i] + pixels.data[i + 1] + pixels.data[i + 2]) / 3 < 130 ? 0 : 255;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v;
    }
    ctx.putImageData(pixels, 0, 0);
    return cv;
  }

  async function runOCR(canvas) {
    try {
      const worker = await ensureOCR();
      const ocrScale = 2;
      const soft = prepOcrCanvas(canvas, ocrScale);
      const hard = prepOcrCanvasHard(canvas, ocrScale);
      const [a, b] = await Promise.all([
        worker.recognize(soft, {}, { text: true, blocks: true }),
        worker.recognize(hard, {}, { text: true, blocks: true })
      ]);
      return { words: [...collectWords(a.data, ocrScale), ...collectWords(b.data, ocrScale)] };
    } catch (err) {
      return { words: [], error: err.message || String(err) };
    }
  }

  async function runRoomOCR(canvas, rooms) {
    const words = [];
    if (!rooms?.length) return words;
    try {
      const worker = await ensureOCR();
      for (const room of rooms) {
        const [x0, y0, x1, y1] = room.rect || [];
        if (!(x1 > x0 && y1 > y0)) continue;
        const pad = 8;
        const sx = Math.max(0, Math.floor(x0 - pad));
        const sy = Math.max(0, Math.floor(y0 - pad));
        const sw = Math.min(canvas.width - sx, Math.ceil(x1 - x0 + pad * 2));
        const sh = Math.min(canvas.height - sy, Math.ceil(y1 - y0 + pad * 2));
        if (sw < 12 || sh < 12) continue;
        const crop = document.createElement('canvas');
        crop.width = sw;
        crop.height = sh;
        crop.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        const ocrScale = Math.max(2, Math.min(4, Math.round(420 / Math.max(sw, sh))));
        const cv = prepOcrCanvas(crop, ocrScale);
        const { data } = await worker.recognize(cv, {}, { text: true, blocks: true });
        for (const w of collectWords(data, ocrScale)) {
          words.push({
            text: w.text,
            confidence: Math.max(w.confidence, 35),
            bbox: {
              x0: w.bbox.x0 + sx, y0: w.bbox.y0 + sy,
              x1: w.bbox.x1 + sx, y1: w.bbox.y1 + sy
            }
          });
        }
      }
    } catch (_) { /* room OCR is best-effort */ }
    return words;
  }

  async function recognizeFile(file, options = {}) {
    const image = await loadImageBitmap(file);
    const prepared = toCanvas(image, options.maxSide || 1600);
    const onProgress = options.onProgress || (() => {});
    onProgress('正在识别墙体与房间…');
    let result = await detectAsync(prepared.imageData, options.detect || {});
    onProgress('正在识别房间名称与尺寸…');
    const ocr = await runOCR(prepared.canvas);
    onProgress('正在核对各房间标注…');
    const roomWords = await runRoomOCR(prepared.canvas, result.rooms || []);
    const words = [...(ocr.words || []), ...roomWords];
    result = R().enrich(result, words);
    if (ocr.error) result.warnings = [...(result.warnings || []), '文字识别未完成：' + ocr.error + '。房间名称可稍后手改。'];
    // Scrub dimension ticks / UI chrome from underlay; keep compass patch.
    const cleaned = R().cleanUnderlayImage(prepared.imageData, result);
    prepared.ctx.putImageData(new ImageData(cleaned.data, cleaned.width, cleaned.height), 0, 0);
    const underlaySrc = compressUnderlay(prepared.canvas);
    return {
      result,
      underlaySrc,
      canvas: prepared.canvas,
      imageWidth: prepared.canvas.width,
      imageHeight: prepared.canvas.height,
      originalWidth: image.width,
      originalHeight: image.height
    };
  }

  async function terminate() {
    if (worker) { worker.terminate(); worker = null; }
    if (ocrWorker) { await ocrWorker.terminate(); ocrWorker = null; }
    pending.clear();
  }

  root.FloorplanRecognitionService = { recognizeFile, detectAsync, loadImageBitmap, toCanvas, terminate, ensureOCR };
})(globalThis);
