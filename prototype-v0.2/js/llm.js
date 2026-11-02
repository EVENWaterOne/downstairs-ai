/* 模型调用层：照搬 V0.1 的 prototype/js/llm.js，改动只有三处：
 *   1. 网页内置的 Claude（claude.ai 的 sample 能力）可以指定模型，并记下实际回答的是不是这个模型；
 *   2. 统一成 call({ role, label, system, user }) → { text, meta } 一个接口，turn.js 只认这个；
 *   3. 离线演示不走这里，由 mock.js 直接回答。
 * 10-29 加了用量：meta 里记下是哪种接口（provider）、接口报的 usage、输出上限、网页内置 Claude 的字节上限，tokens.js 拿去算。
 * 11-02 提示词缓存：prompts.js 给的 parts 把 user 切成几块。Anthropic 按块发，system 和标了 cache 的块末尾打断点（一共最多 4 个）；
 *   DeepSeek、OpenAI 会自动缓存相同的开头，照旧发整段文字就行；网页内置的 Claude 没有提示词缓存。
 * 不依赖 DOM（网页内置的 Claude 只在浏览器里能用）。 */
(function (root) {
  "use strict";

  const PRESETS = {
    mock: { label: { zh: "离线演示（不调用模型）", en: "Offline demo (no model)" }, kind: "mock" },
    claude_page: { label: { zh: "Claude（claude.ai 网页内置，用你自己的账号）", en: "Claude (built into claude.ai, your own account)" }, kind: "page", model: "claude-sonnet-5-5" },
    anthropic: { label: { zh: "Anthropic API（填 API Key）", en: "Anthropic API (API key)" }, kind: "anthropic", base: "https://api.anthropic.com", model: "claude-sonnet-5-5" },
    openai: { label: { zh: "OpenAI 兼容（DeepSeek 等）", en: "OpenAI-compatible (DeepSeek etc.)" }, kind: "openai", base: "https://api.deepseek.com", model: "deepseek-chat" }
  };

  async function chat(settings, system, user, parts) {
    const preset = PRESETS[settings.provider];
    if (!preset) throw new Error("未知的服务类型：" + settings.provider);
    if (preset.kind === "page") return callPage(settings, system, user);
    if (preset.kind === "anthropic") return callAnthropic(settings, system, user, parts);
    if (preset.kind === "openai") return callOpenAI(settings, system, user);
    throw new Error("离线演示不调用模型");
  }

  async function callOpenAI(s, system, user) {
    const base = (s.baseUrl || PRESETS.openai.base).replace(/\/+$/, "");
    const body = { model: s.model || PRESETS.openai.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], response_format: { type: "json_object" } };
    const r = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + s.apiKey },
      body: JSON.stringify(body)
    });
    const data = await readJSON(r);
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    const finish = data.choices && data.choices[0] && data.choices[0].finish_reason;
    return { text: (msg && msg.content) || "", meta: { model: data.model || body.model, usage: data.usage || null, truncated: finish === "length" } };
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
  async function callAnthropic(s, system, user, parts) {
    const base = (s.baseUrl || PRESETS.anthropic.base).replace(/\/+$/, "");
    const body = anthropicBody(s, system, user, parts);
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
    const data = await readJSON(r);
    if (data.stop_reason === "refusal") throw new Error("模型拒绝了这次请求（refusal）");
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    return { text, meta: { model: data.model || body.model, usage: data.usage || null, stop_reason: data.stop_reason, maxTokens: MAX_TOKENS, truncated: data.stop_reason === "max_tokens" } };
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
  async function callPage(s, system, user) {
    const sample = await pageSample();
    if (!sample) throw new Error("这里用不了网页内置的 Claude（要在 claude.ai 上打开这个网页）。请在设置里改用离线演示或填 API Key。");
    const model = s.model || PRESETS.claude_page.model;
    const opts = { cache: false, modelTier: "default" };
    if (model) opts.model = model;
    if (s.effort) opts.effort = s.effort;
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
      const r = await chat(settings, call.system, call.user, call.parts);
      r.meta = Object.assign({ ms: Date.now() - t0, provider: PRESETS[settings.provider].kind }, r.meta);
      return r;
    };
  }

  root.V2LLM = { PRESETS, chat, caller, parseJSON, pageSample, userBlocks, anthropicBody };
})(typeof window !== "undefined" ? window : globalThis);
