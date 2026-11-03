/* 日子和日程（M2）。
 * 每个十年挑几个「日子」来过，每个日子是完整的一天，玩家在这一天里相对自由（10-28 Polaris：挑日子）。
 * 日子之间的几个月、几年不玩，只换一张标题卡。M3 以后改由规划调用来排；现在第一个十年是写死的 8 个日子。
 * 11-02 Polaris：只做每个住户自己的家（maps.js）。所以日程只决定每个人每个时段在不在家：
 *   home 在自己家；也可以写别人家的地图 id（去做客）；PLACES 里的几种都不在地图上，GM 从「各家现在」知道他在哪：
 *   away 出门了（上班、上学、去巴刹），downstairs 在楼下，working 在楼里干活（Kumar 打扫走廊和楼下）。
 *   原来在走廊上的时段改成在家（就在自家门口），原来在楼下的大多改成 downstairs；陈阿姨和 Hafiz 有两个楼下的时段改成在家，不然玩家很少碰得到他们。
 * gm 一栏只给 GM 看，是这一天的背景；史实来源见 docs/PROTOTYPE_V0.2_DESIGN.md。不依赖 DOM。 */
(function (root) {
  "use strict";
  const W = root.V2World, M = root.V2Maps, H = root.V2Harness, B = root.V2Board;
  const LAST_SLOT = H.SLOTS.length - 1;

  // 不在地图上的几种去处：人不在任何一张图上，activity 写这一句，GM 的「各家现在」里看得到
  const PLACES = {
    away: { zh: "出门了", en: "out" },
    downstairs: { zh: "在楼下", en: "downstairs" },
    working: { zh: "在楼里干活", en: "working around the block" }
  };

  // kind：work 平日（日期都是星期一到五，测试会查），rest 周末或节日（日程不同）。
  // player.map：玩家从哪一家开始，站在进门的地方。overrides：{ 时段: { 角色: 去处 } }，props：这一天临时摆出来的东西
  const DAYS = [
    {
      id: "d1989_first", decade: 1, date: { year: 1989, month: 3, day: 6 }, slot: 1, kind: "work",
      title: { zh: "1989 年 3 月 · 上任第一天", en: "March 1989 · Your first day" },
      player: { map: "flat_chen" },
      gm: {
        zh: "玩家上任第一天，挨家挨户上门认识住户，先从隔壁出租楼里独居的陈阿姨开始。317A 刚交钥匙几个月，有的人家还在装修，屋里还空荡荡的；老伯们已经在楼下摆起象棋。这个月政府刚宣布种族融合政策，没人在谈。今天没有安排大事，让玩家认识人。",
        en: "The player's first day: going door to door to meet the residents, starting with Mdm Chan, who lives alone in the rental block next door. Keys to 317A were handed over a few months ago; some flats are still being renovated and the homes are half bare; downstairs, the old men have already set up chess. The Ethnic Integration Policy was announced this month; nobody is talking about it. Nothing big is planned: let the player meet people."
      }
    },
    {
      id: "d1990_cny", decade: 1, date: { year: 1990, month: 1, day: 20 }, slot: 1, kind: "rest",
      title: { zh: "1990 年 1 月 · 农历新年前", en: "January 1990 · The week before Chinese New Year" },
      player: { map: "flat_lin" },
      gm: {
        zh: "农历新年前一个星期（这年的初一是 1 月 27 日）。家家户户在家大扫除、办年货，窗外的竹竿上晾着被子。林家在商量初一先回哪边父母家。陈阿姨一个人过年。Aisyah 会送糕给邻居。",
        en: "A week before Chinese New Year (New Year's Day falls on 27 January this year). Every family is spring-cleaning and shopping; quilts air on the poles outside the windows. The Lims are deciding whose parents to visit first. Mdm Chan will spend the New Year alone. Aisyah will send kuih round to the neighbours."
      }
    },
    {
      id: "d1990_rain", decade: 1, date: { year: 1990, month: 12, day: 6 }, slot: 3, kind: "work",
      title: { zh: "1990 年 12 月 · 雨季的下午", en: "December 1990 · A monsoon afternoon" },
      player: { map: "flat_aisyah" },
      overrides: { 3: { chen: "home", hafiz: "home" }, 4: { mak_esah: "home" } },
      gm: {
        zh: "十二月，季风季，下了一下午的雨。上个月吴作栋接任总理，十月新加坡和中国建交，报纸电视都在说，有人在家里聊两句。没有什么特别的事：雨把人都关在家里，陈阿姨今天没去巴刹，Hafiz 下不了楼踢球。",
        en: "December monsoon; it rains all afternoon. Goh Chok Tong became Prime Minister last month and Singapore established ties with China in October; people mention it now and then at home. Nothing in particular happens: the rain keeps everyone in. Mdm Chan hasn't gone to the market, and Hafiz can't go down to play football."
      }
    },
    {
      id: "d1992_raya", decade: 1, date: { year: 1992, month: 4, day: 4 }, slot: 2, kind: "rest",
      title: { zh: "1992 年 4 月 · 开斋节", en: "April 1992 · Hari Raya Puasa" },
      player: { map: "flat_aisyah" },
      props: { flat_aisyah: [["kuih_tray", 11, 5]] },
      overrides: {
        2: { nurul: "home" },
        3: { nurul: "home", hafiz: "home", chen: "flat_aisyah", huiling: "flat_aisyah", junhao: "flat_aisyah" },
        4: { mak_esah: "home" }
      },
      gm: {
        zh: "开斋节。Aisyah 一家在家里开门请客（open house），长木桌摆开，摆满马来糕和黄姜饭，邻居进进出出。下午陈阿姨来坐坐，慧玲也带着俊豪来了。Nurul 刚进理工学院，今天在家帮忙。Mei 一家今年刚来新加坡，住在隔壁楼，还不认识这里的人，今天不在 317A。",
        en: "Hari Raya Puasa. Aisyah's family keeps open house: the long table is out, loaded with kuih and nasi kuning, and neighbours come and go. In the afternoon Mdm Chan drops by, and Hui Ling brings Jun Hao. Nurul has just entered polytechnic and is home helping today. Mei's family arrived in Singapore this year and rents in the next block; they know no one here and are not at 317A today."
      }
    },
    {
      id: "d1994_move", decade: 1, date: { year: 1994, month: 6, day: 11 }, slot: 1, kind: "rest",
      title: { zh: "1994 年 6 月 · 七楼有人搬进来", en: "June 1994 · New neighbours on level 7" },
      player: { map: "flat_mei" },
      props: { flat_mei: [["boxes", 8, 2], ["boxes", 8, 3]] },
      gm: {
        zh: "周末。Mei 一家今天搬进七楼那户三房式（原屋主一家移民加拿大），屋里堆着纸箱，门开着，邻居有的探头来看。王美说标准普通话，楼里老人说福建话、广东话，年轻人说英语。",
        en: "A weekend. Mei's family moves into the three-room flat on level 7 (the previous owners emigrated to Canada). Boxes are piled up inside, the door stands open, and some neighbours put their heads in to look. Wang Mei speaks standard Mandarin; the old folk speak Hokkien and Cantonese, the young speak English."
      }
    },
    {
      id: "d1994_cup", decade: 1, date: { year: 1994, month: 12, day: 17 }, slot: 4, kind: "rest",
      title: { zh: "1994 年 12 月 17 日 · 马来西亚杯决赛", en: "17 December 1994 · The Malaysia Cup final" },
      player: { map: "flat_aisyah" },
      gm: {
        zh: "马来西亚杯决赛之夜，新加坡对彭亨。家家户户开着电视：Rahman 和 Hafiz 在家里看，伟明和俊豪、建国也守在自家电视前；进球的时候整栋楼都在喊，隔着墙都听得到。新加坡最后 4 比 0 赢了；打完这个赛季，新加坡队就退出了马来西亚的比赛，这时候大家还不知道。",
        en: "Malaysia Cup final night, Singapore against Pahang. Every flat has the television on: Rahman and Hafiz watch at home, as do Wei Ming and Jun Hao, and Jianguo; when a goal goes in the whole block shouts, loud enough to hear through the walls. Singapore win 4–0; after this season Singapore leave the Malaysian competitions, which nobody knows yet."
      }
    },
    {
      id: "d1997_haze", decade: 1, date: { year: 1997, month: 9, day: 24 }, slot: 1, kind: "work",
      title: { zh: "1997 年 9 月 · 烟霾", en: "September 1997 · The haze" },
      player: { map: "flat_chen" },
      gm: {
        zh: "印尼林火的烟霾笼罩新加坡，空气里一股焦味，这个月空气污染指数最高到过 226，各家都关着窗。亚洲金融风暴刚开始，报纸说硬盘厂陆续关闭或迁出，伟明和建国都在这一行。学校让孩子留在室内。玩家今天先上门看看独居的陈阿姨。",
        en: "Haze from Indonesian forest fires covers Singapore and the air smells burnt; the PSI peaks at 226 this month and every flat keeps its windows shut. The Asian financial crisis is starting and the papers report disk-drive plants closing or leaving; Wei Ming and Jianguo both work in that industry. Schools keep children indoors. The player starts the day by looking in on Mdm Chan, who lives alone."
      }
    },
    {
      id: "d1998_spring", decade: 1, date: { year: 1998, month: 4, day: 16 }, slot: 2, kind: "work",
      title: { zh: "1998 年 4 月", en: "April 1998" },
      player: { map: "flat_lin" },
      overrides: { 2: { weiming: "home" }, 3: { weiming: "home" } },
      gm: {
        zh: "经济衰退，裁员潮。伟明年初被裁，到现在快三个月，每天照样穿衬衫出门，家里还不知道；今天中午和下午趁家里没人，他回家坐着，傍晚再像下班一样出门，晚上才回来。建国在同一轮调整里保住了位子。慧玲在为俊豪的华文发愁。这是第一个十年的最后一个日子。",
        en: "Recession and retrenchments. Wei Ming was let go early this year; for almost three months he has left every morning in a shirt and his family still does not know. Today at midday and in the afternoon, with nobody else home, he sits in the flat; in the evening he goes out again as if from work and comes back at night. Jianguo kept his job in the same round. Hui Ling worries about Jun Hao's Chinese. This is the last day of the first decade."
      }
    }
  ];

  // 每人每个时段（早上、上午、中午、下午、傍晚、晚上）在哪。work 平日，rest 周末和节日
  const SCHEDULES = {
    chen: { work: ["downstairs", "home", "home", "away", "home", "home"], rest: ["downstairs", "home", "home", "downstairs", "home", "home"] },
    weiming: { work: ["home", "away", "away", "away", "away", "home"], rest: ["away", "home", "home", "downstairs", "home", "home"] },
    huiling: { work: ["home", "away", "away", "away", "home", "home"], rest: ["away", "home", "home", "home", "home", "home"] },
    junhao: { work: ["home", "away", "away", "away", "home", "home"], rest: ["away", "home", "home", "downstairs", "home", "home"] },
    rahman: { work: ["away", "away", "away", "home", "home", "home"], rest: ["home", "home", "home", "home", "home", "home"] },
    aisyah_kassim: { work: ["away", "home", "home", "home", "home", "home"], rest: ["away", "home", "home", "home", "home", "home"] },
    nurul: { work: ["home", "away", "away", "away", "home", "home"], rest: ["home", "home", "away", "away", "home", "home"] },
    hafiz: { work: ["home", "away", "away", "downstairs", "home", "home"], rest: ["home", "downstairs", "home", "downstairs", "home", "home"] },
    mak_esah: { work: ["home", "home", "home", "home", "downstairs", "home"], rest: ["home", "home", "home", "home", "downstairs", "home"] },
    kumar: { work: ["away", "working", "working", "working", "home", "home"], rest: ["home", "away", "away", "away", "away", "home"] },
    wangmei: { work: ["away", "away", "away", "home", "home", "home"], rest: ["home", "home", "home", "home", "home", "home"] },
    jianguo: { work: ["home", "away", "away", "away", "home", "home"], rest: ["home", "home", "home", "home", "home", "home"] },
    xiaoyu: { work: ["home", "away", "away", "home", "home", "home"], rest: ["home", "home", "home", "home", "home", "home"] }
  };

  // 去别人家做客时习惯站的地方；被占了就站旁边。在自己家站 HOME_SPOT（一家人并排）
  const SPOTS = {
    flat_aisyah: { chen: [9, 4], huiling: [10, 4], junhao: [11, 4] }
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
      // 出门了、在楼下、在楼里干活：不在地图上，activity 写去处（GM 的「各家现在」用）
      if (PLACES[place]) { Object.assign(a, { map: null, x: null, y: null, activity: PLACES[place][state.lang] || PLACES[place].zh }); continue; }
      const map = place === "home" ? W.RESIDENTS[a.household].home : place;
      if (!M.MAPS[map]) { Object.assign(a, { map: null, x: null, y: null, activity: "" }); continue; }
      const spot = place === "home" ? homeSpot(id) : ((SPOTS[map] || {})[id] || HOME_SPOT[map] || null);
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
    // 玩家站在这一家进门的地方
    const [ex, ey] = M.entryOf(day.player.map);
    const at = B.nearestFree(state, day.player.map, ex, ey, { except: "player", noExit: true });
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

  root.V2Days = { DAYS, SCHEDULES, SPOTS, PLACES, LAST_SLOT, daysOf, dayById, currentDay, placeFor, placeBySchedule, startDay, begin, nextDay, wait, slotsLeft, clearMet, homeSpot };
})(typeof window !== "undefined" ? window : globalThis);
