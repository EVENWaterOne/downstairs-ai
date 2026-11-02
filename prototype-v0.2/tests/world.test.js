const test = require("node:test");
const assert = require("node:assert/strict");
const { W, M } = require("./load");

function bilingual(obj, where) {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const keys = Object.keys(obj);
    if (keys.includes("zh") || keys.includes("en")) {
      assert.ok(typeof obj.zh === "string" && obj.zh.length, `${where} 缺中文`);
      assert.ok(typeof obj.en === "string" && obj.en.length, `${where} 缺英文`);
    }
    for (const k of keys) if (k !== "zh" && k !== "en") bilingual(obj[k], where + "." + k);
  } else if (Array.isArray(obj)) obj.forEach((x, i) => bilingual(x, `${where}[${i}]`));
}

test("所有面向玩家的文字都有中英两份", () => {
  for (const k of ["NEEDS", "BARRIERS", "BADGES", "FACILITIES", "POLICIES", "RESIDENTS", "RELATIONS", "SUPPORTING", "DECADES", "CLOCK_SEEDS", "SETTING_NOTES", "TONE_NOTES", "DISCLOSURE_NOTES"]) bilingual(W[k], k);
  bilingual(M.MAPS, "MAPS");
  bilingual(M.PROPS, "PROPS");
});

test("住户字段沿用 Downstairs 的 id，需求和障碍都有定义", () => {
  assert.deepEqual(Object.keys(W.RESIDENTS).sort(), ["aisyah", "chen", "kumar", "lin", "mei"]);
  for (const [id, r] of Object.entries(W.RESIDENTS)) {
    for (const n of r.needs) assert.ok(W.NEEDS[n], `${id} 的需求 ${n}`);
    for (const b of r.barriers) assert.ok(W.BARRIERS[b], `${id} 的障碍 ${b}`);
    assert.ok(M.MAPS[r.home], `${id} 的家 ${r.home}`);
    assert.ok(r.tension.a && r.tension.b, `${id} 的核心张力`);
    assert.equal(r.stages.length, 3, `${id} 前三个十年的人生阶段`);
  }
  assert.ok(W.RESIDENTS.mei.tension.anchor, "Mei 的锚点");
});

test("角色：林家、Mei 家按人拆开，其他户本身就是一个角色；id 不重复", () => {
  assert.deepEqual(W.charactersAt(1989).sort(), ["aisyah_kassim", "chen", "hafiz", "huiling", "junhao", "kumar", "mak_esah", "nurul", "rahman", "weiming"]);
  assert.ok(!W.charactersAt(2001).includes("mak_esah") && !W.charactersAt(2003).includes("nurul"));
  assert.ok(["wangmei", "jianguo", "xiaoyu"].every((id) => W.charactersAt(1994).includes(id)));
  assert.ok(!W.charactersAt(2011).includes("junhao"), "俊豪去澳洲读书");
  for (const id of Object.keys(W.CHARACTERS)) assert.ok(!W.RESIDENTS[id] || !W.RESIDENTS[id].split, `${id} 和拆开的户重名`);
  for (const [hid, r] of Object.entries(W.RESIDENTS)) for (const s of r.secrets) if (s.holder) assert.ok(r.members.some((m) => m.id === s.holder), `${hid}.${s.id} 的 holder`);
  assert.equal(W.tensionOf("lin").a.zh, "往上走");
  assert.equal(W.tensionOf("weiming").a.zh, "信念");
  assert.equal(W.tensionOf("huiling").b.zh, "这个家");
});

test("时间线：孩子上学、服役的年份对得上（新加坡 7 岁那年上小一，小六考 PSLE）", () => {
  const born = (hid, id) => W.RESIDENTS[hid].members.find((m) => m.id === id).born;
  assert.equal(born("lin", "junhao") + 7, 1995, "俊豪 1995 年上小一");
  assert.equal(born("lin", "junhao") + 12, 2000, "2000 年考 PSLE");
  assert.equal(born("mei", "xiaoyu") + 7, 1993, "晓雨 1993 年上小一");
  assert.ok(W.RESIDENTS.lin.secrets.find((s) => s.id === "laid_off").zh.includes("1998"));
  assert.ok(!W.RESIDENTS.kumar.stages[1].zh.includes("毕业"), "Priya 1990 年生，第 2 个十年还没大学毕业");
  assert.ok(W.RESIDENTS.kumar.stages[2].zh.includes("2012 年 Priya 大学毕业"));
  for (const [hid, r] of Object.entries(W.RESIDENTS)) for (const x of r.secrets) for (const k of x.known_to || []) assert.ok(W.CHARACTERS[k] && W.householdOf(k) !== hid, `${hid}.${x.id} 的 known_to ${k}`);
  for (const rel of W.RELATIONS) for (const k of rel.members || []) assert.ok(rel.between.includes(W.householdOf(k)), `${rel.id} 的 members ${k}`);
});

test("十个十年连续覆盖 1989–2088 的地契", () => {
  assert.equal(W.DECADES.length, 10);
  assert.equal(W.DECADES[0].years[0], 1989);
  assert.equal(W.DECADES[9].years[1], 2088);
  for (let i = 1; i < 10; i++) assert.equal(W.DECADES[i].years[0], W.DECADES[i - 1].years[1] + 1);
});

test("Mei 一家 1994 年才搬来（317A 的屋主住满 5 年才能转售）；Kumar 2014 年回国，由 Murugan 接班", () => {
  assert.equal(W.livesHere("mei", 1993), false);
  assert.equal(W.livesHere("mei", 1994), true);
  assert.deepEqual(W.membersAt("kumar", 2013).map((m) => m.id), ["kumar"]);
  assert.deepEqual(W.membersAt("kumar", 2014).map((m) => m.id), ["murugan"]);
});

test("地图出入口互相连通，落点都能站人", () => {
  for (const [id, m] of Object.entries(M.MAPS)) {
    const width = m.rows[0].length;
    m.rows.forEach((row, y) => assert.equal(row.length, width, `${id} 第 ${y} 行宽度`));
    for (const [letter, ex] of Object.entries(m.exits)) {
      assert.ok(m.rows.some((row) => row.includes(letter)), `${id} 图上没有出口 ${letter}`);
      assert.ok(M.MAPS[ex.to], `${id}.${letter} 通往不存在的 ${ex.to}`);
      assert.ok(M.standable(ex.to, ex.at[0], ex.at[1]), `${id}.${letter} 的落点 ${ex.to}(${ex.at}) 不能站人`);
    }
  }
  for (const [n, [x, y]] of Object.entries(M.MAPS.void_deck.plots)) assert.equal(M.tile("void_deck", x, y), n, `地块 ${n}`);
});

test("物件只能出现在允许的地图上", () => {
  for (const [k, p] of Object.entries(M.PROPS)) for (const m of p.maps) assert.ok(m === "*" || M.MAPS[m], `${k} 的地图 ${m}`);
  assert.equal(M.propAllowed("wedding_tent", "void_deck"), true);
  assert.equal(M.propAllowed("wedding_tent", "flat_lin"), false);
  assert.equal(M.propAllowed("kopi_cup", "dorm"), true);
});
