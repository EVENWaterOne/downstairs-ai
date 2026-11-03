/* 离线演示：不调用任何模型，用固定的规则和台词回答，只用来把流程从头走到尾，不代表模型表现。
 * 和真模型走同一条路：输出同样格式的 JSON，同样过 Harness 和设定门。
 * 台词是为演示写的，没有出现在设定里；测试会检查它们都能过设定门。不依赖 DOM。 */
(function (root) {
  "use strict";
  const W = root.V2World, B = root.V2Board, H = root.V2Harness;

  // 每个人几句话，按说话的次数轮着用；reveal 表示说这句话时说出了一个障碍；gloss 是给读的人的翻译（方言、外语）
  const LINES = {
    chen: [
      { speak: "后生仔，又系拿表格来嘅？坐啦，坐低先。", gloss: "年轻人，又是拿表格来的？坐吧，先坐下。", act: "陈阿姨用下巴指了指旁边的矮凳。" },
      { speak: "以前楼下摆张象棋桌，几个老伯一坐就是一个下午。你识唔识捉棋？", gloss: "以前楼下摆着一张象棋桌，几个老伯一坐就是一个下午。你会不会下棋？" },
      { speak: "楼下那些活动，听讲要用手机预约？我边识用。", gloss: "楼下那些活动，听说要用手机预约？我哪会用。", reveal: ["barrier", "📱"] },
      { speak: "今日条鱼贵咗两毛，我同佢讲咗半日，冇所谓啦。", gloss: "今天的鱼贵了两毛，我跟他讲了半天，算了，无所谓啦。" }
    ],
    weiming: [
      { speak: "你好你好，新来的？有什么需要帮忙的尽管说。", act: "伟明伸出手跟你握了一下。" },
      { speak: "托儿中心那边的名单，你能不能帮我们问问？我们两个都要上班。" },
      { speak: "年轻人，这个国家给你机会，你要自己争气。" }
    ],
    huiling: [
      { speak: "你是新来的社区工作者？正好，我有几件事要反映。" },
      { speak: "走廊上堆东西的问题，你们会管吗？我不是针对谁。" },
      { speak: "我赶时间，下次再详细说，好吗？", act: "慧玲看了一眼手表。" }
    ],
    junhao: [{ speak: "你看我的脚车！" }, { speak: "Kumar uncle 会补车胎的。" }],
    rahman: [
      { speak: "Assalamualaikum。你找哪位？", gloss: "愿你平安。你找哪位？", act: "Rahman 站在门口，没有让开。" },
      { speak: "Tak payah，不用麻烦你们。" },
      { speak: "我开早班，下午要睡一下。" }
    ],
    aisyah_kassim: [
      { speak: "来来来，makan dulu，先吃点东西。", act: "Aisyah 把一碟糕推到你面前。" },
      { speak: "熟食中心那边，没有我们能吃的摊子，过节都是自己煮。", reveal: ["barrier", "🍲"] },
      { speak: "过节的时候我们在楼下摆一张长桌，你也来。" }
    ],
    nurul: [
      { speak: "你是居委会的？那我可以直接问你吗？" },
      { speak: "有些事情，问了才知道是不是公平。" },
      { speak: "我晚一点还要去图书馆。" }
    ],
    hafiz: [{ speak: "你会踢球吗？我们缺一个守门员！" }, { speak: "我以后要当球员。" }],
    mak_esah: [
      { speak: "Duduk, duduk。", gloss: "坐，坐。", act: "老祖母拍了拍身边的位子，示意你坐。" },
      { speak: "Dulu kampung tak macam ni.", gloss: "以前在甘榜可不是这样的。", act: "她笑着摇摇头。" }
    ],
    kumar: [
      { speak: "Boss，ok ok，no problem。", gloss: "老板，好的好的，没问题。", act: "Kumar 赶紧站起来。" },
      { speak: "有些地方 residents only，我们不能进去坐。", reveal: ["barrier", "🚫"] },
      { speak: "这座楼的水管，我全部认识。" }
    ],
    wangmei: [
      { speak: "您好，您是社区工作者吧？我们刚搬来，还乱着呢。" },
      { speak: "联络所的传单都是英文的，我看得慢。", reveal: ["barrier", "🗣"] },
      { speak: "孩子的作文，我可以帮着看看。" }
    ],
    jianguo: [
      { speak: "哎，你好你好，刚搬来，乱得很，别见怪。" },
      { speak: "厂里最近也不太平。" },
      { speak: "周末包饺子，回头给你送几个。" }
    ],
    xiaoyu: [{ speak: "Hello！我妈妈在里面。" }, { speak: "我们班上的同学都说英文。" }]
  };

  // 英文版的台词：意思和上面对应，不是逐字翻译；方言和马来语照样夹在英文里
  const LINES_EN = {
    chen: [
      { speak: "Aiyah, bring forms again ah? Sit, sit down first.", act: "Mdm Chan nods at the low stool beside her." },
      { speak: "Last time downstairs got one chess table. The old uncles sit there whole afternoon. You know how to play or not?" },
      { speak: "Those activities downstairs, they say must book by phone? How would I know how to do that.", reveal: ["barrier", "📱"] },
      { speak: "Today the fish went up twenty cents. I argued with him half a day. Never mind lah." }
    ],
    weiming: [
      { speak: "Hello, hello, you're new? Anything you need, just tell me.", act: "Wei Ming reaches out and shakes your hand." },
      { speak: "The childcare centre waiting list, can you help us ask? Both of us are working." },
      { speak: "Young man, this country gives you chances. You must make something of yourself." }
    ],
    huiling: [
      { speak: "You're the new community worker? Good, I have a few things to raise." },
      { speak: "People leaving things in the corridor, will you people do something? I'm not pointing at anyone." },
      { speak: "I'm rushing, can we talk properly next time?", act: "Hui Ling glances at her watch." }
    ],
    junhao: [{ speak: "Look at my bicycle!" }, { speak: "Kumar uncle can patch tyres one." }],
    rahman: [
      { speak: "Assalamualaikum. Who are you looking for?", gloss: "Peace be upon you. Who are you looking for?", act: "Rahman stays in the doorway and doesn't step aside." },
      { speak: "Tak payah, no need to trouble yourselves." },
      { speak: "I drive the early shift. Afternoon I need to sleep a bit." }
    ],
    aisyah_kassim: [
      { speak: "Come, come, makan dulu, eat something first.", act: "Aisyah pushes a plate of kuih toward you." },
      { speak: "At the hawker centre there's no stall we can eat from. Every festival we cook ourselves.", reveal: ["barrier", "🍲"] },
      { speak: "At festival time we put out a long table downstairs. You come too." }
    ],
    nurul: [
      { speak: "You're from the residents' committee? Then can I ask you directly?" },
      { speak: "Some things, you only know if they're fair when you ask." },
      { speak: "I still have to go to the library later." }
    ],
    hafiz: [{ speak: "Can you play football? We need a goalkeeper!" }, { speak: "When I grow up I'm going to be a footballer." }],
    mak_esah: [
      { speak: "Duduk, duduk.", gloss: "Sit, sit.", act: "The old grandmother pats the seat beside her for you to sit." },
      { speak: "Dulu kampung tak macam ni.", gloss: "It wasn't like this back in the kampong.", act: "She smiles and shakes her head." }
    ],
    kumar: [
      { speak: "Boss, ok ok, no problem.", act: "Kumar quickly stands up." },
      { speak: "Some places residents only. We cannot go in and sit.", reveal: ["barrier", "🚫"] },
      { speak: "The pipes in this block, I know every one." }
    ],
    wangmei: [
      { speak: "Hello, you must be the community worker? We've only just moved in, everything's still a mess." },
      { speak: "The community centre's flyers are all in English. I read them slowly.", reveal: ["barrier", "🗣"] },
      { speak: "If the children have compositions, I can help look them over." }
    ],
    jianguo: [
      { speak: "Ah, hello, hello. Just moved in, it's a mess, don't mind it." },
      { speak: "Things at the factory haven't been too steady lately." },
      { speak: "We're making dumplings at the weekend. I'll bring you some." }
    ],
    xiaoyu: [{ speak: "Hello! My mama is inside." }, { speak: "Everyone in my class speaks English." }]
  };

  const HELP = /帮|搬|组织|陪|修|打扫|扫地|带.*去/;
  const LOOK = /看看|四周|环顾|看一下|周围/;
  const HELP_EN = /\b(help|carry|move|organi[sz]e|go with|accompany|fix|repair|clean|sweep|take (him|her|them) to)\b/i;
  const LOOK_EN = /\b(look around|look about|around me|look at the|what'?s here|who'?s here)\b/i;
  const T = (state, zh, en) => (state.lang === "en" ? en : zh);

  function gm(ctx) {
    const state = ctx.state;
    if (ctx.retry) return { ops: [] };
    // 补翻译：离线演示的台词都自带翻译，这里只是照着写好的找一句
    if (ctx.translate) {
      const all = [].concat(...Object.values(LINES), ...Object.values(LINES_EN));
      const hit = all.find((l) => l.speak === ctx.event.summary);
      return { gloss: hit && hit.gloss ? hit.gloss : "" };
    }
    const year = state.time.year;
    const talkers = B.nearby(state).filter((id) => W.canTalk(id, year));
    const near = new Set(B.adjacent(state));
    const p = state.actors.player;
    const close = (id) => Math.abs(state.actors[id].x - p.x) + Math.abs(state.actors[id].y - p.y) <= 4;
    const aim = ctx.to && ctx.to !== "gm" ? ctx.to : ctx.focus;
    const target = talkers.includes(aim) ? aim : talkers.find((id) => near.has(id)) || talkers.find(close) || null;
    const ops = [];
    const en = state.lang === "en";
    // 对住户说的话：GM 不替玩家做事，只决定谁回应
    if (!ctx.toGM) {
      if (!target) ops.push({ op: "narrate", text: T(state, "四周没有人回应你。", "Nobody around answers you.") });
      return { ops, responders: target ? [target] : [] };
    }
    // 对 GM 说：看看四周、帮忙这两种照做，其他的出戏回一句
    if ((en ? LOOK_EN : LOOK).test(ctx.input)) {
      const names = B.nearby(state).map((id) => nameOf(state, id));
      ops.push({ op: "narrate", text: en
        ? (names.length ? `You look around. ${names.join(", ")} ${names.length > 1 ? "are" : "is"} here.` : "You look around. Nobody else is here.")
        : (names.length ? `你看了看四周。${names.join("、")}在这里。` : "你看了看四周，这里没有别人。") });
    }
    if ((en ? HELP_EN : HELP).test(ctx.input) && target) {
      const hid = W.householdOf(target);
      ops.push({ op: "community_action", residents: [target], need: W.RESIDENTS[hid].needs[0], description: T(state, "你动手帮忙：", "You pitch in: ") + String(ctx.input).slice(0, 40) });
      ops.push({ op: "advance_time", slots: 1, reason: T(state, "帮忙花了些时间", "helping took a while") });
    }
    // 只出戏回了一句：住户什么都没看到，没人接话
    if (!ops.length) return { ops: [{ op: "gm_reply", text: T(state, "离线演示里 GM 只会两件事：看看四周、帮在场的人做点事。想跟谁说话，点他，再对他说。", "In the offline demo the GM only does two things: look around, and help someone here with something. To talk to someone, tap them and talk to them.") }], responders: [] };
    return { ops, responders: target ? [target] : [] };
  }

  function nameOf(state, id) { const n = W.characterName(id); return n ? n[state.lang] || n.zh : id; }

  function character(ctx) {
    const state = ctx.state, id = ctx.id;
    if (ctx.retry) return { speak: "", act: nameOf(state, id) + T(state, "点了点头。", " nods.") };
    const lines = (state.lang === "en" ? LINES_EN : LINES)[id] || [{ speak: T(state, "嗯。", "Mm.") }];
    const said = state.events.filter((e) => e.kind === "speech" && e.actor === id).length;
    const line = lines[said % lines.length];
    const turn = ctx.turnEvents || [];
    const heard = turn.find((e) => e.kind === "player_input" && e.perceivedBy.includes(id));
    const out = { speak: line.speak, gloss: line.gloss || null, act: line.act || "", impression: null, satisfaction: null, reveal: null, lean: null };
    const hid = W.householdOf(id);
    if (line.reveal) {
      const [kind, rid] = line.reveal;
      if (!(state.revealed.barriers[hid] || []).includes(rid)) out.reveal = { kind, id: rid };
    }
    if (said === 1 && heard) out.impression = { text: T(state, "这个社区工作者又来找我说话了", "This community worker came to talk to me again"), evidence: [heard.id] };
    const action = turn.find((e) => e.kind === "action" && (e.households || []).includes(hid) && e.perceivedBy.includes(id));
    if (action) out.satisfaction = { delta: 3, reason: T(state, "帮了我们家的忙", "helped our family out"), evidence: [action.id] };
    return out;
  }

  // 和 V2LLM.caller 一样的接口。call 里带 onText（流式）时，把写好的 JSON 几个字一段地交出去，好看界面上边写边显示的样子；
  // opts.delay 是每段之间等多少毫秒（默认 25，测试里给 0）
  function caller(opts) {
    const delay = opts && Number.isFinite(opts.delay) ? opts.delay : 25;
    return async (call) => {
      const body = call.role === "gm" ? gm(call.ctx) : character(call.ctx);
      const en = call.ctx && call.ctx.state && call.ctx.state.lang === "en";
      const text = JSON.stringify(body);
      if (typeof call.onText === "function") {
        const chars = Array.from(text);
        for (let i = 6; i < chars.length + 6; i += 6) {
          if (delay > 0) await new Promise((ok) => setTimeout(ok, delay));
          try { call.onText(chars.slice(0, i).join("")); } catch (e) { /* 忽略 */ }
        }
      }
      return { text, meta: { model: en ? "offline demo" : "离线演示", ms: 0, provider: "mock" } };
    };
  }

  root.V2Mock = { LINES, LINES_EN, gm, character, caller };
})(typeof window !== "undefined" ? window : globalThis);
