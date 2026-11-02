const test = require("node:test");
const assert = require("node:assert/strict");
const { W, M, H, API, B, D, P, Mock, Turn } = require("./load");

const key = (x, y) => x + "," + y;

// 从第一个日子开局；id 给了就直接跳到那个日子
function game(dayId) {
  const s = API.createSession({ lang: "zh" });
  D.begin(s.state);
  if (dayId) assert.ok(D.startDay(s.state, dayId).ok);
  return s;
}
// 把玩家放到某人旁边
function nextTo(state, id) {
  const a = state.actors[id];
  for (const [dx, dy] of B.DIRS) {
    if (B.free(state, a.map, a.x + dx, a.y + dy, "player") && !B.exitAt(a.map, a.x + dx, a.y + dy)) {
      Object.assign(state.actors.player, { map: a.map, x: a.x + dx, y: a.y + dy });
      return;
    }
  }
  throw new Error("没有空位：" + id);
}
// 假模型：按角色返回写好的输出，记下每次调用
function fake(byRole) {
  const calls = [];
  const fn = async (call) => {
    calls.push(call);
    const f = byRole[call.role];
    const body = typeof f === "function" ? f(call.ctx, calls) : f;
    return { text: typeof body === "string" ? body : JSON.stringify(body), meta: { model: "fake" } };
  };
  fn.calls = calls;
  return fn;
}

// ---------------- 棋盘 ----------------
test("固定家具都摆在空地上：不压墙、门和地块，一格只放一件", () => {
  for (const [map, list] of Object.entries(M.FURNITURE)) {
    const seen = new Set();
    for (const [kind, x, y] of list) {
      assert.ok(M.PROPS[kind], `${map} 里有未知的家具 ${kind}`);
      assert.ok(M.placeable(map, x, y) && !M.isPlot(map, x, y), `${map} 的 ${kind} 在 (${x},${y})，不是空地`);
      assert.ok(!seen.has(key(x, y)), `${map} (${x},${y}) 放了两件`);
      seen.add(key(x, y));
    }
  }
});

// 每张图（加上每个日子临时摆的东西）能走的格子连成一片，每扇门旁边都站得到
function checkConnected(state, map) {
  const cells = [];
  const m = M.MAPS[map];
  m.rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (M.standable(map, x, y) && !B.furnitureAt(state, map, x, y) && !B.exitAt(map, x, y)) cells.push([x, y]); });
  const all = new Set(cells.map(([x, y]) => key(x, y)));
  const seen = new Set([key(...cells[0])]);
  const queue = [cells[0]];
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of B.DIRS) { const k = key(x + dx, y + dy); if (all.has(k) && !seen.has(k)) { seen.add(k); queue.push([x + dx, y + dy]); } }
  }
  assert.equal(seen.size, all.size, `${map}${state.day ? "（" + state.day.id + "）" : ""} 有走不到的格子`);
  // 一扇门可以占好几格（电梯），有一格走得到就行
  const reach = {};
  m.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ex = B.exitAt(map, x, y);
      if (ex) reach[ex.char] = reach[ex.char] || B.DIRS.some(([dx, dy]) => seen.has(key(x + dx, y + dy)));
    }
  });
  for (const [c, ok] of Object.entries(reach)) assert.ok(ok, `${map} 的门 ${c} 旁边站不到人`);
  for (const ex of Object.values(m.exits)) assert.ok(M.standable(ex.to, ex.at[0], ex.at[1]), `${map} → ${ex.to} 的落脚点站不了人`);
}
test("每张图能走的格子连成一片，每个日子摆出来的东西也不挡路", () => {
  const s = game();
  for (const map of Object.keys(M.MAPS)) checkConnected(s.state, map);
  for (const day of D.daysOf(1).slice(1)) {
    D.startDay(s.state, day.id);
    for (const map of Object.keys(s.state.day_props)) checkConnected(s.state, map);
  }
});

test("日子：都在第一个十年里、按时间往后排，平日都是星期一到五", () => {
  const days = D.daysOf(1);
  assert.ok(days.length >= 6 && days.length <= 8);
  let last = 0;
  for (const d of days) {
    const t = d.date;
    assert.ok(t.year >= 1989 && t.year <= 1998, d.id);
    const k = (t.year * 12 + t.month) * 31 + t.day;
    assert.ok(k > last, d.id + " 没有按时间排");
    last = k;
    const wd = new Date(t.year, t.month - 1, t.day).getDay();
    if (d.kind === "work") assert.ok(wd >= 1 && wd <= 5, d.id + " 是平日，日期却是周末");
    assert.ok(d.gm.zh && d.title.zh, d.id);
  }
});

test("每个日子的每个时段：人都站在能站的格子上，没有两个人占同一格", () => {
  const s = game(), state = s.state;
  for (const day of D.daysOf(1)) {
    if (state.day.id !== day.id) D.startDay(state, day.id);
    for (;;) {
      const taken = new Set();
      for (const a of Object.values(state.actors)) {
        if (!a.map) continue;
        if (a.kind === "resident" && !W.characterPresent(a.id, state.time.year)) continue;
        assert.ok(M.standable(a.map, a.x, a.y) && !B.furnitureAt(state, a.map, a.x, a.y), `${day.id} ${a.id} 站在 ${a.map} (${a.x},${a.y})`);
        const k = a.map + key(a.x, a.y);
        assert.ok(!taken.has(k), `${day.id} 时段 ${state.time.slot}：${a.id} 和别人站在同一格`);
        taken.add(k);
      }
      for (const id of W.charactersAt(state.time.year)) {
        const place = D.placeFor(day, id, state.time.slot);
        assert.equal(!!state.actors[id].map, place !== "away", `${day.id} 时段 ${state.time.slot}：${id} 应该在 ${place}`);
      }
      if (!D.wait(state).ok) break;
    }
    assert.equal(state.time.slot, D.LAST_SLOT);
  }
});

test("等一会儿：到晚上就不能再等，要换日子；最后一个日子之后没有下一个", () => {
  const s = game(), state = s.state;
  const day = state.time.day;
  while (D.wait(state).ok);
  assert.equal(state.time.day, day);
  assert.deepEqual(D.wait(state), { ok: false, endOfDay: true });
  D.startDay(state, D.daysOf(1).slice(-1)[0].id);
  assert.equal(D.nextDay(state), null);
});

test("门：还没搬来的人家进不去，家里没人也进不去", () => {
  const s = game(), state = s.state;
  const mei = { to: "flat_mei" }, lin = { to: "flat_lin" };
  assert.equal(B.exitOpen(state, mei).ok, false);
  for (const a of Object.values(state.actors)) if (a.map === "flat_lin") Object.assign(a, { map: null, x: null, y: null });
  assert.equal(B.exitOpen(state, lin).ok, false);
  assert.match(B.exitOpen(state, lin).reason.zh, /没人在家/);
  assert.equal(B.exitOpen(state, { to: "dorm" }).ok, true);
});

test("走路：找路绕开墙和家具，点到人就走到他旁边，踩到门就换图", () => {
  const s = game(), state = s.state;
  const route = B.path(state, "office", [3, 2], [2, 5]);
  assert.ok(route && route.length);
  for (const [x, y] of route) assert.equal(B.moveTo(state, x, y).ok, true);
  assert.equal(state.actors.player.map, "void_deck");
  const someone = B.nearby(state)[0];
  assert.ok(someone, "上任第一天的上午楼下有人");
  const a = state.actors[someone], p = state.actors.player;
  const r2 = B.path(state, p.map, [p.x, p.y], [a.x, a.y]);
  for (const [x, y] of r2) B.moveTo(state, x, y);
  assert.ok(B.adjacent(state).includes(someone));
});

// ---------------- 提示词隔离 ----------------
function promptOf(state, id) { const p = P.characterPrompt(state, id, { input: "你好", identity: P.DEFAULT_IDENTITY, turnEvents: [] }); return p.system + "\n" + p.user; }
function at(year) {
  const s = game();
  if (year > 1989) assert.ok(H.applyOp(s.state, { op: "jump_time", year, month: 6, day: 1, slot: 1 }, { by: "system" }).ok);
  return s.state;
}
test("住户的提示词：只有自己知道的事，没有以后才发生的事", () => {
  const y89 = at(1989), y95 = at(1995), y97 = at(1997);
  const y98 = game("d1998_spring").state;
  // 伟明 1998 年被裁：他自己那年才知道，慧玲一直不知道
  assert.ok(!promptOf(y89, "weiming").includes("被裁员"));
  assert.ok(promptOf(y98, "weiming").includes("被裁员"));
  assert.ok(!promptOf(y98, "huiling").includes("被裁员"));
  // 那一天给 GM 的背景（伟明年初被裁）不给住户
  assert.ok(P.gmPrompt(y98, { input: "你好", identity: P.DEFAULT_IDENTITY }).system.length > 0);
  assert.ok((p => p.system + p.user)(P.gmPrompt(y98, { input: "你好", identity: P.DEFAULT_IDENTITY })).includes("伟明年初被裁"));
  for (const id of ["huiling", "jianguo", "wangmei"]) assert.ok(!promptOf(y98, id).includes("伟明年初被裁"), id);
  // 慧玲推掉香港的事：1996 年以后她自己知道，伟明不知道
  assert.ok(!promptOf(y89, "huiling").includes("香港分行"));
  assert.ok(promptOf(y97, "huiling").includes("香港分行"));
  assert.ok(!promptOf(y97, "weiming").includes("香港分行"));
  // 1964 年的事：只有陈阿姨和 Mak Esah 知道
  assert.ok(promptOf(y89, "mak_esah").includes("藏在家里"));
  assert.ok(promptOf(y89, "chen").includes("藏在家里"));
  for (const id of ["rahman", "aisyah_kassim", "nurul", "kumar"]) assert.ok(!promptOf(y89, id).includes("藏在家里"), id);
  // 王美洗碗：1994 年以后 Aisyah 和 Kumar 看见过，林家不知道
  assert.ok(!promptOf(y89, "aisyah_kassim").includes("洗碗"));
  assert.ok(promptOf(y95, "aisyah_kassim").includes("洗碗"));
  assert.ok(promptOf(y95, "kumar").includes("洗碗"));
  for (const id of ["weiming", "huiling", "rahman"]) assert.ok(!promptOf(y95, id).includes("洗碗"), id);
});

test("住户不知道自己的以后：1989 到 2018 年每一年，提示词里都没有比今年晚的年份", () => {
  const s = game(), state = s.state;
  for (let year = 1989; year <= 2018; year++) {
    while (state.decade < W.decadeOfYear(year)) API.advanceDecade(s);
    if (year > state.time.year) assert.ok(H.applyOp(state, { op: "jump_time", year, month: 6, day: 1, slot: 1 }, { by: "system" }).ok);
    for (const id of W.charactersAt(year)) {
      if (!W.canTalk(id, year)) continue;
      const later = (promptOf(state, id).match(/(19|20)\d\d/g) || []).map(Number).filter((y) => y > year);
      assert.deepEqual(later, [], `${year} 年 ${id} 的提示词里出现了以后的年份`);
    }
  }
});

test("住户不知道自己的以后：没写年份的以后的事也按年份给", () => {
  const y89 = at(1989), y95 = at(1995);
  // Kumar 的女儿 1990 年才出生，Shohel 1995 年才来
  assert.ok(!promptOf(y89, "kumar").includes("Priya") && !promptOf(y89, "kumar").includes("Shohel"));
  assert.ok(promptOf(y95, "kumar").includes("Priya") && promptOf(y95, "kumar").includes("Shohel"));
  // 俊豪跟 Kumar 学补车胎是上小学以后的事
  for (const id of ["kumar", "huiling", "weiming"]) assert.ok(!promptOf(y89, id).includes("补车胎"), id);
  assert.ok(promptOf(y95, "kumar").includes("补车胎"));
  // Kumar 的女儿 1990 年才出生：1989 年他心里还没有"女儿"
  assert.ok(!promptOf(y89, "kumar").includes("女儿"));
  assert.ok(promptOf(y95, "kumar").includes("女儿"));
  // 王美和晓雨以后才有的变化（没写年份的"二三十年后""慢慢地"）
  for (const t of ["二三十年后", "如今新加坡熟了", "慢慢有人专门来请教华文"]) assert.ok(!promptOf(y95, "wangmei").includes(t), t);
  assert.ok(!promptOf(y95, "xiaoyu").includes("慢慢地两边"));
  // 孩子用自己的说话方式，不用大人的
  assert.match(promptOf(y95, "junhao"), /你说话的样子：小孩子的新加坡英语/);
  assert.match(promptOf(y95, "xiaoyu"), /你说话的样子：在家说普通话/);
  // GM 拿到的也是到今年为止的
  const gm = (st) => { const p = P.gmPrompt(st, { input: "你好", identity: P.DEFAULT_IDENTITY }); return p.system + p.user; };
  assert.ok(!gm(y89).includes("Shohel（1972 年生）加入"));
  // 设定门照样认得以后才会写进来的段落
  assert.ok(H.leakCheck(y89, "1995 年孟加拉来的工友 Shohel（1972 年生）加入"));
});

test("玩家的身份写进提示词；自定义的身份替换默认的", () => {
  const s = game();
  const me = { name: "Siti", gender: "女", ethnicity: "马来人", born: 1966, languages: "马来语、英语", about: "在芽笼士乃长大" };
  const p = P.characterPrompt(s.state, "chen", { input: "你好", identity: me, turnEvents: [] });
  const text = p.system + p.user;
  assert.ok(text.includes("Siti") && text.includes("23 岁") && text.includes("芽笼士乃"));
  assert.ok(!text.includes("何志强"));
  assert.match(P.identityText(s.state, null), /何志强，24 岁/);
});

// ---------------- 一轮 ----------------
test("GM 不能换日子；推进时间不跨过今天", async () => {
  const s = game(), state = s.state;
  const llm = fake({ gm: (ctx) => (ctx.retry ? { ops: [] } : { ops: [{ op: "jump_time", year: 1990, month: 1, day: 1, slot: 1 }, { op: "advance_time", slots: 12 }], responders: [] }) });
  const res = await Turn.playerTurn(s, "我把今天的表格整理完", { llm });
  assert.equal(state.time.year, 1989);
  assert.equal(state.time.day, 6);
  assert.equal(state.time.slot, D.LAST_SLOT);
  const r = res.calls[0].results;
  assert.equal(r[0].ok, false);
  assert.match(r[0].reason, /GM 不能跳/);
  assert.equal(r[1].ok, true);
});

test("花政策点的行动：玩家不确认就不做；确认了才扣点，并报给游戏端", async () => {
  const s = game(), state = s.state;
  Object.assign(state.actors.chen, { map: "void_deck", x: 6, y: 4 });
  nextTo(state, "chen");
  const gmOut = { ops: [{ op: "community_action", residents: ["chen"], need: "🪑", description: "帮陈阿姨把矮凳搬到树荫下" }, { op: "advance_time", slots: 1 }], responders: ["chen"] };
  const llm = fake({ gm: gmOut, character: { speak: "唔该晒。", act: "" } });
  const no = await Turn.playerTurn(s, "我想帮陈阿姨把凳子搬到树荫下", { llm, to: "gm", confirmSpend: async () => false });
  assert.equal(state.game.points, 3);
  assert.ok(no.items.some((e) => e.summary === "你想了想，这次没有去做。"));
  const yes = await Turn.playerTurn(s, "我想帮陈阿姨把凳子搬到树荫下", { llm, to: "gm", confirmSpend: async () => true });
  assert.equal(state.game.points, 2);
  assert.equal(s.sim.points, 2);
  // 先做事，再过时间，最后住户回应
  const kinds = yes.items.map((e) => e.kind);
  assert.ok(kinds.indexOf("action") < kinds.lastIndexOf("time") && kinds.lastIndexOf("time") < kinds.indexOf("speech"), kinds.join(","));
});

test("住户的话过不了设定门：重写一次；还不过就不说，只留一句代码写的反应", async () => {
  const s = game(), state = s.state;
  nextTo(state, "chen");
  const leaky = { speak: "我心里的张力你不会懂。", act: "" };
  const llm = fake({ gm: { ops: [], responders: ["chen"] }, character: leaky });
  const res = await Turn.playerTurn(s, "阿姨好", { llm, focus: "chen" });
  assert.equal(llm.calls.filter((c) => c.role === "character").length, 2);
  assert.ok(!res.items.some((e) => e.kind === "speech"));
  assert.ok(res.items.some((e) => e.summary === "陈阿姨看了你一眼，没有说话。"));
  // 重写过了就用重写的
  let n = 0;
  const llm2 = fake({ gm: { ops: [], responders: ["chen"] }, character: () => (n++ ? { speak: "饮咗茶未？" } : leaky) });
  const res2 = await Turn.playerTurn(s, "阿姨好", { llm: llm2, focus: "chen" });
  assert.deepEqual(res2.items.filter((e) => e.kind === "speech").map((e) => e.summary), ["饮咗茶未？"]);
});

test("回应的人：要在同一张图、会说话，最多两个；GM 的输出解析不了时由对着的人回答", async () => {
  const s = game("d1990_cny"), state = s.state;
  const here = B.nearby(state).filter((id) => W.canTalk(id, 1990));
  assert.ok(here.length >= 1);
  const away = W.charactersAt(1990).find((id) => state.actors[id].map !== state.actors.player.map);
  assert.deepEqual(Turn.pickResponders(state, [away, "junhao", "nobody"], null), []);
  assert.ok(Turn.pickResponders(state, W.charactersAt(1990), null).length <= 2);
  nextTo(state, here[0]);
  const llm = fake({ gm: "我不会写 JSON", character: { speak: "早晨。" } });
  const res = await Turn.playerTurn(s, "早", { llm, focus: here[0] });
  assert.equal(llm.calls.filter((c) => c.role === "gm").length, 2);
  assert.ok(res.items.some((e) => e.kind === "speech" && e.actor === here[0]));
});

test("住户只能替自己说话：输出里的 npc 一律换成他自己", () => {
  const ops = Turn.characterOps({}, "chen", { speak: "好", reveal: { kind: "barrier", id: "📱" }, impression: { text: "x", evidence: ["E1"] } });
  for (const { op } of ops) if (op.npc) assert.equal(op.npc, "chen");
});

// ---------------- 离线演示 ----------------
test("离线演示：写好的台词都过得了设定门", () => {
  const state = at(1995);
  for (const [id, lines] of Object.entries(Mock.LINES)) {
    assert.ok(W.CHARACTERS[id], id);
    for (const l of lines) for (const t of [l.speak, l.act]) if (t) assert.equal(H.leakCheck(state, t), null, `${id}：${t}`);
  }
});

test("离线演示：八个日子从头走到尾，每天都能说上话，不出错", async () => {
  const s = game(), state = s.state;
  const llm = Mock.caller();
  for (;;) {
    let talked = 0;
    for (let slot = 0; slot < 3; slot++) {
      // 这个时段在楼里、会说话的人，走到他旁边
      const who = W.charactersAt(state.time.year).find((id) => state.actors[id].map && W.canTalk(id, state.time.year));
      if (who) {
        nextTo(state, who);
        const res = await Turn.playerTurn(s, slot === 1 ? "我想帮他搬东西" : "你好，最近怎么样？", { llm, focus: who, to: slot === 1 ? "gm" : who, confirmSpend: async () => true });
        talked += res.items.filter((e) => e.kind === "speech").length;
      }
      if (!D.wait(state).ok) break;
    }
    assert.ok(talked > 0, state.day.id + " 一整天没跟人说上话");
    const next = D.nextDay(state);
    if (!next) break;
    D.startDay(state, next.id);
  }
  assert.equal(state.day.id, "d1998_spring");
  assert.ok(state.events.filter((e) => e.kind === "speech").length >= 8);
  // 看着难懂的话都带着翻译
  for (const e of state.events.filter((x) => x.kind === "speech")) if (H.needsGloss(state, e.summary)) assert.ok(e.gloss, e.summary);
});
