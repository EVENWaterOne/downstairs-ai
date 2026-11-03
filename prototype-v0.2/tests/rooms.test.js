// 11-02 Polaris："只做每个住户自己的房间和交互，办公室和房间走廊之类的不用做"。
// 只剩五张图（四户的家和宿舍的一间房）以后的规矩：门不通到别的图，换一家用门牌（B.visit），
// 还没搬来、家里没人的去不了；不在地图上的人记着去处；GM 从「各家现在」知道各家有谁，住户看不到这一块。
const test = require("node:test");
const assert = require("node:assert/strict");
const { W, M, H, API, B, D, P, Mock, Turn } = require("./load");

const HAN = /\p{Script=Han}/u;
const key = (x, y) => x + "," + y;
const HOMES = ["flat_chen", "flat_lin", "flat_aisyah", "flat_mei", "dorm"];

function game(lang, dayId) {
  const s = API.createSession({ lang: lang || "zh" });
  D.begin(s.state);
  if (dayId) assert.ok(D.startDay(s.state, dayId).ok);
  return s;
}
const where = (state, id) => { const a = state.actors[id]; return [a.map, a.x, a.y]; };
const residentsOn = (state, map) => Object.values(state.actors).filter((a) => a.kind === "resident" && a.map === map && W.characterPresent(a.id, state.time.year)).map((a) => a.id);
function clearMap(state, map) { for (const id of residentsOn(state, map)) Object.assign(state.actors[id], { map: null, x: null, y: null }); }
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
const gmText = (state) => { const p = P.gmPrompt(state, { input: "hi", identity: state.lang === "en" ? P.DEFAULT_IDENTITY_EN : P.DEFAULT_IDENTITY }); return { p, text: p.system + p.user }; };
const charText = (state, id) => { const p = P.characterPrompt(state, id, { input: "hi", identity: state.lang === "en" ? P.DEFAULT_IDENTITY_EN : P.DEFAULT_IDENTITY, turnEvents: [] }); return p.system + p.user; };
// 「各家现在」那一块：从标题行到下一个 ## 之前
function homesBlockOf(user, lang) {
  const head = lang === "en" ? "The homes right now" : "各家现在";
  const i = user.indexOf(head);
  if (i < 0) return null;
  const j = user.indexOf("\n## ", i);
  return user.slice(i, j < 0 ? undefined : j);
}
const lineOf = (block, map) => block.split("\n").find((l) => l.startsWith(`- ${map}`)) || "";

// ---------------- 地图 ----------------
test("只有五张图：四户的家和宿舍；没有办公室、走廊和楼下", () => {
  assert.deepEqual(M.HOMES, HOMES);
  assert.deepEqual(Object.keys(M.MAPS).sort(), [...HOMES].sort());
  for (const gone of ["office", "corridor", "void_deck"]) {
    assert.equal(M.MAPS[gone], undefined, gone);
    assert.equal(M.FURNITURE[gone], undefined, gone);
  }
  assert.equal(M.isPlot, undefined);
  assert.equal(B.exitOpen, undefined);
  // 每一户的家都在这五张图里
  for (const [hid, r] of Object.entries(W.RESIDENTS)) assert.ok(HOMES.includes(r.home), `${hid} 的家 ${r.home} 不在地图里`);
  for (const map of HOMES) {
    const m = M.MAPS[map];
    for (const f of ["name", "short"]) {
      assert.ok(m[f] && m[f].zh && m[f].en, `${map} 少了 ${f}`);
      assert.ok(!HAN.test(m[f].en), `${map} 的英文 ${f} 里有汉字：${m[f].en}`);
    }
    // 图例只有墙、地面和这一家的门；门只有一个字母，不通到别的图
    const doors = Object.keys(m.exits);
    assert.equal(doors.length, 1, `${map} 应该只有一扇门`);
    assert.deepEqual(m.exits[doors[0]], {}, `${map} 的门不该再写 to/at`);
    for (const row of m.rows) for (const c of row) assert.ok(c === "#" || c === "." || c === doors[0], `${map} 里有不认识的格子 ${c}`);
    // 门在墙上（图的边上），门里面那一格是挨着门的地面
    const door = M.doorOf(map), entry = M.entryOf(map);
    assert.ok(door && M.isExit(map, ...door), map);
    assert.ok(door[1] === 0 || door[1] === m.rows.length - 1 || door[0] === 0 || door[0] === m.rows[door[1]].length - 1, `${map} 的门不在边上`);
    assert.ok(entry && M.placeable(map, ...entry) && !M.isExit(map, ...entry), `${map} 进门的地方不是地面`);
    assert.equal(Math.abs(entry[0] - door[0]) + Math.abs(entry[1] - door[1]), 1, `${map} 进门的地方不挨着门`);
    assert.equal(H.furnitureAt(null, map, ...entry), null, `${map} 进门的地方摆着家具`);
  }
  assert.equal(M.doorOf("void_deck"), null);
  assert.equal(M.entryOf("office"), null);
});

test("物件：只在公共空间出现的东西拿掉了，其他的只写各家；马来糕每一户都能有", () => {
  for (const gone of ["chess_table", "wedding_tent", "funeral_wake", "shoe_rack", "notice", "bench", "trolley", "desk"]) assert.equal(M.PROPS[gone], undefined, gone);
  for (const [kind, p] of Object.entries(M.PROPS)) {
    assert.ok(p.name.zh && p.name.en && !HAN.test(p.name.en), kind);
    for (const map of p.maps) assert.ok(map === "*" || HOMES.includes(map), `${kind} 还写着 ${map}`);
  }
  for (const map of ["flat_chen", "flat_lin", "flat_aisyah", "flat_mei"]) assert.ok(M.propAllowed("kuih_tray", map), map);
  assert.equal(M.propAllowed("kuih_tray", "dorm"), false);
});

// ---------------- 门牌 ----------------
test("门牌：还没搬来的去不了，两种语言都有理由；玩家留在原地", () => {
  for (const lang of ["zh", "en"]) {
    const s = game(lang), state = s.state;
    const before = where(state, "player"), time = JSON.stringify(state.time);
    const v = H.canVisit(state, "flat_mei");
    assert.equal(v.ok, false);
    assert.equal(v.code, "not_yet");
    const r = B.visit(state, "flat_mei");
    assert.equal(r.ok, false);
    assert.match(r.reason.zh, /还没搬来/);
    assert.match(r.reason.en, /hasn't moved in/);
    assert.ok(!HAN.test(r.reason.en), r.reason.en);
    assert.deepEqual(where(state, "player"), before);
    assert.equal(JSON.stringify(state.time), time);
    // 没有的图也去不了
    const none = B.visit(state, "void_deck");
    assert.equal(none.ok, false);
    assert.equal(H.canVisit(state, "void_deck").code, "no_map");
    assert.ok(none.reason.zh && none.reason.en && !HAN.test(none.reason.en));
    assert.deepEqual(where(state, "player"), before);
  }
});

test("门牌：家里没人去不了；有人在家（来做客的也算）就去得了", () => {
  const s = game(), state = s.state;
  const before = where(state, "player");
  // 上任第一天的上午，林家三口都出门了
  assert.deepEqual(residentsOn(state, "flat_lin"), []);
  const v = H.canVisit(state, "flat_lin");
  assert.equal(v.ok, false);
  assert.equal(v.code, "nobody");
  assert.ok(v.reason.zh && v.reason.en && !HAN.test(v.reason.en));
  const r = B.visit(state, "flat_lin");
  assert.equal(r.ok, false);
  assert.match(r.reason.zh, /没人在家/);
  assert.match(r.reason.en, /Nobody is home/);
  assert.deepEqual(where(state, "player"), before);
  // 别家的人来林家做客，也算有人
  Object.assign(state.actors.aisyah_kassim, { map: "flat_lin", x: 3, y: 3 });
  assert.equal(H.canVisit(state, "flat_lin").ok, true);
  assert.equal(B.visit(state, "flat_lin").ok, true);
  assert.equal(state.actors.player.map, "flat_lin");
});

test("门牌：宿舍一直能去；去自己所在的这一家不算换", () => {
  const s = game(), state = s.state;
  // 上任第一天的上午 Kumar 在楼里干活，宿舍里没有角色
  assert.equal(state.actors.kumar.map, null);
  assert.deepEqual(residentsOn(state, "dorm"), []);
  assert.equal(H.canVisit(state, "dorm").ok, true);
  const before = where(state, "player");
  assert.deepEqual(B.visit(state, "flat_chen"), { ok: false, same: true });
  assert.deepEqual(where(state, "player"), before);
  const r = B.visit(state, "dorm");
  assert.equal(r.ok, true);
  assert.equal(r.changedMap, true);
  assert.equal(r.from, "flat_chen");
  assert.deepEqual(where(state, "player"), ["dorm", ...M.entryOf("dorm")]);
  assert.deepEqual(B.visit(state, "dorm"), { ok: false, same: true });
});

test("门牌：站到进门的那一格，被占了就站最近的空位，不站在门上，不花时间", () => {
  const s = game(), state = s.state, p = state.actors.player;
  const time = JSON.stringify(state.time);
  const r = B.visit(state, "flat_aisyah");
  assert.equal(r.ok, true);
  assert.equal(r.changedMap, true);
  assert.equal(r.from, "flat_chen");
  assert.deepEqual(where(state, "player"), ["flat_aisyah", ...M.entryOf("flat_aisyah")]);
  assert.equal(JSON.stringify(state.time), time);
  assert.equal(state.scene.map, "flat_aisyah");
  // 回陈阿姨家，进门那一格有人（只为测试硬放的）：站到旁边最近的空位
  const [ex, ey] = M.entryOf("flat_chen");
  Object.assign(state.actors.weiming, { map: "flat_chen", x: ex, y: ey });
  const back = B.visit(state, "flat_chen");
  assert.equal(back.ok, true);
  assert.equal(back.from, "flat_aisyah");
  assert.equal(p.map, "flat_chen");
  assert.notDeepEqual([p.x, p.y], [ex, ey]);
  assert.ok(!M.isExit("flat_chen", p.x, p.y), "玩家站到了门上");
  assert.ok(M.standable("flat_chen", p.x, p.y) && !B.furnitureAt(state, "flat_chen", p.x, p.y));
  assert.equal(Math.abs(p.x - ex) + Math.abs(p.y - ey), 1, "没有站在最近的空位");
  // 门里那一格和它旁边能站的两格都有人（硬放的）：再近也不站门上，往屋里找
  assert.equal(B.visit(state, "flat_aisyah").ok, true);
  Object.assign(state.actors.huiling, { map: "flat_chen", x: 4, y: 5 });
  Object.assign(state.actors.junhao, { map: "flat_chen", x: 5, y: 6 });
  assert.equal(B.visit(state, "flat_chen").ok, true);
  assert.ok(!M.isExit("flat_chen", p.x, p.y), `玩家站到了门上 (${p.x},${p.y})`);
  assert.ok(B.free(state, "flat_chen", p.x, p.y, "player"));
});

// ---------------- GM 的 move ----------------
test("GM 带玩家去没人在家、还没搬来的一家：退回，英文局的理由是英文", async () => {
  const s = game("en"), state = s.state;
  const before = where(state, "player");
  const mei = H.applyOp(state, { op: "move", actor: "player", map: "flat_mei" }, { by: "gm" });
  assert.equal(mei.ok, false);
  assert.match(mei.reason, /^flat_mei: this family hasn't moved in yet/);
  assert.ok(!HAN.test(mei.reason), mei.reason);
  const lin = H.applyOp(state, { op: "move", actor: "player", map: "flat_lin", x: 3, y: 3 }, { by: "gm" });
  assert.equal(lin.ok, false);
  assert.match(lin.reason, /^flat_lin: nobody is home/);
  assert.ok(!HAN.test(lin.reason), lin.reason);
  assert.deepEqual(where(state, "player"), before);
  // 走一整轮也一样：GM 写的 move 被退回，理由是英文
  const llm = fake({ gm: (ctx) => (ctx.retry ? { ops: [] } : { ops: [{ op: "move", actor: "player", map: "flat_lin" }, { op: "move", actor: "player", map: "flat_mei" }], responders: [] }) });
  const res = await Turn.playerTurn(s, "Let's go and see the Lims", { llm, to: "gm" });
  const results = res.calls[0].results;
  assert.equal(results[0].ok, false);
  assert.equal(results[1].ok, false);
  for (const x of results) assert.ok(x.reason && !HAN.test(x.reason), x.reason);
  assert.deepEqual(where(state, "player"), before);
  // 中文局是中文理由
  const zh = game("zh").state;
  assert.equal(H.applyOp(zh, { op: "move", actor: "player", map: "flat_lin" }, { by: "gm" }).reason, "flat_lin 家里没人，玩家去不了");
  assert.equal(H.applyOp(zh, { op: "move", actor: "player", map: "flat_mei" }, { by: "gm" }).reason, "flat_mei 这户人家还没搬来，玩家去不了");
});

test("GM 的 move 只写 map 不写 x、y：站在进门的地方；被占了站最近的空位", () => {
  const s = game("en"), state = s.state, p = state.actors.player;
  const r = H.applyOp(state, { op: "move", actor: "player", map: "flat_aisyah" }, { by: "gm" });
  assert.equal(r.ok, true);
  assert.equal(r.changedMap, true);
  assert.deepEqual(where(state, "player"), ["flat_aisyah", ...M.entryOf("flat_aisyah")]);
  assert.equal(state.scene.map, "flat_aisyah");
  // 进门那一格有人（只为测试硬放的）
  const [ex, ey] = M.entryOf("flat_chen");
  Object.assign(state.actors.weiming, { map: "flat_chen", x: ex, y: ey });
  assert.equal(H.applyOp(state, { op: "move", actor: "player", map: "flat_chen" }, { by: "gm" }).ok, true);
  assert.equal(p.map, "flat_chen");
  assert.equal(Math.abs(p.x - ex) + Math.abs(p.y - ey), 1);
  assert.ok(!M.isExit("flat_chen", p.x, p.y) && !B.furnitureAt(state, "flat_chen", p.x, p.y));
  // 门里那一格和右边都有人：不写坐标也不站门上
  assert.equal(H.applyOp(state, { op: "move", actor: "player", map: "flat_aisyah" }, { by: "gm" }).ok, true);
  Object.assign(state.actors.junhao, { map: "flat_chen", x: 5, y: 6 });
  assert.equal(H.applyOp(state, { op: "move", actor: "player", map: "flat_chen" }, { by: "gm" }).ok, true);
  assert.ok(!M.isExit("flat_chen", p.x, p.y), `玩家站到了门上 (${p.x},${p.y})`);
  // 门不通到别处，GM 写了门的坐标也不行（同一张图、换一张图都一样），英文理由
  const [dx, dy] = M.doorOf("flat_chen");
  const onDoor = H.applyOp(state, { op: "move", actor: "player", x: dx, y: dy }, { by: "gm" });
  assert.equal(onDoor.ok, false);
  assert.ok(!HAN.test(onDoor.reason), onDoor.reason);
  assert.equal(H.applyOp(state, { op: "move", actor: "player", map: "flat_aisyah", x: 6, y: 9 }, { by: "gm" }).ok, false);
  assert.ok(M.isExit("flat_aisyah", 6, 9));
  // 住户自己不能换图，要换用 leave
  assert.equal(H.applyOp(state, { op: "move", actor: "chen", map: "flat_aisyah" }, { by: "character" }).ok, false);
  // 界面只能移动玩家
  assert.equal(H.applyOp(state, { op: "move", actor: "chen", map: "flat_aisyah" }, { by: "ui" }).ok, false);
});

test("GM 用 move 带 map 叫人进门：不写 x、y 也绝不站在门口那唯一一格，也不堵门", () => {
  const s = game(), state = s.state, p = state.actors.player;
  const map = "flat_chen";
  const [ex, ey] = M.entryOf(map), [dx, dy] = M.doorOf(map);
  // 陈阿姨家的门 (4,7) 只有 (4,6) 走得进去
  const doorNeighbours = B.DIRS.map(([x, y]) => [dx + x, dy + y]).filter(([x, y]) => M.standable(map, x, y) && !B.furnitureAt(state, map, x, y));
  assert.deepEqual(doorNeighbours, [[ex, ey]]);
  // 玩家先走开，让进门那一格空着
  assert.equal(H.applyOp(state, { op: "move", actor: "player", x: 5, y: 2 }, { by: "ui" }).ok, true);
  const guests = W.charactersAt(state.time.year).filter((id) => W.householdOf(id) !== "chen");
  assert.ok(guests.length >= 6);
  for (const id of guests) {
    const r = H.applyOp(state, { op: "move", actor: id, map }, { by: "gm" });
    assert.equal(r.ok, true, `${id}：${r.reason}`);
    const a = state.actors[id];
    assert.equal(a.map, map);
    assert.notDeepEqual([a.x, a.y], [ex, ey], `${id} 站在了门口那一格`);
    assert.ok(!M.isExit(map, a.x, a.y), `${id} 站在了门上`);
    assert.ok(M.standable(map, a.x, a.y) && !B.furnitureAt(state, map, a.x, a.y), `${id} 站在 (${a.x},${a.y})`);
    assert.equal(H.blocksDoor(state, map, a.x, a.y, id), false, `${id} 堵住了门`);
  }
  // 没有两个人占同一格；进门那一格一直空着，玩家走得到
  const cells = residentsOn(state, map).map((id) => key(state.actors[id].x, state.actors[id].y));
  assert.equal(new Set(cells).size, cells.length);
  assert.equal(B.personAt(state, map, ex, ey), null);
  assert.ok(B.free(state, map, ex, ey, "player"));
  // 写了门口那一格的坐标：退回
  const extra = guests[0];
  const bad = H.applyOp(state, { op: "move", actor: extra, x: ex, y: ey }, { by: "gm" });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /门口/);
  assert.equal(p.map, map);
  // 人都进来以后，站在进门那一格的玩家还走得到屋里大部分地方
  assert.equal(H.applyOp(state, { op: "move", actor: "player", x: ex, y: ey }, { by: "ui" }).ok, true);
  const open = [];
  for (let y = 0; y < M.MAPS[map].rows.length; y++) for (let x = 0; x < M.MAPS[map].rows[y].length; x++) if (B.free(state, map, x, y, "player") && !M.isExit(map, x, y)) open.push([x, y]);
  const reach = open.filter(([x, y]) => B.path(state, map, [ex, ey], [x, y]));
  assert.ok(reach.length * 2 >= open.length, `进门以后只走得到 ${reach.length}/${open.length} 格`);
});

test("门口那一格空着也不够：几个人把它和屋里隔开就退回（move、set_scene、extras 都查，中英文理由）", () => {
  for (const lang of ["zh", "en"]) {
    const s = game(lang), state = s.state;
    const map = "flat_chen", [ex, ey] = M.entryOf(map);
    assert.deepEqual([ex, ey], [4, 6]);
    // 陈阿姨家门里那一格：左边 (3,6) 是木屐，能走的只有上面 (4,5) 和右边 (5,6)
    assert.ok(B.furnitureAt(state, map, 3, 6));
    assert.equal(H.applyOp(state, { op: "move", actor: "player", x: 5, y: 2 }, { by: "ui" }).ok, true);
    // 一个人站 (4,5)：右边还通，可以
    const one = H.applyOp(state, { op: "move", actor: "weiming", map, x: 4, y: 5 }, { by: "gm" });
    assert.equal(one.ok, true, one.reason);
    // 第二个人站 (5,6)：进门的人就困在门口，退回
    const two = H.applyOp(state, { op: "move", actor: "huiling", map, x: 5, y: 6 }, { by: "gm" });
    assert.equal(two.ok, false);
    assert.equal(H.blocksDoor(state, map, 5, 6, "huiling"), "seal");
    if (lang === "en") { assert.ok(!HAN.test(two.reason), two.reason); assert.match(two.reason, /doorway/); }
    else assert.match(two.reason, /进门的路堵住/);
    // 配角也一样
    const ex2 = H.applyOp(state, { op: "extras", label: lang === "en" ? "Kids" : "小孩", count: 2, map, x: 5, y: 6 }, { by: "gm" });
    assert.equal(ex2.ok, false);
    // 角落里隔开一两格没关系：(1,5) 一站，(1,6)、(2,6) 走不到了，照样可以
    const corner = H.applyOp(state, { op: "move", actor: "huiling", map, x: 1, y: 5 }, { by: "gm" });
    assert.equal(corner.ok, true, corner.reason);
    // set_scene 一次摆两个人：一个一个看都不堵，合起来堵了，也退回
    const s2 = game(lang), st2 = s2.state;
    assert.equal(H.applyOp(st2, { op: "move", actor: "player", x: 5, y: 2 }, { by: "ui" }).ok, true);
    const before = where(st2, "weiming");
    const scene = H.applyOp(st2, { op: "set_scene", map, actors: [{ id: "weiming", x: 4, y: 5 }, { id: "huiling", x: 5, y: 6 }], props: [] }, { by: "gm" });
    assert.equal(scene.ok, false);
    if (lang === "en") assert.ok(!HAN.test(scene.reason), scene.reason);
    assert.deepEqual(where(st2, "weiming"), before, "退回的场景不能摆上任何人");
    const fine = H.applyOp(st2, { op: "set_scene", map, actors: [{ id: "weiming", x: 4, y: 5 }, { id: "huiling", x: 6, y: 6 }], props: [] }, { by: "gm" });
    assert.equal(fine.ok, true, fine.reason);
    // 「一半」这条线：三个人把屋子拦成两半，门这边只剩 9/25 格，也退回
    const s3 = game(lang).state;
    assert.equal(H.applyOp(s3, { op: "move", actor: "player", x: 5, y: 2 }, { by: "ui" }).ok, true);
    const half = H.applyOp(s3, { op: "set_scene", map, actors: [{ id: "weiming", x: 4, y: 4 }, { id: "huiling", x: 3, y: 4 }, { id: "junhao", x: 6, y: 2 }], props: [] }, { by: "gm" });
    assert.equal(half.ok, false, "门这边只剩不到一半，应该退回");
    // 已经在屋里的配角也算挡路的
    const s4 = game(lang).state;
    assert.equal(H.applyOp(s4, { op: "move", actor: "player", x: 5, y: 2 }, { by: "ui" }).ok, true);
    assert.equal(H.applyOp(s4, { op: "extras", label: lang === "en" ? "Kids" : "小孩", count: 2, map, x: 4, y: 5 }, { by: "gm" }).ok, true);
    assert.equal(H.applyOp(s4, { op: "move", actor: "huiling", map, x: 5, y: 6 }, { by: "gm" }).ok, false);
    assert.equal(H.blocksDoor(s4, map, 5, 6, "huiling"), "seal");
    // 挪过来的人原来站的格子不算：陈阿姨从 (4,5) 挪到 (5,6)，(4,5) 就空出来了
    const s5 = game(lang).state;
    assert.equal(H.applyOp(s5, { op: "move", actor: "player", x: 5, y: 2 }, { by: "ui" }).ok, true);
    assert.equal(H.applyOp(s5, { op: "move", actor: "chen", x: 4, y: 5 }, { by: "gm" }).ok, true);
    const step = H.applyOp(s5, { op: "move", actor: "chen", x: 5, y: 6 }, { by: "gm" });
    assert.equal(step.ok, true, step.reason);
    // 玩家站着不挡路（他走得开）
    const s6 = game(lang).state;
    assert.equal(H.applyOp(s6, { op: "move", actor: "player", x: 4, y: 5 }, { by: "ui" }).ok, true);
    const nextTo = H.applyOp(s6, { op: "move", actor: "chen", x: 5, y: 6 }, { by: "gm" });
    assert.equal(nextTo.ok, true, nextTo.reason);
    // set_scene 重新摆已经在门边的人：按摆完以后的样子算，不按原来的位置算
    const s7 = game(lang).state;
    assert.equal(H.applyOp(s7, { op: "move", actor: "player", x: 5, y: 2 }, { by: "ui" }).ok, true);
    assert.equal(H.applyOp(s7, { op: "move", actor: "chen", x: 4, y: 5 }, { by: "gm" }).ok, true);
    const rearrange = H.applyOp(s7, { op: "set_scene", map, actors: [{ id: "chen", x: 1, y: 3 }, { id: "weiming", x: 5, y: 6 }], props: [] }, { by: "gm" });
    assert.equal(rearrange.ok, true, rearrange.reason);
    assert.deepEqual(where(s7, "chen"), [map, 1, 3]);
    assert.deepEqual(where(s7, "weiming"), [map, 5, 6]);
  }
});

// ---------------- 日子和日程 ----------------
test("每个日子开始时：玩家站在那一家进门的地方，那一家有会说话的人在", () => {
  for (const lang of ["zh", "en"]) {
    const s = game(lang), state = s.state;
    for (const day of D.daysOf(1)) {
      assert.ok(D.startDay(state, day.id).ok, day.id);
      assert.ok(HOMES.includes(day.player.map), day.id);
      assert.deepEqual(Object.keys(day.player), ["map"], `${day.id} 的起点只写 map`);
      assert.equal(state.time.slot, day.slot);
      assert.deepEqual(where(state, "player"), [day.player.map, ...M.entryOf(day.player.map)], day.id);
      assert.equal(state.scene.map, day.player.map);
      const talkers = B.nearby(state).filter((id) => W.canTalk(id, state.time.year));
      assert.ok(talkers.length >= 1, `${day.id}：${day.player.map} 开局没有会说话的人`);
      for (const id of talkers) assert.ok(W.characterPresent(id, state.time.year));
      assert.equal(H.canVisit(state, day.player.map).ok, true, day.id);
    }
  }
});

test("日程只写 home、别人家的地图 id，或者 D.PLACES 里的去处", () => {
  assert.deepEqual(Object.keys(D.PLACES).sort(), ["away", "downstairs", "working"]);
  for (const [k, v] of Object.entries(D.PLACES)) assert.ok(v.zh && v.en && !HAN.test(v.en), k);
  const ok = (place) => place === "home" || HOMES.includes(place) || !!D.PLACES[place];
  for (const [id, s] of Object.entries(D.SCHEDULES)) {
    assert.ok(W.CHARACTERS[id], id);
    for (const kind of ["work", "rest"]) {
      assert.equal(s[kind].length, H.SLOTS.length, `${id} ${kind}`);
      for (const place of s[kind]) assert.ok(ok(place), `${id} ${kind}：${place}`);
    }
  }
  for (const day of D.DAYS) {
    for (const [slot, o] of Object.entries(day.overrides || {})) {
      for (const [id, place] of Object.entries(o)) {
        assert.ok(W.CHARACTERS[id], `${day.id} ${id}`);
        assert.ok(ok(place), `${day.id} 时段 ${slot}：${id} 去 ${place}`);
        // 去做客的那一家那年得已经住在这里
        if (HOMES.includes(place)) {
          const hid = Object.keys(W.RESIDENTS).find((h) => W.RESIDENTS[h].home === place);
          assert.ok(W.livesHere(hid, day.date.year), `${day.id}：${place} 那年还没人住`);
        }
      }
    }
    for (const map of Object.keys(day.props || {})) assert.ok(HOMES.includes(map), `${day.id} 的东西摆在 ${map}`);
    for (const [map, list] of Object.entries(day.props || {})) for (const [kind] of list) assert.ok(M.propAllowed(kind, map), `${day.id}：${kind} 不能摆在 ${map}`);
  }
});

test("不在地图上的人：activity 是这一局语言的去处", () => {
  for (const lang of ["zh", "en"]) {
    const s = game(lang), state = s.state;
    const seen = new Set();
    for (const day of D.daysOf(1)) {
      D.startDay(state, day.id);
      for (;;) {
        for (const id of W.charactersAt(state.time.year)) {
          const place = D.placeFor(day, id, state.time.slot);
          if (!D.PLACES[place]) continue;
          const a = state.actors[id];
          assert.equal(a.map, null, `${day.id} 时段 ${state.time.slot}：${id} 应该${place}`);
          assert.equal(a.activity, D.PLACES[place][lang], `${lang} ${day.id} 时段 ${state.time.slot}：${id}`);
          if (lang === "en") assert.ok(!HAN.test(a.activity), a.activity);
          seen.add(place);
        }
        if (!D.wait(state).ok) break;
      }
    }
    assert.deepEqual([...seen].sort(), ["away", "downstairs", "working"], lang);
  }
});

test("开斋节：下午陈阿姨、慧玲和俊豪在 Aisyah 家做客，糕摆在长桌边", () => {
  const s = game("zh", "d1992_raya"), state = s.state;
  assert.equal(state.actors.player.map, "flat_aisyah");
  const tray = B.furnitureAt(state, "flat_aisyah", 11, 5);
  assert.equal(tray && tray.kind, "kuih_tray");
  assert.ok(state.day_props.flat_aisyah.some((f) => f.kind === "kuih_tray" && f.x === 11 && f.y === 5));
  while (state.time.slot < 3) assert.ok(D.wait(state).ok);
  for (const id of ["chen", "huiling", "junhao"]) {
    assert.equal(state.actors[id].map, "flat_aisyah", `${id} 应该在 Aisyah 家`);
    assert.deepEqual([state.actors[id].x, state.actors[id].y], D.SPOTS.flat_aisyah[id], id);
  }
  for (const id of ["nurul", "hafiz", "rahman", "aisyah_kassim", "mak_esah"]) assert.equal(state.actors[id].map, "flat_aisyah", id);
  // 陈阿姨出来做客，她家就没人了
  assert.equal(H.canVisit(state, "flat_chen").code, "nobody");
  // GM 的「各家现在」：做客的人写在 Aisyah 家，林家写着慧玲和俊豪在 Aisyah 家
  const block = homesBlockOf(gmText(state).p.user, "zh");
  assert.ok(block);
  assert.match(lineOf(block, "flat_aisyah"), /陈阿姨（来做客）/);
  assert.match(lineOf(block, "flat_aisyah"), /← 玩家在这里/);
  assert.match(lineOf(block, "flat_chen"), /没人在家/);
  assert.match(lineOf(block, "flat_lin"), /不在家的：.*郑慧玲 在.*Aisyah/);
  // 英文局一样写出谁是来做客的、不在家的人在哪一家
  const en = game("en", "d1992_raya").state;
  while (en.time.slot < 3) assert.ok(D.wait(en).ok);
  const enBlock = homesBlockOf(gmText(en).p.user, "en");
  assert.ok(enBlock);
  assert.match(lineOf(enBlock, "flat_aisyah"), /Mdm Chan \(visiting\)/);
  assert.match(lineOf(enBlock, "flat_lin"), /away: .*Tay Hui Ling: at Aisyah's/);
  assert.ok(!HAN.test(enBlock), enBlock);
  // 傍晚各自回家
  assert.ok(D.wait(state).ok);
  for (const id of ["chen", "huiling", "junhao"]) assert.notEqual(state.actors[id].map, "flat_aisyah", id);
  assert.equal(state.actors.chen.map, "flat_chen");
});

test("1998 年 4 月：伟明中午和下午一个人在家，慧玲和俊豪出门了", () => {
  for (const lang of ["zh", "en"]) {
    const s = game(lang, "d1998_spring"), state = s.state;
    assert.equal(state.time.slot, 2);
    for (const slot of [2, 3]) {
      assert.equal(state.time.slot, slot);
      assert.equal(state.actors.weiming.map, "flat_lin", `时段 ${slot}`);
      for (const id of ["huiling", "junhao"]) {
        assert.equal(state.actors[id].map, null, `${id} 时段 ${slot}`);
        assert.equal(state.actors[id].activity, D.PLACES.away[lang]);
      }
      assert.deepEqual(residentsOn(state, "flat_lin"), ["weiming"]);
      // GM 知道伟明一个人在家、另两个出门了（只是在哪，不写为什么）
      const block = homesBlockOf(gmText(state).p.user, lang);
      const line = lineOf(block, "flat_lin");
      const [here, away] = lang === "zh" ? line.split("不在家的：") : line.split("away: ");
      assert.ok(here.includes(lang === "zh" ? "林伟明 在这里" : "Lim Wei Ming here"), line);
      assert.ok(away && !away.includes(lang === "zh" ? "林伟明" : "Wei Ming"), line);
      for (const t of lang === "zh" ? ["郑慧玲 出门了", "林俊豪 出门了", "进门处 (5,7)", "← 玩家在这里"] : ["Tay Hui Ling: out", "Lim Jun Hao: out", "inside the door (5,7)", "<- the player is here"]) assert.ok(away.includes(t), `${line} 里没有 ${t}`);
      D.wait(state);
    }
    // 傍晚他又像下班一样出门
    assert.equal(state.time.slot, 4);
    assert.equal(state.actors.weiming.map, null);
  }
});

// ---------------- 提示词 ----------------
test("GM 的提示词有「各家现在」：1989 年 Mei 家还没搬来，玩家在哪一家有标记；住户看不到这一块", () => {
  for (const lang of ["zh", "en"]) {
    const s = game(lang), state = s.state;
    const { p } = gmText(state);
    const block = homesBlockOf(p.user, lang);
    assert.ok(block, lang);
    // 每一家一行，按门牌的顺序
    const rows = block.split("\n").filter((l) => l.startsWith("- "));
    assert.deepEqual(rows.map((l) => l.slice(2).split(/[（ ]/)[0]), HOMES);
    if (lang === "zh") {
      assert.equal(lineOf(block, "flat_mei"), "- flat_mei（Mei 家）：还没搬来");
      assert.match(lineOf(block, "flat_chen"), /陈阿姨 在这里；进门处 \(4,6\)　← 玩家在这里$/);
      assert.match(lineOf(block, "flat_lin"), /没人在家；不在家的：林伟明 出门了/);
      assert.match(lineOf(block, "dorm"), /只有别的工友在；不在家的：.* 在楼里干活/);
    } else {
      assert.equal(lineOf(block, "flat_mei"), "- flat_mei (Mei's): not moved in yet");
      assert.match(lineOf(block, "flat_chen"), /Mdm Chan here; inside the door \(4,6\) {2}<- the player is here$/);
      assert.match(lineOf(block, "flat_lin"), /nobody home; away: Lim Wei Ming: out/);
      assert.match(lineOf(block, "dorm"), /only the other workers in; away: .*: working around the block/);
      assert.ok(!HAN.test(block), block.split("\n").filter((l) => HAN.test(l)).join("\n"));
    }
    assert.equal(rows.filter((l) => /← 玩家在这里|<- the player is here/.test(l)).length, 1);
    // 在每轮都变的最后一块里，在地图那一块后面；缓存的几块里没有
    const last = p.parts[p.parts.length - 1];
    assert.ok(!last.cache && last.text.includes(block), lang);
    assert.ok(last.text.indexOf(block) > last.text.indexOf(lang === "en" ? "## Map:" : "## 地图："), lang);
    for (const part of p.parts.slice(0, -1)) assert.ok(!part.text.includes(lang === "en" ? "The homes right now" : "各家现在"), lang);
    // 住户（在家的、不在家的）都看不到
    for (const id of W.charactersAt(state.time.year).filter((x) => W.canTalk(x, state.time.year))) {
      const t = charText(state, id);
      for (const word of ["各家现在", "The homes right now", "还没搬来", "not moved in yet", "玩家在这里", "the player is here", "flat_mei"]) assert.ok(!t.includes(word), `${lang} ${id} 的提示词里有「${word}」`);
    }
  }
  // 1994 年 Mei 一家搬来以后就不写还没搬来
  const s94 = game("zh", "d1994_move");
  const b94 = homesBlockOf(gmText(s94.state).p.user, "zh");
  assert.doesNotMatch(lineOf(b94, "flat_mei"), /还没搬来/);
  assert.match(lineOf(b94, "flat_mei"), /← 玩家在这里/);
});

// ---------------- 离线演示 ----------------
test("离线演示：八个日子只用门牌和走路去找人，每天都能说上话", async () => {
  for (const lang of ["zh", "en"]) {
    const s = game(lang), state = s.state, p = state.actors.player;
    const llm = Mock.caller();
    let visits = 0;
    for (;;) {
      let talked = 0;
      let at = state.day ? D.currentDay(state).player.map : null;
      assert.equal(p.map, at);
      for (let slot = 0; slot < 3; slot++) {
        // 玩家只会因为门牌换图：别的地方都没把他挪走
        assert.equal(p.map, at, `${state.day.id} 时段 ${state.time.slot}：玩家被挪到了 ${p.map}`);
        const year = state.time.year;
        const talkers = W.charactersAt(year).filter((id) => state.actors[id].map && W.canTalk(id, year));
        // 第三个时段先去别家找人（有人在别家的话），其他时段先找这一家的人
        const elsewhere = slot === 2 ? talkers.find((id) => state.actors[id].map !== p.map) : null;
        const who = elsewhere || talkers.find((id) => state.actors[id].map === p.map) || talkers[0];
        if (who) {
          const map = state.actors[who].map;
          if (map !== p.map) {
            assert.equal(H.canVisit(state, map).ok, true, `${map} 有人在家却去不了`);
            const v = B.visit(state, map);
            assert.equal(v.ok, true, `${state.day.id}：去不了 ${map}`);
            assert.equal(v.changedMap, true);
            at = map;
            visits++;
          }
          const a = state.actors[who];
          const route = B.path(state, p.map, [p.x, p.y], [a.x, a.y]);
          assert.ok(route, `${state.day.id}：在 ${p.map} 走不到 ${who} 旁边`);
          for (const [x, y] of route) assert.equal(B.moveTo(state, x, y).ok, true);
          assert.ok(B.adjacent(state).includes(who), `${state.day.id}：没走到 ${who} 旁边`);
          const help = slot === 1;
          const input = lang === "en" ? (help ? "I'd like to help carry things" : "Hello, how have you been?") : help ? "我想帮他搬东西" : "你好，最近怎么样？";
          const res = await Turn.playerTurn(s, input, { llm, focus: who, to: help ? "gm" : who, confirmSpend: async () => true });
          talked += res.items.filter((e) => e.kind === "speech").length;
          if (lang === "en") for (const e of res.items) assert.ok(!HAN.test(e.summary || ""), e.summary);
        }
        if (!D.wait(state).ok) break;
      }
      assert.ok(talked > 0, state.day.id + " 一整天没跟人说上话");
      const next = D.nextDay(state);
      if (!next) break;
      D.startDay(state, next.id);
    }
    assert.equal(state.day.id, "d1998_spring");
    assert.ok(visits > 0, "一次门牌都没用过");
    assert.ok(state.events.filter((e) => e.kind === "speech").length >= 8);
  }
});

// ---------------- 审查后补的 ----------------
test("从外面叫进门的人不再带着「出门了」「在楼下」；还没搬来的那一家谁也摆不进去；set_scene 不能把人摞在别人头上", () => {
  for (const lang of ["zh", "en"]) {
    const s = game(lang, "d1990_rain"), state = s.state;
    const kumar = state.actors.kumar;
    assert.equal(kumar.map, null);
    assert.equal(kumar.activity, D.PLACES.working[lang]);
    const r = H.applyOp(state, { op: "move", actor: "kumar", map: "flat_aisyah" }, { by: "gm" });
    assert.equal(r.ok, true, r.reason);
    assert.equal(kumar.map, "flat_aisyah");
    assert.equal(kumar.activity, "", "叫进门以后不该还写着在楼里干活");
    const gm = gmText(state).p.user;
    assert.ok(!gm.includes(D.PLACES.working[lang]), "GM 的提示词里 Kumar 还写着在楼里干活");
    // 1990 年 Mei 家还没搬来：住户叫不进去，场景、配角也摆不进去，英文局是英文理由
    for (const op of [
      { op: "move", actor: "huiling", map: "flat_mei" },
      { op: "set_scene", map: "flat_mei", actors: [{ id: "chen", x: 2, y: 3 }], props: [] },
      { op: "extras", label: lang === "en" ? "Movers" : "搬家工人", count: 2, map: "flat_mei", x: 3, y: 3 }
    ]) {
      const bad = H.applyOp(state, op, { by: "gm" });
      assert.equal(bad.ok, false, op.op);
      assert.match(bad.reason, lang === "en" ? /hasn't moved in yet/ : /还没搬来/);
      if (lang === "en") assert.ok(!HAN.test(bad.reason), bad.reason);
    }
    assert.notEqual(state.actors.huiling.map, "flat_mei");
    assert.notEqual(state.actors.chen.map, "flat_mei");
    assert.equal(state.scene.map, "flat_aisyah");
    // set_scene：已经站在那一格、这次没摆的人还在，不能摞上去；这次摆的人可以换到彼此空出来的格子
    const rahman = state.actors.rahman;
    const stack = H.applyOp(state, { op: "set_scene", map: "flat_aisyah", actors: [{ id: "chen", x: rahman.x, y: rahman.y }], props: [] }, { by: "gm" });
    assert.equal(stack.ok, false, "陈阿姨被摞在了 Rahman 头上");
    const [ax, ay] = [state.actors.aisyah_kassim.x, state.actors.aisyah_kassim.y];
    const swap = H.applyOp(state, { op: "set_scene", map: "flat_aisyah", actors: [{ id: "rahman", x: ax, y: ay }, { id: "aisyah_kassim", x: 8, y: 6 }], props: [] }, { by: "gm" });
    assert.equal(swap.ok, true, swap.reason);
    assert.deepEqual(where(state, "rahman"), ["flat_aisyah", ax, ay]);
  }
});

test("在别人家说「回家」的，回到自己家里，门牌上那一家就有人了；去别处的照旧不在地图上", () => {
  for (const lang of ["zh", "en"]) {
    const s = game(lang, "d1992_raya"), state = s.state;
    while (state.time.slot < 3) assert.ok(D.wait(state).ok);
    assert.equal(state.actors.chen.map, "flat_aisyah");
    assert.equal(H.canVisit(state, "flat_chen").code, "nobody");
    const r = H.applyOp(state, { op: "leave", actor: "chen", to: lang === "en" ? "heads home" : "回家了" }, { by: "gm" });
    assert.equal(r.ok, true, r.reason);
    assert.deepEqual(where(state, "chen"), ["flat_chen", 3, 3]);
    assert.equal(state.actors.chen.activity, "");
    assert.equal(H.canVisit(state, "flat_chen").ok, true);
    // 走的那一下在 Aisyah 家的人都看见了
    assert.equal(r.event.map, "flat_aisyah");
    assert.ok(r.event.perceivedBy.includes("player"));
    // 住户自己写的 leave 也一样（俊豪跟着慧玲回家）
    assert.equal(H.applyOp(state, { op: "leave", actor: "huiling", to: lang === "en" ? "back home" : "带俊豪回家" }, { by: "character" }).ok, true);
    assert.equal(state.actors.huiling.map, "flat_lin");
    assert.ok(B.free(state, "flat_lin", state.actors.huiling.x, state.actors.huiling.y, "player") === false);
    assert.equal(H.blocksDoor(state, "flat_lin", state.actors.huiling.x, state.actors.huiling.y, "huiling"), false);
    // 去别处的：不在地图上，记着去处
    assert.equal(H.applyOp(state, { op: "leave", actor: "junhao", to: lang === "en" ? "to the market" : "去巴刹" }, { by: "gm" }).ok, true);
    assert.equal(state.actors.junhao.map, null);
    assert.equal(state.actors.junhao.activity, lang === "en" ? "to the market" : "去巴刹");
    // 在自己家说回家（说不通）：照旧离开地图
    const s2 = game(lang).state;
    assert.equal(H.applyOp(s2, { op: "leave", actor: "chen", to: lang === "en" ? "home" : "回家" }, { by: "gm" }).ok, true);
    assert.equal(s2.actors.chen.map, null);
  }
  // 只看去处的开头：哪些算回自己家，哪些不算
  const homeward = ["回家", "回家做饭", "先回家", "正要回家", "带俊豪回家", "回自己家去了", "home", "heads home", "heading home to cook", "to go home", "back home", "going back home", "returns home", "off home", "Home"];
  const elsewhere = ["回家乡探亲", "先不回家，去巴刹", "寄钱回家", "送Hafiz回家", "去巴刹", "下楼", "walking Hafiz home", "to send money back home", "home-made kuih for the Lims", "to the market", "to the Lims' home"];
  const tryLeave = (to) => {
    const st = game(/\p{Script=Han}/u.test(to) ? "zh" : "en", "d1992_raya").state;
    while (st.time.slot < 3) assert.ok(D.wait(st).ok);
    assert.equal(H.applyOp(st, { op: "leave", actor: "chen", to }, { by: "gm" }).ok, true, to);
    return st.actors.chen.map;
  };
  for (const to of homeward) assert.equal(tryLeave(to), "flat_chen", `「${to}」应该回到自己家`);
  for (const to of elsewhere) assert.equal(tryLeave(to), null, `「${to}」不是回自己家`);
  // Kumar 回宿舍
  const k = game("en", "d1990_rain").state;
  assert.equal(H.applyOp(k, { op: "move", actor: "kumar", map: "flat_aisyah" }, { by: "gm" }).ok, true);
  assert.equal(H.applyOp(k, { op: "leave", actor: "kumar", to: "back to the dorm" }, { by: "gm" }).ok, true);
  assert.equal(k.actors.kumar.map, "dorm");
});

test("本来就在别家的人换一家：GM 刚定的手上的事不清掉", () => {
  for (const lang of ["zh", "en"]) {
    const state = game(lang).state;
    const act = lang === "en" ? "carrying a tray of kuih" : "端着一盘糕";
    assert.equal(state.actors.aisyah_kassim.map, "flat_aisyah");
    assert.equal(H.applyOp(state, { op: "set_activity", actor: "aisyah_kassim", activity: act }, { by: "gm" }).ok, true);
    assert.equal(H.applyOp(state, { op: "move", actor: "aisyah_kassim", map: "flat_chen" }, { by: "gm" }).ok, true);
    assert.equal(state.actors.aisyah_kassim.map, "flat_chen");
    assert.equal(state.actors.aisyah_kassim.activity, act);
  }
});

test("门上的提示两种语言都有，英文没有汉字", () => {
  assert.ok(B.DOOR_HINT.zh && B.DOOR_HINT.en);
  assert.ok(!HAN.test(B.DOOR_HINT.en), B.DOOR_HINT.en);
  assert.match(B.DOOR_HINT.zh, /门牌/);
  assert.match(B.DOOR_HINT.en, /door plates/);
});

test("GM 提示词里的例子在它说的那张图上都过得了规则层（中英文）", () => {
  const examples = (text) => text.split("\n").filter((l) => /^(例子|Example)/.test(l)).map((l) => JSON.parse(l.slice(l.indexOf("{"))));
  // 每个例子在哪一天、哪个时段用：前两个在陈阿姨家，第三个去林家（得有人在家），第四个 Hafiz 在家
  const where4 = [["d1989_first", 1], ["d1989_first", 1], ["d1994_cup", 4], ["d1990_rain", 3]];
  for (const lang of ["zh", "en"]) {
    const sys = gmText(game(lang).state).p.system;
    const list = examples(sys);
    assert.equal(list.length, 4, lang);
    list.forEach((ex, i) => {
      const [day, slot] = where4[i];
      const state = game(lang, day).state;
      while (state.time.slot < slot) assert.ok(D.wait(state).ok);
      for (const op of ex.ops) {
        const r = H.applyOp(state, op, { by: "gm" });
        assert.equal(r.ok, true, `${lang} 例子 ${i + 1} 的 ${op.op}：${r.reason}`);
      }
      for (const id of ex.responders) assert.equal(state.actors[id].map, state.actors.player.map, `${lang} 例子 ${i + 1}：${id} 不在玩家那一家`);
    });
    // 操作说明里的写法也都过得了（陈阿姨家，第一天早上；拿走糕在开斋节的 Aisyah 家）
    // 带 […] 的写法（检定）不是完整的 JSON，跳过
    const tryParse = (t) => { try { return JSON.parse(t); } catch (err) { return null; } };
    const ops = sys.split("\n").filter((l) => l.startsWith("- {\"op\"")).map((l) => tryParse(l.slice(2, l.search(/\}\s/) + 1))).filter(Boolean);
    const pick = (name) => { const o = ops.find((x) => x.op === name); assert.ok(o, `${lang} 操作说明里没有 ${name}`); return o; };
    // 每一条各自在第一天早上的陈阿姨家试（它们是各自的例子，不是一串）
    for (const name of ["set_scene", "move", "set_activity", "place_prop", "extras"]) {
      const st = game(lang).state;
      const op = Object.assign({}, pick(name));
      if (name === "set_scene") { op.map = "flat_chen"; op.actors = op.actors.map((a) => Object.assign({}, a, { activity: "" })); }
      const r = H.applyOp(st, op, { by: "gm" });
      assert.equal(r.ok, true, `${lang} 操作说明 ${name}：${r.reason}`);
    }
    const raya = game(lang, "d1992_raya").state;
    const rm = H.applyOp(raya, pick("remove_prop"), { by: "gm" });
    assert.equal(rm.ok, true, `${lang} 操作说明 remove_prop：${rm.reason}`);
  }
});
