// 10-29 试玩之后的修改：玩家的话分两路（对住户 / 对 GM），先操作后叙述（离场、动作、物件、配角），
// 住户只拿到自己所在环境和自己家的信息、能自己走动和离开，叙述和状态对不上时退回一次。
const test = require("node:test");
const assert = require("node:assert/strict");
const { W, M, H, API, B, D, P, Mock, Turn } = require("./load");

const HAN = /\p{Script=Han}/u;

function game(lang) {
  const s = API.createSession({ lang: lang || "zh" });
  D.begin(s.state);
  return s;
}
// 11-02 只剩各家：舞台是第一天上午的陈阿姨家（只有她住）。她在 (3,3)，固定家具旧象棋盘在 (5,3)、神台在 (1,1)；
// 门 R 在 (4,7)，门口只有 (4,6) 一格。玩家默认站在她旁边 (4,3)；FAR 是屋里离她最远的角落 (6,6)，旁边能站的只有 (5,6)
const FAR = [6, 6];
function atChens(lang, at) {
  const s = game(lang), st = s.state;
  Object.assign(st.actors.chen, { map: "flat_chen", x: 3, y: 3, activity: lang === "en" ? "sitting by the chessboard" : "坐在棋盘边" });
  Object.assign(st.actors.player, { map: "flat_chen", x: at ? at[0] : 4, y: at ? at[1] : 3 });
  return s;
}
// 陈阿姨去 Aisyah 家坐坐（她不在自己家，"你家"才另列一节）：Aisyah (4,4)、Mak Esah (7,4) 在家，陈阿姨在 (6,4)，玩家在 (9,4)，隔 3 格
function chenAtAisyahs(lang) {
  const s = game(lang), st = s.state;
  Object.assign(st.actors.chen, { map: "flat_aisyah", x: 6, y: 4, activity: lang === "en" ? "sitting with a cup of tea" : "坐着喝茶" });
  Object.assign(st.actors.player, { map: "flat_aisyah", x: 9, y: 4 });
  st.scene = { map: "flat_aisyah", props: [], weather: "" };
  return s;
}
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
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

// ---------------- 玩家的话分两路 ----------------
test("对 GM 说的话只有玩家知道：住户的视角、住户的提示词里都没有；GM 看得到", () => {
  const s = atChens(), st = s.state;
  const r = H.applyOp(st, { op: "player_say", text: "现在该做什么？", to: "gm" }, { by: "ui" });
  assert.equal(r.event.kind, "player_to_gm");
  assert.deepEqual(r.event.perceivedBy, ["player"]);
  const reply = H.applyOp(st, { op: "gm_reply", text: "可以先跟陈阿姨打个招呼。" }, { by: "gm" });
  assert.deepEqual(reply.event.perceivedBy, ["player"]);
  assert.ok(!H.getView(st, "chen").events.some((e) => e.id === r.event.id || e.id === reply.event.id));
  // 11-02 起历史只取上一轮为止的事件：先翻到下一轮，这两条也会出现在历史那一段里，一起检查
  st.turn += 1;
  const cp = P.characterPrompt(st, "chen", { toGM: true, input: "现在该做什么？", turnEvents: st.events.slice(-2) });
  assert.ok(!(cp.system + cp.user).includes("现在该做什么"));
  assert.ok(!(cp.system + cp.user).includes("打个招呼"));
  // 这一轮她什么都没看到：照实说，不把玩家的原话塞给她
  assert.match(cp.user, /这一轮你没看到、没听到什么新的事/);
  const gp = P.gmPrompt(st, { toGM: true, to: "gm", input: "现在该做什么？" });
  assert.match(gp.user, /玩家（对 GM，出戏）：现在该做什么？/);
  assert.match(gp.user, /GM（对玩家，出戏）：可以先跟陈阿姨打个招呼。/);
  assert.match(gp.user, /玩家对你（GM）说，玩家身份，住户听不到/);
  // gm_reply 也过设定门，只有 GM 能用
  assert.equal(H.applyOp(st, { op: "gm_reply", text: "她心里的张力很大。" }, { by: "gm" }).ok, false);
  assert.equal(H.applyOp(st, { op: "gm_reply", text: "好" }, { by: "character" }).ok, false);
});

test("对住户说的话记下是对谁说的；住户和 GM 的提示词里都写明", () => {
  const s = atChens(), st = s.state;
  const r = H.applyOp(st, { op: "player_say", text: "阿姨早", to: "chen" }, { by: "ui" });
  assert.equal(r.event.kind, "player_input");
  assert.equal(r.event.to, "chen");
  assert.ok(r.event.perceivedBy.includes("chen"));
  // 不在这张图上的人不算对象
  assert.equal(H.applyOp(st, { op: "player_say", text: "喂", to: "rahman" }, { by: "ui" }).event.to, undefined);
  const cp = P.characterPrompt(st, "chen", { addressee: "chen", input: "阿姨早", turnEvents: [r.event] });
  assert.match(cp.user, /玩家（对陈阿姨）：阿姨早/);
  const gp = P.gmPrompt(st, { to: "chen", input: "阿姨早" });
  assert.match(gp.user, /玩家对 chen（陈阿姨）说，角色说出口的话/);
});

test("对住户说话的这一轮，GM 不能替玩家花政策点、挪玩家、出戏回答；对 GM 说就可以", async () => {
  const s = atChens(), st = s.state;
  const gmOut = { ops: [{ op: "community_action", residents: ["chen"], need: "🪑", description: "帮陈阿姨搬凳子" }, { op: "move", x: 6, y: 4 }, { op: "gm_reply", text: "好的" }], responders: ["chen"] };
  const llm = fake({ gm: (ctx) => (ctx.retry ? { ops: [] } : gmOut), character: { speak: "唔该。" } });
  let asked = 0;
  const res = await Turn.playerTurn(s, "我帮你搬凳子吧", { llm, to: "chen", confirmSpend: async () => { asked++; return true; } });
  assert.equal(asked, 0);
  assert.equal(st.game.points, 3);
  assert.deepEqual([st.actors.player.x, st.actors.player.y], [4, 3]);
  const r = res.calls[0].results;
  assert.ok(r.every((x) => !x.ok && /对住户说的话/.test(x.reason)), JSON.stringify(r));
  assert.ok(!res.items.some((e) => e.kind === "gm_reply"));
  // 同样的输出，对 GM 说
  const res2 = await Turn.playerTurn(s, "我想帮陈阿姨把凳子搬到窗边", { llm, to: "gm", confirmSpend: async () => { asked++; return true; } });
  assert.equal(asked, 1);
  assert.equal(st.game.points, 2);
  assert.deepEqual([st.actors.player.x, st.actors.player.y], [6, 4]);
  assert.ok(res2.items.some((e) => e.kind === "gm_reply"));
  assert.ok(res2.items.some((e) => e.kind === "player_to_gm"));
});

test("对 GM 说了话，GM 却什么都没给玩家看：补一句出戏的回音", async () => {
  const s = atChens(), st = s.state;
  const llm = fake({ gm: "不是 JSON" });
  const res = await Turn.playerTurn(s, "我想去七楼看看", { llm, to: "gm" });
  assert.ok(res.items.some((e) => e.kind === "gm_reply" && /没听明白/.test(e.summary)));
  // 没有住户被叫来回答（玩家没对他们说话）
  assert.ok(!res.calls.some((c) => c.role === "character"));
});

test("离线演示：对 GM 说的话，看看四周和帮忙照做，其他的出戏回一句", async () => {
  for (const lang of ["zh", "en"]) {
    const s = atChens(lang), st = s.state;
    const res = await Turn.playerTurn(s, lang === "en" ? "What should I do now?" : "现在该做什么？", { llm: Mock.caller(), to: "gm" });
    assert.ok(res.items.some((e) => e.kind === "gm_reply"), lang);
    if (lang === "en") for (const e of res.items) assert.ok(!HAN.test(e.summary), e.summary);
    // 对住户说“帮忙”不会花政策点
    await Turn.playerTurn(s, lang === "en" ? "Let me help you carry that" : "我帮你搬东西吧", { llm: Mock.caller(), to: "chen", confirmSpend: async () => true });
    assert.equal(st.game.points, 3, lang);
  }
});

// ---------------- 先操作，后叙述 ----------------
test("leave：住户离开地图，去处记在 activity，在场的人看到他走了；配角也能走", () => {
  const s = atChens(), st = s.state;
  const r = H.applyOp(st, { op: "leave", actor: "chen", to: "去巴刹" }, { by: "gm" });
  assert.ok(r.ok);
  assert.equal(st.actors.chen.map, null);
  assert.equal(st.actors.chen.activity, "去巴刹");
  assert.equal(r.event.kind, "world");
  assert.equal(r.event.summary, "陈阿姨离开了（去巴刹）");
  assert.ok(r.event.perceivedBy.includes("player") && r.event.perceivedBy.includes("chen"));
  assert.equal(H.applyOp(st, { op: "leave", actor: "chen", to: "下楼" }, { by: "gm" }).ok, false);
  const g = H.applyOp(st, { op: "extras", label: "老伯", count: 3, x: 4, y: 2 }, { by: "gm" }).extras;
  // 住户不能替配角做主
  assert.equal(H.applyOp(st, { op: "leave", actor: g.id, to: "回家" }, { by: "character" }).ok, false);
  const e = H.applyOp(st, { op: "leave", actor: g.id, to: "回家" }, { by: "gm" });
  assert.equal(e.event.summary, "老伯 ×3离开了（回家）");
  assert.equal(H.extrasOn(st, "flat_chen").length, 0);
});

test("set_activity、place_prop、remove_prop：改动作不用重摆场景；固定家具拿不走", () => {
  const s = atChens(), st = s.state;
  assert.ok(H.applyOp(st, { op: "set_activity", actor: "chen", activity: "收拾棋盘" }, { by: "gm" }).ok);
  assert.equal(st.actors.chen.activity, "收拾棋盘");
  assert.equal(H.applyOp(st, { op: "set_activity", actor: "chen", activity: "心里的张力" }, { by: "gm" }).ok, false);
  assert.ok(H.applyOp(st, { op: "place_prop", kind: "kopi_cup", x: 2, y: 3 }, { by: "gm" }).ok);
  assert.ok(st.scene.props.some((p) => p.kind === "kopi_cup" && p.x === 2));
  // 压着家具（旧象棋盘 (5,3)）、不允许的物件（皮沙发只在林家）、站着人的格子（陈阿姨 (3,3)）都不行
  assert.match(H.applyOp(st, { op: "place_prop", kind: "flyer", x: 5, y: 3 }, { by: "gm" }).reason, /已经有东西了/);
  assert.match(H.applyOp(st, { op: "place_prop", kind: "sofa", x: 2, y: 2 }, { by: "gm" }).reason, /不能出现在/);
  assert.match(H.applyOp(st, { op: "place_prop", kind: "flyer", x: 3, y: 3 }, { by: "gm" }).reason, /已经有东西了/);
  assert.ok(H.applyOp(st, { op: "remove_prop", kind: "kopi_cup" }, { by: "gm" }).ok);
  assert.ok(!st.scene.props.some((p) => p.kind === "kopi_cup"));
  assert.match(H.applyOp(st, { op: "remove_prop", kind: "chess_board" }, { by: "gm" }).reason, /固定家具不能拿走/);
  assert.match(H.applyOp(st, { op: "remove_prop", kind: "tv" }, { by: "gm" }).reason, /这里没有/);
});

test("无名配角：上地图占格子，能改人数和位置；一张图最多 4 组；不能站在家具上", () => {
  const s = atChens(), st = s.state;
  const g = H.applyOp(st, { op: "extras", label: "老伯", count: 3, x: 4, y: 2, activity: "围着看棋" }, { by: "gm" }).extras;
  assert.equal(g.id, "x1");
  assert.ok(B.extrasAt(st, "flat_chen", 4, 2));
  assert.equal(B.free(st, "flat_chen", 4, 2), false);
  assert.match(H.applyOp(st, { op: "move", actor: "chen", x: 4, y: 2 }, { by: "gm" }).reason, /已经有人了/);
  assert.ok(H.applyOp(st, { op: "extras", id: "x1", label: "老伯", count: 2, x: 5, y: 2 }, { by: "gm" }).ok);
  assert.equal(H.extrasOn(st, "flat_chen").length, 1);
  assert.equal(H.extrasName(st, H.extrasOn(st, "flat_chen")[0]), "老伯 ×2");
  assert.match(H.applyOp(st, { op: "extras", label: "邻居", x: 5, y: 3 }, { by: "gm" }).reason, /有家具/);
  assert.match(H.applyOp(st, { op: "extras", label: "邻居", count: 12, x: 2, y: 2 }, { by: "gm" }).reason, /1–9/);
  assert.match(H.applyOp(st, { op: "extras", id: "chen", label: "邻居", x: 2, y: 2 }, { by: "gm" }).reason, /id/);
  for (const x of [2, 4, 5]) assert.ok(H.applyOp(st, { op: "extras", label: "邻居", x, y: 1 }, { by: "gm" }).ok);
  assert.match(H.applyOp(st, { op: "extras", label: "邻居", x: 1, y: 2 }, { by: "gm" }).reason, /最多 4 组/);
  // GM 和玩家都看得到
  assert.match(P.gmPrompt(st, { input: "x" }).user, /x1（老伯 ×2，无名配角）在 \(5,2\)/);
  assert.equal(H.getView(st, "player").extras.length, 4);
  // 换一天就清掉
  D.startDay(st, D.daysOf(1)[1].id);
  assert.equal(st.extras.length, 0);
});

test("家具上不能站人：GM 摆场景、挪人都不行；住户自己只能在所在的图上走", () => {
  const s = atChens(), st = s.state;
  assert.match(H.applyOp(st, { op: "move", actor: "chen", x: 5, y: 3 }, { by: "gm" }).reason, /有家具/);
  assert.ok(H.applyOp(st, { op: "move", actor: "chen", x: 2, y: 3 }, { by: "character" }).ok);
  assert.match(H.applyOp(st, { op: "move", actor: "chen", map: "flat_lin", x: 2, y: 3 }, { by: "character" }).reason, /只能在自己所在的地图上走动/);
});

test("narrate 的 noticed_by：只有写到的人注意到；写不在场的人就退回", () => {
  const s = atChens(), st = s.state;
  Object.assign(st.actors.kumar, { map: "flat_chen", x: 6, y: 2 });
  const r = H.applyOp(st, { op: "narrate", text: "你悄悄把传单塞进口袋。", noticed_by: [] }, { by: "gm" });
  assert.deepEqual(r.event.perceivedBy, ["player"]);
  const r2 = H.applyOp(st, { op: "narrate", text: "你朝陈阿姨点了点头。", noticed_by: ["chen"] }, { by: "gm" });
  assert.deepEqual(r2.event.perceivedBy, ["player", "chen"]);
  assert.ok(!H.getView(st, "kumar").events.some((e) => e.id === r2.event.id));
  assert.match(H.applyOp(st, { op: "narrate", text: "x", noticed_by: ["rahman"] }, { by: "gm" }).reason, /noticed_by/);
  // 不写就是这张图上的人都看到
  const r3 = H.applyOp(st, { op: "narrate", text: "风把传单吹得哗哗响。" }, { by: "gm" });
  assert.ok(r3.event.perceivedBy.includes("kumar"));
});

// ---------------- 住户只拿到自己所在环境和自己家 ----------------
test("住户的场景：这张图的家具、物件、人和配角的位置、和玩家隔几格；自己家的布置；别人家和秘密都没有", () => {
  // 她在 Aisyah 家做客：这里是 Aisyah 家，你家是陈阿姨家，别人家是林家
  const s = chenAtAisyahs("zh"), st = s.state;
  st.actors.aisyah_kassim.activity = "摆糕";
  assert.ok(H.applyOp(st, { op: "extras", label: "亲戚", count: 3, x: 4, y: 2, activity: "围着吃糕" }, { by: "gm" }).ok);
  assert.ok(H.applyOp(st, { op: "place_prop", kind: "kopi_cup", x: 5, y: 3 }, { by: "gm" }).ok);
  // 她在场时定下的细节给她；别人家的细节、她不在场时定下的不给
  H.applyOp(st, { op: "establish_fact", subject: "flat_aisyah", key: "kuih_today", value: "桌上摆着刚蒸好的千层糕" }, { by: "gm" });
  H.applyOp(st, { op: "establish_fact", subject: "flat_lin", key: "new_tv", value: "林家新买了彩色电视" }, { by: "gm" });
  H.applyOp(st, { op: "establish_fact", subject: "flat_chen", key: "joss_sticks", value: "神台上点着三支香" }, { by: "gm" });
  // 她不在时定下的家里细节：她没看到
  Object.assign(st.actors.chen, { map: null });
  H.applyOp(st, { op: "establish_fact", subject: "flat_chen", key: "door_left_open", value: "门没锁" }, { by: "gm" });
  Object.assign(st.actors.chen, { map: "flat_aisyah" });
  const view = H.getView(st, "chen").surroundings;
  assert.equal(view.here.map, "flat_aisyah");
  assert.deepEqual(view.here.player, { x: 9, y: 4, distance: 3 });
  assert.ok(view.here.people.some((x) => x.id === "aisyah_kassim" && x.activity === "摆糕"));
  assert.equal(view.here.extras.length, 1);
  assert.equal(view.home.map, "flat_chen");
  const keys = view.details.map((d) => d.key);
  assert.ok(keys.includes("flat_aisyah.kuih_today"));
  assert.ok(!keys.includes("flat_lin.new_tv"));
  assert.ok(keys.includes("flat_chen.joss_sticks"));
  // 别人家的细节，她在场也不进她的经历
  assert.ok(!H.getView(st, "chen").events.some((e) => e.fact === "flat_lin.new_tv"));
  assert.ok(H.getView(st, "player").events.some((e) => e.fact === "flat_lin.new_tv"));
  assert.ok(!keys.includes("flat_chen.door_left_open"));
  st.turn += 1; // 上面定下的细节进到历史那一段里，历史也要一起检查
  const p = P.characterPrompt(st, "chen", { input: "阿姨早", addressee: "chen", turnEvents: [] });
  const all = p.system + p.user;
  assert.match(p.user, /家具（挡路，不能站人）：礼拜毯\(1,1\)[^\n]*饭桌\(9,5\)/);
  assert.match(p.user, /摆出来的东西：一杯咖啡乌\(5,3\)/);
  assert.match(p.user, /Aisyah[^\n]* 在 \(4,4\)，正在摆糕/);
  assert.match(p.user, /亲戚 ×3 在 \(4,2\)，正在围着吃糕/);
  assert.match(p.user, /离你 3 格，伸手够不着/);
  assert.match(p.user, /## 你家/);
  assert.match(p.user, /神台香炉/);
  assert.ok(!all.includes("皮沙发") && !all.includes("彩色电视"), "别人家的东西");
  assert.ok(!all.includes("门没锁"));
  // 局势钟、满意度、别人家的秘密都不在里面
  for (const c of Object.values(st.plans.clocks)) assert.ok(!all.includes(c.id), c.id);
  assert.ok(!/满意度/.test(all));
  const lin = W.RESIDENTS.lin.secrets.filter((x) => W.secretActive(x, 1989));
  for (const sec of lin) assert.ok(!all.includes(sec.zh));
  // 她就在 Aisyah 家里，Aisyah 一家的秘密也不给
  const hosts = W.RESIDENTS.aisyah.secrets.filter((x) => W.secretActive(x, 1989));
  assert.ok(hosts.length);
  for (const sec of hosts) assert.ok(!all.includes(sec.zh), sec.id);
  // 在自己家时，"你家"不另外列一节
  Object.assign(st.actors.chen, { map: "flat_chen", x: 3, y: 3 });
  assert.equal(H.getView(st, "chen").surroundings.home, null);
});

test("英文版的住户场景块也是英文", () => {
  const s = chenAtAisyahs("en"), st = s.state;
  assert.ok(H.applyOp(st, { op: "extras", label: "relatives", count: 3, x: 4, y: 2 }, { by: "gm" }).ok);
  const p = P.characterPrompt(st, "chen", { input: "Morning", addressee: "chen", turnEvents: [] });
  assert.match(p.user, /Furniture \(blocks the way; nobody can stand there\): Prayer mat\(1,1\)[^\n]*Dining table\(9,5\)/);
  assert.match(p.user, /relatives ×3 at \(4,2\)/);
  assert.match(p.user, /3 steps from you, out of reach/);
  assert.match(p.user, /## Your home/);
  assert.match(p.system, /"move":null,"doing":null,"leave":null/);
  // 场景块里除了设定原文（住户名字、地图名），没有中文。11-02 起场景块在最后一块里，从「## Now」到「## This round」
  const scene = p.user.slice(p.user.indexOf("## Now")).split("## This round")[0];
  assert.match(scene, /## Your home/);
  const lines = scene.split("\n").filter((l) => HAN.test(l));
  assert.deepEqual(lines, []);
});

// ---------------- 住户自己走动、离开 ----------------
test("住户的 move：走到玩家旁边或某一格，先走再说话；被点名又离得远、自己没走，就替他走过去", async () => {
  const s = atChens("zh", FAR), st = s.state;
  const llm = fake({ gm: { ops: [], responders: ["chen"] }, character: { speak: "后生仔，过来坐。", move: "player" } });
  const res = await Turn.playerTurn(s, "阿姨早", { llm, to: "chen" });
  assert.ok(dist(st.actors.chen, st.actors.player) <= 1);
  assert.ok(res.items.some((e) => e.kind === "speech"));
  // 没被点名、也没写 move：不动
  const s2 = atChens("zh", FAR), st2 = s2.state;
  const quiet = fake({ gm: { ops: [], responders: ["chen"] }, character: { speak: "嗯。" } });
  await Turn.playerTurn(s2, "大家早", { llm: quiet });
  assert.deepEqual([st2.actors.chen.x, st2.actors.chen.y], [3, 3]);
  // 被点名：替她走到玩家旁边
  await Turn.playerTurn(s2, "阿姨早", { llm: quiet, to: "chen" });
  assert.ok(dist(st2.actors.chen, st2.actors.player) <= 1);
  // 写了格子就走到那一格；格子不能站人就退回重写
  const s3 = atChens("zh", FAR), st3 = s3.state;
  let n = 0;
  const pick = fake({ gm: { ops: [], responders: ["chen"] }, character: () => (n++ ? { speak: "", move: { x: 5, y: 4 } } : { speak: "等等。", move: { x: 5, y: 3 } }) });
  const res3 = await Turn.playerTurn(s3, "大家早", { llm: pick });
  assert.match(res3.calls[1].results.find((r) => r.part === "move").reason, /有家具/);
  assert.deepEqual([st3.actors.chen.x, st3.actors.chen.y], [5, 4]);
});

test("住户的 leave：说完话再走；act 里说走了却没写 leave，退回重写一次", async () => {
  const s = atChens(), st = s.state;
  const llm = fake({ gm: { ops: [], responders: ["chen"] }, character: { speak: "我去巴刹了。", act: "陈阿姨夹起棋盒。", doing: "夹着棋盒", leave: "去巴刹" } });
  const res = await Turn.playerTurn(s, "阿姨早", { llm, to: "chen" });
  const kinds = res.items.map((e) => e.kind);
  assert.ok(kinds.indexOf("speech") < kinds.indexOf("world"), kinds.join(","));
  assert.equal(st.actors.chen.map, null);
  assert.equal(st.actors.chen.activity, "去巴刹");
  // act 说她走了，却没写 leave
  const s2 = atChens(), st2 = s2.state;
  let n = 0;
  const forgot = fake({ gm: { ops: [], responders: ["chen"] }, character: () => (n++ ? { speak: "", act: "陈阿姨夹着棋盒，朝巴刹的方向走了。", leave: "去巴刹" } : { speak: "我去巴刹了。", act: "陈阿姨夹着棋盒，朝巴刹的方向走了。" }) });
  const res2 = await Turn.playerTurn(s2, "阿姨早", { llm: forgot, to: "chen" });
  assert.equal(forgot.calls.filter((c) => c.role === "character").length, 2);
  assert.match(forgot.calls[2].user, /act 里写了你要走/);
  assert.equal(st2.actors.chen.map, null);
  assert.ok(res2.items.some((e) => e.kind === "narration" && /巴刹的方向走了/.test(e.summary)));
  // 两次都不写 leave：那句照样放出来，但记一笔
  const s3 = atChens(), st3 = s3.state;
  const stubborn = fake({ gm: { ops: [], responders: ["chen"] }, character: { speak: "", act: "陈阿姨起身走了。" } });
  const res3 = await Turn.playerTurn(s3, "阿姨早", { llm: stubborn, to: "chen" });
  assert.equal(st3.actors.chen.map, "flat_chen");
  assert.ok(res3.calls.some((c) => (c.results || []).some((r) => r.part === "check" && !r.ok)));
});

// ---------------- 轻检查 ----------------
test("叙述说谁走了、地图上人还在：退回给 GM 补 leave；补了就从地图上消失", async () => {
  const s = atChens(), st = s.state;
  H.applyOp(st, { op: "extras", label: "老伯", count: 3, x: 4, y: 2 }, { by: "gm" });
  const told = "陈阿姨把棋盒夹在腋下，朝巴刹的方向走了。围着看棋的老伯们陆续散开。";
  const llm = fake({ gm: (ctx) => (ctx.retry ? { ops: [{ op: "leave", actor: "chen", to: "去巴刹" }, { op: "leave", actor: "x1", to: "散了" }] } : { ops: [{ op: "narrate", text: told }], responders: [] }) });
  const res = await Turn.playerTurn(s, "我看着她们", { llm, to: "gm" });
  assert.equal(llm.calls.filter((c) => c.role === "gm").length, 2);
  assert.match(llm.calls[1].user, /叙述里像是写了 chen（陈阿姨）、x1 离开/);
  assert.deepEqual(llm.calls[1].ctx.stranded, ["chen", "x1"]);
  assert.equal(st.actors.chen.map, null);
  assert.equal(H.extrasOn(st, "flat_chen").length, 0);
  assert.ok(res.items.filter((e) => e.kind === "world").length === 2);
  // 没补：放过去，记在调用记录里
  const s2 = atChens(), st2 = s2.state;
  const lazy = fake({ gm: (ctx) => (ctx.retry ? { ops: [] } : { ops: [{ op: "narrate", text: "陈阿姨起身走了。" }], responders: [] }) });
  const res2 = await Turn.playerTurn(s2, "我看着她", { llm: lazy, to: "gm" });
  assert.equal(st2.actors.chen.map, "flat_chen");
  assert.ok(res2.calls[1].results.some((r) => r.op === "check" && !r.ok));
  // 没说走：不退回
  const s3 = atChens();
  const fine = fake({ gm: { ops: [{ op: "narrate", text: "陈阿姨没有马上离开，低头看着棋盘。" }], responders: [] } });
  await Turn.playerTurn(s3, "我看着她", { llm: fine, to: "gm" });
  assert.equal(fine.calls.length, 1);
});

test("leaveClaims：中英文都认；否定句、拿走东西不算；只认这张图上的人", () => {
  const s = atChens(), st = s.state;
  assert.deepEqual(H.leaveClaims(st, "陈阿姨朝巴刹的方向走了。"), ["chen"]);
  assert.deepEqual(H.leaveClaims(st, "陈阿姨没有离开。"), []);
  assert.deepEqual(H.leaveClaims(st, "陈阿姨把碗端走了。"), []);
  assert.deepEqual(H.leaveClaims(st, "Rahman 离开了。"), []);
  assert.deepEqual(H.leaveClaims(st, "她起身走了。", { self: "chen" }), ["chen"]);
  const e = atChens("en").state;
  assert.deepEqual(H.leaveClaims(e, "Mdm Chan tucks the box under her arm and heads off to the market."), ["chen"]);
  assert.deepEqual(H.leaveClaims(e, "Mdm Chan doesn't leave just yet."), []);
});

test("英文版：新操作的退回理由都是英文", () => {
  const s = atChens("en"), st = s.state;
  const bad = [
    [{ op: "leave", actor: "rahman", to: "home" }, "gm"],
    [{ op: "leave", actor: "nobody", to: "home" }, "gm"],
    [{ op: "set_activity", actor: "rahman", activity: "x" }, "gm"],
    [{ op: "place_prop", kind: "sofa", x: 2, y: 2 }, "gm"],
    [{ op: "place_prop", kind: "nope", x: 2, y: 2 }, "gm"],
    [{ op: "place_prop", kind: "kopi_cup", x: 5, y: 3 }, "gm"],
    [{ op: "place_prop", kind: "kopi_cup", x: 0, y: 0 }, "gm"],
    [{ op: "remove_prop", kind: "chess_board" }, "gm"],
    [{ op: "remove_prop", kind: "tv" }, "gm"],
    [{ op: "extras", label: "", x: 2, y: 2 }, "gm"],
    [{ op: "extras", label: "uncles", count: 0, x: 2, y: 2 }, "gm"],
    [{ op: "extras", label: "uncles", x: 5, y: 3 }, "gm"],
    [{ op: "extras", label: "uncles", x: 4, y: 7 }, "gm"],
    [{ op: "extras", label: "uncles", x: 4, y: 6 }, "gm"],
    [{ op: "extras", id: "chen", label: "uncles", x: 2, y: 2 }, "gm"],
    [{ op: "move", actor: "chen", x: 5, y: 3 }, "gm"],
    [{ op: "move", actor: "chen", map: "flat_lin", x: 2, y: 3 }, "character"],
    [{ op: "move", actor: "chen", map: "nowhere" }, "gm"],
    // 11-02 只剩各家：GM 带玩家去还没搬来的、家里没人的那一家
    [{ op: "move", map: "flat_mei" }, "gm"],
    [{ op: "move", map: "flat_lin" }, "gm"],
    [{ op: "narrate", text: "x", noticed_by: ["rahman"] }, "gm"],
    [{ op: "gm_reply", text: "" }, "gm"],
    [{ op: "set_scene", map: "flat_chen", actors: [{ id: "chen", x: 5, y: 3 }] }, "gm"]
  ];
  for (const [op, by] of bad) {
    const r = H.applyOp(st, op, { by });
    assert.equal(r.ok, false, JSON.stringify(op));
    assert.ok(r.reason && !HAN.test(r.reason), `${JSON.stringify(op)} → ${r.reason}`);
  }
  for (const [x, y] of [[2, 1], [4, 1], [5, 1], [1, 2]]) assert.ok(H.applyOp(st, { op: "extras", label: "people", x, y }, { by: "gm" }).ok);
  const r = H.applyOp(st, { op: "extras", label: "people", x: 2, y: 2 }, { by: "gm" });
  assert.ok(!r.ok && !HAN.test(r.reason), r.reason);
  const g = H.extrasOn(st, "flat_chen")[0];
  const r2 = H.applyOp(st, { op: "leave", actor: g.id, to: "home" }, { by: "character" });
  assert.ok(!r2.ok && !HAN.test(r2.reason), r2.reason);
});

// ---------------- 审查发现的问题（10-29） ----------------
test("模型漏写坐标不会让整轮中断；改配角时没写的栏位照旧", async () => {
  const s = atChens(), st = s.state;
  H.applyOp(st, { op: "extras", label: "老伯", count: 3, x: 4, y: 2, activity: "围着看棋" }, { by: "gm" });
  // 只改在做什么
  assert.ok(H.applyOp(st, { op: "extras", id: "x1", activity: "收拾棋子" }, { by: "gm" }).ok);
  assert.deepEqual(H.extrasOn(st, "flat_chen").map((g) => [g.label, g.count, g.x, g.y, g.activity]), [["老伯", 3, 4, 2, "收拾棋子"]]);
  // 只挪位置，人数和在做什么照旧
  assert.ok(H.applyOp(st, { op: "extras", id: "x1", x: 5, y: 2 }, { by: "gm" }).ok);
  assert.deepEqual(H.extrasOn(st, "flat_chen").map((g) => [g.count, g.x, g.activity]), [[3, 5, "收拾棋子"]]);
  // 新建却没写坐标、物件没写坐标、坐标是字符串：退回，不抛错
  for (const op of [{ op: "extras", label: "路人" }, { op: "place_prop", kind: "kopi_cup" }, { op: "place_prop", kind: "kopi_cup", x: "5", y: "3" }, { op: "move", actor: "chen", x: null, y: 4 }]) {
    const r = H.applyOp(st, op, { by: "gm" });
    assert.equal(r.ok, false, JSON.stringify(op));
  }
  // 一轮里也一样：退回给 GM 重给，住户照常回应
  const llm = fake({ gm: (ctx) => (ctx.retry ? { ops: [] } : { ops: [{ op: "narrate", text: "老伯们开始收拾棋子。" }, { op: "place_prop", kind: "kopi_cup" }], responders: ["chen"] }), character: { speak: "收工啰。" } });
  const res = await Turn.playerTurn(s, "我看看", { llm, to: "gm" });
  assert.ok(res.items.some((e) => e.kind === "speech"));
});

test("配角和住户都不能站在门上（会把门堵住）", () => {
  // 陈阿姨家：门 R 在 (4,7)
  const s = atChens("zh", [2, 3]), st = s.state;
  const [dx, dy] = M.doorOf("flat_chen");
  assert.deepEqual([dx, dy], [4, 7]);
  assert.ok(M.isExit("flat_chen", dx, dy));
  assert.match(H.applyOp(st, { op: "extras", label: "访客", count: 2, x: dx, y: dy }, { by: "gm" }).reason, /是门/);
  assert.match(H.applyOp(st, { op: "move", actor: "chen", x: dx, y: dy }, { by: "gm" }).reason, /是门/);
  assert.match(H.applyOp(st, { op: "move", actor: "chen", x: dx, y: dy }, { by: "character" }).reason, /是门/);
  assert.match(H.applyOp(st, { op: "set_scene", map: "flat_chen", actors: [{ id: "chen", x: dx, y: dy }] }, { by: "gm" }).reason, /是门/);
  // 门格在底图上还是能站的格子；11-02 起门不通到别处，玩家走到门上只提示用门牌，不换图
  assert.ok(M.standable("flat_chen", dx, dy));
  Object.assign(st.actors.player, { x: 4, y: 6 });
  const bump = B.moveTo(st, dx, dy);
  assert.equal(bump.ok, false);
  assert.equal(bump.door, true);
  assert.deepEqual([st.actors.player.map, st.actors.player.x, st.actors.player.y], ["flat_chen", 4, 6]);
  const en = atChens("en", [2, 3]).state;
  assert.ok(!HAN.test(H.applyOp(en, { op: "extras", label: "visitors", x: dx, y: dy }, { by: "gm" }).reason));
});

test("住户只写了 leave：先给反应再离开，不会走了以后还'看了你一眼'；话被退回时，重写在他走之前", async () => {
  const s = atChens(), st = s.state;
  const llm = fake({ gm: { ops: [], responders: ["chen"] }, character: { speak: "", act: "", leave: "下楼" } });
  const res = await Turn.playerTurn(s, "阿姨早", { llm, to: "chen" });
  const shown = res.items.filter((e) => e.kind !== "player_input").map((e) => e.kind + ":" + e.summary);
  assert.deepEqual(shown, ["narration:陈阿姨看了你一眼，没有说话。", "world:陈阿姨离开了（下楼）"]);
  assert.equal(st.actors.chen.map, null);
  // 第一次的话过不了设定门：重写的话能说出来，然后才走
  const s2 = atChens(), st2 = s2.state;
  let n = 0;
  const llm2 = fake({ gm: { ops: [], responders: ["chen"] }, character: () => (n++ ? { speak: "饮咗茶未？" } : { speak: "我心里的张力很大。", leave: "去巴刹" }) });
  const res2 = await Turn.playerTurn(s2, "阿姨早", { llm: llm2, to: "chen" });
  const kinds = res2.items.map((e) => e.kind + ":" + e.summary);
  assert.deepEqual(kinds.slice(1), ["speech:饮咗茶未？", "world:陈阿姨离开了（去巴刹）"]);
  assert.equal(st2.actors.chen.map, null);
});

test("掷骰只有玩家看得到；检定分支里不能藏花政策点、挪玩家、出戏回答", async () => {
  const s = atChens(), st = s.state;
  const r = H.applyOp(st, { op: "roll", dc: 5, reason: "偷看桌上的信", on_success: [{ op: "narrate", text: "你看清了信封上的字。", noticed_by: [] }] }, { by: "gm" });
  assert.deepEqual(r.event.perceivedBy, ["player"]);
  assert.ok(!H.getView(st, "chen").events.some((e) => e.kind === "roll"));
  const sneaky = { ops: [{ op: "roll", dc: 5, reason: "x", on_success: [{ op: "community_action", residents: ["chen"], need: "🪑", description: "搬凳子" }, { op: "move", x: 6, y: 4 }] }], responders: [] };
  const llm = fake({ gm: (ctx) => (ctx.retry ? { ops: [] } : sneaky) });
  let asked = 0;
  const res = await Turn.playerTurn(s, "阿姨早", { llm, to: "chen", confirmSpend: async () => { asked++; return true; } });
  assert.equal(asked, 0);
  assert.equal(st.game.points, 3);
  assert.deepEqual([st.actors.player.x, st.actors.player.y], [4, 3]);
  assert.equal(res.calls[0].results[0].ok, false);
  // 对 GM 说也不行：花政策点要走确认
  const res2 = await Turn.playerTurn(s, "我想偷偷帮她", { llm, to: "gm", confirmSpend: async () => { asked++; return true; } });
  assert.equal(asked, 0);
  assert.match(res2.calls[0].results[0].reason, /检定的分支里不能用 community_action/);
});

test("对 GM 说的事没做成：那几句只给玩家看；住户没听到请求，也看不到回绝", async () => {
  const s = atChens(), st = s.state;
  st.game.points = 0;
  const llm = fake({ gm: { ops: [{ op: "community_action", residents: ["chen"], need: "🪑", description: "搬凳子" }], responders: [] } });
  const res = await Turn.playerTurn(s, "我想帮陈阿姨搬凳子", { llm, to: "gm" });
  const e = res.items.find((x) => /政策点已经用完/.test(x.summary));
  assert.deepEqual(e.perceivedBy, ["player"]);
  st.game.points = 3;
  const res2 = await Turn.playerTurn(s, "我想帮陈阿姨搬凳子", { llm, to: "gm", confirmSpend: async () => false });
  assert.deepEqual(res2.items.find((x) => /这次没有去做/.test(x.summary)).perceivedBy, ["player"]);
  assert.ok(!H.getView(st, "chen").events.some((x) => /政策点|没有去做/.test(x.summary)));
});

test("叙述写的是走过来、走到旁边：不算离开；这一轮被 move 挪过的人也不退回", async () => {
  const s = atChens("zh", FAR), st = s.state;
  assert.deepEqual(H.leaveClaims(st, "陈阿姨站起来，朝你走了过来。"), []);
  assert.deepEqual(H.leaveClaims(st, "陈阿姨走到你旁边坐下。"), []);
  const e = atChens("en", FAR).state;
  assert.deepEqual(H.leaveClaims(e, "Mdm Chan gets up and comes over to you."), []);
  assert.deepEqual(H.leaveClaims(e, "Mdm Chan heads for the stool beside you."), []);
  // GM 用 move 叫她过来（玩家在角落 (6,6)，旁边只有 (5,6) 能站），叙述里写"往灶台那边走去"，不退回
  const llm = fake({ gm: { ops: [{ op: "move", actor: "chen", x: 5, y: 6 }, { op: "narrate", text: "陈阿姨收起棋子，往灶台那边走去。" }], responders: ["chen"] }, character: { speak: "来啦。" } });
  await Turn.playerTurn(s, "能请陈阿姨过来吗", { llm, to: "gm" });
  assert.equal(llm.calls.filter((c) => c.role === "gm").length, 1);
  assert.deepEqual([st.actors.chen.map, st.actors.chen.x, st.actors.chen.y], ["flat_chen", 5, 6]);
});

test("离线演示：对 GM 说了一句只能出戏回答的话，身边的人不接话", async () => {
  for (const lang of ["zh", "en"]) {
    const s = atChens(lang, [3, 5]);
    const res = await Turn.playerTurn(s, lang === "en" ? "Good morning" : "早上好", { llm: Mock.caller(), to: "gm" });
    assert.ok(!res.calls.some((c) => c.role === "character"), lang);
  }
});

test("住户是玩家说完话才被叫来的：这一轮的提示词里没有玩家的原话", async () => {
  const s = atChens(), st = s.state;
  Object.assign(st.actors.weiming, { map: null, x: null, y: null });
  const llm = fake({ gm: { ops: [{ op: "move", actor: "weiming", map: "flat_chen", x: 6, y: 4 }], responders: ["chen", "weiming"] }, character: { speak: "嗯。" } });
  await Turn.playerTurn(s, "阿姨，悄悄跟你说件事", { llm, to: "chen" });
  const wm = llm.calls.find((c) => c.role === "character" && c.ctx.id === "weiming");
  assert.ok(wm);
  assert.ok(!wm.user.includes("悄悄跟你说件事"));
  assert.match(wm.user, /这一轮你没看到、没听到什么新的事/);
});

// ---------------- 第二轮审查后补的 ----------------
test("离得远的住户被点名、act 说走了却没写 leave：不替他走过去，照样退回重写", async () => {
  for (const [lang, act, to] of [["zh", "陈阿姨收起棋盘，出门去了。", "去巴刹"], ["en", "Mdm Chan packs up the chessboard and heads out.", "to the market"]]) {
    const s = atChens(lang, FAR), st = s.state;
    let n = 0;
    const llm = fake({ gm: { ops: [], responders: ["chen"] }, character: () => (n++ ? { speak: "", act, leave: to } : { speak: "", act }) });
    await Turn.playerTurn(s, lang === "en" ? "Morning, auntie" : "阿姨早", { llm, to: "chen" });
    assert.equal(llm.calls.filter((c) => c.role === "character").length, 2, lang);
    assert.equal(st.actors.chen.map, null, lang);
  }
  // 重写也没写 leave：那句放出来、记一笔，她留在原地，没被挪到玩家旁边
  const s = atChens("zh", FAR), st = s.state;
  const stubborn = fake({ gm: { ops: [], responders: ["chen"] }, character: { speak: "", act: "陈阿姨收起棋盘，出门去了。" } });
  const res = await Turn.playerTurn(s, "阿姨早", { llm: stubborn, to: "chen" });
  assert.deepEqual([st.actors.chen.map, st.actors.chen.x, st.actors.chen.y], ["flat_chen", 3, 3]);
  assert.ok(res.calls.some((c) => (c.results || []).some((r) => r.part === "check" && !r.ok)));
});

test("leaveClaims 按小句看：朝你摆手、向你道别以后走了照样算离开；走过来的是别人，不挡住前半句", () => {
  const st = atChens("zh", FAR).state;
  Object.assign(st.actors.weiming, { map: "flat_chen", x: 6, y: 4 });
  for (const t of ["陈阿姨收起棋盘，回家去了。", "陈阿姨朝你摆摆手，转身走了。", "陈阿姨朝你点点头，收起棋盒往巴刹走去。", "陈阿姨向你道了别，离开了棋桌。", "陈阿姨愣了一下才反应过来，转身走了。", "陈阿姨把棋盒递过来，转身走了。", "陈阿姨离开了棋桌，林伟明走了过来。", "陈阿姨离开了棋桌，伟明走了过来。"])
    assert.deepEqual(H.leaveClaims(st, t), ["chen"], t);
  assert.deepEqual(H.leaveClaims(st, "朝你摆摆手，转身走了。", { self: "chen" }), ["chen"]);
  assert.deepEqual(H.leaveClaims(st, "陈阿姨、林伟明一起离开了。").sort(), ["chen", "weiming"]);
  // 走近还是不算
  for (const t of ["陈阿姨站起来，朝你走了过来。", "陈阿姨走到你旁边坐下。", "陈阿姨收起棋盒，朝你走去。", "陈阿姨离开棋桌，走到你身边。"])
    assert.deepEqual(H.leaveClaims(st, t), [], t);
  const e = atChens("en", FAR).state;
  Object.assign(e.actors.weiming, { map: "flat_chen", x: 6, y: 4 });
  for (const t of ["Mdm Chan gets up from beside you and walks off to the market.", "Mdm Chan waves to you and walks away.", "Mdm Chan nods at you, then heads home.", "Mdm Chan leaves the table, and Wei Ming comes over."])
    assert.deepEqual(H.leaveClaims(e, t), ["chen"], t);
  for (const t of ["Mdm Chan gets up and comes over to you.", "Mdm Chan walks away from the table to sit beside you."])
    assert.deepEqual(H.leaveClaims(e, t), [], t);
});

test("叙述说配角散了：只改了配角在做什么、没挪位置的，照样退回；检定分支里挪过的人不退回", async () => {
  const s = atChens(), st = s.state;
  H.applyOp(st, { op: "extras", label: "老伯", count: 3, x: 4, y: 2 }, { by: "gm" });
  const llm = fake({ gm: (ctx) => (ctx.retry ? { ops: [{ op: "leave", actor: "x1", to: "散了" }] } : { ops: [{ op: "extras", id: "x1", activity: "收拾棋子准备走" }, { op: "narrate", text: "老伯们收拾好棋子，散了。" }], responders: [] }) });
  await Turn.playerTurn(s, "我看着他们", { llm, to: "gm" });
  assert.equal(llm.calls.filter((c) => c.role === "gm").length, 2);
  assert.equal(H.extrasOn(st, "flat_chen").length, 0);
  // 检定两个分支都把陈阿姨挪到灶台边（玩家旁边），叙述写"往灶台那边走去"：不退回
  const s2 = atChens("zh", FAR), st2 = s2.state;
  const branch = [{ op: "move", actor: "chen", x: 5, y: 6 }, { op: "narrate", text: "陈阿姨收起棋子，往灶台那边走去。" }];
  const llm2 = fake({ gm: { ops: [{ op: "roll", dc: 10, reason: "请陈阿姨过来", on_success: branch, on_failure: branch }], responders: [] } });
  await Turn.playerTurn(s2, "能请陈阿姨过来吗", { llm: llm2, to: "gm" });
  assert.equal(llm2.calls.filter((c) => c.role === "gm").length, 1);
  assert.deepEqual([st2.actors.chen.map, st2.actors.chen.x], ["flat_chen", 5]);
});

test("检定的分支不是列表：掷骰之前就退回，不会掷两次", async () => {
  const s = atChens(), st = s.state;
  const bad = { op: "roll", dc: 12, reason: "说服保安", on_success: { op: "narrate", text: "保安点了点头。" } };
  const r = H.applyOp(st, bad, { by: "gm" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /列表/);
  assert.ok(!st.events.some((e) => e.kind === "roll"));
  assert.deepEqual(st.failed_rolls, {});
  const llm = fake({ gm: (ctx) => (ctx.retry ? { ops: [Object.assign({}, bad, { on_success: [bad.on_success] })] } : { ops: [bad] }) });
  const res = await Turn.playerTurn(s, "我想说服保安", { llm, to: "gm" });
  assert.match(res.calls[0].results[0].reason, /列表/);
  assert.equal(st.events.filter((e) => e.kind === "roll").length, 1);
  const en = atChens("en").state;
  assert.ok(!HAN.test(H.applyOp(en, bad, { by: "gm" }).reason));
});

test("门口只剩一格能进出时，那一格不能让住户或配角站（玩家会出不了门）", async () => {
  // 陈阿姨家的门在 (4,7)，门口只有 (4,6) 一格（(3,6) 是木屐，(5,6) 不挨着门）
  const s = atChens("zh", [2, 2]), st = s.state;
  assert.deepEqual(M.entryOf("flat_chen"), [4, 6]);
  assert.match(H.applyOp(st, { op: "extras", label: "访客", x: 4, y: 6 }, { by: "gm" }).reason, /门口/);
  assert.match(H.applyOp(st, { op: "move", actor: "chen", x: 4, y: 6 }, { by: "gm" }).reason, /门口/);
  assert.match(H.applyOp(st, { op: "move", actor: "chen", x: 4, y: 6 }, { by: "character" }).reason, /门口/);
  assert.match(H.applyOp(st, { op: "set_scene", map: "flat_chen", actors: [{ id: "chen", x: 4, y: 6 }] }, { by: "gm" }).reason, /门口/);
  assert.ok(H.applyOp(st, { op: "move", actor: "chen", x: 5, y: 6 }, { by: "gm" }).ok);
  // 玩家自己站在门口不算（他走得开）：进门时就站在这一格
  assert.ok(H.applyOp(st, { op: "move", x: 4, y: 6 }, { by: "ui" }).ok);
  // 门口有两格的门（原来楼下那扇在墙角，两边都能进）：占一格可以，两格都占就不行。
  // 11-02 只剩各家以后，每一家的门口都只有一格，这条就在测试里临时加一张墙角开门的小图来查，查完拿掉
  M.MAPS.test_corner = { name: { zh: "墙角开门的小图", en: "Corner-door test map" }, short: { zh: "墙角", en: "Corner" }, rows: ["#####", "#D..#", "#...#", "#####"], exits: { D: {} } };
  try {
    const v = atChens().state;
    assert.ok(H.applyOp(v, { op: "extras", label: "老伯", map: "test_corner", x: 2, y: 1 }, { by: "gm" }).ok);
    assert.match(H.applyOp(v, { op: "extras", label: "孩子", map: "test_corner", x: 1, y: 2 }, { by: "gm" }).reason, /门口/);
  } finally { delete M.MAPS.test_corner; }
  // 替住户走到玩家旁边时，也不挑门口那一格：宿舍的门 X 在 (2,6)，门口只有 (2,5)。
  // 玩家在 (2,4)、Kumar 在 (1,5)：玩家身边离他最近的一格就是门口（(1,4) 是家人照片），要挑下一近的 (2,3)
  const s2 = game(), st2 = s2.state;
  assert.deepEqual(M.entryOf("dorm"), [2, 5]);
  Object.assign(st2.actors.player, { map: "dorm", x: 2, y: 4 });
  Object.assign(st2.actors.kumar, { map: "dorm", x: 1, y: 5, activity: "" });
  const llm = fake({ gm: { ops: [], responders: ["kumar"] }, character: { speak: "嗯。" } });
  await Turn.playerTurn(s2, "Kumar 早", { llm, to: "kumar" });
  assert.deepEqual([st2.actors.kumar.x, st2.actors.kumar.y], [2, 3]);
  assert.equal(llm.calls.filter((c) => c.role === "character").length, 1);
  const en = atChens("en", [2, 2]).state;
  assert.ok(!HAN.test(H.applyOp(en, { op: "extras", label: "visitors", x: 4, y: 6 }, { by: "gm" }).reason));
});
