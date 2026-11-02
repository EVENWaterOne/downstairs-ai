// T10：英文版。英文局里给模型的提示词、退回理由、系统旁白和离线演示都是英文，
// 中文版测过的隔离（别人家的事、以后的事）英文版一样成立。
const test = require("node:test");
const assert = require("node:assert/strict");
const { W, M, H, API, B, D, P, Mock, Turn } = require("./load");

const HAN = /\p{Script=Han}/u;
const hanLines = (text) => String(text).split("\n").filter((l) => HAN.test(l));

function game(dayId) {
  const s = API.createSession({ lang: "en" });
  D.begin(s.state);
  if (dayId) assert.ok(D.startDay(s.state, dayId).ok);
  return s;
}
function at(year) {
  const s = game();
  if (year > 1989) assert.ok(H.applyOp(s.state, { op: "jump_time", year, month: 6, day: 1, slot: 1 }, { by: "system" }).ok);
  return s.state;
}
function nextTo(state, id) {
  const a = state.actors[id];
  for (const [dx, dy] of B.DIRS) {
    if (B.free(state, a.map, a.x + dx, a.y + dy, "player") && !B.exitAt(a.map, a.x + dx, a.y + dy)) {
      Object.assign(state.actors.player, { map: a.map, x: a.x + dx, y: a.y + dy });
      return;
    }
  }
  throw new Error("no free cell next to " + id);
}
const promptOf = (state, id) => { const p = P.characterPrompt(state, id, { input: "Hello", turnEvents: [] }); return p.system + "\n" + p.user; };
const gmOf = (state) => { const p = P.gmPrompt(state, { input: "Hello" }); return p.system + "\n" + p.user; };

test("英文版：每个日子每个时段，GM 和在场住户的提示词里没有汉字", () => {
  const s = game(), state = s.state;
  for (;;) {
    for (;;) {
      for (const map of Object.keys(M.MAPS)) {
        // 玩家站到每张图上看一遍（地图块、谁在这里都会变）
        const spot = M.MAPS[map].rows.flatMap((row, y) => [...row].map((_, x) => [x, y])).find(([x, y]) => B.free(state, map, x, y, "player") && !B.exitAt(map, x, y));
        Object.assign(state.actors.player, { map, x: spot[0], y: spot[1] });
        assert.deepEqual(hanLines(gmOf(state)), [], `${state.day.id} slot ${state.time.slot} ${map}: GM prompt`);
        for (const id of B.nearby(state)) if (W.CHARACTERS[id]) assert.deepEqual(hanLines(promptOf(state, id)), [], `${state.day.id} ${id}`);
      }
      if (!D.wait(state).ok) break;
    }
    const next = D.nextDay(state);
    if (!next) break;
    D.startDay(state, next.id);
  }
});

test("英文版：住户只知道自己的事，GM 的当天背景不给住户", () => {
  const y89 = at(1989), y95 = at(1995), y97 = at(1997);
  const y98 = game("d1998_spring").state;
  assert.ok(!promptOf(y89, "weiming").includes("retrenched"));
  assert.ok(promptOf(y98, "weiming").includes("retrenched"));
  assert.ok(!promptOf(y98, "huiling").includes("retrenched"));
  assert.ok(gmOf(y98).includes("Wei Ming was let go early this year"));
  for (const id of ["huiling", "jianguo", "wangmei"]) assert.ok(!promptOf(y98, id).includes("let go early this year"), id);
  assert.ok(!promptOf(y89, "huiling").includes("Hong Kong branch"));
  assert.ok(promptOf(y97, "huiling").includes("Hong Kong branch"));
  assert.ok(!promptOf(y97, "weiming").includes("Hong Kong branch"));
  assert.ok(promptOf(y89, "mak_esah").includes("1964 riots"));
  assert.ok(promptOf(y89, "chen").includes("1964 riots"));
  for (const id of ["rahman", "aisyah_kassim", "nurul", "kumar"]) assert.ok(!promptOf(y89, id).includes("1964 riots"), id);
  assert.ok(!promptOf(y89, "aisyah_kassim").includes("washes dishes"));
  assert.ok(promptOf(y95, "aisyah_kassim").includes("washes dishes"));
  assert.ok(promptOf(y95, "kumar").includes("washes dishes"));
  for (const id of ["weiming", "huiling", "rahman"]) assert.ok(!promptOf(y95, id).includes("washes dishes"), id);
});

test("英文版：住户不知道自己的以后（1989 到 2018 年，提示词里没有比今年晚的年份）", () => {
  const s = game(), state = s.state;
  for (let year = 1989; year <= 2018; year++) {
    while (state.decade < W.decadeOfYear(year)) API.advanceDecade(s);
    if (year > state.time.year) assert.ok(H.applyOp(state, { op: "jump_time", year, month: 6, day: 1, slot: 1 }, { by: "system" }).ok);
    for (const id of W.charactersAt(year)) {
      if (!W.canTalk(id, year)) continue;
      const later = (promptOf(state, id).match(/(19|20)\d\d/g) || []).map(Number).filter((y) => y > year);
      assert.deepEqual(later, [], `${year} ${id}`);
    }
  }
});

test("英文版：没写年份的以后的事也按年份给", () => {
  const y89 = at(1989), y95 = at(1995);
  assert.ok(!promptOf(y89, "kumar").includes("Priya") && !promptOf(y89, "kumar").includes("Shohel"));
  assert.ok(promptOf(y95, "kumar").includes("Priya") && promptOf(y95, "kumar").includes("Shohel"));
  for (const id of ["kumar", "huiling", "weiming"]) assert.ok(!promptOf(y89, id).includes("patch tyres"), id);
  assert.ok(promptOf(y95, "kumar").includes("patch tyres"));
  assert.ok(!gmOf(y89).includes("Shohel"));
  assert.ok(!/daughter/.test(promptOf(y89, "kumar")));
  assert.ok(/daughter/.test(promptOf(y95, "kumar")));
  for (const t of ["decades later", "now Singapore is familiar", "people have started coming to her"]) assert.ok(!promptOf(y95, "wangmei").includes(t), t);
  assert.ok(!promptOf(y95, "xiaoyu").includes("sound local in both"));
  assert.match(promptOf(y95, "junhao"), /How you talk: A small boy's Singapore English/);
  assert.match(promptOf(y95, "xiaoyu"), /How you talk: Mandarin with a touch/);
});

test("英文版：默认身份是 Ho Chee Keong；自定义身份（中英文的性别写法都认）替换默认的", () => {
  const s = game();
  assert.match(P.identityText(s.state, null), /Ho Chee Keong, a 24-year-old Chinese man/);
  const me = { name: "Siti", gender: "female", ethnicity: "Malay", born: 1966, languages: "Malay and English", about: "Grew up in Geylang Serai." };
  const p = P.characterPrompt(s.state, "chen", { input: "Hello", identity: me, turnEvents: [] });
  assert.ok((p.system + p.user).includes("Siti, a 23-year-old Malay woman") && (p.system + p.user).includes("Geylang Serai"));
  assert.ok(!(p.system + p.user).includes("Ho Chee Keong"));
  assert.match(P.identityText(s.state, { gender: "女" }), /old Chinese woman/);
  // 中文局还是何志强
  assert.match(P.identityText(API.createSession({ lang: "zh" }).state, null), /何志强/);
});

test("英文版：规则层的退回理由都是英文", async () => {
  const state = at(1990);
  const bad = [
    { op: "speak", npc: "nobody", text: "Hi" },
    { op: "narrate", text: "Her tension is plain to see." },
    { op: "narrate", text: "" },
    { op: "establish_fact", subject: "nowhere", key: "x", value: "y" },
    { op: "establish_fact", subject: "void_deck", key: "Bad Key", value: "y" },
    { op: "roll", dc: 99, reason: "x" },
    { op: "move", actor: "chen", map: "nowhere", x: 1, y: 1 },
    { op: "community_action", residents: ["nobody"], description: "help" },
    { op: "clock_tick", clock: "nope", by: 1, evidence: [] },
    { op: "jump_time", year: 2030, month: 1, day: 1, slot: 0 },
    { op: "reveal", npc: "chen", kind: "secret", id: "nope" },
    { op: "impression", npc: "chen", about: "player", text: "x", evidence: ["E999"] },
    { op: "satisfaction", npc: "chen", delta: 50, reason: "x", evidence: [] },
    { op: "lean", npc: "chen", toward: "z", evidence: [] },
    { op: "bogus" }
  ];
  for (const op of bad) {
    const r = H.applyOp(state, op, { by: op.op === "jump_time" ? "gm" : "character" });
    assert.equal(r.ok, false, JSON.stringify(op));
    assert.ok(r.reason && !HAN.test(r.reason), `${JSON.stringify(op)} → ${r.reason}`);
  }
  // GM 那一层（turn.js）的理由、重给的提示也是英文
  const s = game(), st = s.state;
  const who = W.charactersAt(1989).find((id) => st.actors[id].map && W.canTalk(id, 1989));
  nextTo(st, who);
  const calls = [];
  const llm = async (call) => {
    calls.push(call);
    if (call.role === "gm") return { text: JSON.stringify({ ops: [{ op: "jump_time", year: 1990 }, { op: "advance_time", slots: 0 }], responders: [who] }) };
    return { text: "not json" };
  };
  const res = await Turn.playerTurn(s, "Good morning", { llm, focus: who });
  for (const c of res.calls) {
    assert.deepEqual(hanLines(c.system + "\n" + c.user), [], c.label);
    assert.ok(!HAN.test(c.label), c.label);
    for (const r of c.results || []) if (r.reason) assert.ok(!HAN.test(r.reason), r.reason);
  }
  assert.ok(calls.some((c) => c.label.includes("JSON again")));
  // 两次都不是 JSON：代码写的那句也是英文
  for (const e of res.items) assert.ok(!HAN.test(e.summary), e.summary);
  assert.ok(res.items.some((e) => e.kind === "narration" && /glances at you and says nothing/.test(e.summary)));
});

test("英文版：游戏端模拟器和走路的提示也有英文", () => {
  const s = game();
  const r = API.gameAction(s, "build", "nope", 0);
  assert.equal(r.ok, false);
  assert.ok(r.reason_en && !HAN.test(r.reason_en));
  const out = B.moveTo(s.state, -5, -5);
  if (out.reason) assert.ok(out.reason.en && !HAN.test(out.reason.en));
});

test("英文版离线演示：每个人都有英文台词，都过得了设定门，里面没有汉字", () => {
  const state = at(1995);
  assert.deepEqual(Object.keys(Mock.LINES_EN).sort(), Object.keys(Mock.LINES).sort());
  for (const [id, lines] of Object.entries(Mock.LINES_EN)) {
    assert.ok(W.CHARACTERS[id], id);
    assert.equal(lines.length, Mock.LINES[id].length, id);
    lines.forEach((l, i) => {
      assert.deepEqual(l.reveal || null, Mock.LINES[id][i].reveal || null, `${id} ${i}: reveal`);
      for (const t of [l.speak, l.act]) if (t) {
        assert.ok(!HAN.test(t), `${id}: ${t}`);
        assert.equal(H.leakCheck(state, t), null, `${id}: ${t}`);
      }
    });
  }
});

test("英文版离线演示：八个日子从头走到尾，玩家看到的每一行都没有汉字", async () => {
  const s = game(), state = s.state;
  const llm = Mock.caller();
  let spent = 0;
  for (;;) {
    let talked = 0;
    for (let slot = 0; slot < 3; slot++) {
      const who = W.charactersAt(state.time.year).find((id) => state.actors[id].map && W.canTalk(id, state.time.year));
      if (who) {
        nextTo(state, who);
        const input = slot === 0 ? "Let me look around" : slot === 1 ? "Let me help you carry that" : "Hello, how have you been?";
        // 看看四周、帮忙是对 GM 说的；问好是对住户说的
        const res = await Turn.playerTurn(s, input, { llm, focus: who, to: slot < 2 ? "gm" : who, confirmSpend: async () => { spent++; return true; } });
        talked += res.items.filter((e) => e.kind === "speech").length;
        for (const e of res.items) assert.ok(!HAN.test(e.summary), `${state.day.id}: ${e.kind} ${e.summary}`);
        for (const c of res.calls) assert.deepEqual(hanLines(c.system + "\n" + c.user + "\n" + c.text), [], `${state.day.id} ${c.label}`);
      }
      if (!D.wait(state).ok) break;
    }
    assert.ok(talked > 0, state.day.id);
    const next = D.nextDay(state);
    if (!next) break;
    D.startDay(state, next.id);
  }
  assert.equal(state.day.id, "d1998_spring");
  assert.ok(spent > 0, "the help line should trigger a community action");
  // 看着难懂的话都带着翻译
  for (const e of state.events.filter((x) => x.kind === "speech")) if (H.needsGloss(state, e.summary)) assert.ok(e.gloss, e.summary);
  // 时间、检定这些系统写的行也是英文
  for (const e of state.events.filter((x) => x.perceivedBy.includes("player"))) assert.ok(!HAN.test(e.summary), `${e.kind}: ${e.summary}`);
});
