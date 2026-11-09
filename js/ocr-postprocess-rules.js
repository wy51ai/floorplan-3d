/* OCR post-process rules — single source of truth for UI docs + room-name aliases.
 * recognition-core.parseRoomName reads roomNameAliases; other steps are code-bound
 * and described here so alternate OCR engines can reimplement the same pipeline. */
(function (root) {
  'use strict';

  /** Canonical room nouns + OCR misreads / synonyms (order = match priority). */
  const roomNameAliases = [
    { name: '客餐厅', patterns: ['客餐厅', '客\\s*餐\\s*厅'], note: '客餐厅优先于单独的客厅/餐厅' },
    { name: '卫生间', patterns: ['卫生间', '卫浴', '洗手间', '洗澡间'] },
    { name: '厨房', patterns: ['厨房', '后房'], note: '「后房」为「厨房」常见误读' },
    { name: '阳台', patterns: ['阳台', '晾台', '露台'] },
    { name: '主卧', patterns: ['主卧', '主卧室'] },
    { name: '次卧', patterns: ['次卧', '次卧室'] },
    { name: '卧室', patterns: ['卧室'] },
    { name: '客厅', patterns: ['客厅'] },
    { name: '餐厅', patterns: ['餐厅'] },
    { name: '书房', patterns: ['书房'] },
    { name: '玄关', patterns: ['玄关', '门厅'] },
    { name: '储藏', patterns: ['储藏', '储物', '家居仓'] },
    { name: '衣帽间', patterns: ['衣帽间', '衣帽'] },
    { name: '过道', patterns: ['过道', '走廊'] },
    { name: '洗衣', patterns: ['洗衣房', '洗衣'] }
  ];

  /**
   * Structured catalog for in-app display / export.
   * binding: "data" = values live in this module; "code" = implemented in JS (see impl).
   * kind: "ocr" = text cleanup / assignment; "related" = uses OCR evidence but not text parsing;
   *       "geometry" = wall/opening recognition — not OCR post-process.
   */
  const sections = [
    {
      id: 'engine',
      title: 'OCR 引擎与读图前处理',
      kind: 'ocr',
      binding: 'code',
      impl: 'js/recognition-service.js',
      intro: '换其他 OCR 时，尽量先做到相近的输入图与输出词条结构，再套用后处理。',
      rules: [
        {
          id: 'tess-config',
          title: '引擎参数',
          detail: '本地 Tesseract.js，语言 chi_sim；页面分割模式 PSM=11（稀疏文字）；preserve_interword_spaces=1。'
        },
        {
          id: 'dual-prep',
          title: '双路图像增强',
          detail: '整图放大 2× 后并行识别两路：软对比度拉伸（灰度阈值约 90–200 线性拉伸到 0–255，保留木纹/石材上的标注）与硬二值化（灰度阈值 130）。合并两路词条。'
        },
        {
          id: 'room-crop',
          title: '按房间裁剪复检',
          detail: '对每个已检出房间矩形外扩 8px 再 OCR；缩放系数 clamp 到 2–4，使短边约 420px。裁剪结果置信度至少抬到 35，坐标平移回整图。'
        },
        {
          id: 'collect-words',
          title: '词条采集',
          detail: '优先取叶子 words；否则遍历 blocks/paragraphs/lines。文本 trim，长度 ≤ 40；输出 { text, confidence, bbox }，bbox 按放大倍数除回原图像素。'
        }
      ]
    },
    {
      id: 'normalize',
      title: '文本规范化',
      kind: 'ocr',
      binding: 'code',
      impl: 'js/recognition-core.js → normalizeOcrText',
      rules: [
        {
          id: 'strip-space',
          title: '去空白与逗号',
          detail: '删除全部空白；删除中文逗号「，」与英文逗号「,」。'
        },
        {
          id: 'area-unit',
          title: '面积单位归一',
          detail: '㎡ → m²；词尾 m[il1] / mi / m2（忽略大小写）→ m²。便于面积解析统一认单位。'
        }
      ]
    },
    {
      id: 'dedupe-merge',
      title: '去重与碎片合并',
      kind: 'ocr',
      binding: 'code',
      impl: 'js/recognition-core.js → enrich',
      rules: [
        {
          id: 'dedupe',
          title: '近重复去重',
          detail: '相同规范化文本，且框中心距离 < 18px → 只保留一条。'
        },
        {
          id: 'merge-near',
          title: '邻近碎片拼接',
          detail: '两框中心距离 ≤ 48px 时尝试：上+下、左+右拼接；若拼接结果能解析为房间名或面积，则加入合并词条（置信度取 max，至少 40）。'
        },
        {
          id: 'merge-decimal',
          title: '丢失小数点修复',
          detail: '左侧为单个数字、右侧为「两位数字 + 可选 m/m²」时，插入小数点再合并（如 4 + 18m → 4.18m）。'
        }
      ]
    },
    {
      id: 'room-name',
      title: '房间名称解析',
      kind: 'ocr',
      binding: 'data',
      impl: 'js/ocr-postprocess-rules.js → roomNameAliases；parseRoomName',
      intro: '别名表可直接复用；按下列顺序正则匹配，命中即返回标准名。',
      rules: roomNameAliases.map((a, i) => ({
        id: 'name-' + i,
        title: a.name,
        detail: '匹配：' + a.patterns.map(p => p.replace(/\\s\*/g, ' ')).join(' / ') + (a.note ? '。' + a.note : '')
      }))
    },
    {
      id: 'room-area',
      title: '面积数字解析',
      kind: 'ocr',
      binding: 'code',
      impl: 'js/recognition-core.js → parseRoomArea',
      intro: '有效面积范围：1.5–120 m²。按下列顺序尝试。',
      rules: [
        {
          id: 'area-decimal',
          title: '标准小数',
          detail: '匹配 (1–2 位).(1–2 位) 可选后接 m²/m，如 9.14m²、4.18m、30.06。'
        },
        {
          id: 'area-3digit',
          title: '三位数丢小数点',
          detail: '整段为「1 位 + 2 位」可选 m/m² → 插入小数点（418m → 4.18）。'
        },
        {
          id: 'area-4digit',
          title: '四位数 + 单位',
          detail: '整段为「2 位 + 2 位」且带 m/m² → 插入小数点（1739m → 17.39）。'
        },
        {
          id: 'area-broken',
          title: '夹杂错字',
          detail: '数字与小数点之间夹 0–3 个非数字非点字符，如「7了.28mi」→ 7.28。'
        }
      ]
    },
    {
      id: 'assign',
      title: '标注归属房间',
      kind: 'ocr',
      binding: 'code',
      impl: 'js/recognition-core.js → enrich',
      rules: [
        {
          id: 'point-in-poly',
          title: '点落多边形',
          detail: '用词条框中心点找包含它的房间；多命中时取面积（像素）更小的房间。'
        },
        {
          id: 'near-center',
          title: '近邻回退',
          detail: '点不在任何多边形内时，取房间质心距离 < 55px 的最近房间（标注常落在家具填充上）。'
        },
        {
          id: 'name-confidence',
          title: '名称置信度',
          detail: '置信度 < 15 且原文长度 > 标准名长度 + 2 → 丢弃。纯房间名词可接受低置信度。'
        },
        {
          id: 'name-priority',
          title: '名称写入',
          detail: '按置信度、名称长度排序；每房只写一次；已有更长/更具体名称时不覆盖。'
        },
        {
          id: 'area-filter',
          title: '面积噪声过滤',
          detail: '无小数点且无 m/m²、数值 ≥ 100 的整数当作墙尺寸忽略（如 1022）。面积词条即使置信度 0 也可采用。'
        },
        {
          id: 'area-place',
          title: '面积落点',
          detail: '优先框中心落房；失败则试中心上移 18px（面积常在名称下方）。已有 areaLabel 的房间不再写。'
        },
        {
          id: 'area-below-name',
          title: '名称下方补面积',
          detail: '已命名但无面积时，在名称下方（cy ≥ 名称 cy − 6）找距离 < 70px 的未用面积词条。'
        }
      ]
    },
    {
      id: 'orphan-heuristics',
      title: '孤儿标注与启发式补名',
      kind: 'ocr',
      binding: 'code',
      impl: 'js/recognition-core.js → enrich',
      rules: [
        {
          id: 'orphan',
          title: '多边形外名称',
          detail: '若尚无同名已标注房间：优先挂到近邻未命名/「空间*」房间；否则按邻近面积与邻房矩形合成占位房间（常见开放阳台），并标 synthetic/review。'
        },
        {
          id: 'bath-by-area',
          title: '卫生间面积启发',
          detail: '名称仍为「空间*」、面积标注 3.5–6.5 m² 且 areaPx < 25000 → 命名为「卫生间」。'
        },
        {
          id: 'kitchen-xuan',
          title: '厨房旁小空间',
          detail: '存在「厨房」时：未命名且面积像素 < 厨房 70%、相对厨房在横向 1.2× 宽、纵向一高范围内 → 命名为「玄关」。'
        }
      ]
    },
    {
      id: 'scale',
      title: '比例尺（来自 OCR 数字）',
      kind: 'ocr',
      binding: 'code',
      impl: 'js/recognition-core.js → estimateScale / estimateScaleFromAreas',
      rules: [
        {
          id: 'dim-axis',
          title: '外围尺寸标注',
          detail: '词条中 3–5 位整数，数值 600–20000。底部带（cy 在外包底 18% 内）或右侧带合计 ÷ 墙体外包宽/高 → mm/px；合法区间约 2–40，优先接近 10。'
        },
        {
          id: 'area-scale',
          title: '面积反推比例',
          detail: '至少 2 个房间同时有 areaLabel 与 areaPx：mmPerPx = 1000 × √(areaLabel / areaPx)，取中位数，区间 2–40。'
        }
      ]
    },
    {
      id: 'underlay-scrub',
      title: '底图文字擦除（相关，非解析）',
      kind: 'related',
      binding: 'code',
      impl: 'js/recognition-core.js → cleanUnderlayImage / scrubRoomLabelInk',
      intro: '依赖 OCR 证据框，但不改识别文本；换 OCR 时若仍要干净底图，可复用证据框擦除思路。',
      rules: [
        {
          id: 'scrub-boxes',
          title: '按证据框擦除',
          detail: '用名称/面积 bbox 外扩约 6–8px 填底色；无框时在房间质心附近估一块名称+面积区域。'
        },
        {
          id: 'scrub-interior',
          title: '房间内填充擦除',
          detail: '对房间多边形内部（保留近墙边沿）填底色，避免原图标注在缩放后鬼影。'
        }
      ]
    },
    {
      id: 'not-ocr',
      title: '不属于 OCR 后处理',
      kind: 'geometry',
      binding: 'code',
      impl: 'js/recognition-core.js → detect 等',
      intro: '以下是墙体/门窗几何识别，与 OCR 引擎无关，换 OCR 时不必复用。',
      rules: [
        {
          id: 'walls',
          title: '墙体与房间轮廓',
          detail: '栅格阈值、形态学、连通域与房间 flood；不含文字解析。'
        },
        {
          id: 'openings',
          title: '门窗洞口启发',
          detail: '墙缝间隙、外墙白缝、厨房旁空缝过滤等；与 OCR 无关。'
        },
        {
          id: 'compass-frame',
          title: '指南针与比例线框',
          detail: '图像几何检测；尺寸数字合计见上文「比例尺」。'
        }
      ]
    }
  ];

  function roomNameRegexRules() {
    return roomNameAliases.map(a => [a.name, new RegExp(a.patterns.join('|'))]);
  }

  function toPlainText() {
    const lines = [
      '筑家 · OCR 后处理规则',
      '版本 ' + catalog.version + ' · 可与其他 OCR 引擎配合复用「ocr」类规则',
      '',
      '说明：binding=data 的条目（房间别名）以本文件为准；binding=code 的步骤与源码绑定，改逻辑时请同步改本文件。',
      ''
    ];
    for (const sec of sections) {
      const tag = sec.kind === 'ocr' ? '[OCR]' : sec.kind === 'related' ? '[相关]' : '[非OCR]';
      const bind = sec.binding === 'data' ? '数据驱动' : '代码实现';
      lines.push('## ' + tag + ' ' + sec.title + '（' + bind + '）');
      if (sec.impl) lines.push('实现：' + sec.impl);
      if (sec.intro) lines.push(sec.intro);
      for (const r of sec.rules) {
        lines.push('- ' + r.title + '：' + r.detail);
      }
      lines.push('');
    }
    return lines.join('\n').trim() + '\n';
  }

  const catalog = {
    version: 1,
    title: 'OCR 后处理规则',
    subtitle: '识别文字之后的清理、解析与房间归属；可复用于其他 OCR。',
    roomNameAliases,
    sections,
    roomNameRegexRules,
    toPlainText
  };

  root.FloorplanOcrPostprocessRules = catalog;
  if (typeof module !== 'undefined') module.exports = catalog;
})(typeof globalThis !== 'undefined' ? globalThis : this);
