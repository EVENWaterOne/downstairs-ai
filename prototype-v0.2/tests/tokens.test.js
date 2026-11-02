// token 数和上下文用量（10-29 Polaris："得加个token数计算和上下文计算的功能"）
const test = require("node:test");
const assert = require("node:assert/strict");
const { W, B, D, API, LLM, Mock, Turn, Tok } = require("./load");

function game(lang) {
  const s = API.createSession({ lang });
  D.begin(s.state);
  const state = s.state;
  const id = W.charactersAt(state.time.year).find((x) => state.actors[x].map && W.canTalk(x, state.time.year));
  const a = state.actors[id];
  for (const [dx, dy] of B.DIRS) {
    if (B.free(state, a.map, a.x + dx, a.y + dy, "player") && !B.exitAt(a.map, a.x + dx, a.y + dy)) {
      Object.assign(state.actors.player, { map: a.map, x: a.x + dx, y: a.y + dy });
      break;
    }
  }
  return { s, id };
}

test("估算：Claude 一个汉字约 1.1 个 token、3.5 个英文字符一个；DeepSeek 按它文档的 0.6 和 0.3", () => {
  const zh = "组屋楼下的空地上有人在下棋".repeat(10); // 130 个汉字
  assert.equal(Tok.estimate(zh, "claude"), Math.ceil(130 * 1.1));
  assert.equal(Tok.estimate(zh, "deepseek"), Math.ceil(130 * 0.6));
  assert.equal(Tok.estimate("a".repeat(35), "claude"), 10);
  assert.equal(Tok.estimate("a".repeat(10), "deepseek"), 3);
  // 全角标点算汉字那一类
  assert.equal(Tok.estimate("好，好。", "claude"), Math.ceil(4 * 1.1));
  assert.equal(Tok.estimate("", "claude"), 0);
  assert.equal(Tok.utf8Bytes("ab陈"), 5);
  assert.equal(Tok.family("openai", "deepseek-chat"), "deepseek");
  assert.equal(Tok.family("anthropic", "claude-sonnet-5-5"), "claude");
  assert.equal(Tok.family("page", null), "claude");
});

test("两种接口报的用量都换成同一个样子；没报就是 null", () => {
  // Anthropic 的 input_tokens 只是缓存断点之后的那一截，整份提示词要把读的和写的加回去
  assert.deepEqual(Tok.normalizeUsage({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 }), { input: 160, output: 20, cached: 50, written: 10 });
  assert.deepEqual(Tok.normalizeUsage({ prompt_tokens: 300, completion_tokens: 40, total_tokens: 340, prompt_cache_hit_tokens: 128 }), { input: 300, output: 40, cached: 128, written: 0 });
  assert.deepEqual(Tok.normalizeUsage({ prompt_tokens: 300, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 64 } }), { input: 300, output: 40, cached: 64, written: 0 });
  assert.equal(Tok.normalizeUsage(null), null);
  assert.equal(Tok.normalizeUsage({}), null);
});

test("上下文窗口按模型名找；认不出就不算占比", () => {
  assert.equal(Tok.windowFor("claude-sonnet-5-5"), 1000000);
  assert.equal(Tok.windowFor("claude-opus-4-8"), 1000000);
  assert.equal(Tok.windowFor("anthropic.claude-opus-5-5"), 1000000);
  assert.equal(Tok.windowFor("claude-haiku-4-5"), 200000);
  assert.equal(Tok.windowFor("claude-3-5-haiku-latest"), 200000);
  assert.equal(Tok.windowFor("deepseek-chat"), 128000);
  assert.equal(Tok.windowFor("some-local-model"), null);
  const k = Tok.forCall({ system: "x", user: "y", text: "z", meta: { provider: "openai", model: "some-local-model" } });
  assert.equal(k.share, null);
  assert.equal(k.limit, null);
});

test("一次调用：报了用量就用准确数（各部分按比例对上），网页内置的 Claude 看字节上限", () => {
  const system = "开头的话\n## 规则\n" + "规矩".repeat(200) + "\n## 输出\n只输出 JSON";
  const user = "## 现在\n1989 年\n## 这一轮\n玩家说：早晨";
  const exact = Tok.forCall({ system, user, text: "{}", meta: { provider: "anthropic", model: "claude-sonnet-5-5", usage: { input_tokens: 1000, output_tokens: 7 }, maxTokens: 4000 } });
  assert.equal(exact.exact, true);
  assert.equal(exact.input, 1000);
  assert.equal(exact.output, 7);
  assert.ok(exact.est.input > 0 && exact.est.input !== 1000);
  assert.equal(exact.share, 1000 / 1000000);
  assert.equal(exact.limit, "window");
  assert.equal(exact.maxOutput, 4000);
  const total = exact.sections.reduce((n, x) => n + x.tokens, 0);
  assert.ok(Math.abs(total - 1000) <= exact.sections.length, total);
  assert.deepEqual(exact.sections.map((x) => x.title), [null, "规则", "输出", "现在", "这一轮"]);
  assert.equal(exact.sections.reduce((a, b) => (b.tokens > a.tokens ? b : a)).title, "规则");

  const page = Tok.forCall({ system, user, text: "{}", meta: { provider: "page", model: "默认档（default）", requested: "claude-sonnet-5-5", limitBytes: 262144 } });
  assert.equal(page.exact, false);
  assert.equal(page.windowModel, "claude-sonnet-5-5");
  assert.equal(page.bytes, Tok.utf8Bytes(system + "\n\n" + user));
  assert.equal(page.byteShare, page.bytes / 262144);
  assert.equal(page.limit, "bytes");
  assert.equal(page.used, page.byteShare);
});

test("合计：分开算准确数和估算，记下最大的一次和实际比估算多多少", () => {
  const mk = (input, exact) => ({ label: String(input), tokens: Object.assign({ input, output: 10, exact, est: { input: exact ? input / 2 : input, output: 10 }, used: input / 1000000 }) });
  const u = Tok.sum([mk(100, false), mk(400, true), mk(200, true)]);
  assert.equal(u.calls, 3);
  assert.equal(u.input, 700);
  assert.equal(u.output, 30);
  assert.equal(u.exact, 2);
  assert.equal(u.estimated, 1);
  assert.equal(u.largest.label, "400");
  assert.equal(u.ratio, 2);
  assert.deepEqual(Tok.sum([]), { calls: 0, input: 0, output: 0, exact: 0, estimated: 0, largest: null, ratio: null, cached: 0, written: 0, exactInput: 0 });
  assert.equal(Tok.compact(1000000), "1M");
  assert.equal(Tok.compact(128000), "128K");
  assert.equal(Tok.compact(262144), "262.1K");
});

test("一轮（离线演示）：每次调用都有用量，按默认模型算占比；这一轮的合计对得上", async () => {
  for (const lang of ["zh", "en"]) {
    const { s, id } = game(lang);
    const res = await Turn.playerTurn(s, lang === "en" ? "Morning!" : "早晨！", { llm: Mock.caller(), focus: id });
    assert.ok(res.calls.length >= 2, lang);
    for (const c of res.calls) {
      const k = c.tokens;
      assert.ok(k && k.input > 100 && k.output > 0, c.label);
      assert.equal(k.exact, false);
      assert.equal(k.reference, true);
      assert.equal(k.windowModel, LLM.PRESETS.claude_page.model);
      assert.ok(k.share > 0 && k.share < 0.05, String(k.share));
      // 英文局的提示词各部分标题里没有汉字
      if (lang === "en") for (const x of k.sections) assert.ok(!/\p{Script=Han}/u.test(x.title || ""), x.title);
    }
    assert.equal(res.usage.calls, res.calls.length);
    assert.equal(res.usage.input, res.calls.reduce((n, c) => n + c.tokens.input, 0));
    assert.equal(res.usage.largest.role, "gm");
  }
});

test("一轮（报用量的接口）：用接口的准确数；中途出错也把已经发出的调用交出来", async () => {
  const { s, id } = game("zh");
  const llm = async (call) => ({ text: JSON.stringify(call.role === "gm" ? { ops: [], responders: [id] } : { speak: "早晨。" }), meta: { provider: "anthropic", model: "claude-sonnet-5-5", usage: { input_tokens: call.role === "gm" ? 5000 : 2000, output_tokens: 30 } } });
  const res = await Turn.playerTurn(s, "早晨！", { llm, focus: id });
  assert.deepEqual(res.calls.map((c) => c.tokens.input), [5000, 2000]);
  assert.equal(res.usage.exact, 2);
  assert.ok(res.usage.ratio > 0);

  const g2 = game("zh");
  let n = 0;
  const broken = async (call) => {
    if (n++ > 0) throw new Error("HTTP 529");
    return { text: JSON.stringify({ ops: [], responders: [g2.id] }), meta: { provider: "anthropic", model: "claude-sonnet-5-5", usage: { input_tokens: 4000, output_tokens: 12 } } };
  };
  await assert.rejects(Turn.playerTurn(g2.s, "早晨！", { llm: broken, focus: g2.id }), (e) => e.calls.length === 1 && e.calls[0].tokens.input === 4000);
});

test("导出记录可以带上用量", () => {
  const { s } = game("zh");
  const log = JSON.parse(API.exportLog(s, { usage: { calls: 3 } }));
  assert.equal(log.format, "emergent-trpg/v0.2-log");
  assert.equal(log.usage.calls, 3);
  assert.ok(log.state && log.sim);
});
