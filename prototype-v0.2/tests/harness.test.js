const test = require("node:test");
const assert = require("node:assert/strict");
const { W, S, H, API } = require("./load");

const gm = (ops) => ({ by: "gm", ops });
const ch = (ops) => ({ by: "character", ops });
const ui = (ops) => ({ by: "ui", ops });
const planner = (ops) => ({ by: "planner", ops });

// 开局：玩家去陈阿姨家门口，陈阿姨在家
function atChen(opts) {
  const s = API.createSession(opts);
  const r = API.propose(s, ui([{ op: "move", map: "flat_chen", x: 4, y: 5 }]));
  assert.ok(r.results[0].ok, r.results[0].reason);
  return s;
}
const say = (s, text) => API.propose(s, ui([{ op: "player_say", text }])).results[0].event.id;
const chenSays = (s, text) => API.propose(s, ch([{ op: "speak", npc: "chen", text }])).results[0].event.id;

test("权限：GM 不能替住户说话或改印象，角色输出不能确立事实", () => {
  const s = atChen();
  const [a, b] = API.propose(s, gm([{ op: "speak", npc: "chen", text: "好" }, { op: "impression", npc: "chen", text: "x", evidence: ["E1"] }])).results;
  assert.equal(a.ok, false); assert.equal(b.ok, false);
  assert.equal(API.propose(s, ch([{ op: "establish_fact", subject: "estate", key: "x", value: 1 }])).results[0].ok, false);
});

test("事实四层：普通细节不设额度，已确认的不能改，有后果的必须走检定，秘密不能由 GM 写", () => {
  const s = atChen();
  const ops = [];
  for (let i = 0; i < 20; i++) ops.push({ op: "establish_fact", subject: "void_deck", key: "detail_" + i, value: "有人在下棋" });
  assert.ok(API.propose(s, gm(ops)).results.every((r) => r.ok), "20 条普通细节都应该成立（V0.1 只给 4 个额度）");
  const again = API.propose(s, gm([{ op: "establish_fact", subject: "void_deck", key: "detail_0", value: "没人" }])).results[0];
  assert.equal(again.ok, false); assert.match(again.reason, /不能改/);
  assert.equal(API.propose(s, gm([{ op: "establish_fact", subject: "kumar", key: "heatstroke", value: true, layer: "stake" }])).results[0].ok, false);
  assert.equal(API.propose(s, gm([{ op: "establish_fact", subject: "chen", key: "secret_son", value: "x" }])).results[0].ok, false);
  const r = API.propose(s, gm([{ op: "roll", dc: 5, reason: "午休中暑", on_success: [{ op: "establish_fact", subject: "kumar", key: "heatstroke", value: false, layer: "stake" }], on_failure: [{ op: "establish_fact", subject: "kumar", key: "heatstroke", value: true, layer: "stake" }] }])).results[0];
  assert.ok(r.ok); assert.ok(r.results[0].ok, "检定分支里可以确立有后果的事实");
  assert.equal(s.state.details["kumar.heatstroke"].source, "roll");
});

test("场景：只能用固定物件和能站人的格子", () => {
  const s = atChen();
  const bad = (scene) => API.propose(s, gm([Object.assign({ op: "set_scene", map: "void_deck" }, scene)])).results[0];
  assert.equal(bad({ props: [{ kind: "spaceship", x: 3, y: 3 }] }).ok, false);
  assert.equal(bad({ props: [{ kind: "sofa", x: 3, y: 3 }] }).ok, false, "沙发不能出现在 void deck");
  assert.equal(bad({ props: [{ kind: "bench", x: 0, y: 0 }] }).ok, false, "墙上不能放东西");
  assert.equal(bad({ props: [{ kind: "bench", x: 3, y: 3 }, { kind: "kopi_cup", x: 3, y: 3 }] }).ok, false);
  assert.equal(bad({ actors: [{ id: "wangmei", x: 5, y: 3 }] }).ok, false, "1989 年王美还没搬来");
  assert.match(bad({ actors: [{ id: "lin", x: 5, y: 3 }] }).reason, /按人/, "拆开的户要按人摆");
  assert.equal(bad({ actors: [{ id: "chen", x: 3, y: 2 }] }).ok, false, "柱子上不能站人");
  // (6,3) 是楼下固定的象棋桌：人不能站在家具上（10-29 的中文局里陈阿姨就被摆在了桌子上）
  assert.match(bad({ actors: [{ id: "chen", x: 6, y: 3 }] }).reason, /有家具/);
  assert.match(bad({ props: [{ kind: "bench", x: 6, y: 3 }] }).reason, /已经有东西了/, "物件也不能压在家具上");
  const ok = bad({ props: [{ kind: "chess_table", x: 5, y: 3 }, { kind: "bench", x: 7, y: 3 }], actors: [{ id: "chen", x: 6, y: 4, activity: "下棋" }], weather: "雷阵雨前" });
  assert.ok(ok.ok, ok.reason);
  assert.equal(s.state.actors.chen.map, "void_deck");
});

test("住户的印象只能引用自己经历过的事；不同住户的印象可以互相矛盾", () => {
  const s = atChen();
  const e1 = say(s, "阿姨，我帮你看看表格");
  // Kumar 不在场，不能引用这件事
  const k = API.propose(s, ch([{ op: "impression", npc: "kumar", text: "这个人好", evidence: [e1] }])).results[0];
  assert.equal(k.ok, false); assert.match(k.reason, /没有经历过/);
  assert.ok(API.propose(s, ch([{ op: "impression", npc: "chen", text: "又是拿表格来的", evidence: [e1] }])).results[0].ok);
  // 去楼下帮 Kumar 搬推车，Kumar 形成相反的印象
  API.propose(s, gm([{ op: "set_scene", map: "void_deck", actors: [{ id: "kumar", x: 6, y: 4 }] }]));
  API.propose(s, ui([{ op: "move", map: "void_deck", x: 5, y: 3 }]));
  const e2 = say(s, "Kumar，我帮你推");
  assert.ok(API.propose(s, ch([{ op: "impression", npc: "kumar", text: "会帮忙的人", evidence: [e2] }])).results[0].ok);
  assert.equal(s.state.minds.chen.impressions.length, 1);
  assert.equal(s.state.minds.kumar.impressions.length, 1);
});

test("四种存储隔离：玩家看不到 GM 推测、钟和别人的心思；住户只看到自己的", () => {
  const s = atChen();
  const e1 = say(s, "我是新来的");
  API.propose(s, gm([{ op: "gm_hypothesis", trait: "站在住户这边", text: "主动上门", confidence: 0.3, evidence: [e1] }]));
  API.propose(s, ch([{ op: "impression", npc: "chen", text: "后生仔", evidence: [e1] }]));
  const pv = API.getView(s, "player");
  const flat = JSON.stringify(pv);
  assert.ok(!("gm" in pv) && !flat.includes("站在住户这边"));
  assert.ok(!flat.includes("后生仔"), "玩家不能读到陈阿姨的心思");
  assert.ok(!flat.includes("childcare_queue"), "不可见的钟不给玩家看");
  const cv = API.getView(s, "chen");
  assert.equal(cv.mind.impressions[0].text, "后生仔");
  const lv = API.getView(s, "huiling");
  assert.equal(lv.mind.impressions.length, 0);
  assert.ok(!JSON.stringify(lv).includes("后生仔"));
  assert.ok(API.getView(s, "gm").full.gm.hypotheses.length === 1);
});

test("揭示：障碍和秘密只能由本人当着玩家说出；障碍会回传给游戏端", () => {
  const s = atChen();
  assert.equal(API.propose(s, ch([{ op: "reveal", npc: "kumar", kind: "barrier", id: "🚫" }])).results[0].ok, false, "Kumar 不在");
  assert.equal(API.propose(s, ch([{ op: "reveal", npc: "chen", kind: "barrier", id: "🍲" }])).results[0].ok, false, "不是她的障碍");
  const r = API.propose(s, ch([{ op: "reveal", npc: "chen", kind: "barrier", id: "📝" }]));
  assert.ok(r.results[0].ok);
  assert.equal(r.sent[0].event.type, "trpg_info");
  assert.deepEqual(API.getView(s, "player").revealed.barriers.chen, ["📝"]);
  assert.ok(API.propose(s, ch([{ op: "reveal", npc: "chen", kind: "relation", id: "riot_1964" }])).results[0].ok);
  assert.equal(API.propose(s, ch([{ op: "reveal", npc: "chen", kind: "relation", id: "same_trade" }])).results[0].ok, false);
});

test("满意度：纯对话每十年最多 +2，可以往下掉到 -5", () => {
  const s = atChen();
  const e = chenSays(s, "后生仔，坐啦");
  const r1 = API.propose(s, ch([{ op: "satisfaction", npc: "chen", delta: 5, reason: "有人陪她说话", evidence: [e] }]));
  assert.equal(r1.results[0].applied, 2);
  assert.equal(r1.sent[0].event.delta, 2);
  assert.equal(s.sim.satisfaction.chen, 57);
  const r2 = API.propose(s, ch([{ op: "satisfaction", npc: "chen", delta: 1, reason: "再聊", evidence: [e] }]));
  assert.equal(r2.results[0].applied, 0); assert.equal(r2.sent.length, 0);
  const lie = say(s, "我是建屋局派来的官员");
  const r3 = API.propose(s, ch([{ op: "satisfaction", npc: "chen", delta: -8, reason: "发现被骗", evidence: [lie] }]));
  assert.equal(r3.results[0].applied, -5);
});

test("自由行动：扣 1 个政策点；需求对口最多 +5，不对口最多 +1；合计不超过 6", () => {
  const s = atChen();
  const a = API.propose(s, gm([{ op: "community_action", residents: ["chen"], need: "🤝", description: "在楼下组织一场象棋赛" }]));
  assert.ok(a.results[0].ok);
  assert.equal(a.sent[0].event.type, "trpg_spend");
  assert.equal(s.sim.points, 2);
  const act = a.results[0].event.id;
  assert.equal(API.propose(s, ch([{ op: "satisfaction", npc: "chen", delta: 8, reason: "象棋赛", evidence: [act] }])).results[0].applied, 5);
  const e = chenSays(s, "你人几好");
  assert.equal(API.propose(s, ch([{ op: "satisfaction", npc: "chen", delta: 2, reason: "聊天", evidence: [e] }])).results[0].applied, 1, "合计封顶 6");

  const s2 = atChen();
  const b = API.propose(s2, gm([{ op: "community_action", residents: ["chen"], need: "🧒", description: "帮她带孩子" }])).results[0].event.id;
  assert.equal(API.propose(s2, ch([{ op: "satisfaction", npc: "chen", delta: 5, reason: "帮忙", evidence: [b] }])).results[0].applied, 1, "需求不对口");
});

test("自由行动：对象必须在身边，政策点用完就不能做", () => {
  const s = atChen();
  assert.equal(API.propose(s, gm([{ op: "community_action", residents: ["lin"], description: "帮林家搬沙发" }])).results[0].ok, false);
  for (let i = 0; i < 3; i++) assert.ok(API.propose(s, gm([{ op: "community_action", residents: ["chen"], description: "帮忙 " + i }])).results[0].ok);
  const r = API.propose(s, gm([{ op: "community_action", residents: ["chen"], description: "再帮一次" }])).results[0];
  assert.equal(r.ok, false); assert.match(r.reason, /政策点/);
});

test("说好话不能抵消政策伤害：本十年因政策掉了 X 点，最多补回 X/3", () => {
  const s = API.createSession();
  API.gameAction(s, "enact", "tighten_quota");          // Aisyah 家 -20
  assert.equal(s.sim.satisfaction.aisyah, 40);
  API.propose(s, ui([{ op: "move", map: "flat_aisyah", x: 4, y: 5 }]));
  const act = API.propose(s, gm([{ op: "community_action", residents: ["aisyah"], need: "🎊", description: "帮他们在楼下摆开斋节长桌" }])).results[0].event.id;
  const r = API.propose(s, ch([{ op: "satisfaction", npc: "aisyah_kassim", delta: 5, reason: "长桌", evidence: [act] }])).results[0];
  assert.equal(r.applied, 5, "伤害 20，三分之一是 6，这次 5 可以");
  const e = API.propose(s, ch([{ op: "speak", npc: "rahman", text: "Tak payah，不用麻烦" }])).results[0].event.id;
  assert.equal(API.propose(s, ch([{ op: "satisfaction", npc: "rahman", delta: 2, reason: "安慰", evidence: [e] }])).results[0].applied, 1, "同一户的另一个人，共用上限");
  assert.equal(s.sim.satisfaction.aisyah, 46, "政策伤害 -20 只被缓和了 6");

  const s2 = API.createSession();
  API.gameAction(s2, "enact", "cleanup");                 // Aisyah 家 -4：最多补回 1
  API.propose(s2, ui([{ op: "move", map: "flat_aisyah", x: 4, y: 5 }]));
  const e2 = API.propose(s2, ch([{ op: "speak", npc: "aisyah_kassim", text: "长桌收走了" }])).results[0].event.id;
  assert.equal(API.propose(s2, ch([{ op: "satisfaction", npc: "aisyah_kassim", delta: 2, reason: "安慰", evidence: [e2] }])).results[0].applied, 1);
});

test("满意度只能引用这个十年里、这户经历过的事", () => {
  const s = atChen();
  const old = chenSays(s, "以前的事");
  API.advanceDecade(s);
  API.propose(s, ui([{ op: "move", map: "flat_chen", x: 4, y: 5 }]));
  assert.match(API.propose(s, ch([{ op: "satisfaction", npc: "chen", delta: 1, reason: "x", evidence: [old] }])).results[0].reason, /这个十年/);
});

test("张力倾向：一次挪一格；光靠对话每个十年只能挪一次", () => {
  const s = atChen();
  const e1 = chenSays(s, "呢栋楼我起嘅");
  assert.equal(API.propose(s, ch([{ op: "lean", npc: "chen", toward: "a", evidence: [e1] }])).results[0].lean, -1);
  const e2 = chenSays(s, "我老咗");
  assert.equal(API.propose(s, ch([{ op: "lean", npc: "chen", toward: "b", evidence: [e2] }])).results[0].ok, false);
  const act = API.propose(s, gm([{ op: "community_action", residents: ["chen"], need: "🤝", description: "请她教年轻人下棋" }])).results[0].event.id;
  assert.equal(API.propose(s, ch([{ op: "lean", npc: "chen", toward: "a", evidence: [act] }])).results[0].lean, -2);
});

test("进度钟：游戏端事件启动；推进要有更新的证据；满格后果一定发生，只发生一次", () => {
  const s = atChen();
  assert.ok(s.state.plans.clocks.childcare_queue && s.state.plans.clocks.afternoon_heat, "第 1 个十年的钟开局就在");
  API.gameAction(s, "build", "smart");
  const c = s.state.plans.clocks.chen_withdraws;
  assert.ok(c);
  const e0 = chenSays(s, "要用电话订？我唔识");
  assert.ok(API.propose(s, gm([{ op: "clock_tick", clock: "chen_withdraws", by: 1, evidence: [e0] }])).results[0].ok);
  assert.equal(API.propose(s, gm([{ op: "clock_tick", clock: "chen_withdraws", by: 1, evidence: [e0] }])).results[0].ok, false, "同一个证据不能用两次");
  let fired = null;
  for (let i = 0; i < 3; i++) {
    const e = chenSays(s, "唔去喇 " + i);
    fired = API.propose(s, gm([{ op: "clock_tick", clock: "chen_withdraws", by: 1, evidence: [e] }])).results[0].fired;
  }
  assert.ok(fired && fired.kind === "consequence");
  assert.equal(s.state.events.filter((e) => e.clock === "chen_withdraws").length, 1);
  assert.equal(API.propose(s, planner([{ op: "clock_drop", clock: "chen_withdraws" }])).results[0].ok, false, "满格的钟不能撤");
});

test("进度钟：建了对口设施，相关的钟解除", () => {
  const s = API.createSession();
  API.gameAction(s, "build", "childcare");
  assert.equal(s.state.plans.clocks.childcare_queue.status, "resolved");
});

test("时间只能往前走，不能自己走出这个十年；Mei 一家 1994 年搬进来", () => {
  const s = API.createSession();
  assert.equal(API.propose(s, gm([{ op: "jump_time", year: 1989, month: 1, day: 1 }])).results[0].ok, false);
  assert.equal(API.propose(s, gm([{ op: "jump_time", year: 1999, month: 1, day: 1 }])).results[0].ok, false);
  assert.ok(API.propose(s, gm([{ op: "jump_time", year: 1993, month: 6, day: 1 }])).results[0].ok);
  assert.equal(s.state.actors.wangmei.map, null, "1993 年还在隔壁租房间");
  assert.ok(API.propose(s, gm([{ op: "jump_time", year: 1994, month: 6, day: 1 }])).results[0].ok);
  for (const id of ["wangmei", "jianguo", "xiaoyu"]) assert.equal(s.state.actors[id].map, "flat_mei");
  assert.notDeepEqual([s.state.actors.wangmei.x, s.state.actors.wangmei.y], [s.state.actors.jianguo.x, s.state.actors.jianguo.y], "一家人不站在同一格");
});

test("进入下一个十年由游戏端推进：账本清零、政策点恢复、时间跳到十年开头", () => {
  const s = atChen();
  const e = chenSays(s, "食咗饭未");
  API.propose(s, ch([{ op: "satisfaction", npc: "chen", delta: 2, reason: "x", evidence: [e] }]));
  API.propose(s, gm([{ op: "community_action", residents: ["chen"], description: "帮忙" }]));
  const r = API.advanceDecade(s);
  assert.ok(r.ok);
  assert.equal(s.state.decade, 2);
  assert.equal(s.state.time.year, 1999);
  assert.equal(s.state.game.points, 3);
  assert.equal(s.state.ledger.per.chen.up, 0);
  assert.equal(API.pushGameEvent(s, { type: "decade", decade: 5 }).ok, false, "不能跳过十年");
});

test("回传格式：每条都带原因、证据和十年", () => {
  const s = atChen();
  const e = chenSays(s, "多谢");
  const r = API.propose(s, ch([{ op: "satisfaction", npc: "chen", delta: 1, reason: "有人记得她", evidence: [e] }]));
  const ev = r.sent[0].event;
  assert.deepEqual(Object.keys(ev).sort(), ["category", "decade", "delta", "evidence", "reason", "resident", "source", "type"]);
  assert.equal(ev.source, "trpg");
});

test("主动来找你：同一张图就走到旁边，不在就记成敲门", () => {
  const s = atChen();
  const r = API.propose(s, ch([{ op: "initiate", npc: "chen" }])).results[0];
  assert.ok(r.ok && r.event);
  const p = s.state.actors.player, c = s.state.actors.chen;
  assert.equal(Math.abs(p.x - c.x) + Math.abs(p.y - c.y), 1);
  assert.ok(API.propose(s, ch([{ op: "initiate", npc: "huiling" }])).results[0].pending);
  assert.deepEqual(API.getView(s, "player").knocking, ["huiling"]);
});

test("骰子可复现：同一个种子同样的检定结果相同", () => {
  const roll = () => { const s = API.createSession({ seed: 7 }); return API.propose(s, gm([{ op: "roll", dc: 12, reason: "说服" }])).results[0].event.roll; };
  assert.equal(roll(), roll());
});

test("英文版：引擎文字跟着语言走", () => {
  const s = API.createSession({ lang: "en" });
  const r = API.gameAction(s, "build", "hawker");
  assert.match(r.synced[0].event.summary, /Hawker Centre/);
  assert.equal(API.getView(s, "player").decade_title, "A New Town");
});

test("设定门：不能把张力直接说出来（同一段话里出现两头）", () => {
  const s = atChen();
  const r = API.propose(s, ch([{ op: "speak", npc: "chen", text: "我系建造者，而家变咗被遗忘的人" }])).results[0];
  assert.equal(r.ok, false); assert.equal(r.leak.kind, "tension");
  API.propose(s, gm([{ op: "jump_time", year: 1994, month: 6 }]));
  API.propose(s, ui([{ op: "move", map: "flat_mei", x: 4, y: 5 }]));
  assert.equal(API.propose(s, ch([{ op: "speak", npc: "wangmei", text: "这里又熟悉又陌生" }])).results[0].ok, false);
  assert.equal(API.propose(s, gm([{ op: "narrate", text: "她站在门口，既熟悉，又陌生。" }])).results[0].ok, false, "旁白也不行");
  assert.ok(API.propose(s, ch([{ op: "speak", npc: "wangmei", text: "楼下的招牌我都认得，可是他们说的话，我一句也听不懂。" }])).results[0].ok, "用细节表现可以");
  assert.equal(API.propose(s, gm([{ op: "narrate", text: "他守着那份信念，可经历一次次反驳他。" }])).results[0].leak.match, "信念 / 经历", "成员自己的张力也算");
});

test("设定门：故事里不能出现元语言", () => {
  const s = atChen();
  assert.equal(API.propose(s, gm([{ op: "narrate", text: "陈阿姨的核心张力在这一刻显露出来" }])).results[0].leak.kind, "meta");
  const en = API.createSession({ lang: "en" });
  API.propose(en, ui([{ op: "move", map: "flat_chen", x: 4, y: 5 }]));
  assert.equal(API.propose(en, gm([{ op: "narrate", text: "Her inner tension shows." }])).results[0].ok, false);
});

test("设定门：不能照抄设定原文；原作台词可以说；说出来的秘密之后可以照说", () => {
  const s = atChen();
  const bio = W.RESIDENTS.chen.bio.zh.slice(0, 30);
  assert.equal(API.propose(s, gm([{ op: "narrate", text: "旁白：" + bio }])).results[0].leak.kind, "verbatim");
  assert.ok(API.propose(s, ch([{ op: "speak", npc: "chen", text: W.RESIDENTS.chen.quote.zh }])).results[0].ok, "原作台词不算");
  assert.ok(API.propose(s, ch([{ op: "speak", npc: "chen", text: "后生仔，唔该，冇所谓，食咗饭未？" }])).results[0].ok, "口头禅不算");
  const secret = W.RESIDENTS.chen.secrets[0].zh;
  assert.equal(API.propose(s, ch([{ op: "speak", npc: "chen", text: secret }])).results[0].ok, false, "还没说出口的秘密");
  assert.ok(API.propose(s, ch([{ op: "reveal", npc: "chen", kind: "secret", id: "daughter" }])).results[0].ok);
  assert.ok(API.propose(s, ch([{ op: "speak", npc: "chen", text: secret }])).results[0].ok, "说出来之后可以");
});

test("设定门：英文版同样检查张力两头和照抄", () => {
  const s = API.createSession({ lang: "en" });
  API.propose(s, ui([{ op: "move", map: "void_deck", x: 5, y: 3 }]));
  API.propose(s, gm([{ op: "set_scene", map: "void_deck", actors: [{ id: "kumar", x: 6, y: 4 }] }]));
  assert.equal(API.propose(s, ch([{ op: "speak", npc: "kumar", text: "Sir, behind the mask is my true self." }])).results[0].leak.kind, "tension");
  const bio = W.RESIDENTS.kumar.bio.en.split(" ").slice(0, 12).join(" ");
  assert.equal(API.propose(s, gm([{ op: "narrate", text: bio }])).results[0].leak.kind, "verbatim");
  assert.ok(API.propose(s, ch([{ op: "speak", npc: "kumar", text: "Sir, no problem one. We sit here only, five minutes." }])).results[0].ok);
});

test("设定门：场景说明和行动描述也要过", () => {
  const s = atChen();
  assert.equal(API.propose(s, gm([{ op: "set_scene", map: "flat_chen", note: "这里藏着她的张力" }])).results[0].ok, false);
  assert.equal(API.propose(s, gm([{ op: "community_action", residents: ["chen"], description: "让她从被遗忘的人变回建造者" }])).results[0].ok, false);
  assert.equal(s.sim.points, 3, "被拦下的行动不扣政策点");
});

// ---------- 林家、Mei 家按人拆开 ----------
const atLin = () => { const s = API.createSession(); API.propose(s, ui([{ op: "move", map: "flat_lin", x: 7, y: 5 }])); return s; };

test("按人拆开：一家人各有位置和印象，不在场的家人没有经历过", () => {
  const s = API.createSession();
  // 伟明在楼下跟你说话，慧玲在家
  API.propose(s, gm([{ op: "set_scene", map: "void_deck", actors: [{ id: "weiming", x: 6, y: 4 }] }]));
  API.propose(s, ui([{ op: "move", map: "void_deck", x: 5, y: 3 }]));
  const e = API.propose(s, ch([{ op: "speak", npc: "weiming", text: "没事啦，我已经有安排了。" }])).results[0].event.id;
  assert.equal(s.state.actors.huiling.map, "flat_lin");
  assert.match(API.propose(s, ch([{ op: "impression", npc: "huiling", text: "他在瞒我", evidence: [e] }])).results[0].reason, /没有经历过/);
  assert.ok(API.propose(s, ch([{ op: "impression", npc: "weiming", about: "player", text: "会听人说话", evidence: [e] }])).results[0].ok);
  assert.ok(!JSON.stringify(API.getView(s, "huiling")).includes("会听人说话"));
  assert.equal(API.propose(s, ch([{ op: "speak", npc: "lin", text: "你好" }])).results[0].ok, false, "户名不能当一个人说话");
});

test("按人拆开：只有一个人知道的秘密，只有他自己能说出来", () => {
  const s = atLin();
  const knows = (who, id, year) => W.secretsKnownBy(who, year).some((k) => k.secret.id === id);
  assert.ok(!knows("huiling", "laid_off") && knows("weiming", "laid_off"));
  assert.ok(!knows("weiming", "hk_offer"));
  assert.ok(knows("huiling", "condo"), "全家都知道的秘密");
  assert.match(API.propose(s, ch([{ op: "reveal", npc: "weiming", kind: "secret", id: "laid_off" }])).results[0].reason, /还没发生/, "1989 年还没被裁");
  API.propose(s, gm([{ op: "jump_time", year: 1998, month: 6 }]));
  API.propose(s, ui([{ op: "move", map: "flat_lin", x: 7, y: 5 }]));
  assert.ok(!API.getView(s, "huiling").secrets.some((k) => k.id === "laid_off"));
  assert.ok(API.getView(s, "weiming").secrets.some((k) => k.id === "laid_off"));
  assert.match(API.propose(s, ch([{ op: "reveal", npc: "huiling", kind: "secret", id: "laid_off" }])).results[0].reason, /一个人的秘密/);
  assert.ok(API.propose(s, ch([{ op: "reveal", npc: "weiming", kind: "secret", id: "laid_off" }])).results[0].ok);
  assert.deepEqual(s.state.revealed.secrets.lin, ["laid_off"]);
});

test("按人拆开：满意度由人提议、按户记账，一家人共用上限", () => {
  const s = atLin();
  const e1 = API.propose(s, ch([{ op: "speak", npc: "weiming", text: "你人不错" }])).results[0].event.id;
  const r1 = API.propose(s, ch([{ op: "satisfaction", npc: "weiming", delta: 2, reason: "聊得来", evidence: [e1] }]));
  assert.equal(r1.sent[0].event.resident, "lin");
  assert.equal(s.sim.satisfaction.lin, 62);
  const e2 = API.propose(s, ch([{ op: "speak", npc: "huiling", text: "谢谢你帮忙问托儿" }])).results[0].event.id;
  assert.equal(API.propose(s, ch([{ op: "satisfaction", npc: "huiling", delta: 2, reason: "帮忙", evidence: [e2] }])).results[0].applied, 0, "纯对话 +2 是整户的上限");
  const act = API.propose(s, gm([{ op: "community_action", residents: ["huiling"], need: "🧒", description: "帮他们问托儿中心的名额" }])).results[0].event;
  assert.deepEqual(act.households, ["lin"]);
  assert.equal(API.propose(s, ch([{ op: "satisfaction", npc: "weiming", delta: 4, reason: "名额", evidence: [act.id] }])).results[0].applied, 4, "对户里任何一个人做的事都算这户的行动");
});

test("按人拆开：张力倾向记在有张力的人身上，林家共同的那一对记在户上", () => {
  const s = atLin();
  const e = API.propose(s, ch([{ op: "speak", npc: "weiming", text: "这个国家给你机会，你要自己争气。" }])).results[0].event.id;
  assert.equal(API.propose(s, ch([{ op: "lean", npc: "weiming", toward: "a", evidence: [e] }])).results[0].lean, -1);
  assert.equal(API.propose(s, ch([{ op: "lean", npc: "lin", toward: "a", evidence: [e] }])).results[0].lean, -1, "家里任何一个人经历过就可以");
  assert.equal(s.state.minds.huiling.lean, 0);
  assert.equal(W.tensionOf("wangmei").a.zh, "熟悉", "Mei 家的核心张力在王美身上");
  assert.equal(W.tensionOf("jianguo"), null);
  assert.equal(W.tensionOf("mei"), null);
  API.propose(s, gm([{ op: "jump_time", year: 1994, month: 6 }]));
  API.propose(s, ui([{ op: "move", map: "flat_mei", x: 6, y: 5 }]));
  const e2 = API.propose(s, ch([{ op: "speak", npc: "jianguo", text: "坐，坐。" }])).results[0].event.id;
  assert.match(API.propose(s, ch([{ op: "lean", npc: "jianguo", toward: "a", evidence: [e2] }])).results[0].reason, /没有要记倾向的张力/);
});

test("按人拆开：太小的孩子还不会说话", () => {
  const s = atLin();
  assert.match(API.propose(s, ch([{ op: "speak", npc: "junhao", text: "叔叔好" }])).results[0].reason, /太小/);
  API.propose(s, gm([{ op: "jump_time", year: 1993, month: 3 }]));
  API.propose(s, ui([{ op: "move", map: "flat_lin", x: 7, y: 5 }]));
  assert.ok(API.propose(s, ch([{ op: "speak", npc: "junhao", text: "叔叔好" }])).results[0].ok);
});

test("Aisyah 一家按人拆开：各有目标和私有信息；1964 年的旧事只有老祖母和陈阿姨能说", () => {
  const s = API.createSession();
  API.propose(s, ui([{ op: "move", map: "flat_aisyah", x: 4, y: 5 }]));
  for (const id of ["rahman", "aisyah_kassim", "nurul", "hafiz", "mak_esah"]) {
    assert.equal(s.state.actors[id].map, "flat_aisyah");
    assert.ok(W.CHARACTERS[id].member.goal, `${id} 有自己的目标`);
  }
  assert.match(API.propose(s, ch([{ op: "speak", npc: "aisyah", text: "makan dulu" }])).results[0].reason, /按人/);
  assert.equal(API.propose(s, ch([{ op: "reveal", npc: "rahman", kind: "relation", id: "riot_1964" }])).results[0].ok, false);
  assert.equal(API.propose(s, ch([{ op: "reveal", npc: "rahman", kind: "secret", id: "riot_1964" }])).results[0].ok, false, "老祖母一个人的秘密");
  assert.ok(API.propose(s, ch([{ op: "reveal", npc: "mak_esah", kind: "relation", id: "riot_1964" }])).results[0].ok);
  assert.equal(API.propose(s, ch([{ op: "reveal", npc: "nurul", kind: "secret", id: "boyfriend" }])).results[0].ok, false, "1989 年 Nurul 才 14 岁");
  assert.equal(W.tensionOf("aisyah_kassim").b.zh, "公道", "和气 ↔ 公道 在 Aisyah 本人身上");
  assert.equal(W.tensionOf("rahman"), null);
});

test("别人家里也知道的事：王美洗碗，Aisyah 和 Kumar 看见过，林家不知道；但只有王美家的人能说出来", () => {
  const knows = (who) => W.secretsKnownBy(who, 1995).some((k) => k.household === "mei" && k.secret.id === "dishwashing");
  assert.ok(knows("aisyah_kassim") && knows("kumar") && knows("wangmei") && knows("jianguo"));
  assert.ok(!knows("huiling") && !knows("rahman"));
  const s = API.createSession();
  API.propose(s, gm([{ op: "jump_time", year: 1995, month: 3 }]));
  API.propose(s, ui([{ op: "move", map: "flat_aisyah", x: 4, y: 5 }]));
  assert.equal(API.propose(s, ch([{ op: "reveal", npc: "aisyah_kassim", kind: "secret", id: "dishwashing" }])).results[0].ok, false);
});

test("Kumar：Priya 1990 年生，2008 年上大学，借钱的事 2008 年以前不成立", () => {
  assert.equal(W.secretsKnownBy("kumar", 1999).some((k) => k.secret.id === "loan"), false);
  assert.ok(W.secretsKnownBy("kumar", 2009).some((k) => k.secret.id === "loan"));
});
