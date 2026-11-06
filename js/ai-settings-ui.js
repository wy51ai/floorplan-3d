/* Shared AI settings. Independent of layout and furniture workflows. */
(function () {
  'use strict';
  const E = esc;
  let configStatus = '', configBusy = false, modelsBusy = false, panelModelIds = null;
  const dialog = document.createElement('dialog');
  dialog.id = 'aiSettingsDialog';
  dialog.className = 'catalog-dialog p-work';
  dialog.setAttribute('aria-label', 'AI 接口设置');
  document.body.appendChild(dialog);
  dialog.addEventListener('keydown', e => e.stopPropagation());
  dialog.addEventListener('cancel', e => { if (configBusy || modelsBusy) e.preventDefault(); });
  function render() {
    dialog.innerHTML = '<h2>AI 接口设置</h2><p class="p-muted">OpenAI 和 DeepSeek 各自保存一套配置。选择服务商即切换当前使用的接口，切换前会保存当前填写的内容。家具图片识别与 AI 帮你装共用当前选择。识别图片需选择支持图像输入的模型。</p>' + configFormHtml();
    bindConfigForm(dialog);
  }
  function open() {
    if (dialog.open) return;
    configStatus = ''; panelModelIds = null;
    render(); dialog.showModal();
  }
  function readConfigForm(root) {
    const C = window.AiConfig;
    if (!C) throw new Error('AiConfig 未加载');
    const provider = root.querySelector('#aiConfigForm').dataset.provider;
    const known = C.PROVIDERS[provider] || C.PROVIDERS.openai;
    let apiKey = (root.querySelector('[name="aiApiKey"]')?.value || '').trim();
    const keep = root.querySelector('[name="aiApiKey"]')?.dataset.keepKey;
    if (!apiKey && keep) apiKey = C.load(provider).apiKey;
    const modelIds = Array.isArray(panelModelIds)
      ? panelModelIds
      : (C.load(provider).modelIds || []);
    return {
      provider,
      baseUrl: (root.querySelector('[name="aiBaseUrl"]')?.value || '').trim() || known.baseUrl,
      apiKey,
      model: (root.querySelector('[name="aiModel"]')?.value || '').trim() || known.model,
      modelIds,
    };
  }

  function modelSelectOptionsHtml(modelIds, currentModel) {
    const ids = Array.isArray(modelIds) ? modelIds : [];
    const cur = String(currentModel || '').trim();
    if (!ids.length) {
      return `<option value="">— 点击「获取模型」或手动填写 —</option>` +
        (cur ? `<option value="${E(cur)}" selected>${E(cur)}</option>` : '');
    }
    const parts = window.AiClient?.partitionModelIds
      ? window.AiClient.partitionModelIds(ids)
      : { chat: ids, other: [], all: ids };
    const inList = parts.all.includes(cur);
    const opt = (id, selected) =>
      `<option value="${E(id)}" ${selected ? 'selected' : ''}>${E(id)}</option>`;
    let html = '';
    if (!inList && cur) html += opt(cur, true);
    if (parts.chat.length) {
      html += `<optgroup label="对话 / 补全">` +
        parts.chat.map(id => opt(id, inList && id === cur)).join('') +
        `</optgroup>`;
    }
    if (parts.other.length) {
      html += `<optgroup label="其他（原始 id）">` +
        parts.other.map(id => opt(id, inList && id === cur)).join('') +
        `</optgroup>`;
    }
    if (!html) html = `<option value="">— 无可用模型 —</option>`;
    return html;
  }

  function configFormHtml() {
    const C = window.AiConfig;
    if (!C) {
      return `<p class="p-error">AiConfig 未加载，请检查 index.html 是否引入 js/ai-config.js</p>`;
    }
    const cfg = C.load();
    const opts = Object.values(C.PROVIDERS).map(p =>
      `<option value="${E(p.id)}" ${cfg.provider === p.id ? 'selected' : ''}>${E(p.label)}</option>`
    ).join('');
    const hasKey = C.hasKey(cfg);
    const modelIds = Array.isArray(panelModelIds) ? panelModelIds : (cfg.modelIds || []);
    const busy = configBusy || modelsBusy;
    const fetchLabel = modelsBusy ? '拉取中…' : '获取模型';
    return `<div class="ai-config" id="aiConfigForm" data-provider="${E(cfg.provider)}">
      <p class="p-muted">密钥仅保存在本机浏览器 localStorage（键名 <code class="p-code">${E(C.STORAGE_KEY)}</code>），不会写入项目文件。</p>
      <label>当前使用的接口
        <select name="aiProvider" id="aiProvider" ${busy ? 'disabled' : ''}>${opts}</select>
      </label>
      <label>API Base URL
        <input name="aiBaseUrl" id="aiBaseUrl" type="url" spellcheck="false" autocomplete="off" value="${E(cfg.baseUrl)}">
      </label>
      <label>API Key${hasKey ? ` <span class="p-badge">已保存 ${E(C.maskedKey(cfg))}</span>` : ''}
        <input name="aiApiKey" id="aiApiKey" type="password" spellcheck="false" autocomplete="off"
          placeholder="${hasKey ? '留空则保持已保存密钥' : 'sk-…'}"
          ${hasKey ? `data-keep-key="1"` : ''} value="">
      </label>
      <div class="ai-model-field">
        <span class="ai-model-label">模型</span>
        <div class="ai-model-row">
          <select name="aiModelSelect" id="aiModelSelect" ${modelsBusy ? 'disabled' : ''} aria-label="可用模型">
            ${modelSelectOptionsHtml(modelIds, cfg.model)}
          </select>
          <button type="button" class="btn" id="aiCfgFetchModels" ${busy ? 'disabled' : ''}>${fetchLabel}</button>
        </div>
        <input name="aiModel" id="aiModel" type="text" spellcheck="false" autocomplete="off"
          value="${E(cfg.model)}" placeholder="也可手动填写模型 id" ${modelsBusy ? 'disabled' : ''}>
        <p class="p-muted ai-model-hint">点「获取模型」调用 <code class="p-code">GET {baseUrl}/models</code>。本机直接访问官方 API 可能被 CORS 拦截，失败时请手动填写下方输入框。</p>
      </div>
      ${configStatus ? `<p class="${/失败|错误|请先|无法|拦截|CORS|cors/.test(configStatus) ? 'p-error' : 'ai-status'}">${E(configStatus)}</p>` : ''}
      <div class="p-actions">
        <button type="button" class="btn primary" id="aiCfgSave" ${busy ? 'disabled' : ''}>保存当前配置</button>
        <button type="button" class="btn" id="aiCfgTest" ${busy ? 'disabled' : ''}>测试连接</button>
        <button type="button" class="btn" id="aiCfgClear" ${busy || !hasKey ? 'disabled' : ''}>清除当前密钥</button>
        <button type="button" class="btn" id="aiCfgBack" ${busy ? 'disabled' : ''}>返回</button>
      </div>
    </div>`;
  }

  function bindConfigForm(root) {
    const C = window.AiConfig;
    const providerEl = root.querySelector('#aiProvider');
    const modelEl = root.querySelector('#aiModel');
    const modelSelectEl = root.querySelector('#aiModelSelect');

    const syncSelectToModel = () => {
      if (!modelSelectEl || !modelEl) return;
      const v = modelSelectEl.value;
      if (v) modelEl.value = v;
    };

    const syncModelToSelect = () => {
      if (!modelSelectEl || !modelEl) return;
      const v = modelEl.value.trim();
      if (!v) return;
      const has = Array.from(modelSelectEl.options).some(o => o.value === v);
      if (has) modelSelectEl.value = v;
    };

    providerEl?.addEventListener('change', () => {
      const selected = providerEl.value;
      try {
        C.save(readConfigForm(root));
        const next = C.switchProvider(selected);
        panelModelIds = null;
        configStatus = '当前使用 · ' + C.statusSummary(next);
        render();
      } catch (err) {
        providerEl.value = root.querySelector('#aiConfigForm').dataset.provider;
        toast(err.message || '切换失败');
      }
    });

    modelSelectEl?.addEventListener('change', syncSelectToModel);
    modelEl?.addEventListener('input', syncModelToSelect);
    modelEl?.addEventListener('change', syncModelToSelect);

    const setBusy = (b, msg) => {
      configBusy = b;
      if (msg != null) configStatus = msg;
      render();
    };

    const setModelsBusy = (b, msg) => {
      modelsBusy = b;
      if (msg != null) configStatus = msg;
      render();
    };

    root.querySelector('#aiCfgFetchModels')?.addEventListener('click', async () => {
      if (!window.AiClient) {
        configStatus = 'AiClient 未加载';
        toast(configStatus);
        render();
        return;
      }
      let draft;
      try {
        draft = readConfigForm(root);
        C.save(draft); // persist before re-render so loading UI keeps form values
      } catch (err) {
        configStatus = err.message || String(err);
        toast(configStatus);
        render();
        return;
      }
      setModelsBusy(true, '正在从接口拉取模型列表…');
      try {
        const r = await window.AiClient.listModels({ config: draft });
        panelModelIds = r.models.slice();
        C.save({
          ...draft,
          modelIds: panelModelIds,
        });
        const n = panelModelIds.length;
        const chatN = (r.chat && r.chat.length) || 0;
        setModelsBusy(
          false,
          `已拉取 ${n} 个模型` +
            (chatN ? `（对话相关 ${chatN} 个，其余在「其他」分组）` : '') +
            '；当前模型可继续手动改'
        );
        toast(`已获取 ${n} 个模型`);
      } catch (err) {
        setModelsBusy(false, err.message || String(err));
        toast(err.message || '获取模型失败');
      }
    });

    root.querySelector('#aiCfgSave')?.addEventListener('click', () => {
      try {
        const next = C.save(readConfigForm(root));
        configStatus = '已保存 · ' + C.statusSummary(next);
        toast('AI 接口配置已保存到本机');
        render();
      } catch (err) {
        configStatus = err.message || String(err);
        toast(configStatus);
        render();
      }
    });

    root.querySelector('#aiCfgTest')?.addEventListener('click', async () => {
      if (!window.AiClient) {
        configStatus = 'AiClient 未加载';
        render();
        return;
      }
      let draft;
      try {
        draft = readConfigForm(root);
        C.save(draft);
      } catch (err) {
        configStatus = err.message || String(err);
        render();
        return;
      }
      setBusy(true, '正在测试连接…');
      try {
        const r = await window.AiClient.testConnection(draft);
        setBusy(false, `连接成功 · ${r.provider} / ${r.model}${r.preview ? ' · 回复：' + r.preview : ''}`);
        toast('AI 连接测试成功');
      } catch (err) {
        setBusy(false, err.message || String(err));
        toast(err.message || '测试失败');
      }
    });

    root.querySelector('#aiCfgClear')?.addEventListener('click', () => {
      try {
        C.clearKey();
        const keyInput = root.querySelector('#aiApiKey');
        if (keyInput) { keyInput.value = ''; delete keyInput.dataset.keepKey; }
        configStatus = '已清除当前接口密钥，另一套配置保留';
        toast('已清除 API Key');
        render();
      } catch (err) {
        configStatus = err.message || String(err);
        render();
      }
    });

    root.querySelector('#aiCfgBack')?.addEventListener('click', () => dialog.close());
  }

  window.AiSettings = { open };
  document.querySelector('#aiSettingsOpen').addEventListener('click', open);
})();
