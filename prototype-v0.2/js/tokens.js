/* token 数和上下文用量（10-29 Polaris："得加个token数计算和上下文计算的功能"）。
 * - 填 API Key 的两种接口会在回答里报 token 数：Anthropic 是 usage.input_tokens / output_tokens（加上缓存的两项），
 *   OpenAI 兼容的是 usage.prompt_tokens / completion_tokens。有就用，算准确数。
 * - claude.ai 网页内置的 Claude 和离线演示不报，按字数估：
 *     Claude：一个汉字（含全角标点）约 1.1 个 token，其余字符约 3.5 个一个 token
 *       （一句 19 个汉字 21 个 token，见 jangwook.net 的多语言 token 实验；英文 3.5 个字母一个 token 是 Anthropic 以前文档里的说法）；
 *     DeepSeek 等：一个中文字符约 0.6 个 token，一个英文字符约 0.3 个 token（DeepSeek 文档 token_usage 页）。
 *   估算只用来看大小，差一两成很正常；有准确数的调用会一起记下估算，界面上显示两者差多少，以后可以拿来校准。
 * - 每次调用都是单独的一问一答，不带对话历史，所以一次调用的"上下文"就是这次发出去的全部提示词，占模型上下文窗口多少。
 *   网页内置的 Claude 另有一次最多发多少字节的上限（sample.limits().maxPromptBytes），通常比上下文窗口先到。
 * - 11-02 提示词缓存：Anthropic 报 cache_read_input_tokens（按缓存价读的）和 cache_creation_input_tokens（这次写进缓存的），
 *   DeepSeek 报 prompt_cache_hit_tokens，OpenAI 报 prompt_tokens_details.cached_tokens。记成 cached（读）和 written（写，只有 Anthropic 有）。
 * 不依赖 DOM。 */
(function (root) {
  "use strict";

  const RATES = { claude: { cjk: 1.1, other: 1 / 3.5 }, deepseek: { cjk: 0.6, other: 0.3 } };
  // 汉字、日文假名、韩文、全角标点和全角字母
  const CJK = /[⺀-⿟　-〿぀-ヿ㄀-ㇿ㐀-䶿一-鿿가-힯豈-﫿︰-﹏＀-￯]|[\ud840-\ud87f][\udc00-\udfff]/g;

  // 上下文窗口（token）。从上往下第一个对上的算数；对不上就是不知道
  const WINDOWS = [
    [/^claude-haiku-4-5/, 200000],
    [/^claude-(fable|mythos|opus|sonnet|haiku)-5/, 1000000],
    [/^claude-(opus|sonnet)-4-[6-9]/, 1000000],
    [/^claude-/, 200000],
    [/^deepseek-(flash|v4)/, 1000000],
    [/^deepseek-/, 128000]
  ];
  // 离线演示没有模型，按网页内置 Claude 的默认模型算占比
  const REFERENCE_MODEL = "claude-sonnet-5-5";

  function bare(model) { return String(model || "").toLowerCase().replace(/^(?:[a-z]{2}\.)?anthropic\./, ""); }
  function windowFor(model) {
    const m = bare(model);
    for (const [re, n] of WINDOWS) if (re.test(m)) return n;
    return null;
  }
  function family(provider, model) {
    if (provider === "openai" && !/claude/.test(bare(model))) return "deepseek";
    return "claude";
  }

  function estimate(text, fam) {
    const s = String(text || "");
    if (!s) return 0;
    const cjk = (s.match(CJK) || []).length;
    const other = Array.from(s).length - cjk;
    const k = RATES[fam] || RATES.claude;
    return Math.ceil(cjk * k.cjk + other * k.other);
  }
  function utf8Bytes(text) {
    let n = 0;
    for (const ch of String(text || "")) { const c = ch.codePointAt(0); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; }
    return n;
  }

  // 各家报的用量 → { input, output, cached, written }；没报就是 null。input 是整份提示词（含缓存读的和写的）
  function normalizeUsage(u) {
    if (!u || typeof u !== "object") return null;
    const num = (v) => (Number.isFinite(v) ? v : 0);
    if (u.input_tokens != null || u.output_tokens != null) {
      const cached = num(u.cache_read_input_tokens);
      const written = num(u.cache_creation_input_tokens);
      return { input: num(u.input_tokens) + cached + written, output: num(u.output_tokens), cached, written };
    }
    if (u.prompt_tokens != null || u.completion_tokens != null) {
      const cached = num(u.prompt_cache_hit_tokens) || num(u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens);
      return { input: num(u.prompt_tokens), output: num(u.completion_tokens), cached, written: 0 };
    }
    return null;
  }

  // 提示词按 "## 标题" 分段，看哪一部分最占地方（"###" 算在上一个 "##" 里）
  function sections(system, user, fam) {
    const out = [];
    for (const [where, text] of [["system", system], ["user", user]]) {
      const parts = String(text || "").split(/^(?=## )/m);
      for (const p of parts) {
        if (!p.trim()) continue;
        const m = p.match(/^## (.+)/);
        out.push({ where, title: m ? m[1].trim() : null, tokens: estimate(p, fam) });
      }
    }
    return out;
  }

  // 一次调用的用量。call = { system, user, text, meta }，meta 来自 llm.js 或 mock.js
  function forCall(call) {
    const m = call.meta || {};
    const fam = family(m.provider, m.model);
    const prompt = (call.system || "") + "\n\n" + (call.user || "");
    const est = { input: estimate(prompt, fam), output: estimate(call.text, fam) };
    const u = normalizeUsage(m.usage);
    const input = u ? u.input : est.input, output = u ? u.output : est.output;
    let windowModel = [m.model, m.requested].find((x) => windowFor(x)) || null, reference = false;
    if (!windowModel && m.provider === "mock") { windowModel = REFERENCE_MODEL; reference = true; }
    const win = m.window || windowFor(windowModel);
    const secs = sections(call.system, call.user, fam);
    // 有准确数时，各段按比例放大缩小，加起来等于实际的输入
    const scale = est.input ? input / est.input : 1;
    for (const s of secs) s.tokens = Math.round(s.tokens * scale);
    const r = {
      input, output, exact: !!u, est, cached: u ? u.cached : 0, written: u ? u.written : 0, family: fam,
      window: win || null, windowModel: win ? windowModel : null, reference, share: win ? input / win : null,
      bytes: utf8Bytes(prompt), limitBytes: m.limitBytes || null, byteShare: null,
      maxOutput: m.maxTokens || null, sections: secs
    };
    if (r.limitBytes) r.byteShare = r.bytes / r.limitBytes;
    // 真正先碰到的那个上限
    r.used = Math.max(r.share || 0, r.byteShare || 0) || null;
    r.limit = r.byteShare != null && r.byteShare >= (r.share || 0) ? "bytes" : r.share != null ? "window" : null;
    return r;
  }

  // 一组调用的合计
  function sum(calls) {
    const list = (calls || []).filter((c) => c && c.tokens);
    // cached / written / exactInput 只算有准确数的调用：命中率 = cached / exactInput
    const total = { calls: list.length, input: 0, output: 0, exact: 0, estimated: 0, largest: null, ratio: null, cached: 0, written: 0, exactInput: 0 };
    let estIn = 0, exactIn = 0;
    for (const c of list) {
      const k = c.tokens;
      total.input += k.input; total.output += k.output;
      if (k.exact) { total.exact++; exactIn += k.input; estIn += k.est.input; total.cached += k.cached || 0; total.written += k.written || 0; } else total.estimated++;
      if (k.used != null && (!total.largest || k.used > total.largest.tokens.used)) total.largest = c;
    }
    // 实际是估算的几倍（只看有准确数的调用）
    if (estIn) total.ratio = exactIn / estIn;
    total.exactInput = exactIn;
    return total;
  }

  function compact(n) {
    if (n == null) return "";
    if (n >= 1000000) return +(n / 1000000).toFixed(n % 1000000 ? 1 : 0) + "M";
    if (n >= 1000) return +(n / 1000).toFixed(n % 1000 ? 1 : 0) + "K";
    return String(n);
  }

  root.V2Tokens = { RATES, WINDOWS, REFERENCE_MODEL, windowFor, family, estimate, utf8Bytes, normalizeUsage, sections, forCall, sum, compact };
})(typeof window !== "undefined" ? window : globalThis);
