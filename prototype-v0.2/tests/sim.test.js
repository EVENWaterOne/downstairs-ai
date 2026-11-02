const test = require("node:test");
const assert = require("node:assert/strict");
const { S } = require("./load");

test("建智能社区中心：陈阿姨用不上（要手机预约），满意度下降；Kumar 被挡在外面", () => {
  const s = S.createSim();
  const r = S.build(s, "smart");
  assert.ok(r.ok);
  assert.ok(r.event.deltas.chen < 0);
  assert.deepEqual(r.event.barriers.chen, ["📱"]);
  assert.deepEqual(r.event.barriers.kumar, ["🚫"]);
  assert.ok(r.event.deltas.mei > 0, "Mei 能用，需求对口");
});

test("熟食中心：Aisyah 家没有清真食物；批准涨租后 Mei 和 Kumar 也吃不起", () => {
  const s = S.createSim();
  S.build(s, "hawker");
  assert.deepEqual(S.barriersFor(s, "hawker", "aisyah"), ["🍲"]);
  assert.ok(S.enact(s, "rent_rise").ok);
  assert.deepEqual(S.barriersFor(s, "hawker", "mei"), ["💲"]);
  assert.deepEqual(S.barriersFor(s, "hawker", "aisyah"), ["🍲", "💲"]);
});

test("政策前提：没建熟食中心不能涨租；没收紧配额不需要弹性申请", () => {
  const s = S.createSim();
  assert.equal(S.enact(s, "rent_rise").ok, false);
  assert.equal(S.enact(s, "flexible").ok, false);
  S.enact(s, "tighten_quota");
  assert.ok(S.enact(s, "flexible").ok);
});

test("政策点：每个十年 3 点，用完不能再建；进入下一个十年恢复", () => {
  const s = S.createSim();
  for (const c of ["club", "bus", "roof"]) assert.ok(S.build(s, c).ok);
  assert.equal(S.build(s, "rain").ok, false);
  S.nextDecade(s);
  assert.equal(s.points, 3);
  assert.equal(s.year, 1999);
});

test("满意度在 0–100 之间", () => {
  const s = S.createSim();
  S.adjust(s, "kumar", -999);
  assert.equal(s.satisfaction.kumar, 0);
});

test("只接受 V0.2 的回传和政策点消耗", () => {
  const s = S.createSim();
  assert.ok(S.applyTrpg(s, { type: "trpg_feedback", resident: "chen", delta: 2 }).ok);
  assert.equal(s.satisfaction.chen, 57);
  assert.ok(S.applyTrpg(s, { type: "trpg_spend", points: 1 }).ok);
  assert.equal(s.points, 2);
  assert.equal(S.applyTrpg(s, { type: "build", card: "smart" }).ok, false);
});

test("预置剧本能跑完前三个十年", () => {
  for (const name of Object.keys(S.SCRIPTS)) {
    const s = S.createSim();
    for (let d = 1; d <= 3; d++) {
      const rs = S.runScript(s, name);
      rs.forEach((r) => assert.ok(r.ok, `${name} 第 ${d} 个十年：${r.reason}`));
      if (d < 3) S.nextDecade(s);
    }
  }
});
