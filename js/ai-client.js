/* OpenAI-compatible chat client for OpenAI + DeepSeek. */
(function () {
  'use strict';

  class AiClientError extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'AiClientError';
      this.code = code || 'ai_error';
    }
  }

  function requireAuthConfig(cfg) {
    const c = cfg || window.AiConfig?.load?.();
    if (!c) throw new AiClientError('AI 配置模块未加载', 'no_module');
    if (!c.apiKey || !String(c.apiKey).trim()) {
      throw new AiClientError('请先在 AI 接口设置中填写 API Key', 'missing_key');
    }
    if (!c.baseUrl || !String(c.baseUrl).trim()) {
      throw new AiClientError('请填写 API Base URL', 'missing_base');
    }
    return {
      provider: c.provider,
      baseUrl: String(c.baseUrl).trim().replace(/\/+$/, ''),
      apiKey: String(c.apiKey).trim(),
      model: String(c.model || '').trim(),
    };
  }

  function requireConfig(cfg) {
    const c = requireAuthConfig(cfg);
    if (!c.model) {
      throw new AiClientError('请填写模型名称', 'missing_model');
    }
    return c;
  }

  function networkErrorMessage(err) {
    const msg = err?.message || String(err);
    const looksCors =
      err?.name === 'TypeError' ||
      /Failed to fetch|NetworkError|Load failed|CORS|cross-origin|blocked/i.test(msg);
    if (looksCors) {
      return (
        '网络请求失败：' +
        msg +
        '。本机页面直接请求 api.openai.com / api.deepseek.com 常被浏览器 CORS 拦截；可手动填写模型，或改用允许跨域的 Base URL。'
      );
    }
    return '网络请求失败：' + msg;
  }

  /** Prefer chat/completion models; keep non-chat ids selectable in an "其他" group. */
  function partitionModelIds(ids) {
    const NOISY =
      /embedding|whisper|tts|dall-?e|davinci-002|babbage|moderation|image|audio|realtime|transcribe|codec|sora|gpt-image|omni-moderation|text-similarity|text-search|code-search/i;
    const chat = [];
    const other = [];
    const seen = new Set();
    for (const raw of ids) {
      const id = String(raw || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (NOISY.test(id)) other.push(id);
      else chat.push(id);
    }
    const sortIds = (a, b) => a.localeCompare(b);
    chat.sort(sortIds);
    other.sort(sortIds);
    return { chat, other, all: chat.concat(other) };
  }

  async function listModels(options) {
    const opts = options || {};
    const c = requireAuthConfig(opts.config || opts);
    const url = c.baseUrl + '/models';
    let res;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + c.apiKey,
        },
        signal: opts.signal,
      });
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      throw new AiClientError(networkErrorMessage(e), 'network');
    }

    let data = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = null;
    }

    if (!res.ok) {
      const msg =
        (data && (data.error?.message || data.message)) ||
        text?.slice(0, 240) ||
        res.statusText ||
        '请求失败';
      throw new AiClientError(`拉取模型失败 (${res.status})：${msg}`, 'http_' + res.status);
    }

    const rawList = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
        ? data.models
        : Array.isArray(data)
          ? data
          : [];
    const ids = rawList
      .map(m => (typeof m === 'string' ? m : m && (m.id || m.name)))
      .filter(Boolean);
    if (!ids.length) {
      throw new AiClientError('接口未返回可用模型列表', 'empty_models');
    }
    const parts = partitionModelIds(ids);
    return {
      models: parts.all,
      chat: parts.chat,
      other: parts.other,
      raw: data,
      config: c,
    };
  }

  // Gateway names may include a provider prefix or a model suffix.
  function usesCompletionTokens(model) {
    const name = String(model || '').split('/').pop();
    const gpt = /^gpt-(\d+)(?:[.\-]|$)/i.exec(name);
    return !!(gpt && Number(gpt[1]) >= 5) || /^o[134](?:-|$)/i.test(name);
  }

  async function chatCompletions(options) {
    const opts = options || {};
    const cfg = requireConfig(opts.config);
    const messages = opts.messages;
    if (!Array.isArray(messages) || !messages.length) {
      throw new AiClientError('messages 不能为空', 'bad_request');
    }

    const url = cfg.baseUrl + '/chat/completions';
    const body = {
      model: opts.model || cfg.model,
      messages,
    };
    // Let the model/gateway choose its sampling default. Reasoning models may
    // reject non-default temperature even when reasoning_effort was not sent.
    const reasoningModel = usesCompletionTokens(body.model);
    if (opts.reasoning_effort != null) body.reasoning_effort = opts.reasoning_effort;
    if (opts.temperature != null && (!reasoningModel || opts.reasoning_effort === 'none')) body.temperature = opts.temperature;
    if (opts.max_completion_tokens != null) body.max_completion_tokens = opts.max_completion_tokens;
    else if (opts.max_tokens != null) body[reasoningModel ? 'max_completion_tokens' : 'max_tokens'] = opts.max_tokens;
    if (opts.stream === true) body.stream = true;

    // Retry only explicit parameter-rejection 400s, changing each rejected field
    // at most once. Never retry authentication, network, rate-limit or server errors.
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + cfg.apiKey,
          },
          body: JSON.stringify(body),
          signal: opts.signal,
        });
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        throw new AiClientError(networkErrorMessage(e), 'network');
      }

      let data = null;
      const text = await res.text();
      try {
        data = text ? JSON.parse(text) : null;
      } catch (e) {
        data = null;
      }

      if (!res.ok) {
        const msg =
          (data && (data.error?.message || data.message)) ||
          text?.slice(0, 240) ||
          res.statusText ||
          '请求失败';
        if (res.status === 400 && attempt < 2 && /unsupported|not support|doesn't support|does not support|only .*supported|not allowed/i.test(msg)) {
          if (/temperature/i.test(msg) && Object.hasOwn(body, 'temperature')) {
            delete body.temperature;
            continue;
          }
          if (/max_tokens/i.test(msg) && /max_completion_tokens/i.test(msg) && Object.hasOwn(body, 'max_tokens')) {
            body.max_completion_tokens = body.max_tokens;
            delete body.max_tokens;
            continue;
          }
        }
        throw new AiClientError(`API 错误 (${res.status})：${msg}`, 'http_' + res.status);
      }

      const choice = data?.choices?.[0];
      const content = choice?.message?.content;
      if (choice?.finish_reason === 'length') {
        throw new AiClientError('模型已达到输出上限，回复可能未完成；请提高 token 上限或缩短问题后重试。', 'token_limit');
      }
      if (content == null || !String(content).trim()) {
        throw new AiClientError('响应中没有 choices[0].message.content', 'bad_response');
      }
      return { content: String(content), raw: data, config: cfg };
    }
  }

  /** Lightweight connectivity check: one short completion. */
  async function testConnection(cfg) {
    const c = requireConfig(cfg);
    const result = await chatCompletions({
      config: c,
      messages: [
        { role: 'system', content: 'Reply with exactly: ok' },
        { role: 'user', content: 'ping' },
      ],
      max_tokens: usesCompletionTokens(c.model) ? 4096 : 8,
    });
    return {
      ok: true,
      provider: c.provider,
      model: c.model,
      preview: String(result.content).trim().slice(0, 80),
    };
  }

  window.AiClient = {
    Error: AiClientError,
    chatCompletions,
    testConnection,
    listModels,
    partitionModelIds,
    requireConfig,
    requireAuthConfig,
    usesCompletionTokens,
  };
})();
