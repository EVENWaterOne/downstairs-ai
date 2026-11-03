/* V0.2 Harness：唯一拥有"事实写入权"的部分（沿用 V0.1 / D-017）。
 * GM、规划、角色输出只能提交操作提案，这里逐条校验，合法的才写入。
 * 四种存储分开放：客观事实（events / details）、GM 推测（gm）、住户主观认知（minds）、未执行计划（plans）。
 * 地图上的人和心思按"角色"算（world.js 的 CHARACTERS：林家、Mei 家按成员拆开），满意度、需求、障碍仍按户算。
 * 游戏端（模拟器或以后的真游戏）通过 pushGameEvent 进来；回传给游戏端的东西放在 outbox。不依赖 DOM。 */
(function (root) {
  "use strict";
  const W = root.V2World, M = root.V2Maps;

  const SLOTS = [
    { zh: "早上", en: "Early morning" }, { zh: "上午", en: "Morning" }, { zh: "中午", en: "Midday" },
    { zh: "下午", en: "Afternoon" }, { zh: "傍晚", en: "Evening" }, { zh: "晚上", en: "Night" }
  ];
  // 满意度回传上限（每户每个十年）。数值是初始值，跑了再调（10-28 Polaris）
  const CAPS = { talk: { up: 2, down: -5 }, action: { up: 5, down: -5, mismatch_up: 1 }, total: { up: 6, down: -6 }, harm_ratio: 1 / 3 };
  const SPEECH_KINDS = new Set(["speech", "player_input"]);
  const ID_RE = /^[a-z_][a-z0-9_]{0,31}$/;
  // 10-29 试玩之后：先操作，后叙述。有人来、走、换动作、拿走东西，都要先有操作（leave、set_activity、place_prop、remove_prop、extras），
  // 叙述只写已经发生的变化；玩家对 GM 说的话和 GM 的出戏回答（gm_reply）住户听不到
  const PERMS = {
    gm: ["establish_fact", "roll", "set_scene", "move", "leave", "set_activity", "place_prop", "remove_prop", "extras", "advance_time", "jump_time", "community_action", "gm_hypothesis", "clock_tick", "narrate", "gm_reply", "gloss"],
    planner: ["clock_create", "clock_tick", "clock_drop", "plan_thread", "gm_hypothesis"],
    // 住户只能动自己：在自己所在的图上走几步、离开、换手上的事（turn.js 把 actor 一律写成他自己）
    character: ["speak", "narrate", "impression", "lean", "satisfaction", "reveal", "initiate", "move", "leave", "set_activity"],
    summarizer: ["chronicle"],
    ui: ["move", "player_say"],
    // 日程和日子（days.js）：换时段、换日子，都是写死的规则，不是模型
    system: ["move", "leave", "advance_time", "jump_time", "narrate"]
  };
  const MAX_EXTRAS = 4;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const isPrim = (v) => v === null || ["number", "boolean"].includes(typeof v) || (typeof v === "string" && v.length <= 200);
  const L = (state, o) => (o && typeof o === "object" ? o[state.lang] || o.zh : String(o == null ? "" : o));

  // ---------- 随机数（种子在状态里，可复现） ----------
  function nextRand(state) {
    let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const d20 = (state) => 1 + Math.floor(nextRand(state) * 20);

  // ---------- 初始化 ----------
  const HOME_SPOT = { flat_chen: [3, 3], flat_lin: [3, 3], flat_aisyah: [3, 4], flat_mei: [3, 4], dorm: [3, 2] };
  // 拆开的户，成员在家里并排站
  function homeSpot(id) {
    const c = W.CHARACTERS[id], r = W.RESIDENTS[c.household];
    const [x, y] = HOME_SPOT[r.home];
    return [x + (c.member ? r.members.indexOf(c.member) : 0), y];
  }
  function sendHome(a) { const [x, y] = homeSpot(a.id); Object.assign(a, { map: W.RESIDENTS[a.household].home, x, y }); }
  const freshMind = () => ({ impressions: [], lean: 0, lean_seq: 0, speech_lean_decade: 0 });
  const START_MAP = "flat_chen";

  function createState(opts) {
    opts = opts || {};
    const lang = opts.lang === "en" ? "en" : "zh";
    const seed = (opts.seed >>> 0) || 19890301;
    const year = W.START_YEAR;
    // 11-02 只剩各家：开局先站在陈阿姨家进门的地方，days.js 的 begin 会按第一个日子再摆一次
    const [px, py] = M.entryOf(START_MAP);
    const actors = { player: { id: "player", kind: "player", map: START_MAP, x: px, y: py } };
    for (const [id, c] of Object.entries(W.CHARACTERS)) {
      actors[id] = { id, kind: "resident", household: c.household, map: null, x: null, y: null, activity: "" };
      if (W.characterPresent(id, year)) sendHome(actors[id]);
    }
    // 每个角色一份心思；林家这种张力记在家庭这一层的，户本身也有一份（只用来记倾向）
    const minds = {};
    for (const id of W.mindIds()) minds[id] = freshMind();
    const state = {
      version: 2, lang, seed, rng: seed, turn: 0, decade: 1,
      time: { year, month: 3, day: 1, slot: 1 },
      actors, scene: { map: START_MAP, props: [], weather: "" },
      events: [], seq: 0, details: {},
      game: { decade: 1, points: 3, built: [], plots: {}, flags: {}, satisfaction: {} },
      minds, gm: { hypotheses: [] }, plans: { clocks: {}, threads: [] },
      revealed: { barriers: {}, secrets: {}, relations: [] },
      ledger: freshLedger(1), failed_rolls: {}, chronicle: [], pending_initiatives: [],
      outbox: [], feedback_log: [],
      // 无名配角（下棋的老伯、看热闹的人）：一组一个棋子，只占格子、不说话；换日子时清掉
      extras: []
    };
    seedDecadeClocks(state, 1);
    return state;
  }

  function freshLedger(decade) {
    const per = {};
    for (const id of Object.keys(W.RESIDENTS)) per[id] = { talk_up: 0, talk_down: 0, action_up: 0, action_down: 0, up: 0, down: 0, harm: 0 };
    return { decade, per };
  }

  // ---------- 查询 ----------
  const present = (state, id) => W.characterPresent(id, state.time.year);
  const residentsOn = (state, map) => Object.values(state.actors).filter((a) => a.kind === "resident" && a.map === map && present(state, a.id)).map((a) => a.id);
  const nameOf = (state, id) => L(state, W.characterName(id) || (W.RESIDENTS[id] && W.RESIDENTS[id].name) || id);
  // 拆开的户不能当成一个人用：要写成员
  function notCharacter(id) {
    const r = W.RESIDENTS[id];
    return r && r.split ? `${id} 一家要按人写：${r.members.map((m) => m.id).join("、")}` : `${id} 不是住户`;
  }
  const withPlayer = (state, id) => state.actors[id] && state.actors[id].map && state.actors[id].map === state.actors.player.map;
  // 11-02 只剩各家：玩家换一家（门牌栏、GM 的 move 带 map）都查这一条，和原来走到别人家门口一样：
  // 这一户得已经住在这里，而且家里有人（谁在都算，来做客的也算）；宿舍一直能进，里面总有工友
  const homeOfMap = (map) => Object.keys(W.RESIDENTS).find((id) => W.RESIDENTS[id].home === map) || null;
  function canVisit(state, map) {
    if (!M.MAPS[map]) return { ok: false, code: "no_map", reason: { zh: `没有 ${map} 这张地图`, en: `No map called ${map}` } };
    const hid = homeOfMap(map);
    if (!hid || hid === "kumar") return { ok: true };
    if (!W.livesHere(hid, state.time.year)) return { ok: false, code: "not_yet", reason: { zh: "这户人家还没搬来。", en: "This family hasn't moved in yet." } };
    if (!residentsOn(state, map).length) return { ok: false, code: "nobody", reason: { zh: "敲了门，没人在家。", en: "You knock. Nobody is home." } };
    return { ok: true };
  }
  const extrasOf = (state) => state.extras || (state.extras = []);
  const extrasOn = (state, map) => extrasOf(state).filter((g) => g.map === map);
  function occupied(state, map, x, y, except) {
    return Object.values(state.actors).some((a) => a.id !== except && a.map === map && a.x === x && a.y === y && (a.kind === "player" || present(state, a.id)))
      || extrasOf(state).some((g) => g.id !== except && g.map === map && g.x === x && g.y === y);
  }
  // 挡路的家具：固定家具 + 这一天临时摆出来的（board.js 也用这个）。GM 的场景物件不挡路
  function furnitureOn(state, map) {
    const fixed = (M.FURNITURE[map] || []).map(([kind, x, y]) => ({ kind, x, y }));
    return fixed.concat(((state && state.day_props) || {})[map] || []);
  }
  const furnitureAt = (state, map, x, y) => furnitureOn(state, map).find((f) => f.x === x && f.y === y) || null;
  // 住户和配角能站的格子：底图能站人，没有家具，也不是门（站在门上会把门堵住，玩家出不去）
  const canStand = (state, map, x, y) => M.standable(map, x, y) && !furnitureAt(state, map, x, y) && !M.isExit(map, x, y);
  // 堵门有两种，玩家自己站着都不算（他走得开）：
  // "door"：有人站到 (x, y) 以后，旁边那扇门（同一个字母的门格都算）再没有一格空地能走进去（每一家的门口都只有一格）；
  // "seal"：门口那一格还空着，可是它和屋里别的地方被人隔开了（陈阿姨家门里那一格左边是木屐，(4,5)、(5,6) 各站一个人，
  //   进门的人就困在门口）。11-02 以后玩家换一家总是站在进门的地方，所以要查：站上去以后从门进来走得到的空地，
  //   不能少于原来的一半（角落里被隔开一两格没关系）。
  const NEAR = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const cellKey = (x, y) => x + "," + y;
  // 从门往屋里走得到的空地（只走能站的地面，玩家不挡路）。skip 是正要挪走的人、配角，cells 是另外算作有人站的格子
  function doorReach(state, map, skip, cells) {
    const m = M.MAPS[map];
    const taken = new Set(cells.map(([x, y]) => cellKey(x, y)));
    for (const a of Object.values(state.actors)) if (a.kind !== "player" && !skip.has(a.id) && a.map === map && present(state, a.id)) taken.add(cellKey(a.x, a.y));
    for (const g of extrasOf(state)) if (!skip.has(g.id) && g.map === map) taken.add(cellKey(g.x, g.y));
    const seen = new Set(), queue = [];
    m.rows.forEach((row, ty) => [...row].forEach((t, tx) => { if (m.exits[t]) queue.push([tx, ty]); }));
    while (queue.length) {
      const [cx, cy] = queue.shift();
      for (const [dx, dy] of NEAR) {
        const nx = cx + dx, ny = cy + dy, k = cellKey(nx, ny);
        if (seen.has(k) || taken.has(k) || !canStand(state, map, nx, ny)) continue;
        seen.add(k); queue.push([nx, ny]);
      }
    }
    return seen;
  }
  // 一群人同时站到 cells 上（set_scene 一次摆好几个人）会不会把进门的路隔断。skip 是这些人原来的位置不算
  function sealsDoor(state, map, cells, skip) {
    const before = doorReach(state, map, skip, []);
    const after = doorReach(state, map, skip, cells);
    const stoodOn = cells.filter(([x, y]) => before.has(cellKey(x, y))).length;
    return after.size * 2 < before.size - stoodOn;
  }
  // except：正要挪过来的那个人（id），或者 set_scene 一次摆的所有人（Set），他们原来站的格子不算
  function blocksDoor(state, map, x, y, except) {
    const m = M.MAPS[map];
    if (!m) return false;
    const skip = except instanceof Set ? except : new Set(except ? [except] : []);
    const stander = (nx, ny) => Object.values(state.actors).some((a) => !skip.has(a.id) && a.kind !== "player" && a.map === map && a.x === nx && a.y === ny && present(state, a.id))
      || extrasOf(state).some((g) => !skip.has(g.id) && g.map === map && g.x === nx && g.y === ny);
    const open = (nx, ny) => !(nx === x && ny === y) && canStand(state, map, nx, ny) && !stander(nx, ny);
    for (const [dx, dy] of NEAR) {
      const c = M.tile(map, x + dx, y + dy);
      if (!c || !m.exits[c]) continue;
      const doors = [];
      m.rows.forEach((row, ty) => [...row].forEach((t, tx) => { if (t === c) doors.push([tx, ty]); }));
      if (!doors.some(([tx, ty]) => NEAR.some(([ex, ey]) => open(tx + ex, ty + ey)))) return "door";
    }
    if (sealsDoor(state, map, [[x, y]], skip)) return "seal";
    return false;
  }
  const doorFail = (kind, x, y) => fail(kind === "seal" ? `(${x},${y}) 站在这里会把进门的路堵住` : `(${x},${y}) 在门口，站在这里会把门堵住`);
  // 进门的地方（maps.js 的 entryOf）附近最近的一格能站的空位：玩家站门里那一格就行；住户和配角还不能堵门
  function entrySpot(state, map, who) {
    const start = M.entryOf(map);
    if (!start) return null;
    const ok = (x, y) => M.standable(map, x, y) && !furnitureAt(state, map, x, y) && !M.isExit(map, x, y) && !occupied(state, map, x, y, who)
      && (who === "player" || !blocksDoor(state, map, x, y, who));
    const seen = new Set([start.join(",")]), queue = [start];
    while (queue.length) {
      const [x, y] = queue.shift();
      if (ok(x, y)) return [x, y];
      for (const [dx, dy] of NEAR) {
        const nx = x + dx, ny = y + dy, k = nx + "," + ny;
        if (seen.has(k) || !M.standable(map, nx, ny) || furnitureAt(state, map, nx, ny)) continue;
        seen.add(k); queue.push([nx, ny]);
      }
    }
    return null;
  }
  function findEvent(state, id) { return state.events.find((e) => e.id === id) || null; }
  const extrasName = (state, g) => (g.count > 1 ? `${g.label} ×${g.count}` : g.label);
  function nextExtrasId(state) {
    let n = 1;
    while (extrasOf(state).some((g) => g.id === "x" + n)) n++;
    return "x" + n;
  }
  // leave 的去处是不是「回自己家」，只看开头：回家、回家做饭、先回家、带俊豪回家、回宿舍；home、heads home、to go home、back to the dorm。
  // 不算：回家乡、先不回家、寄钱回家、walking Hafiz home、send money back home、home-made
  const GOING_HOME_ZH = /^(?:先|就|这就|正要|要|准备|该)?(?:带[^，,。、\s]{1,8})?回(?:自己)?(?:家(?!乡)|宿舍)/;
  const GOING_HOME_EN = /^(?:to )?(?:(?:go(?:es|ing)?|head(?:s|ing|ed)?|walk(?:s|ing)?|return(?:s|ing)?|went|off|get(?:s|ting)?) )?(?:back )?(?:home\b(?!-)|to the dorm\b)/i;
  const GOING_HOME = { test: (to) => GOING_HOME_ZH.test(to) || GOING_HOME_EN.test(to) };
  const leaveText = (state, name, to) => state.lang === "en" ? `${name} leaves${to ? " (" + to + ")" : ""}` : `${name}离开了${to ? "（" + to + "）" : ""}`;
  function timeLabel(state, t) {
    t = t || state.time;
    return state.lang === "en" ? `${t.day}/${t.month}/${t.year} · ${SLOTS[t.slot].en}` : `${t.year}年${t.month}月${t.day}日 · ${SLOTS[t.slot].zh}`;
  }

  // ---------- 事件（客观事实） ----------
  function addEvent(state, ev) {
    const map = ev.map !== undefined ? ev.map : (state.actors[ev.actor] && state.actors[ev.actor].map) || null;
    let perceived = ev.perceivedBy;
    if (!perceived) {
      if (ev.global) perceived = ["player"].concat(W.charactersAt(state.time.year));
      else perceived = (state.actors.player.map === map ? ["player"] : []).concat(map ? residentsOn(state, map) : []);
    }
    const e = Object.assign({ id: "E" + (++state.seq), seq: state.seq, turn: state.turn, decade: state.decade, time: clone(state.time), map }, ev, { perceivedBy: perceived });
    delete e.global;
    state.events.push(e);
    return e;
  }

  // ---------- 进度钟（未执行计划） ----------
  function createClock(state, c, source) {
    if (state.plans.clocks[c.id]) return null;
    const clock = { id: c.id, owner: c.owner, segments: c.segments, progress: 0, name: clone(c.name), consequence: clone(c.consequence), visible: !!c.visible, status: "running", last_seq: state.seq, source: source || "planner", decade: state.decade, unless_built: c.unless_built || [] };
    state.plans.clocks[c.id] = clock;
    return clock;
  }
  function seedDecadeClocks(state, decade) {
    for (const seed of W.CLOCK_SEEDS) {
      if (seed.on.type !== "decade" || seed.on.decade > decade) continue;
      if ((seed.unless_built || []).some((c) => state.game.built.includes(c))) continue;
      createClock(state, Object.assign({}, seed.clock, { unless_built: seed.unless_built }), "seed");
    }
  }
  function fireClock(state, clock) {
    clock.status = "fired";
    return addEvent(state, { kind: "consequence", actor: clock.owner, global: true, map: null, clock: clock.id, summary: L(state, clock.consequence) });
  }

  // ---------- 游戏端 → V0.2 ----------
  const GAME_TYPES = new Set(["build", "policy", "satisfaction", "decade"]);
  function pushGameEvent(state, ev) {
    if (!ev || !GAME_TYPES.has(ev.type)) return { ok: false, reason: "未知的游戏端事件" };
    if (ev.type === "decade") {
      if (ev.decade !== state.decade + 1) return { ok: false, reason: `游戏端进入第 ${ev.decade} 个十年，但 V0.2 在第 ${state.decade} 个` };
    } else if (ev.decade != null && ev.decade !== state.decade) return { ok: false, reason: "游戏端事件的十年和 V0.2 不一致" };
    const g = state.game;
    if (Number.isFinite(ev.points)) g.points = ev.points;
    if (ev.satisfaction) g.satisfaction = clone(ev.satisfaction);
    if (ev.flags) Object.assign(g.flags, ev.flags);
    if (ev.type === "build" && !g.built.includes(ev.card)) g.built.push(ev.card);
    // 建在哪一块地上：楼下的地图要画出来
    if (ev.type === "build" && ev.plot) (g.plots = g.plots || {})[ev.plot] = ev.card;
    if (ev.type === "decade") return enterDecade(state, ev);

    // 本十年因游戏端受到的伤害，用来限制 V0.2 能"补回"多少
    for (const [r, d] of Object.entries(ev.deltas || {})) if (d < 0 && state.ledger.per[r]) state.ledger.per[r].harm += -d;
    const name = ev.type === "build" ? W.FACILITIES[ev.card].name : ev.type === "policy" ? W.POLICIES[ev.card].name : null;
    const summary = name ? (ev.type === "build" ? L(state, { zh: "游戏端：建成了", en: "Game: built " }) : L(state, { zh: "游戏端：执行了", en: "Game: enacted " })) + L(state, name)
      : L(state, { zh: "游戏端：满意度变化", en: "Game: satisfaction changed" });
    const e = addEvent(state, { kind: "game", actor: "estate", global: true, map: null, game: clone(ev), summary });
    for (const seed of W.CLOCK_SEEDS) {
      if (seed.on.type === ev.type && seed.on.card === ev.card) createClock(state, seed.clock, "seed");
    }
    // 建了对口的设施，相关的钟就解除（例如建了托儿中心，托儿排队的钟停下）
    if (ev.type === "build") for (const c of Object.values(state.plans.clocks)) if (c.status === "running" && c.unless_built.includes(ev.card)) c.status = "resolved";
    return { ok: true, event: e };
  }

  function enterDecade(state, ev) {
    const n = state.decade + 1;
    const d = W.DECADES[n - 1];
    state.decade = n;
    state.time = { year: d.years[0], month: 1, day: 1, slot: 1 };
    state.ledger = freshLedger(n);
    state.chronicle.push({ decade: n - 1, text: null });
    state.extras = [];
    for (const a of Object.values(state.actors)) {
      if (a.kind !== "resident") continue;
      if (present(state, a.id) && !a.map) sendHome(a);
      if (!present(state, a.id)) Object.assign(a, { map: null, x: null, y: null });
    }
    seedDecadeClocks(state, n);
    const e = addEvent(state, { kind: "time", actor: "estate", global: true, map: null, game: clone(ev), summary: L(state, { zh: `进入第 ${n} 个十年：`, en: `Decade ${n}: ` }) + L(state, d.title) });
    return { ok: true, event: e };
  }

  // ---------- 设定门：不能把设定、更不能把张力直接说出来（10-28 Polaris 的硬约束） ----------
  // 只检查玩家看得到的、由模型写的文字（台词、叙述、场景说明、行动描述）。三条：
  // 1. 元语言：张力、锚点、设定、人设……这些词不该出现在故事里
  // 2. 同一段话里同时出现某户张力的两头（"和气"和"公道"、"伪装"和"真实"……），就是在点题
  // 3. 照抄设定原文：中文连续 12 个字、英文连续 8 个词和设定文字一样（原作台词 quote 除外；已经说出来的秘密和旧事除外）
  // 意译绕得过去，这是兜底，不是语义审查；M2 会在被拦下时要求重写一次。
  const META = { zh: ["张力", "锚点", "设定", "人设", "角色卡", "倾向值", "偏向值"], en: ["tension", "anchor", "backstory", "character sheet", "character card"] };
  const ZH_WIN = 12, EN_WIN = 8;
  // 所有张力：各户的，加上成员自己的（林伟明、郑慧玲）
  const TENSIONS = [];
  for (const [id, r] of Object.entries(W.RESIDENTS)) {
    TENSIONS.push([id, r.tension]);
    for (const m of r.members) if (m.tension) TENSIONS.push([m.id, m.tension]);
  }
  const normZh = (t) => String(t).replace(/[\s\p{P}\p{S}]/gu, "");
  const words = (t) => String(t).toLowerCase().match(/[a-z']+/g) || [];
  let windowCache = { key: null, zh: null, en: null };

  function settingTexts(state) {
    const out = [];
    const push = (o) => { if (o && typeof o === "object") { out.push(o); (o.later || []).forEach((x) => out.push(x)); } };
    const pushTension = (t) => { if (t) [t.about, t.anchor, t.toward_a, t.toward_b].forEach(push); };
    for (const [id, r] of Object.entries(W.RESIDENTS)) {
      // voice 不算：它是说话方式的提示，台词本来就会用到里面的口头禅；everyday 也不算，日常小事照着写没关系
      [r.bio, r.goal, r.first_view].forEach(push);
      pushTension(r.tension);
      for (const m of r.members) { [m.bio, m.goal, m.view].forEach(push); pushTension(m.tension); }
      r.stages.forEach(push);
      const told = state.revealed.secrets[id] || [];
      r.secrets.filter((x) => !told.includes(x.id)).forEach(push);
    }
    W.RELATIONS.filter((x) => !state.revealed.relations.includes(x.id)).forEach(push);
    W.SCENE_SEEDS.forEach(push);
    Object.values(W.SUPPORTING).forEach((x) => push(x.role));
    push(W.SETTING_NOTES); push(W.TONE_NOTES);
    return out;
  }
  function windows(state) {
    const key = JSON.stringify([state.revealed.secrets, state.revealed.relations]);
    if (windowCache.key === key) return windowCache;
    const zh = new Set(), en = new Set();
    for (const o of settingTexts(state)) {
      const z = normZh(o.zh || "");
      for (let i = 0; i + ZH_WIN <= z.length; i++) zh.add(z.slice(i, i + ZH_WIN));
      const w = words(o.en || "");
      for (let i = 0; i + EN_WIN <= w.length; i++) en.add(w.slice(i, i + EN_WIN).join(" "));
    }
    windowCache = { key, zh, en };
    return windowCache;
  }
  function leakCheck(state, text) {
    const t = String(text || "");
    if (!t) return null;
    const lower = t.toLowerCase();
    for (const m of META.zh) if (t.includes(m)) return { kind: "meta", match: m };
    for (const m of META.en) if (new RegExp("\\b" + m + "\\b").test(lower)) return { kind: "meta", match: m };
    for (const [id, { a, b }] of TENSIONS) {
      if (t.includes(a.zh) && t.includes(b.zh)) return { kind: "tension", match: `${a.zh} / ${b.zh}`, resident: id };
      if (lower.includes(a.en.toLowerCase().replace(/^the /, "")) && lower.includes(b.en.toLowerCase().replace(/^the /, ""))) return { kind: "tension", match: `${a.en} / ${b.en}`, resident: id };
    }
    const win = windows(state);
    const z = normZh(t);
    for (let i = 0; i + ZH_WIN <= z.length; i++) if (win.zh.has(z.slice(i, i + ZH_WIN))) return { kind: "verbatim", match: z.slice(i, i + ZH_WIN) };
    const w = words(t);
    for (let i = 0; i + EN_WIN <= w.length; i++) { const g = w.slice(i, i + EN_WIN).join(" "); if (win.en.has(g)) return { kind: "verbatim", match: g }; }
    return null;
  }
  // 这句话读的人可能看不懂吗（兜底用的粗略判断；主要靠住户自己在 gloss 里给翻译）
  // 中文局：有广东话的字，或者拉丁字母（去掉人名地名）比汉字多一倍以上；
  // 英文局：有汉字，或者四成以上的词是马来语。新加坡英语的语气词（lah、leh、lor）不算。
  const CANTONESE = /[嘅咗佢冇嚟啲喺咁乜嘢係噉囉嗰]|唔[识係系该好使知会得]|坐低|边识/;
  const MALAY = new Set(("makan duduk tak payah dulu kampung macam ni tu apa nak sudah dah belum terima kasih jangan boleh pergi mana saya awak kita kami dia " +
    "abang adik nenek cucu sikit sini sana ada tidak betul cantik sayang mari masuk minum rumah orang anak emak ayah bapak encik cik kenapa bila siapa baik " +
    "selamat pagi petang malam tolong lagi juga pun sangat banyak sedikit sama kakak tunggu jalan kerja duit mahal murah sakit penat lapar kenyang faham tahu " +
    "insyaallah alhamdulillah assalamualaikum waalaikumsalam").split(" "));
  let nameWords = null;
  function names() {
    if (nameWords) return nameWords;
    const all = [].concat(Object.keys(W.CHARACTERS).map((id) => W.characterName(id)), Object.values(W.RESIDENTS).map((r) => r.name), Object.values(W.SUPPORTING).map((x) => x.name), Object.values(M.MAPS).map((m) => m.name));
    nameWords = new Set(["blk", "hdb", "void", "deck", "ok", "mrt", "psle", "uncle", "auntie", "aunty", "mdm"]);
    for (const n of all) if (n) for (const w of String(n.en || "").toLowerCase().match(/[a-z]+/g) || []) nameWords.add(w);
    return nameWords;
  }
  function needsGloss(state, text) {
    const t = String(text || "");
    if (state.lang === "en") {
      if (/\p{Script=Han}/u.test(t)) return true;
      const ws = t.toLowerCase().match(/[a-z]+/g) || [];
      const malay = ws.filter((w) => MALAY.has(w)).length;
      return malay >= 2 && malay / ws.length >= 0.4;
    }
    if (CANTONESE.test(t)) return true;
    const latin = (t.match(/[A-Za-z]+/g) || []).filter((w) => !names().has(w.toLowerCase())).join("").length;
    const han = (t.match(/\p{Script=Han}/gu) || []).length;
    return latin >= 6 && latin > han * 2;
  }

  // ---------- 叙述和状态对不对得上（10-29 试玩：叙述说陈阿姨去了巴刹，地图上她还坐在棋桌边） ----------
  // 兜底的粗查：一句话里有在场者的名字（或配角的称呼），又有"离开、走开、散开、朝……走去"这类词，就算这句话说他走了。
  // 只用来退回重写一次，不自动改状态：关键词会误报，也会漏报（只写"她"就查不到）。主要靠 leave 操作和提示词
  const LEAVE_ZH = /(离开|走开|走远|出了门|出门去|回家去|回屋去|上楼去|下楼去|散开|散了|散去|转身走|起身走|走出去|往.{0,10}走去|朝.{0,10}走(去|了|远)|向.{0,10}走去)/;
  const LEAVE_EN = /\b(leaves|leaving|left (for|without)|walks (off|away|out)|walked (off|away|out)|heads? (off|out|home|away)|headed (off|out|home|away)|goes (home|off|out)|went (home|off|out)|wanders? off|wandered off|disperses?|dispersed|drifts? (off|away)|drifted (off|away)|makes? (his|her|their) way (out|home)|made (his|her|their) way (out|home))\b/i;
  // 朝你走过来、走到你旁边：是走近，不是离开。只认"往这边走"，朝你点头、向你道别、递过来、反应过来都不算
  const APPROACH_ZH = /((走|跑|挪|凑|靠)了?过来|走近|凑近|靠近(你|玩家)|走到.{0,8}(旁边|身边|面前|跟前|对面)|(朝|向|往)(你|玩家|这边|这儿)(走|跑|挪|凑|靠|过来|来))/;
  const APPROACH_EN = /\b(toward(s)? (you|the player)|over to you|comes? over|came over|to your side|up to you|(sit|sits|sat|stand|stands|stood|settles?|settled) (down )?(beside|next to) you)\b/i;
  const NOT_LEAVING_ZH = /(没有?|不|未|别|不肯|舍不得)(马上|立刻|急着|打算)?(离开|走)/;
  const NOT_LEAVING_EN = /\b(not|n't|never|without|instead of)\b[^.!?,;]{0,20}\b(leav|walk|head|go|wander|drift)/i;
  function sentences(text) { return String(text || "").split(/(?<=[。！？!?；;])|(?<=\.)\s+/).map((x) => x.trim()).filter(Boolean); }
  // 一句话再按逗号（英文还有 and、then 这些）拆成小句，逐个看：「陈阿姨朝你摆摆手，转身走了」后半句还是走了；
  // 「陈阿姨离开棋桌，走到你身边」后半句说她是走近，前半句只是离开棋桌；「陈阿姨离开了棋桌，林伟明走了过来」走近的是林伟明
  function clauses(sn, en) { return sn.split(en ? /[,;:]|\s+(?:and|then|before|as|while)\s+/i : /[，,：:]/).map((x) => x.trim()).filter(Boolean); }
  // 叙述里常只写名不写姓：林伟明 → 伟明，Lim Wei Ming → Wei Ming，Kumar 和工友 → Kumar
  function shortNames(state, id) {
    const full = nameOf(state, id), out = [full];
    const head = full.split(/\s*(?:和|&)\s*/)[0];
    if (head !== full) out.push(head);
    else if (/^\p{Script=Han}{3}$/u.test(full) && !/[阿姨伯叔婶婆公]/.test(full)) out.push(full.slice(1));
    else if (state.lang === "en" && full.split(/\s+/).length >= 2) out.push(full.split(/\s+/).slice(1).join(" "));
    return out;
  }
  // opts.self：这段话是某个住户写自己的动作（act），没提别人名字的"走了"算他自己
  function leaveClaims(state, text, opts) {
    opts = opts || {};
    const map = opts.map || state.actors.player.map;
    const en = state.lang === "en";
    const LEAVE = en ? LEAVE_EN : LEAVE_ZH, NOT = en ? NOT_LEAVING_EN : NOT_LEAVING_ZH, NEAR_RE = en ? APPROACH_EN : APPROACH_ZH;
    const who = residentsOn(state, map).map((id) => ({ id, names: shortNames(state, id) }))
      .concat(extrasOn(state, map).map((g) => ({ id: g.id, names: [g.label] })));
    const has = (t, n) => (en ? new RegExp("\\b" + String(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(t) : t.includes(n));
    const namedIn = (t) => who.filter((w) => w.names.some((n) => n && has(t, n))).map((w) => w.id);
    const out = new Set();
    for (const sn of sentences(text)) {
      const cls = clauses(sn, en);
      // 每个小句说的是谁：写了名字就是那几个人；没写（"转身走了"）就沿用前面最近提到的人，再没有就是整句里的人，再没有就是 self
      let prev = null;
      const subj = cls.map((cl) => { const n = namedIn(cl); if (n.length) prev = n; return prev; });
      const idsOf = (i) => { const n = subj[i] || namedIn(sn); return n.length || !opts.self ? n : [opts.self]; };
      const near = new Set();
      cls.forEach((cl, i) => { if (NEAR_RE.test(cl)) idsOf(i).forEach((id) => near.add(id)); });
      cls.forEach((cl, i) => {
        if (!LEAVE.test(cl) || NOT.test(cl) || NEAR_RE.test(cl)) return;
        for (const id of idsOf(i)) if (!near.has(id)) out.add(id);
      });
    }
    return [...out];
  }

  function leakFail(leak) {
    const why = { meta: "故事里不能出现元语言", tension: "不能把张力直接说出来", verbatim: "不能照抄设定原文" }[leak.kind];
    return { ok: false, reason: `${why}（${leak.match}），请改成用言行和细节表现`, leak };
  }

  // ---------- 单条操作 ----------
  function fail(reason) { return { ok: false, reason }; }

  // 英文版：退回理由要给模型看，也显示在调用记录里，所以翻成英文（理由在代码里写的是中文，这里按句式对照）
  const REASONS_EN = [
    [/^操作格式不对$/, "Malformed op"],
    [/^(\S+) 不能使用操作 (\S+)$/, "$1 may not use the op $2"],
    [/^未知操作 (.+)$/, "Unknown op $1"],
    [/^没有 (.+) 这个对象$/, "No such subject: $1"],
    [/^没有 (.+) 这张地图$/, "No map called $1"],
    [/^没有 (.+) 这种物件$/, "No prop called $1"],
    [/^没有 (.+) 这个钟$/, "No clock called $1"],
    [/^key 只能用小写字母、数字和下划线$/, "key may only use lowercase letters, digits and underscores"],
    [/^秘密不能由 GM 确立$/, "The GM cannot establish secrets"],
    [/^value 必须是简短的值$/, "value must be short"],
    [/^layer 只能是 mundane 或 stake$/, "layer must be mundane or stake"],
    [/^有后果的事实只能写在检定结果里$/, "A fact with consequences can only be set inside a roll's outcome"],
    [/^(.+) 已经确认为「(.*)」，不能改$/, "$1 is already settled as \"$2\" and cannot change"],
    [/^DC 必须是 5–25 的整数$/, "DC must be an integer from 5 to 25"],
    [/^检定要写明原因$/, "A roll needs a reason"],
    [/^一个场景最多 (\d+) 个物件$/, "At most $1 props in a scene"],
    [/^\((.+)\) 不能放物件$/, "No prop can go at ($1)"],
    [/^\((.+)\) 已经有东西了$/, "($1) already has something on it"],
    [/^(.+) 一家要按人写：(.+)$/, "Write the $1 household person by person: $2"],
    [/^(.+) 站的格子 \((.+)\) 不能站人$/, "$1 cannot stand at ($2)"],
    [/^\((.+)\) 已经被占了$/, "($1) is occupied"],
    [/^\((.+)\) 不能站人$/, "Nobody can stand at ($1)"],
    [/^\((.+)\) 已经有人了$/, "Someone is already at ($1)"],
    [/^界面只能移动玩家$/, "The interface can only move the player"],
    [/^没有内容$/, "Nothing written"],
    [/^一次只能推进 1–12 个时段$/, "Advance 1 to 12 slots at a time"],
    [/^时间格式不对$/, "Malformed time"],
    [/^要写明这次行动是为了谁$/, "Say who the action is for"],
    [/^(.+) 这时还不住在这里$/, "$1 does not live here yet"],
    [/^(.+) 这时不住在这里$/, "$1 does not live here at this time"],
    [/^(.+) 不在你身边，说的话你听不到$/, "$1 is not with the player, so the player cannot hear them"],
    [/^(.+) 家没有人在你身边$/, "Nobody from $1 is with the player"],
    [/^(.+) 不在你身边$/, "$1 is not with the player"],
    [/^(.+) 不是住户$/, "$1 is not a resident"],
    [/^need 必须是住户需求之一$/, "need must be one of the household's needs"],
    [/^这个十年的政策点已经用完了$/, "No policy points left this decade"],
    [/^confidence 必须在 0–1$/, "confidence must be between 0 and 1"],
    [/^钟的 id 格式不对$/, "Malformed clock id"],
    [/^已经有这个钟了$/, "That clock already exists"],
    [/^钟只能是 4、6 或 8 格$/, "A clock has 4, 6 or 8 segments"],
    [/^钟必须写明满格后果$/, "A clock needs a consequence"],
    [/^钟 (.+) 已经满格$/, "Clock $1 has already filled"],
    [/^钟 (.+) 已经停了$/, "Clock $1 has stopped"],
    [/^一次只能推进或倒退一格$/, "Move a clock one segment at a time"],
    [/^引用的事件不比上次推进更新$/, "The cited events are no newer than the last tick"],
    [/^只能停下还在走的钟$/, "Only a running clock can be stopped"],
    [/^伏笔要有内容$/, "A thread needs content"],
    [/^(.+) 还太小，不会说话$/, "$1 is too young to talk"],
    [/^不知道 (.+) 是谁$/, "Unknown person: $1"],
    [/^对自己的看法不算印象$/, "An impression has to be of someone else"],
    [/^(.+) 身上没有要记倾向的张力$/, "$1 has no lean to record"],
    [/^toward 只能是 a 或 b$/, "toward must be a or b"],
    [/^引用的事件不比上次变化更新$/, "The cited events are no newer than the last change"],
    [/^这个十年已经因为对话变过一次，光靠说话不能再变$/, "Talk has already moved this once this decade; talk alone cannot move it again"],
    [/^已经偏到头了$/, "Already at the end of the scale"],
    [/^(.+) 不是 (.+) 的障碍$/, "$1 is not a barrier for $2"],
    [/^已经说过了$/, "Already told"],
    [/^这是 (.+) 一个人的秘密，(.+) 不知道$/, "Only $1 knows this; $2 does not"],
    [/^(.+) 没有这个秘密$/, "$1 has no such secret"],
    [/^这件事这时还没发生，或已经过去了$/, "That has not happened yet, or is already over"],
    [/^(.+) 不知道这段旧事$/, "$1 does not know this history"],
    [/^kind 只能是 barrier、secret 或 relation$/, "kind must be barrier, secret or relation"],
    [/^delta 必须是 -10 到 10 之间、不为 0 的整数$/, "delta must be a non-zero integer from -10 to 10"],
    [/^只能引用这个十年里的事$/, "Only events from this decade can be cited"],
    [/^你身边没有空位$/, "No free cell next to the player"],
    [/^这个十年还没结束$/, "This decade is not over"],
    [/^纪要已经写过了$/, "The chronicle is already written"],
    [/^时间只能往前走$/, "Time only moves forward"],
    [/^这个十年是 (\d+)–(\d+) 年，进入下一个十年要由游戏端推进$/, "This decade is $1–$2; only the game can move to the next decade"],
    [/^必须引用至少一个事件$/, "Cite at least one event"],
    [/^事件 (.+) 不存在$/, "Event $1 does not exist"],
    [/^(.+) 没有经历过事件 (.+)$/, "$1 did not witness event $2"],
    [/^故事里不能出现元语言（(.+)），请改成用言行和细节表现$/, "No meta language in the story ($1); show it through what people do and small details"],
    [/^不能把张力直接说出来（(.+)），请改成用言行和细节表现$/, "Do not state the tension outright ($1); show it through what people do and small details"],
    [/^不能照抄设定原文（(.+)），请改成用言行和细节表现$/, "Do not copy the setting text ($1); show it through what people do and small details"],
    [/^只能给住户说的话加翻译$/, "Only a resident's words can be translated"],
    [/^这句话已经有翻译了$/, "That line already has a translation"],
    [/^\((.+)\) 有家具，不能站人$/, "There is furniture at ($1); nobody can stand there"],
    [/^\((.+)\) 是门，不能站人$/, "($1) is a door; standing there would block it"],
    [/^\((.+)\) 在门口，站在这里会把门堵住$/, "($1) is right in front of a door; standing there would block it"],
    [/^\((.+)\) 站在这里会把进门的路堵住$/, "Standing at ($1) would cut the doorway off from the rest of the room"],
    [/^这几个人站在一起会把进门的路堵住$/, "Standing together, these people would cut the doorway off from the rest of the room"],
    [/^检定的分支要写成列表 \[…\]$/, "A roll's branches must be lists […]"],
    [/^住户只能在自己所在的地图上走动，要去别处用 leave$/, "A resident can only walk within the map they are on; use leave to go elsewhere"],
    [/^(.+) 不在地图上$/, "$1 is not on the map"],
    [/^物件只能放在玩家所在的地图上$/, "Props can only go on the player's map"],
    [/^(\S+) 这户人家还没搬来，玩家去不了$/, "$1: this family hasn't moved in yet, so the player can't go there"],
    [/^(\S+) 这户人家还没搬来$/, "$1: this family hasn't moved in yet, so nobody can be placed there"],
    [/^(\S+) 家里没人，玩家去不了$/, "$1: nobody is home, so the player can't go there"],
    [/^(\S+) 进门的地方站满了人$/, "$1: there is no free cell near the door"],
    [/^固定家具不能拿走$/, "Fixed furniture can't be taken away"],
    [/^这里没有 (.+)$/, "There is no $1 here"],
    [/^配角要写一个简短的称呼（12 个字以内）$/, "Extras need a short label (12 characters at most)"],
    [/^人数只能是 1–9$/, "count must be 1 to 9"],
    [/^配角的 id 格式不对，或者和别人重了$/, "Malformed extras id, or it clashes with someone else"],
    [/^一张图上最多 (\d+) 组配角$/, "At most $1 groups of extras on one map"],
    [/^noticed_by 只能写这张图上的住户（(.+) 不在）$/, "noticed_by may only list residents on this map ($1 is not here)"],
    [/^(.+) 不能出现在 (.+)$/, "$1 can't appear in $2"]
  ];
  function reasonEn(reason) {
    for (const [re, to] of REASONS_EN) if (re.test(reason)) return reason.replace(re, to).replace(/、/g, ", ");
    return reason;
  }
  // perceiver 可以是一个人，也可以是几个人（其中任何一个经历过就算，用于家庭这一层的倾向）
  function needEvidence(state, ids, perceiver) {
    if (!Array.isArray(ids) || !ids.length) return "必须引用至少一个事件";
    const who = perceiver ? [].concat(perceiver) : null;
    for (const id of ids) {
      const e = findEvent(state, id);
      if (!e) return `事件 ${id} 不存在`;
      if (who && !who.some((p) => e.perceivedBy.includes(p))) return `${who.join("/")} 没有经历过事件 ${id}`;
    }
    return null;
  }

  function applyOp(state, op, ctx) {
    const r = applyOpRaw(state, op, ctx);
    if (!r.ok && r.reason && state.lang === "en") r.reason = reasonEn(r.reason);
    return r;
  }
  function applyOpRaw(state, op, ctx) {
    ctx = ctx || {};
    if (!op || typeof op.op !== "string") return fail("操作格式不对");
    const allowed = PERMS[ctx.by] || [];
    if (!allowed.includes(op.op)) return fail(`${ctx.by || "?"} 不能使用操作 ${op.op}`);
    const fn = OPS[op.op];
    return fn ? fn(state, op, ctx) : fail("未知操作 " + op.op);
  }

  // 住户在场也只知道眼前和自己家的细节（10-29 Polaris："住户应该只有自己房子的信息，和自己所在环境的信息"）：
  // 别的地图（别人家）的细节、不在场的人家里的细节，不进他的经历
  function knowsDetail(subject, id, e) {
    const hid = W.householdOf(id);
    if (M.MAPS[subject]) return subject === e.map || subject === W.RESIDENTS[hid].home;
    const owner = W.CHARACTERS[subject] ? W.householdOf(subject) : W.RESIDENTS[subject] ? subject : null;
    if (!owner) return true;
    return owner === hid || e.perceivedBy.includes(subject) || W.RESIDENTS[owner].members.some((m) => e.perceivedBy.includes(m.id));
  }

  const SUBJECTS = (state) => new Set(["estate"].concat(Object.keys(M.MAPS), Object.keys(W.RESIDENTS), Object.keys(W.CHARACTERS), Object.keys(W.SUPPORTING), Object.keys(M.PROPS)));

  const OPS = {
    // 事实四层：已确认的不能改；普通细节不设额度；有后果的要走检定；秘密不能由 GM 写
    establish_fact(state, op, ctx) {
      if (!SUBJECTS(state).has(op.subject)) return fail(`没有 ${op.subject} 这个对象`);
      if (!ID_RE.test(op.key || "")) return fail("key 只能用小写字母、数字和下划线");
      if (/^secret/.test(op.key)) return fail("秘密不能由 GM 确立");
      if (!isPrim(op.value)) return fail("value 必须是简短的值");
      const layer = op.layer || "mundane";
      if (!["mundane", "stake"].includes(layer)) return fail("layer 只能是 mundane 或 stake");
      if (layer === "stake" && !ctx.viaRoll) return fail("有后果的事实只能写在检定结果里");
      const k = op.subject + "." + op.key;
      if (state.details[k]) return fail(`${k} 已经确认为「${state.details[k].value}」，不能改`);
      const e = addEvent(state, { kind: "fact", actor: "player", summary: `${k} = ${op.value}`, fact: k });
      e.perceivedBy = e.perceivedBy.filter((id) => id === "player" || knowsDetail(op.subject, id, e));
      state.details[k] = { value: op.value, layer, source: ctx.viaRoll ? "roll" : "improvised", event: e.id };
      return { ok: true, event: e };
    },

    roll(state, op, ctx) {
      const base = op.dc;
      if (!Number.isInteger(base) || base < 5 || base > 25) return fail("DC 必须是 5–25 的整数");
      if (!op.reason) return fail("检定要写明原因");
      // 分支先查格式再掷骰：掷完才发现分支写错，骰子已经算数了，重给一次就成了掷两次
      if ([op.on_success, op.on_failure].some((b) => b != null && !Array.isArray(b))) return fail("检定的分支要写成列表 […]");
      const key = state.decade + ":" + String(op.reason).slice(0, 40);
      const dc = Math.min(25, base + 2 * (state.failed_rolls[key] || 0));
      const roll = d20(state);
      const success = roll >= dc;
      if (!success) state.failed_rolls[key] = (state.failed_rolls[key] || 0) + 1;
      // 掷骰只有玩家看得到（住户听不到玩家想做什么，也不该看到数字）；在场的人看到的是分支里 narrate 写的结果
      const e = addEvent(state, { kind: "roll", actor: "player", perceivedBy: ["player"], summary: state.lang === "en" ? `${op.reason}: d20=${roll} vs DC ${dc}, ${success ? "success" : "failure"}` : `${op.reason}：d20=${roll} vs DC ${dc}，${success ? "成功" : "失败"}`, roll, dc, success });
      const branch = (success ? op.on_success : op.on_failure) || [];
      const results = branch.map((sub) => {
        try { return applyOp(state, sub, Object.assign({}, ctx, { viaRoll: true })); } catch (err) { return fail(state.lang === "en" ? "Malformed op" : "操作格式不对"); }
      });
      return { ok: true, event: e, success, results };
    },

    // 场景：GM 往固定底图上摆人和物件，这里逐项校验
    set_scene(state, op) {
      const map = op.map;
      if (!M.MAPS[map]) return fail(`没有 ${map} 这张地图`);
      // 还没搬来的那一家：谁也摆不进去（玩家也去不了）
      if (canVisit(state, map).code === "not_yet") return fail(`${map} 这户人家还没搬来`);
      const props = op.props || [], people = op.actors || [];
      if (props.length > M.MAX_PROPS) return fail(`一个场景最多 ${M.MAX_PROPS} 个物件`);
      const taken = new Set();
      for (const p of props) {
        if (!M.PROPS[p.kind]) return fail(`没有 ${p.kind} 这种物件`);
        if (!M.propAllowed(p.kind, map)) return fail(`${p.kind} 不能出现在 ${map}`);
        if (!M.placeable(map, p.x, p.y)) return fail(`(${p.x},${p.y}) 不能放物件`);
        if (taken.has(p.x + "," + p.y)) return fail(`(${p.x},${p.y}) 已经有东西了`);
        taken.add(p.x + "," + p.y);
      }
      for (const p of props) if (furnitureAt(state, map, p.x, p.y)) return fail(`(${p.x},${p.y}) 已经有东西了`);
      if (state.actors.player.map === map) taken.add(state.actors.player.x + "," + state.actors.player.y);
      for (const g of extrasOn(state, map)) taken.add(g.x + "," + g.y);
      // 已经在这张图上、这次没摆的人还站在原地：不能把别人摞在他头上（这次摆的人可以换到彼此空出来的格子）
      const listed = new Set(people.map((a) => a.id));
      for (const id of residentsOn(state, map)) if (!listed.has(id)) taken.add(state.actors[id].x + "," + state.actors[id].y);
      for (const a of people) {
        if (!W.CHARACTERS[a.id]) return fail(notCharacter(a.id));
        if (!present(state, a.id)) return fail(`${a.id} 这时还不住在这里`);
        if (!M.standable(map, a.x, a.y)) return fail(`${a.id} 站的格子 (${a.x},${a.y}) 不能站人`);
        // 10-29 的中文局里陈阿姨被摆在了象棋桌那一格上：人不能站在家具上
        if (furnitureAt(state, map, a.x, a.y)) return fail(`(${a.x},${a.y}) 有家具，不能站人`);
        if (M.isExit(map, a.x, a.y)) return fail(`(${a.x},${a.y}) 是门，不能站人`);
        const blocked = blocksDoor(state, map, a.x, a.y, listed);
        if (blocked) return doorFail(blocked, a.x, a.y);
        if (taken.has(a.x + "," + a.y)) return fail(`(${a.x},${a.y}) 已经被占了`);
        taken.add(a.x + "," + a.y);
      }
      // 一个一个看都不堵，几个人合起来也可能把进门的路隔断
      if (people.length > 1 && sealsDoor(state, map, people.map((a) => [a.x, a.y]), new Set(people.map((a) => a.id)))) return fail("这几个人站在一起会把进门的路堵住");
      const leak = leakCheck(state, op.note);
      if (leak) return leakFail(leak);
      state.scene = { map, props: props.map((p) => ({ kind: p.kind, x: p.x, y: p.y })), weather: String(op.weather || "").slice(0, 40) };
      for (const a of people) Object.assign(state.actors[a.id], { map, x: a.x, y: a.y, activity: String(a.activity || "").slice(0, 80) });
      const e = addEvent(state, { kind: "scene", actor: "player", map, summary: String(op.note || M.MAPS[map].name[state.lang]).slice(0, 200) });
      return { ok: true, event: e };
    },

    move(state, op, ctx) {
      const who = op.actor || "player";
      const a = state.actors[who];
      if (!a) return fail(`没有 ${who}`);
      if (ctx.by === "ui" && who !== "player") return fail("界面只能移动玩家");
      if (who !== "player" && !present(state, who)) return fail(`${who} 这时还不住在这里`);
      const map = op.map || a.map;
      if (!M.MAPS[map]) return fail(`没有 ${map} 这张地图`);
      // 住户自己走：只能在所在的这张图上走几步；要去别处用 leave
      if (ctx.by === "character" && (!a.map || map !== a.map)) return fail("住户只能在自己所在的地图上走动，要去别处用 leave");
      const changed = map !== a.map;
      // 还没搬来的那一家：住户也叫不进去（玩家去不了，「各家现在」里也看不到他）
      if (who !== "player" && changed && canVisit(state, map).code === "not_yet") return fail(`${map} 这户人家还没搬来`);
      // 玩家去别人家：还没搬来、家里没人的去不了
      if (who === "player" && changed) {
        const v = canVisit(state, map);
        if (!v.ok && v.code === "not_yet") return fail(`${map} 这户人家还没搬来，玩家去不了`);
        if (!v.ok && v.code === "nobody") return fail(`${map} 家里没人，玩家去不了`);
      }
      // 换到另一家又没写坐标：站在进门的地方，被占了就站最近的空位（11-02：GM 带玩家去别家、叫人进门，不用算格子）
      let x = op.x, y = op.y;
      if (changed && x == null && y == null) {
        const at = entrySpot(state, map, who);
        if (!at) return fail(`${map} 进门的地方站满了人`);
        [x, y] = at;
      }
      if (!M.standable(map, x, y)) return fail(`(${x},${y}) 不能站人`);
      if (furnitureAt(state, map, x, y)) return fail(`(${x},${y}) 有家具，不能站人`);
      // 门不通到别处（11-02），玩家也不站门上：界面上走到门上只给提示
      if (M.isExit(map, x, y)) return fail(`(${x},${y}) 是门，不能站人`);
      const blocked = who !== "player" && blocksDoor(state, map, x, y, who);
      if (blocked) return doorFail(blocked, x, y);
      if (occupied(state, map, x, y, who)) return fail(`(${x},${y}) 已经有人了`);
      const wasOff = !a.map;
      Object.assign(a, { map, x, y });
      // 从外面叫进门的人，原来记着的去处（「出门了」「在楼下」「去巴刹」）不再是他在做的事；本来就在别家的人照旧
      if (who !== "player" && wasOff) a.activity = "";
      if (who === "player" && changed && state.scene.map !== map) state.scene = { map, props: [], weather: state.scene.weather };
      return { ok: true, changedMap: changed };
    },

    // 玩家说的话分两种（10-29 Polaris："用户的语言全都视为对话，要不然作为游戏人物跟 npc 对话，要不然是作为玩家身份跟 gm 说话"）：
    // to 是 "gm"：玩家身份对 GM 说（想做什么、问一句），只有玩家和 GM 知道，住户听不到；
    // 其他：角色说出口的话，同一张图上的人都听得到；to 写了住户，就记下是对谁说的
    player_say(state, op) {
      const text = String(op.text || "").slice(0, 600);
      if (!text) return fail("没有内容");
      if (op.to === "gm") return { ok: true, event: addEvent(state, { kind: "player_to_gm", actor: "player", perceivedBy: ["player"], summary: text }) };
      const to = op.to && W.CHARACTERS[op.to] && withPlayer(state, op.to) ? op.to : null;
      return { ok: true, event: addEvent(state, Object.assign({ kind: "player_input", actor: "player", summary: text }, to ? { to } : {})) };
    },

    // 离开这张图（去巴刹、回家、上班）。住户和配角都可以；离开前在场的人都看到他走了
    leave(state, op, ctx) {
      const who = op.actor;
      const to = String(op.to || "").trim().slice(0, 40);
      const leak = leakCheck(state, to);
      if (leak) return leakFail(leak);
      const g = extrasOf(state).find((x) => x.id === who);
      if (g) {
        if (ctx.by === "character") return fail(`${who} 不是住户`);
        const e = addEvent(state, { kind: "world", actor: "extras", map: g.map, summary: leaveText(state, extrasName(state, g), to) });
        state.extras = extrasOf(state).filter((x) => x !== g);
        return { ok: true, event: e };
      }
      if (!W.CHARACTERS[who]) return fail(notCharacter(who));
      const a = state.actors[who];
      if (!present(state, who) || !a.map) return fail(`${who} 不在地图上`);
      const e = addEvent(state, { kind: "world", actor: who, map: a.map, summary: leaveText(state, nameOf(state, who), to) });
      const home = W.RESIDENTS[a.household] && W.RESIDENTS[a.household].home;
      Object.assign(a, { map: null, x: null, y: null, activity: to });
      // 11-02 只剩各家：在别人家说「回家」的，就回到自己家里（不然他家在门牌上是空的，玩家找不到他）
      if (home && M.MAPS[home] && e.map !== home && GOING_HOME.test(to)) {
        const [hx, hy] = homeSpot(who);
        const spot = canStand(state, home, hx, hy) && !occupied(state, home, hx, hy, who) && !blocksDoor(state, home, hx, hy, who) ? [hx, hy] : entrySpot(state, home, who);
        if (spot) Object.assign(a, { map: home, x: spot[0], y: spot[1], activity: "" });
      }
      return { ok: true, event: e };
    },

    // 换手上在做的事（"坐在棋桌边" → "收好棋盒，准备去巴刹"）；不写事件，地图和提示词里看得到
    set_activity(state, op) {
      const who = op.actor;
      const activity = String(op.activity || "").trim().slice(0, 80);
      const leak = leakCheck(state, activity);
      if (leak) return leakFail(leak);
      const g = extrasOf(state).find((x) => x.id === who);
      if (g) { g.activity = activity; return { ok: true }; }
      if (!W.CHARACTERS[who]) return fail(notCharacter(who));
      if (!present(state, who) || !state.actors[who].map) return fail(`${who} 不在地图上`);
      state.actors[who].activity = activity;
      return { ok: true };
    },

    // 场景物件：一件一件地摆上、拿走（陈阿姨夹走棋盒，棋盘就没了）。只在玩家所在的图上
    place_prop(state, op) {
      const map = op.map || state.actors.player.map;
      if (map !== state.actors.player.map) return fail("物件只能放在玩家所在的地图上");
      if (!M.PROPS[op.kind]) return fail(`没有 ${op.kind} 这种物件`);
      if (!M.propAllowed(op.kind, map)) return fail(`${op.kind} 不能出现在 ${map}`);
      if (!M.placeable(map, op.x, op.y)) return fail(`(${op.x},${op.y}) 不能放物件`);
      if (state.scene.map !== map) state.scene = { map, props: [], weather: state.scene.weather || "" };
      if (furnitureAt(state, map, op.x, op.y) || state.scene.props.some((p) => p.x === op.x && p.y === op.y) || occupied(state, map, op.x, op.y, null)) return fail(`(${op.x},${op.y}) 已经有东西了`);
      if (state.scene.props.length >= M.MAX_PROPS) return fail(`一个场景最多 ${M.MAX_PROPS} 个物件`);
      state.scene.props.push({ kind: op.kind, x: op.x, y: op.y });
      return { ok: true };
    },
    remove_prop(state, op) {
      const map = state.actors.player.map;
      const hit = (p) => p.kind === op.kind && (op.x == null || p.x === op.x) && (op.y == null || p.y === op.y);
      const scene = state.scene.map === map ? state.scene.props : [];
      const today = ((state.day_props || {})[map]) || [];
      const i = scene.findIndex(hit);
      if (i >= 0) { scene.splice(i, 1); return { ok: true }; }
      const j = today.findIndex(hit);
      if (j >= 0) { today.splice(j, 1); return { ok: true }; }
      if ((M.FURNITURE[map] || []).some(([kind, x, y]) => hit({ kind, x, y }))) return fail("固定家具不能拿走");
      return fail(`这里没有 ${op.kind}`);
    },

    // 无名配角：一组人一个棋子（"老伯 ×3"），只占格子、不说话。写了已有的 id 就是更新（挪位置、改人数、改在做什么）
    extras(state, op) {
      const old = op.id ? extrasOf(state).find((g) => g.id === op.id) : null;
      // 更新已有的一组：没写的栏位照旧（只改在做什么，就只写 activity）
      const pick = (k, dflt) => (op[k] != null ? op[k] : old ? old[k] : dflt);
      const map = pick("map", state.actors.player.map);
      if (!M.MAPS[map]) return fail(`没有 ${map} 这张地图`);
      if (canVisit(state, map).code === "not_yet") return fail(`${map} 这户人家还没搬来`);
      const label = String(pick("label", "")).trim();
      if (!label || label.length > 12) return fail("配角要写一个简短的称呼（12 个字以内）");
      const count = pick("count", 1);
      if (!Number.isInteger(count) || count < 1 || count > 9) return fail("人数只能是 1–9");
      if (op.id && !old && (!ID_RE.test(op.id) || op.id === "player" || op.id === "extras" || W.CHARACTERS[op.id] || W.RESIDENTS[op.id] || W.SUPPORTING[op.id])) return fail("配角的 id 格式不对，或者和别人重了");
      if ((!old || old.map !== map) && extrasOn(state, map).length >= MAX_EXTRAS) return fail(`一张图上最多 ${MAX_EXTRAS} 组配角`);
      const x = pick("x"), y = pick("y");
      if (!M.standable(map, x, y)) return fail(`(${x},${y}) 不能站人`);
      if (furnitureAt(state, map, x, y)) return fail(`(${x},${y}) 有家具，不能站人`);
      if (M.isExit(map, x, y)) return fail(`(${x},${y}) 是门，不能站人`);
      const blocked = blocksDoor(state, map, x, y, old ? old.id : null);
      if (blocked) return doorFail(blocked, x, y);
      if (occupied(state, map, x, y, old ? old.id : null)) return fail(`(${x},${y}) 已经有人了`);
      const activity = String(pick("activity", "")).trim().slice(0, 80);
      const leak = leakCheck(state, label + " " + activity);
      if (leak) return leakFail(leak);
      const g = old || { id: op.id || nextExtrasId(state) };
      Object.assign(g, { label, count, map, x, y, activity });
      if (!old) extrasOf(state).push(g);
      return { ok: true, extras: clone(g) };
    },

    // GM 用玩家身份回答玩家（出戏的话：澄清、提示、"现在可以做什么"）。只有玩家看得到，不进住户的经历
    gm_reply(state, op) {
      const text = String(op.text || "").trim().slice(0, 600);
      if (!text) return fail("没有内容");
      const leak = leakCheck(state, text);
      if (leak) return leakFail(leak);
      return { ok: true, event: addEvent(state, { kind: "gm_reply", actor: "gm", perceivedBy: ["player"], summary: text }) };
    },

    advance_time(state, op) {
      const n = op.slots;
      if (!Number.isInteger(n) || n < 1 || n > 12) return fail("一次只能推进 1–12 个时段");
      const t = clone(state.time);
      t.slot += n;
      while (t.slot >= SLOTS.length) { t.slot -= SLOTS.length; t.day += 1; }
      while (t.day > 28) { t.day -= 28; t.month += 1; }
      while (t.month > 12) { t.month -= 12; t.year += 1; }
      return setTime(state, t, op.reason);
    },

    jump_time(state, op) {
      const t = { year: op.year, month: op.month, day: op.day || 1, slot: op.slot == null ? 1 : op.slot };
      if (![t.year, t.month, t.day, t.slot].every(Number.isInteger) || t.month < 1 || t.month > 12 || t.day < 1 || t.day > 28 || t.slot < 0 || t.slot >= SLOTS.length) return fail("时间格式不对");
      return setTime(state, t, op.reason);
    },

    // 玩家的自由行动：消耗 1 个政策点（和游戏端共用），对象必须在场。
    // 对象可以写人，也可以写拆开的户（那一户至少要有一个人在你身边）；满意度按户算
    community_action(state, op) {
      const targets = op.residents || [];
      if (!targets.length) return fail("要写明这次行动是为了谁");
      for (const r of targets) {
        if (W.CHARACTERS[r]) {
          if (!present(state, r)) return fail(`${r} 这时不住在这里`);
          if (!withPlayer(state, r)) return fail(`${r} 不在你身边`);
        } else if (W.RESIDENTS[r]) {
          if (!W.RESIDENTS[r].members.some((m) => present(state, m.id) && withPlayer(state, m.id))) return fail(`${r} 家没有人在你身边`);
        } else return fail(`${r} 不是住户`);
      }
      if (op.need != null && !W.NEEDS[op.need]) return fail("need 必须是住户需求之一");
      if (state.game.points < 1) return fail("这个十年的政策点已经用完了");
      const leak = leakCheck(state, op.description);
      if (leak) return leakFail(leak);
      state.game.points -= 1;
      const households = [...new Set(targets.map(W.householdOf))];
      const e = addEvent(state, { kind: "action", actor: "player", targets: targets.slice(), households, need: op.need || null, summary: String(op.description || "").slice(0, 200) });
      state.outbox.push({ type: "trpg_spend", source: "trpg", decade: state.decade, points: 1, reason: e.summary, evidence: [e.id] });
      return { ok: true, event: e };
    },

    gm_hypothesis(state, op) {
      const bad = needEvidence(state, op.evidence, "player");
      if (bad) return fail(bad);
      const c = Number(op.confidence);
      if (!(c >= 0 && c <= 1)) return fail("confidence 必须在 0–1");
      const h = { id: "H" + (state.gm.hypotheses.length + 1), trait: String(op.trait || "").slice(0, 40), text: String(op.text || "").slice(0, 200), confidence: c, evidence: op.evidence.slice(), decade: state.decade };
      state.gm.hypotheses.push(h);
      return { ok: true, hypothesis: h };
    },

    clock_create(state, op) {
      if (!ID_RE.test(op.id || "")) return fail("钟的 id 格式不对");
      if (state.plans.clocks[op.id]) return fail("已经有这个钟了");
      if (![4, 6, 8].includes(op.segments)) return fail("钟只能是 4、6 或 8 格");
      if (!op.consequence) return fail("钟必须写明满格后果");
      const name = typeof op.name === "string" ? { zh: op.name, en: op.name } : op.name;
      const consequence = typeof op.consequence === "string" ? { zh: op.consequence, en: op.consequence } : op.consequence;
      return { ok: true, clock: createClock(state, { id: op.id, owner: op.owner || "estate", segments: op.segments, name, consequence, visible: op.visible }, "planner") };
    },

    // 推进或倒退一格：必须引用比上次更新的事件；满格后果必须发生
    clock_tick(state, op) {
      const c = state.plans.clocks[op.clock];
      if (!c) return fail(`没有 ${op.clock} 这个钟`);
      if (c.status !== "running") return fail(`钟 ${c.id} 已经${c.status === "fired" ? "满格" : "停了"}`);
      if (op.by !== 1 && op.by !== -1) return fail("一次只能推进或倒退一格");
      const bad = needEvidence(state, op.evidence);
      if (bad) return fail(bad);
      const newest = Math.max(...op.evidence.map((id) => findEvent(state, id).seq));
      if (newest <= c.last_seq) return fail("引用的事件不比上次推进更新");
      c.progress = Math.max(0, Math.min(c.segments, c.progress + op.by));
      c.last_seq = state.seq;
      const fired = c.progress === c.segments ? fireClock(state, c) : null;
      return { ok: true, clock: clone(c), fired };
    },

    clock_drop(state, op) {
      const c = state.plans.clocks[op.clock];
      if (!c) return fail(`没有 ${op.clock} 这个钟`);
      if (c.status !== "running") return fail("只能停下还在走的钟");
      c.status = "dropped"; c.drop_reason = String(op.reason || "").slice(0, 200);
      return { ok: true };
    },

    plan_thread(state, op) {
      if (!op.text) return fail("伏笔要有内容");
      const t = { id: "F" + (state.plans.threads.length + 1), text: String(op.text).slice(0, 300), residents: (op.residents || []).filter((r) => W.RESIDENTS[r]), decade: state.decade, status: "open" };
      state.plans.threads.push(t);
      return { ok: true, thread: t };
    },

    speak(state, op) {
      if (!W.CHARACTERS[op.npc]) return fail(notCharacter(op.npc));
      if (!present(state, op.npc)) return fail(`${op.npc} 这时不住在这里`);
      if (!withPlayer(state, op.npc)) return fail(`${op.npc} 不在你身边，说的话你听不到`);
      if (!W.canTalk(op.npc, state.time.year)) return fail(`${op.npc} 还太小，不会说话`);
      const leak = leakCheck(state, op.text);
      if (leak) return leakFail(leak);
      // gloss：台词里有读的人看不懂的方言或外语时，住户自己给的整句翻译；同样过设定门
      const gloss = op.gloss == null ? "" : String(op.gloss).trim().slice(0, 400);
      const leak2 = gloss && leakCheck(state, gloss);
      if (leak2) return leakFail(leak2);
      const ev = { kind: "speech", actor: op.npc, summary: String(op.text || "").slice(0, 600) };
      if (gloss && gloss !== ev.summary.trim()) ev.gloss = gloss;
      return { ok: true, event: addEvent(state, ev) };
    },

    // 翻译（10-29 Polaris："每个人说话至少得让人看得懂"）：住户没给翻译、这句话又看着难懂时，由 GM 补一句
    gloss(state, op) {
      const e = findEvent(state, op.event);
      if (!e || e.kind !== "speech") return fail("只能给住户说的话加翻译");
      if (e.gloss) return fail("这句话已经有翻译了");
      const text = String(op.text || "").trim().slice(0, 400);
      if (!text) return fail("没有内容");
      const leak = leakCheck(state, text);
      if (leak) return leakFail(leak);
      e.gloss = text;
      return { ok: true, event: e };
    },

    // 叙述：玩家看到的旁白，同样过设定门
    // noticed_by：谁注意到了（隔着房间的小动作不一定人人看见）；不写就是同一张图上的人都看见
    narrate(state, op) {
      const text = String(op.text || "").slice(0, 1200);
      if (!text) return fail("没有内容");
      const leak = leakCheck(state, text);
      if (leak) return leakFail(leak);
      const ev = { kind: "narration", actor: "player", summary: text };
      if (Array.isArray(op.noticed_by)) {
        const here = residentsOn(state, state.actors.player.map);
        const bad = op.noticed_by.find((id) => !here.includes(id));
        if (bad) return fail(`noticed_by 只能写这张图上的住户（${bad} 不在）`);
        ev.perceivedBy = ["player"].concat(op.noticed_by);
      }
      return { ok: true, event: addEvent(state, ev) };
    },

    // 住户对人的印象：只能引用自己经历过的事；不同住户的印象可以互相矛盾
    impression(state, op) {
      if (!W.CHARACTERS[op.npc]) return fail(notCharacter(op.npc));
      const about = op.about || "player";
      if (about !== "player" && !W.RESIDENTS[about] && !W.CHARACTERS[about] && !W.SUPPORTING[about]) return fail(`不知道 ${about} 是谁`);
      if (about === op.npc) return fail("对自己的看法不算印象");
      const bad = needEvidence(state, op.evidence, op.npc);
      if (bad) return fail(bad);
      const m = state.minds[op.npc];
      const imp = { id: op.npc + "_I" + (m.impressions.length + 1), about, text: String(op.text || "").slice(0, 200), evidence: op.evidence.slice(), decade: state.decade, seq: state.seq };
      m.impressions.push(imp);
      return { ok: true, impression: imp };
    },

    // 张力倾向：一次挪一格，-3（偏 a）到 3（偏 b）；只靠对话的话，每个十年最多挪一次。
    // npc 是有张力的人；林家共同的那一对写户名 lin，家里任何一个人经历过的事都可以引用
    lean(state, op) {
      const m = state.minds[op.npc];
      if (!m) return fail(notCharacter(op.npc));
      if (!W.tensionOf(op.npc)) return fail(`${op.npc} 身上没有要记倾向的张力`);
      if (!["a", "b"].includes(op.toward)) return fail("toward 只能是 a 或 b");
      const who = W.CHARACTERS[op.npc] ? op.npc : W.RESIDENTS[op.npc].members.map((x) => x.id);
      const bad = needEvidence(state, op.evidence, who);
      if (bad) return fail(bad);
      const evs = op.evidence.map((id) => findEvent(state, id));
      if (Math.max(...evs.map((e) => e.seq)) <= m.lean_seq) return fail("引用的事件不比上次变化更新");
      const speechOnly = evs.every((e) => SPEECH_KINDS.has(e.kind));
      if (speechOnly && m.speech_lean_decade === state.decade) return fail("这个十年已经因为对话变过一次，光靠说话不能再变");
      const next = Math.max(-3, Math.min(3, m.lean + (op.toward === "a" ? -1 : 1)));
      if (next === m.lean) return fail("已经偏到头了");
      m.lean = next; m.lean_seq = state.seq;
      if (speechOnly) m.speech_lean_decade = state.decade;
      return { ok: true, lean: next };
    },

    // 住户自己决定说出障碍、秘密或旧事；只能当着玩家说。
    // 障碍和全家都知道的秘密，家里谁都能说；只有一个人知道的秘密（holder），只有他自己能说。揭示的记录按户存
    reveal(state, op) {
      if (!W.CHARACTERS[op.npc]) return fail(notCharacter(op.npc));
      if (!withPlayer(state, op.npc)) return fail(`${op.npc} 不在你身边`);
      const hid = W.householdOf(op.npc), r = W.RESIDENTS[hid];
      const rv = state.revealed;
      let summary;
      if (op.kind === "barrier") {
        if (!r.barriers.includes(op.id)) return fail(`${op.id} 不是 ${hid} 的障碍`);
        rv.barriers[hid] = rv.barriers[hid] || [];
        if (rv.barriers[hid].includes(op.id)) return fail("已经说过了");
        rv.barriers[hid].push(op.id);
        summary = `${L(state, r.name)}：${L(state, W.BARRIERS[op.id])}`;
      } else if (op.kind === "secret") {
        const s = r.secrets.find((x) => x.id === op.id);
        if (!s) return fail(`${op.npc} 没有这个秘密`);
        if (!W.secretActive(s, state.time.year)) return fail("这件事这时还没发生，或已经过去了");
        if (!W.secretsKnownBy(op.npc).some((k) => k.secret === s && k.household === hid)) return fail(`这是 ${s.holder} 一个人的秘密，${op.npc} 不知道`);
        rv.secrets[hid] = rv.secrets[hid] || [];
        if (rv.secrets[hid].includes(op.id)) return fail("已经说过了");
        rv.secrets[hid].push(op.id);
        summary = L(state, s);
      } else if (op.kind === "relation") {
        const rel = W.RELATIONS.find((x) => x.id === op.id);
        if (!rel || !rel.between.includes(hid) || (rel.members && !rel.members.includes(op.npc))) return fail(`${op.npc} 不知道这段旧事`);
        if (rv.relations.includes(op.id)) return fail("已经说过了");
        rv.relations.push(op.id);
        summary = L(state, rel);
      } else return fail("kind 只能是 barrier、secret 或 relation");
      const e = addEvent(state, { kind: "reveal", actor: op.npc, perceivedBy: ["player", op.npc], summary, reveal: { kind: op.kind, id: op.id } });
      if (op.kind === "barrier") state.outbox.push({ type: "trpg_info", source: "trpg", decade: state.decade, resident: hid, barrier: op.id, evidence: [e.id] });
      return { ok: true, event: e };
    },

    // 满意度回传：住户自己提议方向和幅度，Harness 只裁剪，不替住户决定。
    // 由某个人提议（只能引用他自己经历过的事），记在他那一户上；一户人共用一个上限
    satisfaction(state, op) {
      if (!W.CHARACTERS[op.npc]) return fail(notCharacter(op.npc));
      if (!present(state, op.npc)) return fail(`${op.npc} 这时不住在这里`);
      const id = W.householdOf(op.npc);
      if (!Number.isInteger(op.delta) || op.delta === 0 || Math.abs(op.delta) > 10) return fail("delta 必须是 -10 到 10 之间、不为 0 的整数");
      const bad = needEvidence(state, op.evidence, op.npc);
      if (bad) return fail(bad);
      const evs = op.evidence.map((x) => findEvent(state, x));
      if (evs.some((e) => e.decade !== state.decade)) return fail("只能引用这个十年里的事");
      const action = evs.find((e) => e.kind === "action" && (e.households || []).includes(id));
      const category = action ? "action" : "talk";
      const led = state.ledger.per[id];
      let applied;
      if (op.delta > 0) {
        const catCap = category === "talk" ? CAPS.talk.up - led.talk_up
          : (action.need && W.RESIDENTS[id].needs.includes(action.need) ? CAPS.action.up : CAPS.action.mismatch_up) - led.action_up;
        let cap = Math.min(catCap, CAPS.total.up - led.up);
        if (led.harm > 0) cap = Math.min(cap, Math.floor(led.harm * CAPS.harm_ratio) - led.up);
        applied = Math.max(0, Math.min(op.delta, cap));
        led[category + "_up"] += applied; led.up += applied;
      } else {
        const catCap = (category === "talk" ? CAPS.talk.down : CAPS.action.down) - led[category + "_down"];
        const cap = Math.max(catCap, CAPS.total.down - led.down);
        applied = Math.min(0, Math.max(op.delta, cap));
        led[category + "_down"] += applied; led.down += applied;
      }
      const rec = { resident: id, by: op.npc, proposed: op.delta, applied, category, reason: String(op.reason || "").slice(0, 200), evidence: op.evidence.slice(), decade: state.decade };
      state.feedback_log.push(rec);
      if (applied !== 0) state.outbox.push({ type: "trpg_feedback", source: "trpg", decade: state.decade, resident: id, delta: applied, category, reason: rec.reason, evidence: rec.evidence });
      return { ok: true, applied, clipped: applied !== op.delta, category };
    },

    // 住户主动来找你：同一张图就走到你旁边；不在同一张图就记下来，界面显示"有人敲门"
    initiate(state, op) {
      if (!W.CHARACTERS[op.npc]) return fail(notCharacter(op.npc));
      if (!present(state, op.npc)) return fail(`${op.npc} 这时不住在这里`);
      const a = state.actors[op.npc], p = state.actors.player;
      if (a.map !== p.map) {
        if (!state.pending_initiatives.includes(op.npc)) state.pending_initiatives.push(op.npc);
        return { ok: true, pending: true };
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = p.x + dx, y = p.y + dy;
        if (canStand(state, p.map, x, y) && !occupied(state, p.map, x, y, op.npc) && !blocksDoor(state, p.map, x, y, op.npc)) {
          Object.assign(a, { x, y });
          return { ok: true, event: addEvent(state, { kind: "world", actor: op.npc, summary: nameOf(state, op.npc) + L(state, { zh: "走过来找你", en: " comes over to you" }) }) };
        }
      }
      return fail("你身边没有空位");
    },

    chronicle(state, op) {
      const c = state.chronicle.find((x) => x.decade === op.decade);
      if (!c) return fail("这个十年还没结束");
      if (c.text) return fail("纪要已经写过了");
      c.text = String(op.text || "").slice(0, 2000);
      return { ok: true };
    }
  };

  function setTime(state, t, reason) {
    const [lo, hi] = W.DECADES[state.decade - 1].years;
    const now = state.time;
    const key = (x) => ((x.year * 12 + x.month) * 31 + x.day) * 10 + x.slot;
    if (key(t) <= key(now)) return fail("时间只能往前走");
    if (t.year < lo || t.year > hi) return fail(`这个十年是 ${lo}–${hi} 年，进入下一个十年要由游戏端推进`);
    const from = timeLabel(state);
    const arrivedBefore = W.charactersAt(state.time.year);
    state.time = t;
    for (const a of Object.values(state.actors)) {
      if (a.kind !== "resident") continue;
      if (present(state, a.id) && !arrivedBefore.includes(a.id)) sendHome(a);
      if (!present(state, a.id)) Object.assign(a, { map: null, x: null, y: null });
    }
    const e = addEvent(state, { kind: "time", actor: "player", global: true, map: null, summary: `${from} → ${timeLabel(state)}${reason ? (state.lang === "en" ? " (" + String(reason).slice(0, 60) + ")" : "（" + String(reason).slice(0, 60) + "）") : ""}` });
    return { ok: true, event: e };
  }

  // 一次提案：{ by, ops: [...] }，逐条校验，互不影响
  function apply(state, proposal) {
    state.turn += 1;
    const ctx = { by: proposal.by };
    return (proposal.ops || []).map((op) => Object.assign({ op: op && op.op }, applyOp(state, op, ctx)));
  }

  // ---------- 按视角取状态（四种存储在这里隔离） ----------
  function getView(state, perceiver) {
    const pub = {
      lang: state.lang, decade: state.decade, decade_title: L(state, W.DECADES[state.decade - 1].title),
      time: clone(state.time), time_label: timeLabel(state), game: clone(state.game)
    };
    if (perceiver === "gm") return Object.assign(pub, { full: clone(state) });
    if (perceiver === "player") {
      const map = state.actors.player.map;
      return Object.assign(pub, {
        player: clone(state.actors.player),
        scene: state.scene.map === map ? clone(state.scene) : { map, props: [], weather: "" },
        people: residentsOn(state, map).map((id) => ({ id, household: W.householdOf(id), name: nameOf(state, id), x: state.actors[id].x, y: state.actors[id].y, activity: state.actors[id].activity })),
        extras: clone(extrasOn(state, map)),
        revealed: clone(state.revealed),
        clocks: Object.values(state.plans.clocks).filter((c) => c.visible).map((c) => ({ id: c.id, name: L(state, c.name), progress: c.progress, segments: c.segments, status: c.status })),
        events: state.events.filter((e) => e.perceivedBy.includes("player")).map(clone),
        knocking: state.pending_initiatives.slice()
      });
    }
    // 住户的视角按人取：只有自己的心思、自己知道的秘密、自己经历过的事；家庭这一层的倾向（林家）一起给
    if (W.CHARACTERS[perceiver]) {
      const hid = W.householdOf(perceiver), r = W.RESIDENTS[hid];
      return Object.assign(pub, {
        self: { id: perceiver, household: hid, name: nameOf(state, perceiver), here: present(state, perceiver), position: clone(state.actors[perceiver]), members: W.membersAt(hid, state.time.year).map((m) => L(state, m.name)), stage: L(state, r.stages[Math.min(state.decade, r.stages.length) - 1]) },
        mind: clone(state.minds[perceiver]),
        family: perceiver !== hid && state.minds[hid] ? { lean: state.minds[hid].lean } : null,
        secrets: W.secretsKnownBy(perceiver, state.time.year).map((k) => ({ household: k.household, id: k.secret.id })),
        events: state.events.filter((e) => e.perceivedBy.includes(perceiver)).map(clone),
        surroundings: surroundings(state, perceiver)
      });
    }
    return null;
  }

  // 住户眼里的场景（10-29 Polaris："住户应该只有自己房子的信息，和自己所在环境的信息"）：
  // here：此刻所在的这张图（家具、物件、谁在哪、在做什么、配角、玩家在哪），不在任何图上就是 null；
  // home：自己家的布置，人不在家也知道；不给家里此刻有谁。
  // 定下来的细节只给这两处的、而且是他自己在场时定下的；别人家、他不在场时的事都不给
  function surroundings(state, id) {
    const a = state.actors[id], hid = W.householdOf(id), home = W.RESIDENTS[hid].home;
    const family = new Set([id, hid].concat(W.RESIDENTS[hid].members.map((m) => m.id)));
    const places = new Set([home].concat(a.map ? [a.map] : []));
    const details = Object.entries(state.details).filter(([k, d]) => {
      const subject = k.split(".")[0];
      const e = findEvent(state, d.event);
      return e && e.perceivedBy.includes(id) && (places.has(subject) || family.has(subject));
    }).map(([k, d]) => ({ key: k, value: d.value, event: d.event }));
    const place = (map) => ({ map, furniture: furnitureOn(state, map).map(clone) });
    let here = null;
    if (a.map) {
      const p = state.actors.player;
      here = Object.assign(place(a.map), {
        props: state.scene.map === a.map ? clone(state.scene.props) : [],
        weather: state.scene.map === a.map ? state.scene.weather || "" : "",
        self: { x: a.x, y: a.y, activity: a.activity || "" },
        people: residentsOn(state, a.map).filter((x) => x !== id).map((x) => ({ id: x, x: state.actors[x].x, y: state.actors[x].y, activity: state.actors[x].activity || "" })),
        extras: clone(extrasOn(state, a.map)),
        player: p.map === a.map ? { x: p.x, y: p.y, distance: Math.abs(p.x - a.x) + Math.abs(p.y - a.y) } : null
      });
    }
    return { here, home: a.map === home ? null : place(home), details };
  }

  function drainOutbox(state) { const out = state.outbox; state.outbox = []; return out; }

  root.V2Harness = { SLOTS, CAPS, PERMS, MAX_EXTRAS, createState, pushGameEvent, apply, applyOp, getView, drainOutbox, addEvent, timeLabel, leakCheck, needsGloss, reasonEn, furnitureOn, furnitureAt, canStand, blocksDoor, canVisit, extrasOn, extrasName, leaveClaims };
})(typeof window !== "undefined" ? window : globalThis);
