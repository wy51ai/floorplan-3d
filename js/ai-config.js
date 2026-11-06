/* AI provider config — OpenAI / DeepSeek. Keys stay in localStorage only. */
(function () {
  'use strict';

  const STORAGE_KEY = 'floorplan3d.ai.v1';

  const PROVIDERS = {
    openai: {
      id: 'openai',
      label: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    },
    deepseek: {
      id: 'deepseek',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    },
  };

  function defaults(provider) {
    const p = PROVIDERS[provider] || PROVIDERS.openai;
    return {
      provider: p.id,
      baseUrl: p.baseUrl,
      apiKey: '',
      model: p.model,
      modelIds: [],
    };
  }

  function normalizeModelIds(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of list) {
      const id = String(raw || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= 300) break;
    }
    return out;
  }

  function normalize(raw) {
    const base = defaults((raw && raw.provider) || 'openai');
    if (!raw || typeof raw !== 'object') return base;
    const provider = PROVIDERS[raw.provider] ? raw.provider : base.provider;
    const known = PROVIDERS[provider];
    const out = {
      provider,
      baseUrl: String(raw.baseUrl || known.baseUrl).trim().replace(/\/+$/, '') || known.baseUrl,
      apiKey: String(raw.apiKey || '').trim(),
      model: String(raw.model || known.model).trim() || known.model,
      modelIds: normalizeModelIds(raw.modelIds),
    };
    return out;
  }

  function readStore() {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch {}
    const profiles = Object.fromEntries(Object.keys(PROVIDERS).map(id => [id, defaults(id)]));
    let active = 'openai';
    if (raw?.version === 2 && raw.profiles) {
      active = Object.hasOwn(PROVIDERS, raw.active) ? raw.active : active;
      for (const id of Object.keys(PROVIDERS)) {
        profiles[id] = normalize({ ...raw.profiles[id], provider: id });
      }
    } else if (raw && typeof raw === 'object') {
      // Migrate the original single profile only to its own provider.
      active = Object.hasOwn(PROVIDERS, raw.provider) ? raw.provider : active;
      profiles[active] = normalize({ ...raw, provider: active });
    }
    return { version: 2, active, profiles };
  }

  function load(provider) {
    const store = readStore();
    return store.profiles[Object.hasOwn(PROVIDERS, provider) ? provider : store.active];
  }

  function save(partial) {
    const store = readStore();
    const provider = Object.hasOwn(PROVIDERS, partial?.provider) ? partial.provider : store.active;
    const next = normalize({ ...store.profiles[provider], ...(partial || {}), provider });
    store.profiles[provider] = next;
    store.active = provider;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
      throw new Error('无法保存 AI 配置：本机存储空间不足或不可用');
    }
    return next;
  }

  function clearKey() {
    return save({ apiKey: '' });
  }

  function hasKey(cfg) {
    const c = cfg || load();
    return !!(c.apiKey && c.apiKey.length > 0);
  }

  /** Select the saved provider profile without transferring credentials. */
  function switchProvider(providerId) {
    return save({ provider: Object.hasOwn(PROVIDERS, providerId) ? providerId : 'openai' });
  }

  function statusSummary(cfg) {
    const c = cfg || load();
    const label = (PROVIDERS[c.provider] || PROVIDERS.openai).label;
    const key = hasKey(c) ? '已填密钥' : '未配置密钥';
    return `${label} · ${c.model || '—'} · ${key}`;
  }

  function maskedKey(cfg) {
    const k = (cfg || load()).apiKey || '';
    if (!k) return '';
    if (k.length <= 8) return '••••';
    return k.slice(0, 4) + '••••' + k.slice(-4);
  }

  window.AiConfig = {
    STORAGE_KEY,
    PROVIDERS,
    defaults,
    load,
    save,
    clearKey,
    hasKey,
    switchProvider,
    statusSummary,
    maskedKey,
  };
})();
