/* 模型调用层：照搬 V0.1 的 prototype/js/llm.js，改动只有三处：
 *   1. 网页内置的 Claude（claude.ai 的 sample 能力）可以指定模型，并记下实际回答的是不是这个模型；
 *   2. 统一成 call({ role, label, system, user }) → { text, meta } 一个接口，turn.js 只认这个；
 *   3. 离线演示不走这里，由 mock.js 直接回答。
 * 10-29 加了用量：meta 里记下是哪种接口（provider）、接口报的 usage、输出上限、网页内置 Claude 的字节上限，tokens.js 拿去算。
 * 11-02 提示词缓存：prompts.js 给的 parts 把 user 切成几块。Anthropic 按块发，system 和标了 cache 的块末尾打断点（一共最多 4 个）；
 *   DeepSeek、OpenAI 会自动缓存相同的开头，照旧发整段文字就行；网页内置的 Claude 没有提示词缓存。
 * 11-02 流式输出：call 里带 onText(到目前为止的全文) 时边收边回调。Anthropic 和 OpenAI 兼容的接口用 stream: true 读 SSE，
 *   用量照样从流里拿（Anthropic 的 message_start + message_delta，OpenAI 的 stream_options.include_usage）；
 *   网页内置的 Claude 用 sample 的 onText。OpenAI 兼容的接口不认流式参数（HTTP 400/422）时，退回不流式再发一次。
 *   onText 里出错不影响这次调用。
 * 不依赖 DOM（网页内置的 Claude 只在浏览器里能用）。 */
(function (root) {
  "use strict";

  const PRESETS = {
    mock: { label: { zh: "离线演示（不调用模型）", en: "Offline demo (no model)" }, kind: "mock" },
    claude_page: { label: { zh: "Claude（claude.ai 网页内置，用你自己的账号）", en: "Claude (built into claude.ai, your own account)" }, kind: "page", model: "claude-sonnet-5-5" },
    anthropic: { label: { zh: "Anthropic API（填 API Key）", en: "Anthropic API (API key)" }, kind: "anthropic", base: "https://api.anthropic.com", model: "claude-sonnet-5-5" },
    openai: { label: { zh: "OpenAI 兼容（DeepSeek 等）", en: "OpenAI-compatible (DeepSeek etc.)" }, kind: "openai", base: "https://api.deepseek.com", model: "deepseek-chat" }
  };

  async function chat(settings, system, user, parts, onText) {
    const preset = PRESETS[settings.provider];
    if (!preset) throw new Error("未知的服务类型：" + settings.provider);
    const emit = typeof onText === "function" ? safe(onText) : null;
    if (preset.kind === "page") return callPage(settings, system, user, emit);
    if (preset.kind === "anthropic") return callAnthropic(settings, system, user, parts, emit);
    if (preset.kind === "openai") return callOpenAI(settings, system, user, emit);
    throw new Error("离线演示不调用模型");
  }
  // 界面那边出了错，不该让这次调用失败
  function safe(fn) { return (text) => { try { fn(text); } catch (e) { /* 忽略 */ } }; }

  async function callOpenAI(s, system, user, onText) {
    const base = (s.baseUrl || PRESETS.openai.base).replace(/\/+$/, "");
    const body = { model: s.model || PRESETS.openai.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], response_format: { type: "json_object" } };
    const post = (b) => fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + s.apiKey },
      body: JSON.stringify(b)
    });
    if (onText) {
      const r = await post(Object.assign({}, body, { stream: true, stream_options: { include_usage: true } }));
      if (r.ok && isStream(r)) return readOpenAIStream(r, body, onText);
      // 不认流式参数的接口：退回不流式再发一次（别的错照常报）
      if (r.status !== 400 && r.status !== 422) return openAIResult(await readJSON(r), body, onText);
      await r.text().catch(() => "");
    }
    return openAIResult(await readJSON(await post(body)), body, onText);
  }
  function openAIResult(data, body, onText) {
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    const finish = data.choices && data.choices[0] && data.choices[0].finish_reason;
    const text = (msg && msg.content) || "";
    if (onText && text) onText(text);
    return { text, meta: { model: data.model || body.model, usage: data.usage || null, truncated: finish === "length" } };
  }
  async function readOpenAIStream(r, body, onText) {
    let text = "", usage = null, finish = null, model = body.model;
    await readSSE(r, (d) => {
      if (d.error) throw new Error("HTTP " + r.status + "：" + (d.error.message || d.error.type || JSON.stringify(d.error)));
      if (d.model) model = d.model;
      if (d.usage) usage = d.usage;
      const ch = d.choices && d.choices[0];
      if (!ch) return;
      if (ch.finish_reason) finish = ch.finish_reason;
      const piece = ch.delta && typeof ch.delta.content === "string" ? ch.delta.content : "";
      if (piece) { text += piece; onText(text); }
    });
    // 流没收到结束的原因就断了，也算没写完
    return { text, meta: { model, usage, truncated: finish === "length" || !finish, streamed: true } };
  }

  const MAX_TOKENS = 4000;
  const CACHE = { type: "ephemeral" };
  // user 按 parts 切块，标了 cache 的块末尾打断点（system 已经占了一个，这里最多 3 个，多了只留前面的）。
  // parts 接起来要正好是 user 的开头：重试时 user 后面多了"你上一次的输出"，多出来的单独成一块，不打断点。对不上就整段发、不打断点
  function userBlocks(user, parts) {
    const joined = (parts || []).map((p) => p.text).join("");
    if (!parts || !parts.length || !user.startsWith(joined)) return [{ type: "text", text: user }];
    let left = 3;
    const blocks = parts.filter((p) => p.text).map((p) => {
      const b = { type: "text", text: p.text };
      if (p.cache && left > 0) { b.cache_control = CACHE; left--; }
      return b;
    });
    const rest = user.slice(joined.length);
    if (rest) blocks.push({ type: "text", text: rest });
    return blocks;
  }
  function anthropicBody(s, system, user, parts) {
    return {
      model: s.model || PRESETS.anthropic.model, max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: system, cache_control: CACHE }],
      messages: [{ role: "user", content: userBlocks(user, parts) }]
    };
  }
  async function callAnthropic(s, system, user, parts, onText) {
    const base = (s.baseUrl || PRESETS.anthropic.base).replace(/\/+$/, "");
    const body = anthropicBody(s, system, user, parts);
    if (onText) body.stream = true;
    const r = await fetch(base + "/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": s.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(body)
    });
    if (onText && r.ok && isStream(r)) return readAnthropicStream(r, body, onText);
    const data = await readJSON(r);
    if (data.stop_reason === "refusal") throw new Error("模型拒绝了这次请求（refusal）");
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    if (onText && text) onText(text);
    return { text, meta: { model: data.model || body.model, usage: data.usage || null, stop_reason: data.stop_reason, maxTokens: MAX_TOKENS, truncated: data.stop_reason === "max_tokens" } };
  }
  // Anthropic 的流：message_start 带输入的用量（含缓存），content_block_delta 是一段段的字，message_delta 带停下的原因和输出的用量
  async function readAnthropicStream(r, body, onText) {
    let text = "", usage = null, stop = null, model = body.model;
    const add = (u) => { if (!u) return; usage = usage || {}; for (const [k, v] of Object.entries(u)) if (v != null) usage[k] = v; };
    await readSSE(r, (d) => {
      if (d.type === "error") throw new Error("Anthropic：" + ((d.error && (d.error.message || d.error.type)) || "流中断了"));
      if (d.type === "message_start" && d.message) { if (d.message.model) model = d.message.model; add(d.message.usage); }
      else if (d.type === "content_block_delta" && d.delta && d.delta.type === "text_delta" && d.delta.text) { text += d.delta.text; onText(text); }
      else if (d.type === "message_delta") { if (d.delta && d.delta.stop_reason) stop = d.delta.stop_reason; add(d.usage); }
    });
    if (stop === "refusal") throw new Error("模型拒绝了这次请求（refusal）");
    return { text, meta: { model, usage, stop_reason: stop, maxTokens: MAX_TOKENS, truncated: stop === "max_tokens" || !stop, streamed: true } };
  }

  function isStream(r) { return /text\/event-stream/i.test((r.headers && r.headers.get && r.headers.get("content-type")) || ""); }
  // 读 SSE：按空行分成一条条事件，每条取 data: 后面的 JSON 交给 onData（[DONE] 和读不懂的跳过）。onData 抛错就停下、关掉连接
  async function readSSE(r, onData) {
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "";
    const flush = (block) => {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
      if (!data || data === "[DONE]") return;
      let obj;
      try { obj = JSON.parse(data); } catch (e) { return; }
      onData(obj);
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let m;
        while ((m = /\r?\n\r?\n/.exec(buf))) { flush(buf.slice(0, m.index)); buf = buf.slice(m.index + m[0].length); }
      }
      buf += dec.decode();
      if (buf.trim()) flush(buf);
    } catch (e) {
      try { Promise.resolve(reader.cancel()).catch(() => {}); } catch (x) { /* 忽略 */ }
      throw e;
    }
  }

  // claude.ai 上发布的网页可以用浏览者自己的 Claude 账号调用模型（sample 能力），不需要 API Key
  let samplePromise = null;
  function pageSample() {
    if (!samplePromise) {
      const c = typeof window !== "undefined" ? window.claude : null;
      samplePromise = c && typeof c.use === "function" ? c.use("sample").catch(() => null) : Promise.resolve(null);
    }
    return samplePromise;
  }
  // 网页内置的 Claude 一次最多发多少字节（拿不到就是 null）
  let limitsPromise = null;
  function pageLimits(sample) {
    if (!limitsPromise) limitsPromise = sample && typeof sample.limits === "function" ? Promise.resolve().then(() => sample.limits()).catch(() => null) : Promise.resolve(null);
    return limitsPromise;
  }
  const PAGE_ERRORS = {
    not_granted: "你没有允许这个网页使用 Claude。刷新页面后再允许，或在设置里改用离线演示。",
    sampling_disabled: "这个账号不能在网页里使用 Claude。",
    rate_limited: "调用太频繁或达到了用量上限，过一会儿再试。",
    session_expired: "登录已过期，请重新登录 claude.ai。",
    refused: "Claude 拒绝了这次请求，换个说法试试。",
    prompt_too_large: "这一轮的内容太长了。",
    cancelled: "已取消。"
  };
  async function callPage(s, system, user, onText) {
    const sample = await pageSample();
    if (!sample) throw new Error("这里用不了网页内置的 Claude（要在 claude.ai 上打开这个网页）。请在设置里改用离线演示或填 API Key。");
    const model = s.model || PRESETS.claude_page.model;
    const opts = { cache: false, modelTier: "default" };
    if (model) opts.model = model;
    if (s.effort) opts.effort = s.effort;
    if (onText) opts.onText = (u) => onText(u.text);
    try {
      const [r, limits] = await Promise.all([sample([{ role: "user", content: system + "\n\n" + user }], opts), pageLimits(sample)]);
      const applied = r.modelApplied || null;
      return { text: r.text, meta: { model: applied || ("默认档（" + (r.modelTierApplied || "default") + "）"), requested: model, fallback: !!model && applied !== model, truncated: !!r.truncated, limitBytes: (limits && limits.maxPromptBytes) || null } };
    } catch (e) {
      throw new Error(PAGE_ERRORS[e && e.code] || ("Claude 调用失败（" + ((e && e.code) || "unknown") + "）" + (e && e.message ? "：" + e.message : "")));
    }
  }

  async function readJSON(r) {
    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch (e) { throw new Error(`HTTP ${r.status}：${raw.slice(0, 300)}`); }
    if (!r.ok) throw new Error(`HTTP ${r.status}：${(data.error && (data.error.message || data.error.type)) || raw.slice(0, 300)}`);
    return data;
  }

  // 宽容地从模型输出里取出 JSON 对象（照搬 V0.1）
  function parseJSON(text) {
    let t = String(text || "").trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
    try { return JSON.parse(t); } catch (e) { /* 继续尝试 */ }
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { /* 失败 */ } }
    return null;
  }

  // turn.js 用的统一接口
  function caller(settings) {
    return async (call) => {
      const t0 = Date.now();
      const r = await chat(settings, call.system, call.user, call.parts, call.onText);
      r.meta = Object.assign({ ms: Date.now() - t0, provider: PRESETS[settings.provider].kind }, r.meta);
      return r;
    };
  }

  root.V2LLM = { PRESETS, chat, caller, parseJSON, pageSample, userBlocks, anthropicBody, readSSE };
})(typeof window !== "undefined" ? window : globalThis);
