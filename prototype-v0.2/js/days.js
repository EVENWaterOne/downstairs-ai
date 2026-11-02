/* 日子和日程（M2）。
 * 每个十年挑几个「日子」来过，每个日子是完整的一天，玩家在这一天里相对自由（10-28 Polaris：挑日子）。
 * 日子之间的几个月、几年不玩，只换一张标题卡。M3 以后改由规划调用来排；现在第一个十年是写死的 8 个日子。
 * 日程决定每个人每个时段在哪：home（自己家）、away（不在楼里：上班、上学、去巴刹）、corridor、void_deck、dorm。
 * gm 一栏只给 GM 看，是这一天的背景；史实来源见 docs/PROTOTYPE_V0.2_DESIGN.md。不依赖 DOM。 */
(function (root) {
  "use strict";
  const W = root.V2World, M = root.V2Maps, H = root.V2Harness, B = root.V2Board;
  const LAST_SLOT = H.SLOTS.length - 1;

  // kind：work 平日（日期都是星期一到五，测试会查），rest 周末或节日（日程不同）。overrides：{ 时段: { 角色: 地点 } }，props：这一天临时摆出来的东西
  const DAYS = [
    {
      id: "d1989_first", decade: 1, date: { year: 1989, month: 3, day: 6 }, slot: 1, kind: "work",
      title: { zh: "1989 年 3 月 · 上任第一天", en: "March 1989 · Your first day" },
      player: { map: "office", x: 3, y: 2 },
      gm: {
        zh: "玩家今天第一天到 317A 楼下的办公室上班。317A 刚交钥匙几个月，有的人家还在装修，楼下还空荡荡的，老伯们已经在 void deck 摆起象棋。这个月政府刚宣布种族融合政策，楼下没人在谈。今天没有安排大事，让玩家认识人。",
        en: "The player's first day at the office under 317A. Keys were handed over a few months ago; some flats are still being renovated, the void deck is bare, and the old men have already set up chess. The Ethnic Integration Policy was announced this month; nobody downstairs is talking about it. Nothing big is planned: let the player meet people."
      }
    },
    {
      id: "d1990_cny", decade: 1, date: { year: 1990, month: 1, day: 20 }, slot: 1, kind: "rest",
      title: { zh: "1990 年 1 月 · 农历新年前", en: "January 1990 · The week before Chinese New Year" },
      player: { map: "void_deck", x: 2, y: 5 },
      props: { corridor: [["laundry_pole", 10, 2]] },
      gm: {
        zh: "农历新年前一个星期（这年的初一是 1 月 27 日）。家家户户大扫除、办年货，走廊上晾着被子。陈阿姨一个人过年。林家在商量初一先回哪边父母家。Aisyah 会送糕给邻居。",
        en: "A week before Chinese New Year (New Year's Day falls on 27 January this year). Spring cleaning and shopping; quilts airing in the corridor. Mdm Chan will spend the New Year alone. The Lims are deciding whose parents to visit first. Aisyah will send kuih round to the neighbours."
      }
    },
    {
      id: "d1990_rain", decade: 1, date: { year: 1990, month: 12, day: 6 }, slot: 3, kind: "work",
      title: { zh: "1990 年 12 月 · 雨季的下午", en: "December 1990 · A monsoon afternoon" },
      player: { map: "office", x: 3, y: 2 },
      overrides: { 3: { chen: "void_deck", mak_esah: "void_deck" }, 4: { chen: "void_deck", mak_esah: "void_deck" } },
      gm: {
        zh: "十二月，季风季，下了一下午的雨。上个月吴作栋接任总理，十月新加坡和中国建交，报纸电视都在说，楼下偶尔有人聊两句。没有什么特别的事：人在楼下等雨停。",
        en: "December monsoon; it rains all afternoon. Goh Chok Tong became Prime Minister last month and Singapore established ties with China in October; people mention it now and then downstairs. Nothing in particular happens: people wait for the rain to stop."
      }
    },
    {
      id: "d1992_raya", decade: 1, date: { year: 1992, month: 4, day: 4 }, slot: 2, kind: "rest",
      title: { zh: "1992 年 4 月 · 开斋节", en: "April 1992 · Hari Raya Puasa" },
      player: { map: "void_deck", x: 2, y: 5 },
      props: { void_deck: [["long_table", 9, 3], ["long_table", 10, 3], ["kuih_tray", 11, 3]] },
      overrides: {
        2: { rahman: "void_deck", aisyah_kassim: "void_deck", nurul: "void_deck", hafiz: "void_deck", mak_esah: "void_deck" },
        3: { rahman: "void_deck", aisyah_kassim: "void_deck", nurul: "void_deck", hafiz: "void_deck", mak_esah: "void_deck", chen: "void_deck", junhao: "void_deck" },
        4: { aisyah_kassim: "void_deck", hafiz: "void_deck", mak_esah: "void_deck" }
      },
      gm: {
        zh: "开斋节。Aisyah 一家把长木桌搬到 void deck，摆满马来糕和黄姜饭，请邻居来吃。Nurul 刚进理工学院。Mei 一家今年刚来新加坡，住在隔壁楼，还不认识这里的人，今天不在 317A。",
        en: "Hari Raya Puasa. Aisyah's family carries the long table down to the void deck, loads it with kuih and nasi kuning, and invites the neighbours. Nurul has just entered polytechnic. Mei's family arrived in Singapore this year and rents in the next block; they know no one here and are not at 317A today."
      }
    },
    {
      id: "d1994_move", decade: 1, date: { year: 1994, month: 6, day: 11 }, slot: 1, kind: "rest",
      title: { zh: "1994 年 6 月 · 七楼有人搬进来", en: "June 1994 · New neighbours on level 7" },
      player: { map: "corridor", x: 10, y: 2 },
      props: { corridor: [["boxes", 15, 1], ["boxes", 16, 1]] },
      overrides: {
        1: { wangmei: "corridor", jianguo: "corridor", xiaoyu: "corridor" },
        2: { wangmei: "corridor", jianguo: "corridor", xiaoyu: "corridor" },
        3: { jianguo: "corridor" }
      },
      gm: {
        zh: "周末。Mei 一家今天搬进七楼那户三房式（原屋主一家移民加拿大），走廊上堆着纸箱，邻居们出来看。王美说标准普通话，楼里老人说福建话、广东话，年轻人说英语。",
        en: "A weekend. Mei's family moves into the three-room flat on level 7 (the previous owners emigrated to Canada); boxes fill the corridor and neighbours come out to look. Wang Mei speaks standard Mandarin; the old folk speak Hokkien and Cantonese, the young speak English."
      }
    },
    {
      id: "d1994_cup", decade: 1, date: { year: 1994, month: 12, day: 17 }, slot: 4, kind: "rest",
      title: { zh: "1994 年 12 月 17 日 · 马来西亚杯决赛", en: "17 December 1994 · The Malaysia Cup final" },
      player: { map: "void_deck", x: 2, y: 5 },
      props: { void_deck: [["tv", 9, 3]] },
      overrides: {
        4: { rahman: "void_deck", hafiz: "void_deck", weiming: "void_deck", junhao: "void_deck", jianguo: "void_deck", chen: "void_deck" },
        5: { rahman: "void_deck", hafiz: "void_deck", weiming: "void_deck", junhao: "void_deck", jianguo: "void_deck" }
      },
      gm: {
        zh: "马来西亚杯决赛之夜，新加坡对彭亨。有人把电视搬到 void deck，楼里的人围着看，Rahman 和 Hafiz、伟明和俊豪、建国都在。新加坡最后 4 比 0 赢了；打完这个赛季，新加坡队就退出了马来西亚的比赛，这时候大家还不知道。",
        en: "Malaysia Cup final night, Singapore against Pahang. Someone has carried a television down to the void deck and the block crowds round: Rahman and Hafiz, Wei Ming and Jun Hao, Jianguo. Singapore win 4–0; after this season Singapore leave the Malaysian competitions, which nobody knows yet."
      }
    },
    {
      id: "d1997_haze", decade: 1, date: { year: 1997, month: 9, day: 24 }, slot: 1, kind: "work",
      title: { zh: "1997 年 9 月 · 烟霾", en: "September 1997 · The haze" },
      player: { map: "office", x: 3, y: 2 },
      gm: {
        zh: "印尼林火的烟霾笼罩新加坡，空气里一股焦味，这个月空气污染指数最高到过 226。亚洲金融风暴刚开始，报纸说硬盘厂陆续关闭或迁出，伟明和建国都在这一行。学校让孩子留在室内。",
        en: "Haze from Indonesian forest fires covers Singapore and the air smells burnt; the PSI peaks at 226 this month. The Asian financial crisis is starting and the papers report disk-drive plants closing or leaving; Wei Ming and Jianguo both work in that industry. Schools keep children indoors."
      }
    },
    {
      id: "d1998_spring", decade: 1, date: { year: 1998, month: 4, day: 16 }, slot: 2, kind: "work",
      title: { zh: "1998 年 4 月", en: "April 1998" },
      player: { map: "void_deck", x: 2, y: 5 },
      overrides: { 2: { weiming: "void_deck" }, 3: { weiming: "void_deck" } },
      gm: {
        zh: "经济衰退，裁员潮。伟明年初被裁，到现在快三个月，每天照样穿衬衫出门，家里还不知道；今天中午和下午他坐在楼下。建国在同一轮调整里保住了位子。慧玲在为俊豪的华文发愁。这是第一个十年的最后一个日子。",
        en: "Recession and retrenchments. Wei Ming was let go early this year; for almost three months he has left every morning in a shirt and his family still does not know. Today at midday and in the afternoon he sits downstairs. Jianguo kept his job in the same round. Hui Ling worries about Jun Hao's Chinese. This is the last day of the first decade."
      }
    }
  ];

  // 每人每个时段（早上、上午、中午、下午、傍晚、晚上）在哪。work 平日，rest 周末和节日
  const SCHEDULES = {
    chen: { work: ["void_deck", "void_deck", "home", "away", "void_deck", "home"], rest: ["void_deck", "void_deck", "home", "void_deck", "void_deck", "home"] },
    weiming: { work: ["home", "away", "away", "away", "away", "home"], rest: ["away", "home", "home", "void_deck", "home", "home"] },
    huiling: { work: ["home", "away", "away", "away", "home", "home"], rest: ["away", "home", "home", "home", "corridor", "home"] },
    junhao: { work: ["home", "away", "away", "away", "home", "home"], rest: ["away", "home", "home", "void_deck", "home", "home"] },
    rahman: { work: ["away", "away", "away", "home", "corridor", "home"], rest: ["home", "home", "home", "home", "corridor", "home"] },
    aisyah_kassim: { work: ["away", "home", "home", "home", "home", "home"], rest: ["away", "home", "home", "home", "home", "home"] },
    nurul: { work: ["home", "away", "away", "away", "home", "home"], rest: ["home", "home", "away", "away", "home", "home"] },
    hafiz: { work: ["home", "away", "away", "void_deck", "void_deck", "home"], rest: ["home", "void_deck", "home", "void_deck", "void_deck", "home"] },
    mak_esah: { work: ["home", "home", "home", "home", "void_deck", "home"], rest: ["home", "home", "home", "home", "void_deck", "home"] },
    kumar: { work: ["away", "corridor", "void_deck", "corridor", "dorm", "dorm"], rest: ["dorm", "away", "away", "away", "away", "dorm"] },
    wangmei: { work: ["away", "away", "away", "home", "corridor", "home"], rest: ["home", "home", "home", "home", "corridor", "home"] },
    jianguo: { work: ["home", "away", "away", "away", "home", "home"], rest: ["home", "home", "home", "corridor", "home", "home"] },
    xiaoyu: { work: ["home", "away", "away", "home", "corridor", "home"], rest: ["home", "home", "home", "corridor", "corridor", "home"] }
  };

  // 不在家时习惯站的地方；被占了就站旁边
  const SPOTS = {
    void_deck: { chen: [6, 4], mak_esah: [7, 4], kumar: [2, 2], hafiz: [10, 8], junhao: [11, 8], weiming: [13, 4], huiling: [14, 4], rahman: [8, 4], aisyah_kassim: [10, 5], nurul: [11, 5], jianguo: [12, 3], wangmei: [5, 5], xiaoyu: [12, 8] },
    corridor: { rahman: [12, 2], kumar: [4, 2], wangmei: [17, 1], xiaoyu: [14, 1], jianguo: [11, 1], huiling: [7, 2], aisyah_kassim: [10, 1] },
    dorm: { kumar: [3, 2] }
  };
  const HOME_SPOT = { flat_chen: [3, 3], flat_lin: [3, 3], flat_aisyah: [3, 4], flat_mei: [3, 4], dorm: [3, 2] };

  function homeSpot(id) {
    const c = W.CHARACTERS[id], r = W.RESIDENTS[c.household];
    const [x, y] = HOME_SPOT[r.home];
    return [x + (c.member ? r.members.indexOf(c.member) : 0), y];
  }

  const daysOf = (decade) => DAYS.filter((d) => d.decade === decade);
  function dayById(id) { return DAYS.find((d) => d.id === id) || null; }
  function currentDay(state) { return state.day ? dayById(state.day.id) : null; }

  function placeFor(day, id, slot) {
    const o = day.overrides && day.overrides[slot];
    if (o && o[id]) return o[id];
    const s = SCHEDULES[id];
    return s ? s[day.kind][slot] : "home";
  }

  // 按日程把人摆到位。keep：这些人不动（比如正在跟玩家说话的人）
  function placeBySchedule(state, opts) {
    opts = opts || {};
    const day = currentDay(state);
    if (!day) return [];
    const keep = new Set(opts.keep || []);
    const slot = state.time.slot, year = state.time.year;
    const moved = [];
    // 先让要走的人都离开，再一个个摆，避免互相占位
    const plan = [];
    for (const id of W.charactersAt(year)) {
      if (keep.has(id)) continue;
      const place = placeFor(day, id, slot);
      const a = state.actors[id];
      if (place === "away") { Object.assign(a, { map: null, x: null, y: null, activity: "" }); continue; }
      const map = place === "home" ? W.RESIDENTS[a.household].home : place;
      const spot = place === "home" ? homeSpot(id) : ((SPOTS[map] || {})[id] || null);
      plan.push({ id, map, spot });
      Object.assign(a, { map: null, x: null, y: null });
    }
    for (const { id, map, spot } of plan) {
      const p = state.actors.player;
      const start = spot || (p.map === map ? [p.x, p.y] : [1, 1]);
      const at = B.nearestFree(state, map, start[0], start[1], { except: id, noExit: true });
      if (!at) continue;
      Object.assign(state.actors[id], { map, x: at[0], y: at[1], activity: "" });
      moved.push(id);
    }
    return moved;
  }

  function dayProps(day) {
    const out = {};
    for (const [map, list] of Object.entries(day.props || {})) out[map] = list.map(([kind, x, y]) => ({ kind, x, y }));
    return out;
  }

  // 进入某一个日子：跳时间、摆家具、把玩家放到起点、按日程摆人
  function startDay(state, id) {
    const day = dayById(id);
    if (!day) return { ok: false, reason: "没有这个日子" };
    if (day.decade !== state.decade) return { ok: false, reason: "这个日子不在当前的十年里" };
    const t = state.time, d = day.date;
    const same = t.year === d.year && t.month === d.month && t.day === d.day && t.slot === day.slot;
    if (!same) {
      const r = H.applyOp(state, { op: "jump_time", year: d.year, month: d.month, day: d.day, slot: day.slot, reason: day.title[state.lang] || day.title.zh }, { by: "system" });
      if (!r.ok) return r;
    }
    state.day = { id: day.id, index: DAYS.indexOf(day) };
    state.day_props = dayProps(day);
    state.extras = [];
    state.scene = { map: day.player.map, props: [], weather: "" };
    const p = state.actors.player;
    Object.assign(p, { map: null, x: null, y: null });
    placeBySchedule(state);
    const at = B.nearestFree(state, day.player.map, day.player.x, day.player.y, { except: "player", noExit: true });
    Object.assign(p, { map: day.player.map, x: at[0], y: at[1] });
    state.pending_initiatives = [];
    return { ok: true, day };
  }

  // 开局：从第一个十年的第一个日子开始
  function begin(state) { return startDay(state, daysOf(state.decade)[0].id); }

  function nextDay(state) {
    const list = daysOf(state.decade);
    const i = list.findIndex((d) => d.id === state.day.id);
    return i >= 0 && i + 1 < list.length ? list[i + 1] : null;
  }

  // 等一会儿：过一个时段，人按日程走动；已经是晚上就不能再等了，要换日子
  function wait(state, opts) {
    if (state.time.slot >= LAST_SLOT) return { ok: false, endOfDay: true };
    const r = H.applyOp(state, { op: "advance_time", slots: 1, reason: (opts && opts.reason) || null }, { by: "system" });
    if (!r.ok) return r;
    placeBySchedule(state, opts);
    return r;
  }

  // GM 推进时间时不能跨过这一天
  function slotsLeft(state) { return LAST_SLOT - state.time.slot; }

  // 主动来找玩家的人碰上面了，就不再算"在找你"
  function clearMet(state) {
    const p = state.actors.player;
    state.pending_initiatives = (state.pending_initiatives || []).filter((id) => state.actors[id].map !== p.map);
  }

  root.V2Days = { DAYS, SCHEDULES, SPOTS, LAST_SLOT, daysOf, dayById, currentDay, placeFor, placeBySchedule, startDay, begin, nextDay, wait, slotsLeft, clearMet, homeSpot };
})(typeof window !== "undefined" ? window : globalThis);
