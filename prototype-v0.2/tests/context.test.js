// 上下文管理第一步（11-02 Polaris："肯定是api key"）：提示词按稳定程度排、相邻两轮开头一字不差（缓存靠这个命中）、
// 历史按「最近两个时段」取、住户只拿到自己经历过的事、GM 拿到已定细节和自己的推测。
const test = require("node:test");
const assert = require("node:assert/strict");
const { W, M, H, API, B, D, LLM, P, Turn, Tok } = require("./load");

const HAN = /\p{Script=Han}/u;

// 第一天上午：陈阿姨在自己家 (3,3)，玩家站在她旁边 (4,3)，另一边是象棋盘 (5,3)（11-02 只剩各家，原来这一场在楼下）
function atChens(lang) {
  const s = API.createSession({ lang: lang || "zh" });
  D.begin(s.state);
  Object.assign(s.state.actors.chen, { map: "flat_chen", x: 3, y: 3 });
  Object.assign(s.state.actors.player, { map: "flat_chen", x: 4, y: 3 });
  assert.equal(B.furnitureAt(s.state, "flat_chen", 5, 3).kind, "chess_board");
  return s;
}
// 固定输出的假模型：GM 什么都不改、让陈阿姨回话；陈阿姨只说一句好懂的话（不触发翻译）。这样相邻两轮之间只多了这一轮的事
function steady(lang) {
  const calls = [];
  const fn = async (call) => {
    calls.push(call);
    const body = call.role === "gm" ? { ops: [], responders: ["chen"] } : { speak: lang === "en" ? "Sit down first." : "先坐下吧。" };
    return { text: JSON.stringify(body), meta: { model: "fake" } };
  };
  fn.calls = calls;
  return fn;
}
async function rounds(s, llm, lines) {
  for (const say of lines) await Turn.playerTurn(s, say, { llm, focus: "chen", to: "chen" });
  return { gm: llm.calls.filter((c) => c.role === "gm"), chen: llm.calls.filter((c) => c.role === "character") };
}
const LINES = { zh: ["早晨！", "陈阿姨今天下棋吗？", "我陪你下一盘吧", "你先走"], en: ["Morning!", "Playing chess today?", "Let me play a round with you", "You go first"] };
const texts = (parts) => parts.map((p) => p.text);
const marks = (parts) => parts.filter((p) => p.cache).length;

// ---------------- 窗口 ----------------
const ev = (n, slot, day) => Array.from({ length: n }, () => ({ time: { year: 1989, month: 3, day: day || 6, slot } }));
function numbered(groups) {
  const all = [].concat(...groups);
  all.forEach((e, i) => { e.id = "E" + (i + 1); });
  return all;
}

test("窗口：最新的时段加上前面的时段；前面这部分不够下限就整段往前补；整段取，不从时段中间切", () => {
  const w = { min: 30, max: 120, step: 20 };
  // 四个时段各 10、10、5、5 条：最新那段前面只有 5 条，往前补整段，四段全要
  let es = numbered([ev(10, 0, 5), ev(10, 1, 5), ev(5, 0), ev(5, 1)]);
  assert.equal(P.windowOf(es, w).length, 30);
  // 前一个时段自己就有 35 条：只取最新的和它
  es = numbered([ev(40, 0, 5), ev(35, 0), ev(25, 1)]);
  assert.deepEqual(P.windowOf(es, w).map((e) => e.id), es.slice(40).map((e) => e.id));
  // 前一个时段只有 25 条：再补一整段（最新的时段不算在下限里）
  es = numbered([ev(40, 0, 5), ev(25, 0), ev(25, 1)]);
  assert.equal(P.windowOf(es, w).length, 90);
  // 不够两段、事件也少：全给
  es = numbered([ev(3, 0)]);
  assert.equal(P.windowOf(es, w).length, 3);
  assert.deepEqual(P.windowOf([], w), []);
  // 补的时候整段补，哪怕超过下限：3 + 3 不够 30，再补一个 40 条的时段就是 46 条
  es = numbered([ev(40, 0, 4), ev(3, 0), ev(3, 1)]);
  assert.equal(P.windowOf(es, w).length, 46);
});

test("窗口：最新的时段从 1 条长到很多条，开头一直不动，直到超过上限才按步长剪（审查时找到的例子）", () => {
  const w = { min: 30, max: 120, step: 20 };
  const firsts = new Set();
  for (let n = 1; n <= 70; n++) {
    const es = numbered([ev(17, 0, 3), ev(7, 1, 3), ev(20, 0, 4), ev(n, 1, 4)]);
    firsts.add(P.windowOf(es, w)[0].id);
  }
  // 前面 17 + 7 + 20 = 44 条都在窗口里，最新的时段长到 70 条也没超过 120
  assert.deepEqual([...firsts], ["E1"]);
  // 进了新的时段，开头才往后挪一次
  const es = numbered([ev(17, 0, 3), ev(7, 1, 3), ev(20, 0, 4), ev(40, 1, 4), ev(1, 0, 5)]);
  assert.equal(P.windowOf(es, w)[0].id, "E45");
});

test("窗口：同一个时段里加新事件，窗口开头不动；超过上限按步长一截一截地剪，开头也不会每轮都变", () => {
  const w = { min: 30, max: 120, step: 20 };
  const firsts = [];
  for (let n = 20; n <= 160; n++) {
    const es = numbered([ev(10, 0, 5), ev(n, 1)]);
    const win = P.windowOf(es, w);
    assert.ok(win.length <= w.max, `${n}: ${win.length}`);
    assert.equal(win[win.length - 1].id, es[es.length - 1].id);
    firsts.push(win[0].id);
  }
  // 开头只在越过上限、每多 20 条的时候往后跳一次，不是每加一条就变
  const changes = firsts.filter((x, i) => i > 0 && x !== firsts[i - 1]).length;
  assert.ok(changes <= Math.ceil((160 + 10 - w.max) / w.step) + 1, String(changes));
  // 没到上限的时候一直从第一条开始
  assert.equal(firsts[0], "E1");
  assert.equal(firsts[90], "E1"); // 10 + 110 = 120 条，正好在上限上
  assert.equal(firsts[91], "E21"); // 多一条就剪掉一整步（20 条）
  assert.equal(firsts[110], "E21"); // 140 条：还是同一步
  // GM 和住户的窗口。步长取得大一点：剪一次能撑好几轮，不会每两三轮就整段重写一次缓存
  assert.deepEqual(P.WINDOW_GM, { min: 30, max: 120, step: 40 });
  assert.deepEqual(P.WINDOW_CHAR, { min: 20, max: 80, step: 20 });
});

// ---------------- 相邻两轮的提示词开头 ----------------
for (const lang of ["zh", "en"]) {
  test(`相邻两轮：GM 和住户的系统提示一字不差，缓存的部分不变，上一轮的历史是下一轮历史的开头（${lang}）`, async () => {
    const s = atChens(lang);
    const { gm, chen } = await rounds(s, steady(lang), LINES[lang]);
    assert.equal(gm.length, LINES[lang].length);
    assert.equal(chen.length, LINES[lang].length);
    for (const calls of [gm, chen]) {
      for (let i = 1; i < calls.length; i++) {
        const a = calls[i - 1], b = calls[i];
        assert.equal(b.system, a.system, `${b.role} ${i}: system changed`);
        // 除了最后一块（「现在」和「这一轮」），上一轮的每一块原样出现在下一轮的同一个位置
        const prev = texts(a.parts).slice(0, -1);
        assert.deepEqual(texts(b.parts).slice(0, prev.length), prev, `${b.role} ${i}`);
        assert.ok(b.user.startsWith(prev.join("")));
        // 下一轮多出来的历史就是上一轮「这一轮」里的事
        assert.ok(b.parts.length > a.parts.length);
      }
      for (const c of calls) {
        assert.equal(c.parts.map((p) => p.text).join(""), c.user);
        assert.ok(marks(c.parts) <= 3, String(marks(c.parts)));
        // 最后一块不缓存（每轮都变），历史的最后一块缓存
        assert.equal(c.parts[c.parts.length - 1].cache, undefined);
        assert.equal(c.parts[c.parts.length - 2].cache, true);
      }
    }
    // GM：玩家/住户/旧事一块，今天+细节+推测一块，两块都缓存
    assert.equal(gm[0].parts[0].cache, true);
    assert.equal(gm[0].parts[1].cache, true);
    assert.match(gm[0].parts[0].text, lang === "en" ? /^## The player/ : /^## 玩家/);
    assert.match(gm[0].parts[1].text, lang === "en" ? /^## Today/ : /^## 今天/);
    // 英文局的提示词里，新加的标题没有汉字
    if (lang === "en") for (const c of gm.concat(chen)) for (const line of (c.system + "\n" + c.user).split("\n").filter((l) => l.startsWith("#"))) assert.ok(!HAN.test(line), line);
  });
}

test("这一轮的事只在「这一轮」里出现一次，不会同时出现在历史里；记录里写明这次看到了哪些事件", async () => {
  for (const lang of ["zh", "en"]) {
    const s = atChens(lang);
    const llm = steady(lang);
    await rounds(s, llm, LINES[lang].slice(0, 3));
    for (const c of llm.calls.filter((x) => x.role === "gm" || x.role === "character")) {
      assert.ok(c.seen && Array.isArray(c.seen.events) && Array.isArray(c.seen.round), c.label);
      const both = c.seen.events.filter((id) => c.seen.round.includes(id));
      assert.deepEqual(both, [], c.label);
      assert.ok(c.seen.round.length >= 1, c.label);
      // 每个事件编号在提示词里只出现一次
      for (const id of c.seen.events.concat(c.seen.round)) {
        const n = c.user.split(new RegExp(`(?:^|\\n)${id} · `)).length - 1;
        assert.equal(n, 1, `${c.label} ${id}: ${n}`);
      }
      assert.equal(c.seen.from, c.seen.events.length ? c.seen.events[0] : null);
    }
    // 交出来的调用记录也带 seen
    const res = await Turn.playerTurn(s, LINES[lang][3], { llm, focus: "chen", to: "chen" });
    for (const c of res.calls) assert.ok(c.seen && c.seen.round.length >= 1, c.label);
  }
});

test("住户的提示词里只有她自己经历过的事：别人家里的话、对 GM 说的话都不在里面", async () => {
  const s = atChens("zh"), st = s.state;
  // 先去别人家（第一天上午 Aisyah 在家）和那家的人说话，陈阿姨不在
  const other = Object.keys(st.actors).find((id) => id !== "chen" && id !== "player" && st.actors[id].map && st.actors[id].map !== "flat_chen");
  assert.ok(other, "别家要有一个住户在家");
  const away = st.actors[other];
  assert.ok(B.free(st, away.map, away.x, away.y + 1), `${away.map} (${away.x},${away.y + 1}) 站不了`);
  Object.assign(st.actors.player, { map: away.map, x: away.x, y: away.y + 1 });
  const secret = H.applyOp(st, { op: "player_say", text: "隔壁楼那位陈阿姨好像很孤单", to: other }, { by: "ui" }).event;
  assert.ok(secret.perceivedBy.includes(other));
  assert.ok(!secret.perceivedBy.includes("chen"));
  const toGM = H.applyOp(st, { op: "player_say", text: "提示一下下一步", to: "gm" }, { by: "ui" }).event;
  // 回到陈阿姨家，站在她旁边和她说话
  Object.assign(st.actors.player, { map: "flat_chen", x: 4, y: 3 });
  const llm = steady("zh");
  await rounds(s, llm, ["早晨！", "今天热不热？"]);
  for (const c of llm.calls.filter((x) => x.role === "character")) {
    const all = c.system + c.user;
    assert.ok(!all.includes("好像很孤单"), "别人家里说的话漏给了陈阿姨");
    assert.ok(!all.includes("提示一下下一步"), "对 GM 说的话漏给了陈阿姨");
    for (const id of c.seen.events.concat(c.seen.round)) {
      const e = st.events.find((x) => x.id === id);
      assert.ok(e.perceivedBy.includes("chen"), `${id} 陈阿姨没经历过`);
    }
    assert.ok(!c.seen.events.includes(secret.id) && !c.seen.events.includes(toGM.id));
  }
  // GM 什么都看得到
  const g = llm.calls.filter((x) => x.role === "gm").pop();
  assert.ok(g.user.includes("好像很孤单") && g.user.includes("提示一下下一步"));
});

test("GM 记得自己定的细节：还在窗口里的看历史里的「确立」那一行，滚出窗口的列在「今天」那一块；推测放在最后不缓存的那一块", () => {
  for (const lang of ["zh", "en"]) {
    const s = atChens(lang), st = s.state;
    const value = lang === "en" ? "a cracked wooden set" : "一副裂了的木棋";
    const before = P.gmPrompt(st, { to: "chen", input: "x" });
    const say = H.applyOp(st, { op: "player_say", text: lang === "en" ? "Morning!" : "早晨！", to: "chen" }, { by: "ui" }).event;
    const fact = H.applyOp(st, { op: "establish_fact", subject: "flat_chen", key: "chess_set", value }, { by: "gm" });
    assert.equal(fact.ok, true);
    assert.equal(H.applyOp(st, { op: "gm_hypothesis", trait: "patient", text: lang === "en" ? "Takes time with the elderly" : "对老人有耐心", confidence: 0.6, evidence: [say.id] }, { by: "gm" }).ok, true);
    st.turn += 1;
    // 下一轮：细节那条事件在历史里，「今天」那一块和住户那一块都没变，缓存接得上
    const next = P.gmPrompt(st, { to: "chen", input: "x" });
    assert.equal(next.system, before.system);
    assert.equal(next.parts[0].text, before.parts[0].text);
    assert.equal(next.parts[1].text, before.parts[1].text, "定了一个细节，「今天」那一块就变了");
    assert.ok(next.seen.events.includes(fact.event.id));
    assert.ok(next.user.includes((lang === "en" ? "Settled: " : "确立：") + "flat_chen.chess_set = " + value));
    // 推测在最后一块
    const tail = next.parts[next.parts.length - 1].text;
    assert.match(tail, lang === "en" ? /## Your guesses about the player/ : /## 你对玩家的推测/);
    assert.ok(tail.includes(lang === "en" ? "Takes time with the elderly" : "对老人有耐心"));
    assert.ok(!next.parts.slice(0, -1).some((p) => /推测|guesses about/.test(p.text)));
    // 后来过了两天（两个新的时段），前一个时段说了很多话，细节那条事件滚出了窗口：列在「今天」那一块里，不会忘
    const day0 = st.time.day;
    st.time = Object.assign({}, st.time, { day: day0 + 1 });
    for (let i = 0; i < 35; i++) H.applyOp(st, { op: "narrate", text: (lang === "en" ? "Someone moves a piece " : "有人挪了一步棋 ") + i }, { by: "gm" });
    st.turn += 1;
    st.time = Object.assign({}, st.time, { day: day0 + 2 });
    H.applyOp(st, { op: "narrate", text: lang === "en" ? "The lights come on." : "灯亮了。" }, { by: "gm" });
    st.turn += 1;
    const later = P.gmPrompt(st, { to: "chen", input: "x" });
    assert.ok(!later.seen.events.includes(fact.event.id), "细节那条事件应该已经滚出窗口");
    const b = later.parts[1].text;
    assert.match(b, lang === "en" ? /## Details settled earlier/ : /## 早先定下的细节/);
    assert.ok(b.includes("flat_chen.chess_set = " + value), b);
    if (lang === "en") for (const line of later.user.split("\n").filter((l) => l.startsWith("#"))) assert.ok(!HAN.test(line), line);
    // 住户看不到 GM 的推测
    const cp = P.characterPrompt(st, "chen", { to: "chen", input: "x", turnEvents: [] });
    assert.ok(!(cp.system + cp.user).includes(lang === "en" ? "Takes time with the elderly" : "对老人有耐心"));
  }
});

test("住户的历史里（不只是这一轮）：别人家定的细节、她不在时定的细节、她来之前玩家说的话都没有；她在场的事有", () => {
  const s = atChens("zh"), st = s.state;
  // 陈阿姨还在自己家、还没来 Aisyah 家做客时，玩家在 Aisyah 家（第一天上午 Aisyah 和 Mak Esah 在家）自言自语、GM 定了 Aisyah 家的一个细节
  Object.assign(st.actors.player, { map: "flat_aisyah", x: 5, y: 4 });
  assert.ok(B.free(st, "flat_aisyah", 6, 4), "陈阿姨待会儿要站的 (6,4) 得空着");
  const early = H.applyOp(st, { op: "player_say", text: "这里好安静啊" }, { by: "ui" }).event;
  const awayFact = H.applyOp(st, { op: "establish_fact", subject: "flat_aisyah", key: "door_paint", value: "刚刷的绿漆" }, { by: "gm" });
  assert.equal(awayFact.ok, true);
  assert.ok(early.perceivedBy.includes("aisyah_kassim") && awayFact.event.perceivedBy.includes("aisyah_kassim"));
  // 她来做客以后：玩家跟她打招呼；GM 当着她的面定了林家屋里的一个细节（她在场也不该知道别人家里的事）
  Object.assign(st.actors.chen, { map: "flat_aisyah", x: 6, y: 4 });
  const seenByHer = H.applyOp(st, { op: "player_say", text: "阿姨早", to: "chen" }, { by: "ui" }).event;
  const otherFact = H.applyOp(st, { op: "establish_fact", subject: "flat_lin", key: "tv", value: "一台新的彩色电视" }, { by: "gm" });
  assert.equal(otherFact.ok, true);
  assert.ok(!early.perceivedBy.includes("chen") && !awayFact.event.perceivedBy.includes("chen") && !otherFact.event.perceivedBy.includes("chen"));
  st.turn += 1;
  const cp = P.characterPrompt(st, "chen", { to: "chen", input: "x", turnEvents: [] });
  const all = cp.system + cp.user;
  assert.ok(cp.seen.events.includes(seenByHer.id), "她在场的事应该在历史里");
  assert.ok(all.includes("阿姨早"));
  assert.ok(!all.includes("这里好安静"), "她来之前玩家说的话漏进了历史");
  assert.ok(!all.includes("刚刷的绿漆"), "她不在时定的细节漏进了历史");
  assert.ok(!cp.seen.events.includes(early.id) && !cp.seen.events.includes(awayFact.event.id));
  assert.ok(!all.includes("一台新的彩色电视"), "别人家的细节漏进了历史");
  assert.ok(!cp.seen.events.includes(otherFact.event.id));
  for (const eid of cp.seen.events) assert.ok(st.events.find((e) => e.id === eid).perceivedBy.includes("chen"), eid);
});

test("「各家现在」只给 GM：在地图后面、最后那块不缓存的里面；住户的提示词里没有这一块，也没有别人家的人这会儿在哪", async () => {
  for (const lang of ["zh", "en"]) {
    const T = (zh, en) => (lang === "en" ? en : zh);
    const s = atChens(lang), st = s.state, year = st.time.year;
    const { gm, chen } = await rounds(s, steady(lang), LINES[lang].slice(0, 2));
    assert.equal(gm.length, 2);
    assert.equal(chen.length, 2);
    const HEAD = T("各家现在", "The homes right now");
    // 第一天上午：林家三口都出门了，Kumar 在楼里干活，Mei 家还没搬来
    for (const id of ["weiming", "huiling", "junhao", "kumar"]) assert.equal(st.actors[id].map, null, id);
    assert.equal(st.actors.weiming.activity, D.PLACES.away[lang]);
    assert.equal(st.actors.kumar.activity, D.PLACES.working[lang]);
    // 不在任何一张图上的人，「各家现在」里写成「名字 去处」
    const whereabouts = (id) => P.nameOf(st, id) + T(" ", ": ") + st.actors[id].activity;
    const offMap = W.charactersAt(year).filter((id) => !st.actors[id].map);
    assert.ok(offMap.length >= 4, offMap.join(","));
    const [ex, ey] = M.entryOf("flat_chen");
    for (const c of gm) {
      const last = c.parts[c.parts.length - 1];
      assert.equal(last.cache, undefined);
      assert.ok(last.text.includes(HEAD), `${c.label}: 最后一块里没有「各家现在」`);
      // 只在最后这一块里：缓存的块（住户、今天、历史）里都没有，每轮变的东西不会把缓存弄断
      for (const p of c.parts.slice(0, -1)) assert.ok(!p.text.includes(HEAD), `${c.label}: 「各家现在」出现在前面的块里${p.cache ? "（缓存的）" : ""}`);
      assert.ok(last.text.indexOf(T("## 地图", "## Map")) < last.text.indexOf(HEAD), "「各家现在」应该在地图后面");
      const block = last.text.slice(last.text.indexOf(HEAD)).split("\n## ")[0];
      const line = (map) => block.split("\n").find((l) => l.startsWith(`- ${map}`)) || "";
      assert.ok(line("flat_chen").includes(P.nameOf(st, "chen")), block);
      assert.ok(line("flat_chen").includes(T(`进门处 (${ex},${ey})`, `inside the door (${ex},${ey})`)), block);
      assert.ok(line("flat_chen").includes(T("← 玩家在这里", "<- the player is here")), block);
      assert.ok(!line("flat_lin").includes(T("玩家在这里", "the player is here")), block);
      assert.ok(line("flat_lin").includes(T("没人在家", "nobody home")), block);
      for (const id of ["weiming", "huiling", "junhao"]) assert.ok(line("flat_lin").includes(whereabouts(id)), `${id}: ${block}`);
      assert.ok(line("dorm").includes(whereabouts("kumar")), block);
      assert.ok(line("flat_mei").includes(T("还没搬来", "not moved in yet")), block);
      for (const id of offMap) assert.ok(block.includes(whereabouts(id)), `${id}: ${block}`);
      if (lang === "en") assert.ok(!HAN.test(block), block);
    }
    // 住户：这一轮真发出去的陈阿姨的提示词，加上今年每个住户（在家的、出门的）的提示词
    const prompts = chen.map((c) => ({ id: "chen", text: c.system + "\n" + c.user }))
      .concat(W.charactersAt(year).map((id) => { const cp = P.characterPrompt(st, id, { to: "chen", input: "x", turnEvents: [] }); return { id, text: cp.system + "\n" + cp.user }; }));
    for (const { id, text } of prompts) {
      for (const w of [HEAD, T("进门处", "inside the door"), T("还没搬来", "not moved in yet"), T("玩家在这里", "the player is here"), T("不在家的", "away:"), T("没人在家", "nobody home")]) assert.ok(!text.includes(w), `${id} 的提示词里有「${w}」`);
      for (const o of offMap.filter((o) => W.householdOf(o) !== W.householdOf(id))) assert.ok(!text.includes(whereabouts(o)), `${id} 的提示词里有别人家的 ${o} 在哪：${whereabouts(o)}`);
    }
    // 陈阿姨的提示词里根本不提谁出门了、谁在楼里干活
    for (const { text } of prompts.filter((x) => x.id === "chen")) for (const w of [D.PLACES.away[lang], D.PLACES.working[lang]].filter((w) => lang !== "en" || w !== "out")) assert.ok(!text.includes(w), `陈阿姨的提示词里有「${w}」`);
  }
});

// ---------------- 发给 Anthropic 的样子 ----------------
test("Anthropic 请求：系统提示和提示词里标了的块带缓存标记，一共不超过 4 个；对不上就退回一整块", () => {
  const parts = [{ text: "A\n", cache: true }, { text: "B\n", cache: true }, { text: "h\n" }, { text: "r1\n" }, { text: "r2\n", cache: true }, { text: "tail" }];
  const user = parts.map((p) => p.text).join("");
  const body = LLM.anthropicBody({}, "sys", user, parts);
  assert.deepEqual(body.system, [{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }]);
  const blocks = body.messages[0].content;
  assert.deepEqual(blocks.map((b) => b.text), texts(parts));
  assert.deepEqual(blocks.map((b) => !!b.cache_control), [true, true, false, false, true, false]);
  assert.equal(body.model, LLM.PRESETS.anthropic.model);
  // 标了太多：只取前三个（加上系统提示一共 4 个，是接口的上限）
  const many = Array.from({ length: 6 }, (_, i) => ({ text: i + "\n", cache: true }));
  const mb = LLM.userBlocks(many.map((p) => p.text).join(""), many);
  assert.equal(mb.filter((b) => b.cache_control).length, 3);
  // 退回重试时提示词后面多了一段说明：说明单独一块，不带缓存，前面的块不变
  const retry = LLM.userBlocks(user + "\n\n上一次的输出有问题", parts);
  assert.deepEqual(retry.slice(0, parts.length).map((b) => b.text), texts(parts));
  assert.equal(retry[retry.length - 1].text, "\n\n上一次的输出有问题");
  assert.equal(retry[retry.length - 1].cache_control, undefined);
  // 提示词和分块对不上（被别处改过）：老老实实发一整块
  assert.deepEqual(LLM.userBlocks("别的内容", parts), [{ type: "text", text: "别的内容" }]);
  assert.deepEqual(LLM.userBlocks("x", null), [{ type: "text", text: "x" }]);
  assert.deepEqual(LLM.userBlocks("x", []), [{ type: "text", text: "x" }]);
});

test("一整轮发出去的 Anthropic 请求：每次都能拆成块，缓存标记不超过 4 个", async () => {
  const s = atChens("zh");
  const llm = steady("zh");
  await rounds(s, llm, LINES.zh.slice(0, 2));
  for (const c of llm.calls) {
    const body = LLM.anthropicBody({}, c.system, c.user, c.parts);
    const n = body.system.filter((b) => b.cache_control).length + body.messages[0].content.filter((b) => b.cache_control).length;
    assert.ok(n >= 1 && n <= 4, `${c.label}: ${n}`);
    assert.equal(body.messages[0].content.map((b) => b.text).join(""), c.user);
  }
});

// ---------------- 用量里的缓存 ----------------
test("用量：分开记缓存读和写；合计只拿报了准确数的调用算缓存比例", () => {
  const mk = (usage, exact) => ({ label: "x", tokens: Object.assign({ input: usage.input, output: 1, exact, cached: usage.cached || 0, written: usage.written || 0, est: { input: usage.input, output: 1 }, used: 0 }) });
  const u = Tok.sum([mk({ input: 1000, cached: 800, written: 100 }, true), mk({ input: 500, cached: 0, written: 400 }, true), mk({ input: 300 }, false)]);
  assert.equal(u.cached, 800);
  assert.equal(u.written, 500);
  assert.equal(u.exactInput, 1500);
  const k = Tok.forCall({ system: "s", user: "u", text: "{}", meta: { provider: "anthropic", model: "claude-sonnet-5-5", usage: { input_tokens: 50, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 } } });
  assert.equal(k.input, 1000);
  assert.equal(k.cached, 900);
  assert.equal(k.written, 50);
});
