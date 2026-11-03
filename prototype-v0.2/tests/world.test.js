const test = require("node:test");
const assert = require("node:assert/strict");
const { W, M, H } = require("./load");

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

test("只有各家的房间：每家一扇门，门不通到别的图，进门的地方能站人、走得到屋里每一格", () => {
  // 11-02 Polaris：只做每个住户自己的房间，办公室、走廊、楼下都不做
  assert.deepEqual(Object.keys(M.MAPS).sort(), [...M.HOMES].sort(), "地图只有门牌栏上的这几家");
  assert.equal(new Set(M.HOMES).size, M.HOMES.length, "门牌不重复");
  const homes = Object.values(W.RESIDENTS).map((r) => r.home);
  assert.deepEqual([...homes].sort(), [...M.HOMES].sort(), "每户人家各有一张图，每张图都是某一户的家");
  const furnitureCells = (id) => new Set((M.FURNITURE[id] || []).map(([, x, y]) => x + "," + y));
  for (const [id, m] of Object.entries(M.MAPS)) {
    const width = m.rows[0].length;
    m.rows.forEach((row, y) => assert.equal(row.length, width, `${id} 第 ${y} 行宽度`));
    const letters = Object.keys(m.exits);
    assert.equal(letters.length, 1, `${id} 只有一扇门`);
    const [letter] = letters;
    assert.ok(/^[A-Z]$/.test(letter), `${id} 的门用一个字母`);
    assert.ok(!m.exits[letter].to && !m.exits[letter].at, `${id}.${letter} 的门不再通到别的图`);
    for (const row of m.rows) for (const c of row) assert.ok(c === "#" || c === "." || c === letter, `${id} 图上有图例以外的格子 ${c}`);
    const doorCells = [];
    m.rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === letter) doorCells.push([x, y]); }));
    assert.equal(doorCells.length, 1, `${id} 的门只有一格`);
    assert.deepEqual(M.doorOf(id), doorCells[0], `${id} 的 doorOf`);
    const [dx, dy] = doorCells[0];
    assert.ok(M.isExit(id, dx, dy));
    assert.ok(dx === 0 || dy === 0 || dx === width - 1 || dy === m.rows.length - 1, `${id} 的门开在外墙上`);
    const entry = M.entryOf(id);
    assert.ok(entry, `${id} 有进门的地方`);
    const [ex, ey] = entry;
    assert.equal(Math.abs(ex - dx) + Math.abs(ey - dy), 1, `${id} 进门的地方挨着门`);
    assert.ok(M.standable(id, ex, ey) && M.placeable(id, ex, ey) && !M.isExit(id, ex, ey), `${id} 进门的地方 (${entry}) 是能站人的地面`);
    const furn = furnitureCells(id);
    assert.ok(!furn.has(ex + "," + ey), `${id} 进门的地方 (${entry}) 被家具挡住了`);
    // 从进门的地方走得到屋里每一格没有家具的地面（家具不能把屋子隔断）
    const seen = new Set([ex + "," + ey]), queue = [[ex, ey]];
    while (queue.length) {
      const [x, y] = queue.shift();
      for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + sx, ny = y + sy, k = nx + "," + ny;
        if (seen.has(k) || !M.placeable(id, nx, ny) || furn.has(k)) continue;
        seen.add(k); queue.push([nx, ny]);
      }
    }
    m.rows.forEach((row, y) => [...row].forEach((c, x) => {
      if (c === "." && !furn.has(x + "," + y)) assert.ok(seen.has(x + "," + y), `${id} 的 (${x},${y}) 从门口走不到`);
    }));
    assert.ok(!("plots" in m), `${id} 上不画游戏端的地块`);
  }
  // 开局每个在场的人都站在自己家里能站人的地方，门口那一格空着
  const s = H.createState();
  for (const a of Object.values(s.actors)) {
    if (!a.map) continue;
    assert.ok(M.HOMES.includes(a.map), `${a.id} 在 ${a.map}`);
    if (a.kind === "resident") assert.equal(a.map, W.RESIDENTS[a.household].home, `${a.id} 开局在自己家`);
    assert.ok(H.canStand(s, a.map, a.x, a.y) || (a.kind === "player" && M.standable(a.map, a.x, a.y)), `${a.id} 站的 (${a.x},${a.y}) 不能站人`);
  }
  assert.deepEqual([s.actors.player.map, s.actors.player.x, s.actors.player.y], ["flat_chen"].concat(M.entryOf("flat_chen")), "玩家开局站在陈阿姨家进门的地方");
});

test("物件只能出现在允许的地图上", () => {
  for (const [k, p] of Object.entries(M.PROPS)) for (const m of p.maps) assert.ok(m === "*" || M.MAPS[m], `${k} 的地图 ${m}`);
  // 只在公共空间出现的东西（马来婚礼棚、灵堂、长凳、公告板、清洁推车、办公桌、鞋架、楼下的象棋桌）不再摆在地图上
  for (const k of ["wedding_tent", "funeral_wake", "bench", "notice", "trolley", "desk", "shoe_rack", "chess_table"]) {
    assert.ok(!M.PROPS[k], `${k} 已经拿掉了`);
    for (const m of M.HOMES) assert.equal(M.propAllowed(k, m), false, `${k} 不能出现在 ${m}`);
  }
  for (const m of ["flat_chen", "flat_lin", "flat_aisyah", "flat_mei"]) assert.equal(M.propAllowed("kuih_tray", m), true, `马来糕可以送到 ${m}`);
  assert.equal(M.propAllowed("long_table", "flat_aisyah"), true);
  for (const m of M.HOMES.filter((x) => x !== "flat_aisyah")) assert.equal(M.propAllowed("long_table", m), false, `长木桌不能出现在 ${m}`);
  assert.equal(M.propAllowed("sofa", "flat_chen"), false);
  assert.equal(M.propAllowed("kopi_cup", "dorm"), true);
  // 固定家具也是物件：种类要有、要允许出现在这张图上、摆在地面上、一格只放一件
  assert.deepEqual(Object.keys(M.FURNITURE).sort(), Object.keys(M.MAPS).sort());
  for (const [map, list] of Object.entries(M.FURNITURE)) {
    const cells = new Set();
    for (const [kind, x, y] of list) {
      assert.ok(M.PROPS[kind], `${map} 的家具 ${kind}`);
      assert.ok(M.propAllowed(kind, map), `${kind} 不能出现在 ${map}，却是那里的固定家具`);
      assert.ok(M.placeable(map, x, y), `${map} 的 ${kind} 摆在 (${x},${y})，不是地面`);
      assert.ok(!cells.has(x + "," + y), `${map} 的 (${x},${y}) 摆了两件家具`);
      cells.add(x + "," + y);
    }
  }
});
