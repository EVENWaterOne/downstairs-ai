/* 提示词（M2）：中文版和英文版，按 state.lang 选。两种语言的意思保持一致，改一边要改另一边。
 * GM 看得到全局：所有住户的来历、张力、秘密、局势钟、游戏端的数字。
 * 住户只拿到自己的视角：自己的来历和心事、自己知道的秘密、自己经历过的事、自己对玩家的印象，
 *   加上自己所在环境和自己家的情况（10-29 Polaris："住户应该只有自己房子的信息，和自己所在环境的信息"）。
 * 别人的心事、他不在场的事，提示词里根本没有（隔离由这里保证，测试见 tests/prompts.test.js）。
 * 游戏端的变化给住户时只写发生了什么，不给数字。不依赖 DOM。
 * 11-02 上下文（设计文档 11.11）：每轮基本不变的段放前面，每轮都变的放最后，返回值里的 parts 标出分块和缓存断点
 *   （user 就是 parts 依次接起来；llm.js 对 Anthropic 按块发、打断点，DeepSeek 和 OpenAI 按前缀自动缓存）。
 *   事件窗口按时段对齐（windowOf），同一个时段里只在末尾追加；这一轮的事单独放在最后的「这一轮」里，不在历史里重复。 */
(function (root) {
  "use strict";
  const W = root.V2World, M = root.V2Maps, H = root.V2Harness, B = root.V2Board, D = root.V2Days;
  // 取文字时按现在的年份截断（W.textAt）：以后才发生的段落不给 GM，也不给住户
  const L = (state, o) => {
    if (!o || typeof o !== "object") return String(o == null ? "" : o);
    const t = W.textAt(o, state.time.year);
    return t[state.lang] || t.zh;
  };
  // 事件窗口：最新的时段加上它前面的时段；前面这部分不到 min 条就再往前补整个时段（最新的时段还在长，不算进去，
  // 所以同一个时段里开头不动）；超过 max 条就从前面按 step 条一截截去掉
  // （以前是固定的最近 30 条和 20 条，约等于 7 轮和 5 轮，而且每轮开头都换，缓存接不上）
  const WINDOW_GM = { min: 30, max: 120, step: 40 }, WINDOW_CHAR = { min: 20, max: 80, step: 20 };
  const MAX_DETAILS = 150, MAX_HYPOTHESES = 5;
  const T = (state, zh, en) => (state.lang === "en" ? en : zh);
  const list = (state, xs) => xs.join(T(state, "，", ", "));
  const listDun = (state, xs) => xs.join(T(state, "、", ", "));
  // 两段设定文字接在一起时，前一段没有句末标点就补一个
  const endZh = (x) => (x && !/[。！？；）」]$/.test(x) ? x + "。" : x);
  const endEn = (x) => (x && !/[.!?;)'"]$/.test(x) ? x + "." : x);

  function nameOf(state, id) {
    if (id === "player") return T(state, "玩家", "the player");
    if (id === "estate") return T(state, "游戏端", "the game");
    const n = W.characterName(id) || (W.RESIDENTS[id] && W.RESIDENTS[id].name) || (W.SUPPORTING[id] && W.SUPPORTING[id].name);
    return n ? L(state, n) : id;
  }
  const mapName = (state, id) => (id && M.MAPS[id] ? L(state, M.MAPS[id].name) : "");
  const shortTime = (state, t) => T(state, `${t.year}年${t.month}月${t.day}日·${H.SLOTS[t.slot].zh}`, `${t.day}/${t.month}/${t.year} ${H.SLOTS[t.slot].en}`);

  // ---------- 玩家 ----------
  // 默认身份：中文版是何志强，英文版是同一个人的英文写法（新加坡华人常见的方言拼法）
  const DEFAULT_IDENTITY = { name: "何志强", gender: "男", ethnicity: "华人", born: 1965, languages: "华语、英语，会一点广东话和福建话", about: "" };
  const DEFAULT_IDENTITY_EN = { name: "Ho Chee Keong", gender: "male", ethnicity: "Chinese", born: 1965, languages: "Mandarin and English, with some Cantonese and Hokkien", about: "" };
  const defaultIdentity = (lang) => (lang === "en" ? DEFAULT_IDENTITY_EN : DEFAULT_IDENTITY);
  const isMale = (g) => /^(男|male|man|m)$/i.test(String(g || "").trim());
  const isFemale = (g) => /^(女|female|woman|f)$/i.test(String(g || "").trim());
  function identityText(state, id) {
    const p = Object.assign({}, defaultIdentity(state.lang), id || {});
    const age = state.time.year - (p.born || 1965);
    if (state.lang === "en") {
      const who = [p.ethnicity, isFemale(p.gender) ? "woman" : isMale(p.gender) ? "man" : "person"].filter(Boolean).join(" ");
      return `The new community worker, ${p.name}, a ${age}-year-old ${who} who speaks ${p.languages || "Mandarin and English"}. ${p.about || ""}`.trim();
    }
    const who = (p.ethnicity || "") + (isFemale(p.gender) ? "女子" : isMale(p.gender) ? "男子" : "人");
    return `新来的社区工作者，${p.name}，${age} 岁的${who}，会说${p.languages || "华语和英语"}。${p.about ? p.about : ""}`.trim();
  }

  // ---------- 事件 ----------
  function eventText(state, e) {
    const n = nameOf(state, e.actor);
    if (state.lang === "en") switch (e.kind) {
      case "player_input": return e.to ? `Player (to ${nameOf(state, e.to)}): ${e.summary}` : `Player: ${e.summary}`;
      case "player_to_gm": return `Player (to the GM, out of character): ${e.summary}`;
      case "gm_reply": return `GM (to the player, out of character): ${e.summary}`;
      case "speech": return `${n}: ${e.summary}${e.gloss ? ` (meaning: ${e.gloss})` : ""}`;
      case "narration": return `(${e.summary})`;
      case "reveal": return `${n} told something [${e.reveal.kind}:${e.reveal.id}]`;
      case "action": return `The player went and did: ${e.summary}`;
      case "fact": return `Settled: ${e.summary}`;
      case "roll": return `Roll: ${e.summary}`;
      case "time": return `Time: ${e.summary}`;
      case "scene": return `Scene: ${e.summary}`;
      case "game": return e.summary;
      case "consequence": return `Consequence: ${e.summary}`;
      default: return e.summary;
    }
    switch (e.kind) {
      case "player_input": return e.to ? `玩家（对${nameOf(state, e.to)}）：${e.summary}` : `玩家：${e.summary}`;
      case "player_to_gm": return `玩家（对 GM，出戏）：${e.summary}`;
      case "gm_reply": return `GM（对玩家，出戏）：${e.summary}`;
      case "speech": return `${n}：${e.summary}${e.gloss ? `（意思是：${e.gloss}）` : ""}`;
      case "narration": return `（${e.summary}）`;
      case "reveal": return `${n} 说出了一件事［${e.reveal.kind}:${e.reveal.id}］`;
      case "action": return `玩家去做了：${e.summary}`;
      case "fact": return `确立：${e.summary}`;
      case "roll": return `检定：${e.summary}`;
      case "time": return `时间：${e.summary}`;
      case "scene": return `场景：${e.summary}`;
      case "game": return e.summary;
      case "consequence": return `后果：${e.summary}`;
      default: return e.summary;
    }
  }
  function eventLine(state, e) {
    const where = mapName(state, e.map);
    return `${e.id} · ${shortTime(state, e.time)}${where ? " · " + where : ""} · ${eventText(state, e)}`;
  }

  // ---------- 窗口和分块（11-02） ----------
  const slotKey = (t) => `${t.year}-${t.month}-${t.day}-${t.slot}`;
  // events 已经按视角过滤好、只到上一轮为止。从最新的往前，按时段整段地取
  function windowOf(events, w) {
    const n = events.length;
    if (!n) return [];
    // 最新的时段整段都要
    const newest = slotKey(events[n - 1].time);
    let older = n;
    while (older > 0 && slotKey(events[older - 1].time) === newest) older--;
    // 再往前至少一个时段，补到前面这部分够 min 条为止；只看前面这部分，最新的时段长了也不挪开头
    let start = older, slots = 0, key = null;
    for (let i = older - 1; i >= 0; i--) {
      const k = slotKey(events[i].time);
      if (k !== key) {
        if (slots >= 1 && older - start >= w.min) break;
        key = k; slots++;
      }
      start = i;
    }
    // 太长时一截截去掉，开头每 step 条才挪一次，中间几轮缓存还接得上
    const over = events.length - start - w.max;
    if (over > 0) start += Math.ceil(over / w.step) * w.step;
    return events.slice(start);
  }
  // 历史事件按轮切块：缓存往回找上一次写入的位置，要落在块的边界上（上一轮的断点就在上一轮最后一块的末尾）
  function roundChunks(state, events) {
    const out = [];
    let turn = null, lines = [];
    for (const e of events) {
      if (e.turn !== turn && lines.length) { out.push(lines.join("\n") + "\n"); lines = []; }
      turn = e.turn;
      lines.push(eventLine(state, e));
    }
    if (lines.length) out.push(lines.join("\n") + "\n");
    return out;
  }
  // 历史这一段：标题一块，每轮一块，最后一块打断点；没有事件就写"还没有"
  function historyParts(state, heading, chunks) {
    const parts = [{ text: heading + "\n" }].concat((chunks.length ? chunks : [T(state, "（还没有）\n", "(nothing yet)\n")]).map((text) => ({ text })));
    parts[parts.length - 1].cache = true;
    return parts;
  }
  function assemble(parts) {
    parts = parts.filter((p) => p.text);
    return { user: parts.map((p) => p.text).join(""), parts };
  }
  const section = (lines) => lines.filter((x) => x !== "").join("\n");

  // ---------- 地图 ----------
  // GM 和住户看到的场景从同一份状态、同一段代码生成，只是按视角取舍（10-29：两边看到的不一样，住户就会隔着几格递东西）
  const things = (state, xs) => list(state, xs.map((f) => `${L(state, M.PROPS[f.kind].name)}(${f.x},${f.y})`));
  function layoutLines(state, mapId, furniture, props) {
    const m = M.MAPS[mapId];
    const lines = [T(state, "底图（# 墙　. 地面　字母是门）。x 是列、y 是行，从 0 数：",
      "Layout (# wall  . floor; a letter is the door). x is the column, y the row, counting from 0:")];
    lines.push(m.rows.join("\n"));
    const doors = list(state, Object.keys(m.exits));
    lines.push(T(state, `门：${doors}（进出这一家的门）`, `Door: ${doors} (the way in and out of this home)`));
    if (furniture.length) lines.push(T(state, `家具（挡路，不能站人）：${things(state, furniture)}`, `Furniture (blocks the way; nobody can stand there): ${things(state, furniture)}`));
    if (props.length) lines.push(T(state, `摆出来的东西：${things(state, props)}`, `Set out here: ${things(state, props)}`));
    return lines;
  }
  const extrasLine = (state, g) => T(state, `- ${g.id}（${H.extrasName(state, g)}，无名配角）在 (${g.x},${g.y})`, `- ${g.id} (${H.extrasName(state, g)}, extras) at (${g.x},${g.y})`) + (g.activity ? T(state, "，正在" + g.activity, ", " + g.activity) : "");
  function mapBlock(state) {
    const p = state.actors.player;
    const lines = [T(state, `## 地图：${mapName(state, p.map)}（${p.map}）`, `## Map: ${mapName(state, p.map)} (${p.map})`)];
    lines.push(...layoutLines(state, p.map, B.furniture(state, p.map), state.scene.map === p.map ? state.scene.props : []));
    const kinds = Object.keys(M.PROPS).filter((k) => M.propAllowed(k, p.map)).map((k) => `${k}(${L(state, M.PROPS[k].name)})`);
    lines.push(T(state, `这张图上能摆的物件 kind：${list(state, kinds)}`, `Object kinds allowed on this map: ${list(state, kinds)}`));
    lines.push(T(state, `玩家在 (${p.x},${p.y})。`, `The player is at (${p.x},${p.y}).`));
    const near = new Set(B.adjacent(state));
    const people = B.nearby(state);
    lines.push(T(state, "这里有谁：", "Who is here: ") + (people.length ? "" : T(state, "没有别人。", "nobody else.")));
    for (const id of people) {
      const a = state.actors[id];
      const notes = [near.has(id) ? T(state, "就在玩家旁边", "right next to the player") : null, W.canTalk(id, state.time.year) ? null : T(state, "还不会说话", "too young to talk"), a.activity ? T(state, "正在", "") + a.activity : null].filter(Boolean);
      lines.push(T(state, `- ${id}（${nameOf(state, id)}）在 (${a.x},${a.y})`, `- ${id} (${nameOf(state, id)}) at (${a.x},${a.y})`) + (notes.length ? T(state, "，", ", ") + list(state, notes) : ""));
    }
    for (const g of H.extrasOn(state, p.map)) lines.push(extrasLine(state, g));
    return lines.join("\n");
  }

  // 11-02 只剩各家：GM 要知道哪一家现在有人、不在家的人在哪，才接得住「我去林家看看」，也才知道能把谁叫进门。
  // 只给 GM（住户只知道自己家和眼前，10-29 的规矩）。放在每轮都变的最后一块里
  function homesBlock(state) {
    const year = state.time.year, p = state.actors.player;
    const lines = [T(state, "各家现在（玩家点门牌就能去有人在家的那一家，不花时间；没人在家、还没搬来的去不了，宿舍一直能去）：",
      "The homes right now (the player can tap a door plate to go to any home with someone in, at no cost in time; not to an empty home or one whose family hasn't moved in; the dorm is always open):")];
    for (const map of M.HOMES) {
      const hid = Object.keys(W.RESIDENTS).find((h) => W.RESIDENTS[h].home === map);
      const short = L(state, M.MAPS[map].short);
      const head = T(state, `- ${map}（${short}）`, `- ${map} (${short})`);
      const mark = p.map === map ? T(state, "　← 玩家在这里", "  <- the player is here") : "";
      if (!W.livesHere(hid, year)) { lines.push(head + T(state, "：还没搬来", ": not moved in yet") + mark); continue; }
      const here = Object.values(state.actors).filter((a) => a.kind === "resident" && a.map === map && W.characterPresent(a.id, year))
        .map((a) => nameOf(state, a.id) + (a.household !== hid ? T(state, "（来做客）", " (visiting)") : ""));
      const away = W.charactersAt(year).filter((id) => W.householdOf(id) === hid && state.actors[id].map !== map).map((id) => {
        const a = state.actors[id];
        const where = a.map ? T(state, `在${mapName(state, a.map)}`, `at ${mapName(state, a.map)}`) : a.activity || T(state, "不在", "out");
        return `${nameOf(state, id)}${T(state, " ", ": ")}${where}`;
      });
      const entry = M.entryOf(map);
      // 宿舍里总有别的工友（不是角色），所以不写"没人在家"
      const empty = hid === "kumar" ? T(state, "只有别的工友在", "only the other workers in") : T(state, "没人在家", "nobody home");
      const bits = [here.length ? T(state, `${listDun(state, here)} 在这里`, `${listDun(state, here)} here`) : empty]
        .concat(away.length ? [T(state, "不在家的：", "away: ") + list(state, away)] : []);
      lines.push(head + T(state, "：", ": ") + bits.join(T(state, "；", "; ")) + T(state, `；进门处 (${entry[0]},${entry[1]})`, `; inside the door (${entry[0]},${entry[1]})`) + mark);
    }
    return lines.join("\n");
  }

  // 住户看到的场景：只有自己所在的这张图和自己家（getView 的 surroundings 已经按视角过滤好了）
  function sceneBlockForCharacter(state, id, ctx) {
    const sur = H.getView(state, id).surroundings, here = sur.here;
    const hid = W.householdOf(id), home = W.RESIDENTS[hid].home;
    const lines = [T(state, "## 现在", "## Now")];
    if (!here) lines.push(T(state, `${H.timeLabel(state)}。你不在楼里。`, `${H.timeLabel(state)}. You are not in the block.`));
    else {
      lines.push(T(state, `${H.timeLabel(state)}，${mapName(state, here.map)}${here.map === home ? "（你家）" : ""}。`, `${H.timeLabel(state)}, ${mapName(state, here.map)}${here.map === home ? " (your home)" : ""}.`));
      if (here.weather) lines.push(T(state, `天气：${here.weather}`, `Weather: ${here.weather}`));
      lines.push(...layoutLines(state, here.map, here.furniture, here.props));
      lines.push(T(state, `你在 (${here.self.x},${here.self.y})`, `You are at (${here.self.x},${here.self.y})`) + (here.self.activity ? T(state, "，正在" + here.self.activity, ", " + here.self.activity) : "") + T(state, "。", "."));
      const who = here.people.map((x) => T(state, `- ${nameOf(state, x.id)} 在 (${x.x},${x.y})`, `- ${nameOf(state, x.id)} at (${x.x},${x.y})`) + (x.activity ? T(state, "，正在" + x.activity, ", " + x.activity) : ""))
        .concat(here.extras.map((g) => T(state, `- ${H.extrasName(state, g)} 在 (${g.x},${g.y})`, `- ${H.extrasName(state, g)} at (${g.x},${g.y})`) + (g.activity ? T(state, "，正在" + g.activity, ", " + g.activity) : "")));
      lines.push(who.length ? T(state, "这里还有：\n", "Also here:\n") + who.join("\n") : T(state, "这里没有别人。", "Nobody else is here."));
      const pl = here.player;
      const who2 = T(state, `玩家（${identityText(state, ctx.identity)}）`, `The player (${identityText(state, ctx.identity)})`);
      if (!pl) lines.push(who2 + T(state, "不在这里。", " is not here."));
      else lines.push(who2 + T(state, `在 (${pl.x},${pl.y})，`, ` is at (${pl.x},${pl.y}), `) + (pl.distance <= 1 ? T(state, "就在你旁边，伸手够得着。", "right next to you, within reach.") : T(state, `离你 ${pl.distance} 格，伸手够不着。`, `${pl.distance} steps from you, out of reach.`)));
    }
    if (sur.home) {
      lines.push("", T(state, `## 你家（${mapName(state, sur.home.map)}）`, `## Your home (${mapName(state, sur.home.map)})`));
      const names = [...new Set(sur.home.furniture.map((f) => L(state, M.PROPS[f.kind].name)))];
      lines.push(T(state, `家里摆着：${listDun(state, names)}。你现在不在家。`, `At home: ${listDun(state, names)}. You are not at home right now.`));
    }
    if (sur.details.length) {
      lines.push("", T(state, "## 你知道的细节（这里和你家）", "## Details you know (here and at home)"));
      for (const d of sur.details) lines.push(`- ${d.key}${T(state, "：", ": ")}${d.value}`);
    }
    return lines.join("\n");
  }

  // ---------- 游戏端 ----------
  function gameEvents(state) { return state.events.filter((e) => e.kind === "game" && e.decade === state.decade); }
  function gameBlockGM(state) {
    const g = state.game;
    const built = Object.entries(g.plots || {}).map(([i, c]) => L(state, W.FACILITIES[c].name) + T(state, `（地块 ${i}）`, ` (plot ${i})`));
    const policies = gameEvents(state).filter((e) => e.game.type === "policy").map((e) => L(state, W.POLICIES[e.game.card].name));
    const sat = Object.entries(g.satisfaction || {}).map(([r, v]) => `${L(state, W.RESIDENTS[r].name)} ${v}`);
    const none = T(state, "还没有", "none yet");
    return [
      T(state, "## 游戏端（这个十年）", "## The game (this decade)"),
      T(state, `已建：${list(state, built) || none}。执行过的政策：${list(state, policies) || none}。政策点还剩 ${g.points}。`,
        `Built: ${list(state, built) || none}. Policies enacted: ${list(state, policies) || none}. Policy points left: ${g.points}.`),
      sat.length ? T(state, `满意度（0–100，只给你参考，不要写进旁白）：${list(state, sat)}`, `Satisfaction (0–100, for your reference only; never put numbers in narration): ${list(state, sat)}`) : ""
    ].filter(Boolean).join("\n");
  }
  function clocksBlock(state) {
    const cs = Object.values(state.plans.clocks).filter((c) => c.status === "running");
    if (!cs.length) return "";
    return T(state, "## 局势钟（只有你看得到）\n", "## Clocks (only you can see these)\n") + cs.map((c) => T(state,
      `- ${c.id}「${L(state, c.name)}」${c.progress}/${c.segments}，满格后果：${L(state, c.consequence)}`,
      `- ${c.id} "${L(state, c.name)}" ${c.progress}/${c.segments}; when full: ${L(state, c.consequence)}`)).join("\n");
  }

  // GM 定过的细节（11-02：以前 GM 的提示词里没有这一节，细节那条事件滚出窗口以后，GM 就不知道自己定过什么）。
  // 只列事件已经不在历史和这一轮里的那些：还在窗口里的，历史里就有「确立：…」那一行。
  // 这样这一块只在窗口开头往后挪的时候才变（那时候历史的缓存反正也断了），定一个新细节不会把后面的历史缓存全废掉。
  // 按定下的先后排，新的接在后面
  function detailsBlockGM(state, shown) {
    const all = Object.entries(state.details || {}).filter(([, d]) => !(shown && d.event && shown.has(d.event)));
    if (!all.length) return "";
    const byId = new Map(state.events.map((e) => [e.id, e]));
    const listed = all.slice(-MAX_DETAILS);
    const rows = listed.map(([k, d]) => {
      const e = byId.get(d.event);
      const when = e ? shortTime(state, e.time) : "";
      const note = [when, d.layer === "stake" ? T(state, "检定的结果", "from a roll") : ""].filter(Boolean).join(T(state, "，", ", "));
      return `- ${k} = ${d.value}${note ? T(state, `（${note}）`, ` (${note})`) : ""}`;
    });
    const older = all.length - listed.length;
    return [T(state, "## 早先定下的细节（定了就不能改；要定新的就换一个 key。括号里是定下的时间，最近定的在下面的历史里，是「确立：」那几行）", "## Details settled earlier (they can't change; to settle something new, use a new key. The time in brackets is when it was settled; recent ones are in the history below, as the \"Settled:\" lines)"),
      older > 0 ? T(state, `（更早的 ${older} 条没有列出来）`, `(${older} older ones not listed)`) : ""].concat(rows).filter(Boolean).join("\n");
  }
  // GM 对玩家的推测（gm_hypothesis 以前写了没人读）。随时会加，放在最后不缓存的那一块里
  function hypothesesBlock(state) {
    const hs = ((state.gm && state.gm.hypotheses) || []).slice(-MAX_HYPOTHESES);
    if (!hs.length) return "";
    return T(state, "## 你对玩家的推测（只有你看得到，最近的在最后）", "## Your guesses about the player (only you can see these; newest last)") + "\n"
      + hs.map((h) => T(state, `- ${h.id} ${h.trait}：${h.text}（把握 ${h.confidence}，${h.evidence.join("、")}）`, `- ${h.id} ${h.trait}: ${h.text} (confidence ${h.confidence}; ${h.evidence.join(", ")})`)).join("\n");
  }
  // GM 的历史：所有人经历的事，到上一轮为止（这一轮的事放在「这一轮」里）
  function gmHistory(state) {
    return windowOf(state.events.filter((e) => e.turn < state.turn), WINDOW_GM);
  }
  const shownIds = (history, thisRound) => new Set(history.concat(thisRound).map((e) => e.id));

  // ---------- GM 看到的住户 ----------
  function tensionLine(state, t, lean) {
    if (!t) return "";
    if (state.lang === "en") {
      const where = lean == null ? "" : lean < 0 ? `, now leaning ${-lean} toward "${L(state, t.a)}"` : lean > 0 ? `, now leaning ${lean} toward "${L(state, t.b)}"` : ", pulled both ways";
      return `Tension: ${L(state, t.a)} ↔ ${L(state, t.b)}${where}. ${L(state, t.about)}${t.anchor ? " " + L(state, t.anchor) : ""} Toward "${L(state, t.a)}": ${L(state, t.toward_a)}; toward "${L(state, t.b)}": ${L(state, t.toward_b)}`;
    }
    const where = lean == null ? "" : lean < 0 ? `，现在偏「${L(state, t.a)}」${-lean} 格` : lean > 0 ? `，现在偏「${L(state, t.b)}」${lean} 格` : "，现在两头拉扯";
    return `张力：${L(state, t.a)} ↔ ${L(state, t.b)}${where}。${L(state, t.about)}${t.anchor ? "　" + L(state, t.anchor) : ""}　推向「${L(state, t.a)}」：${L(state, t.toward_a)}；推向「${L(state, t.b)}」：${L(state, t.toward_b)}`;
  }
  function residentBlockGM(state, hid) {
    if (state.lang === "en") return residentBlockGMEn(state, hid);
    const r = W.RESIDENTS[hid], year = state.time.year;
    const members = W.membersAt(hid, year);
    const ids = r.split ? members.map((m) => m.id) : [hid];
    const told = state.revealed;
    const out = [`### ${L(state, r.name)}（角色 id：${ids.join("、")}）`];
    out.push(`来历：${L(state, r.bio)}`);
    out.push(`想要：${L(state, r.goal)}`);
    const holder = r.split ? r.tension_holder : hid;
    const lean = state.minds[holder] ? state.minds[holder].lean : null;
    out.push(tensionLine(state, r.tension, lean) + (r.split ? `（记在 ${holder} 身上）` : ""));
    if (r.split) for (const m of members) {
      const bits = [m.bio && L(state, m.bio), m.goal && "想要：" + L(state, m.goal), m.view && "看法：" + L(state, m.view), m.voice && "说话：" + L(state, m.voice)].filter(Boolean);
      out.push(`- ${m.id}（${L(state, m.name)}）${m.born ? `，${year - m.born} 岁` : ""}：${bits.join("　")}`);
      if (m.tension) out.push(`  ${m.id} 自己的${tensionLine(state, m.tension, state.minds[m.id] ? state.minds[m.id].lean : null)}`);
    }
    else out.push(`说话：${L(state, r.voice)}`);
    out.push(`需求：${r.needs.map((n) => n + L(state, W.NEEDS[n])).join("，")}。障碍：${r.barriers.map((b) => b + L(state, W.BARRIERS[b]) + ((told.barriers[hid] || []).includes(b) ? "（已经说出来了）" : "")).join("，") || "无"}`);
    const secrets = r.secrets.filter((s) => W.secretActive(s, year)).map((s) => `［${s.id}］${L(state, s)}${s.holder ? `（只有 ${s.holder} 知道）` : ""}${s.known_to ? `（别人家里 ${s.known_to.join("、")} 也知道）` : ""}${(told.secrets[hid] || []).includes(s.id) ? "（已经说出来了）" : ""}`);
    if (secrets.length) out.push("秘密：" + secrets.join("　"));
    out.push(`这个十年：${L(state, r.stages[Math.min(state.decade, r.stages.length) - 1])}`);
    if (r.everyday) out.push(`日常：${r.everyday.map((e) => L(state, e)).join("；")}`);
    out.push(`原作台词：${L(state, r.quote)}`);
    return out.join("\n");
  }

  const GM_OPS = `- {"op":"narrate","text":"…","noticed_by":["chen"]}　旁白：玩家看得到、听得到的环境、动作和结果，写给玩家看，称玩家为「你」。noticed_by 可以不写，不写就是这张图上的人都看到了；隔着房间的小动作只写注意到的住户 id，写 [] 就是只有玩家知道。
- {"op":"gm_reply","text":"…"}　出戏回答玩家（玩家对你提问、要提示、说不清想做什么时用），一到两句。只有玩家看得到，不进住户的经历。
- {"op":"establish_fact","subject":"…","key":"…","value":"…"}　定一个之前没定、之后一直成立的普通细节（家里电视开着没有、桌上摆着什么）。subject 是地图（各家）、角色、户、配角或物件的 id，楼下和整个小区的事用 estate；key 只用小写英文、数字和下划线；value 是一个简短的值。一次性的动作不要用它。
- {"op":"roll","dc":12,"reason":"…","on_success":[…],"on_failure":[…]}　检定（d20，dc 5–25），只有玩家看得到掷骰。分支里只放结果：narrate、layer 写 "stake" 的 establish_fact，或者 move、leave、set_activity、物件、配角。
- {"op":"set_scene","map":"…","actors":[{"id":"chen","x":3,"y":3,"activity":"…"}],"props":[{"kind":"kopi_cup","x":4,"y":4}],"weather":"…","note":"…"}　在固定底图上一次摆好人和物件（换场时用）。人不能站在家具上，物件不能压着家具。
- {"op":"move","actor":"chen","x":5,"y":4}　让某个人走到这张图上的某格（比如走到玩家身边）。从别处来的人加上 "map"，不写 x、y 就站在进门的地方。人不能站在门上，门口只剩一格能进出时也不能站那一格（会把门堵住）。不写 actor 就是移动玩家：只有玩家对你说要去哪时才移动玩家；去别家只能去有人在家的。
- {"op":"leave","actor":"chen","to":"去巴刹"}　某人离开这张地图（去巴刹、上班、下楼），to 写去处；在别人家的人 to 写「回家」，就回到他自己家里（门牌上那一家就有人了）。actor 也可以是配角的 id。
- {"op":"set_activity","actor":"chen","activity":"收拾棋盘"}　改某人手上在做的事，不用重摆场景。actor 也可以是配角的 id。
- {"op":"place_prop","kind":"kopi_cup","x":4,"y":4}　在玩家所在的地图上摆一件东西；kind 只能用地图一节里列出的。
- {"op":"remove_prop","kind":"kuih_tray","x":11,"y":5}　拿走一件东西（有人收起来、带走了）。固定家具拿不走。x、y 可以不写。
- {"op":"extras","id":"x1","label":"亲戚","count":3,"x":4,"y":2,"activity":"坐着吃糕"}　无名配角：一组不说话的人（来串门的亲戚、邻居家的孩子、上门的工人），地图上画成一个小人。label 是简短的称呼，不超过 12 个字；和人一样不能站在门上、不能堵住门口。不写 id 就新建；写已有的 id 就是改人数、位置或在做什么，没写的栏位照旧。要走用 leave。
- {"op":"advance_time","slots":1,"reason":"…"}　玩家做的事明显要花时间时推进时段（1–3）。
- {"op":"community_action","residents":["chen"],"need":"🤝","description":"…"}　玩家对你说要去实际做帮到住户的事。residents 写角色 id 或户 id；need 是这一户需求的符号之一，帮的不是他们的需求就不写。
- {"op":"clock_tick","clock":"…","by":1,"evidence":["E12"]}　局势钟走一格（by 是 1 或 -1），必须引用比上次更新的事件。
- {"op":"gm_hypothesis","trait":"…","text":"…","confidence":0.5,"evidence":["E3"]}　你对玩家这个人的推测，只有你看得到。`;

  function gmPrompt(state, ctx) {
    ctx = ctx || {};
    if (state.lang === "en") return gmPromptEn(state, ctx);
    const day = D.currentDay(state);
    const year = state.time.year;
    const system = [
      "你是跑团《楼下》的 GM（主持人）。故事发生在新加坡组屋 BLK 317A，从 1989 年交钥匙开始。玩家是新来的社区工作者，一家一家上门。",
      "你负责决定世界里发生了什么，用操作写下来，再指定这一轮谁开口。住户的台词和动作不由你写：住户由另外的调用来扮演。",
      "",
      "## 规则",
      "1. 玩家打的每一句都是话，分两种，「这一轮」会写清楚是哪种。",
      "   - 对住户说：玩家扮演的角色说出口的话，在场的人都听得到。你只决定世界怎么接：谁开口（responders），周围有没有变化。不要替玩家做动作，不要移动玩家，不要用 community_action 和 gm_reply。",
      "   - 对你说：玩家身份说的话，住户听不到。想做一件事（「我想陪陈阿姨下一盘」「我去林家看看」），能做就做：用操作改好状态，再用 narrate 写结果，称玩家为「你」（「你在棋盘对面坐下，把红子摆好」）。住户看到的是这句结果，不是玩家的请求。小动作（点头、接过茶）一句带过。提问、要提示、说不清想做什么，就用 gm_reply 出戏回答。",
      "2. 地图只有住户各自的家：陈阿姨家（隔壁出租楼）、林家、Aisyah 家、Mei 家，和 Kumar 他们宿舍的一间房。楼下、走廊、玩家的办公室都不在地图上：那里的事可以在话里提到、在旁白里听到（门外拖地的声音、楼下的喇叭），但人去不了，也不能把谁摆到那里。玩家要去别家，用 move 只写 map（不写 x、y 就站在进门的地方），只能去「各家现在」里有人在家的那一家；不在家的人可以用 move 带 map 叫进门（来串门的邻居、叫来帮忙的 Kumar）。",
      "3. 先操作，后叙述。有人来、有人走、有人换手上的事，有东西摆上、拿走，都要先用操作（move、leave、set_activity、place_prop、remove_prop、extras），narrate 只写已经发生的变化。旁白里出现的人必须在地图上：住户用 move 叫过来，无名的人（来串门的亲戚、邻居家的孩子）先用 extras 摆上去；写了谁走了，就要有那个人的 leave。",
      "4. 普通的、之前没定下来的细节，你直接定（establish_fact），不要拒绝玩家，也不要说不确定。定下来的就不能改，所以只用来定之后一直成立的事；一次性的动作用操作加 narrate。",
      "5. 有后果、结果不确定的事才检定（roll）。聊天不检定。",
      "6. 住户的秘密、障碍、旧事你都知道，但不能由你说出来，旁白也不能替他们暗示；要不要说由住户自己决定。gm_reply 也一样。",
      "7. 玩家对你说要去实际做的事（帮忙搬东西、组织楼下活动、陪人去办事），用 community_action，要花 1 个政策点，玩家会先确认。只有玩家明确要去做时才用，说说而已不算。",
      "8. 一天有早上、上午、中午、下午、傍晚、晚上 6 个时段。玩家做的事明显要花时间时用 advance_time。不要跳到别的日子。",
      "9. 旁白只写玩家看得到、听得到的东西，一到三句，克制。玩家只是在跟人说话时，通常不需要旁白。住户自己的动作由住户写，你不要替他们写。",
      "10. 你写的每个字玩家都可能看到，同样要守下面的约束。",
      "",
      "## 组屋生活", L(state, W.SETTING_NOTES),
      "## 叙事基调", L(state, W.TONE_NOTES),
      "## 不点题（硬约束）", L(state, W.DISCLOSURE_NOTES),
      "",
      "## 操作（只能用这些）", GM_OPS,
      "",
      "## 输出",
      "只输出一个 JSON 对象，不要别的文字：",
      '{"ops":[…],"responders":["角色 id"]}',
      "responders：这一轮谁开口回应，通常一个人，最多两个；只能是此刻和玩家在同一张地图上、会说话的人。玩家对你说的那一轮，住户看到你写的结果后要接话才写。没人需要开口时给 []。",
      '例子（玩家对陈阿姨说话）：{"ops":[{"op":"establish_fact","subject":"flat_chen","key":"radio_today","value":"收音机开着，放着粤剧"},{"op":"extras","label":"邻居阿婆","count":1,"x":2,"y":3,"activity":"来串门"}],"responders":["chen"]}',
      '例子（玩家对你说「我想陪她下一盘」）：{"ops":[{"op":"move","actor":"chen","x":4,"y":3},{"op":"move","x":6,"y":3},{"op":"narrate","text":"你在棋盘对面坐下，把红子一个个摆好。"}],"responders":["chen"]}',
      '例子（玩家对你说「我去林家看看」）：{"ops":[{"op":"move","map":"flat_lin"},{"op":"narrate","text":"你敲了敲林家的门，慧玲开门让你进来。"}],"responders":["huiling"]}',
      '例子（旁白要写 Hafiz 走了）：{"ops":[{"op":"leave","actor":"hafiz","to":"下楼踢球"},{"op":"narrate","text":"Hafiz 抱起球，拖鞋还没穿好就冲出了门。"}],"responders":[]}'
    ].join("\n");

    const residents = Object.keys(W.RESIDENTS).filter((h) => W.livesHere(h, year)).map((h) => residentBlockGM(state, h));
    const relations = W.RELATIONS.filter((r) => r.between.every((h) => W.livesHere(h, year)))
      .map((r) => `- ［${r.id}］${L(state, r)}${r.members ? `（只有 ${r.members.join("、")} 知道）` : ""}${state.revealed.relations.includes(r.id) ? "（已经说出来了）" : ""}`);
    const seeds = W.SCENE_SEEDS.filter((s) => s.year === year).map((s) => `- ${L(state, s)}`);
    const history = gmHistory(state);
    const thisRound = state.events.filter((e) => e.turn === state.turn);
    const details = detailsBlockGM(state, shownIds(history, thisRound)), hypotheses = hypothesesBlock(state);
    const said = ctx.toGM ? `玩家对你（GM）说，玩家身份，住户听不到：「${ctx.input || ""}」`
      : ctx.to && W.CHARACTERS[ctx.to] ? `玩家对 ${ctx.to}（${nameOf(state, ctx.to)}）说，角色说出口的话，在场的人都听得到：「${ctx.input || ""}」`
      : `玩家说，角色说出口的话，在场的人都听得到，没有特别对着谁：「${ctx.input || ""}」`;

    // 从上到下越变越勤：住户设定（这一年里只有秘密说出来、心里挪了一格才变）→ 今天和滚出窗口的细节 → 历史（每轮在末尾加一块）
    // → 现在、推测和这一轮
    const parts = [
      { cache: true, text: section([
        "## 玩家", identityText(state, ctx.identity),
        "",
        "## 住户（只有你看得到）",
        residents.join("\n\n"),
        relations.length ? "\n## 住户之间的旧事\n" + relations.join("\n") : "",
        seeds.length ? "\n## 今年可以安排的事\n" + seeds.join("\n") : ""
      ]) + "\n\n" },
      { cache: true, text: section([
        `## 今天（第 ${state.decade} 个十年「${L(state, W.DECADES[state.decade - 1].title)}」）`,
        day ? `${L(state, day.title)}\n今天的背景（只有你看得到）：${L(state, day.gm)}` : "",
        details ? "\n" + details : ""
      ]) + "\n\n" }
    ].concat(historyParts(state, "## 最近发生的事（按时间先后，最新的在最后）", roundChunks(state, history)), [
      { text: "\n" + section([
        "## 现在",
        H.timeLabel(state),
        "",
        mapBlock(state),
        "",
        homesBlock(state),
        "",
        gameBlockGM(state),
        clocksBlock(state),
        hypotheses ? "\n" + hypotheses : "",
        "",
        "## 这一轮",
        thisRound.map((e) => eventLine(state, e)).join("\n"),
        said
      ]) }
    ]);
    return Object.assign({ system, seen: seenOf(history, thisRound) }, assemble(parts));
  }
  // 这次调用给了哪些事件（记进调用记录，查"为什么忘了""有没有泄露"用）
  function seenOf(history, thisRound) {
    return { events: history.map((e) => e.id), round: thisRound.map((e) => e.id), from: history.length ? history[0].id : null };
  }

  // ---------- 住户看到的 ----------
  function tensionForCharacter(state, t, lean) {
    if (state.lang === "en") return tensionForCharacterEn(state, t, lean);
    const year = state.time.year;
    const showAbout = t.about_from == null || year >= t.about_from;
    const where = lean == null || lean === 0 ? "现在两头都放不下" : lean < 0 ? `现在更偏「${L(state, t.a)}」一些` : `现在更偏「${L(state, t.b)}」一些`;
    return [
      `你心里同时放着两件事：「${L(state, t.a)}」和「${L(state, t.b)}」。${showAbout ? endZh(L(state, t.about)) : ""}${t.anchor ? endZh(L(state, t.anchor)) : ""}`,
      `要是遇上这些事，会把你推向「${L(state, t.a)}」：${L(state, t.toward_a)}。要是遇上这些事，会把你推向「${L(state, t.b)}」：${L(state, t.toward_b)}。（这些是可能遇上的事，不是已经发生的事。）${where}。`
    ].join("\n");
  }

  function householdNews(state, id) {
    const hid = W.householdOf(id);
    const out = [];
    for (const e of state.events.filter((x) => x.kind === "game" && x.perceivedBy.includes(id))) {
      const g = e.game, d = (g.deltas || {})[hid];
      const blocked = (g.barriers || {})[hid];
      if (state.lang === "en") {
        let en = `${shortTime(state, e.time)}  ${e.summary.replace(/^Game: (\w)/, (_, c) => "Downstairs, someone " + c.toLowerCase())}`;
        if (blocked && blocked.length) en += `. Your family can't use it, because: ${listDun(state, blocked.map((b) => L(state, W.BARRIERS[b])))}`;
        if (d > 0) en += ". It was good for your family";
        if (d < 0) en += d <= -10 ? ". It made life a lot harder for your family" : ". It made life a little harder for your family";
        out.push(en);
        continue;
      }
      let line = `${shortTime(state, e.time)}　${e.summary.replace(/^游戏端：/, "楼下")}`;
      if (blocked && blocked.length) line += `。你们家用不上，因为：${blocked.map((b) => L(state, W.BARRIERS[b])).join("、")}`;
      if (d > 0) line += "。对你们家是好事";
      if (d < 0) line += d <= -10 ? "。这件事让你们家的日子难过了很多" : "。这件事让你们家的日子更难了一点";
      out.push(line);
    }
    return out;
  }

  function characterPrompt(state, id, ctx) {
    ctx = ctx || {};
    if (state.lang === "en") return characterPromptEn(state, id, ctx);
    const year = state.time.year;
    const c = W.CHARACTERS[id], hid = c.household, r = W.RESIDENTS[hid], m = c.member;
    const view = H.getView(state, id);
    const name = nameOf(state, id);
    const age = m && m.born ? year - m.born : !m && r.born ? year - r.born : null;

    const who = [`## 你是谁`, L(state, r.bio)];
    if (r.split && m) {
      who.push(`你是其中的 ${L(state, m.name)}${age != null ? `，今年 ${age} 岁` : ""}。${m.bio ? L(state, m.bio) : ""}`);
      const others = W.membersAt(hid, year).filter((x) => x.id !== id).map((x) => L(state, x.name));
      if (others.length) who.push(`现在家里还有：${others.join("、")}。`);
    } else if (age != null) who.push(`你今年 ${age} 岁。`);
    who.push(`你想要的：${L(state, (m && m.goal) || r.goal)}`);
    if (m && m.view) who.push(`你怎么看事情：${L(state, m.view)}`);
    who.push(`你说话的样子：${L(state, (m && m.voice) || r.voice)}`);
    if (r.everyday) who.push(`你家的日常：${r.everyday.map((e) => L(state, e)).join("；")}`);
    who.push(`现在是 ${year} 年。你只知道到今天为止的事；以后会怎样，你不知道，也不要去猜。`);

    const heart = [];
    const own = W.tensionOf(id);
    if (own) heart.push(tensionForCharacter(state, own, view.mind.lean));
    if (r.split && r.tension_holder === "family" && !own) heart.push(tensionForCharacter(state, r.tension, view.family ? view.family.lean : null));
    else if (r.split && r.tension_holder === "family") heart.push("你们一家人共同的事：" + tensionForCharacter(state, r.tension, view.family ? view.family.lean : null));

    const knows = [];
    const secrets = view.secrets.map((k) => {
      const s = W.RESIDENTS[k.household].secrets.find((x) => x.id === k.id);
      const told = (state.revealed.secrets[k.household] || []).includes(k.id);
      const mine = k.household === hid;
      return `- ［secret:${k.id}］${L(state, s)}${told ? "（已经跟玩家说过了）" : ""}${mine ? "" : "（这是别人家的事，你知道，但轮不到你说出来）"}`;
    });
    if (secrets.length) knows.push("秘密（要不要说你自己决定；一般要信得过对方、话赶话到了才说）：\n" + secrets.join("\n"));
    const barriers = r.barriers.map((b) => `- ［barrier:${b}］${L(state, W.BARRIERS[b])}${(state.revealed.barriers[hid] || []).includes(b) ? "（已经跟玩家说过了）" : ""}`);
    if (barriers.length) knows.push("你们家用不上楼下设施的真实原因（不会一上来就说）：\n" + barriers.join("\n"));
    const rels = W.RELATIONS.filter((x) => x.between.includes(hid) && (!x.members || x.members.includes(id)) && x.between.every((h) => W.livesHere(h, year)))
      .map((x) => `- ［relation:${x.id}］${L(state, x)}${state.revealed.relations.includes(x.id) ? "（已经说出来了）" : ""}`);
    if (rels.length) knows.push("你知道的旧事：\n" + rels.join("\n"));

    const news = householdNews(state, id);
    const imps = view.mind.impressions.filter((i) => i.about === "player").map((i) => `- ${i.text}（${i.evidence.join("、")}）`);

    const leanRule = own ? `\n- lean：这一轮的事让你心里往哪边挪了一点（a 是「${L(state, own.a)}」，b 是「${L(state, own.b)}」）。大多数时候给 null。` : "";
    const system = [
      `你在一场跑团里扮演 ${name}。地点是新加坡组屋 BLK 317A 一带。你只是 ${name}：不是旁白，不是 GM，也不替别人说话。`,
      "",
      who.join("\n"),
      heart.length ? "\n## 你心里的事（绝对不能说出来）\n" + heart.join("\n") + "\n这些只能体现在你做什么、说什么、不说什么、话说到一半停下来；不要用这些词，更不要把这层意思讲出来。" : "",
      knows.length ? "\n## 只有你知道的事\n" + knows.join("\n") : "",
      "",
      "## 说话的规矩",
      L(state, W.SETTING_NOTES),
      L(state, W.TONE_NOTES),
      L(state, W.DISCLOSURE_NOTES),
      "- 只说你亲眼看到、亲耳听到、本来就知道的事；别人家的事你不知道就不要编。",
      "- 一次说一到三句，像真人聊天；可以不回答、可以岔开、可以沉默。",
      "- 下面事件里的旁白是写给玩家看的，里面的「你」指玩家，不是你。",
      "- 你只能碰到身边一格以内的人和东西。要递东西、拉人、坐到谁旁边，先用 move 走过去；够不着就别写。",
      "- 用中文写；可以夹你平时会说的方言或外语。只要有读的人可能看不懂的话（广东话、福建话、马来语、泰米尔语、英语等），就在 gloss 里把整句的意思用平白的中文写出来。",
      "",
      "## 输出",
      "只输出一个 JSON 对象，不要别的文字：",
      '{"speak":"你说的话，不说话就写空字符串","gloss":null,"act":"你的动作或神情，一句，可以空","move":null,"doing":null,"leave":null,"impression":null,"satisfaction":null,"reveal":null,"lean":null}',
      `- act：写给玩家看的一句旁白。你自己用名字写（「${name}把棋子放回盒里」），玩家称「你」（「把茶推到你面前」）。只写你自己做的事，不替别人做动作。`,
      '- move：要先走过去再说、再做，就写 {"x":5,"y":4}（这张图上空着的格子），或者 "player"（走到玩家旁边）。不走动就 null。',
      '- doing：这一轮之后你手上在做什么，一个短语（「收拾棋盘」）；和原来一样就 null。',
      '- leave：你要离开这里，就写去哪（「去巴刹」「回家」），这一轮说完、做完就走。不走就 null。act 里写了你走，这里就一定要写。',
      '- gloss：speak 里有读的人可能看不懂的方言或外语时，把整句话的意思用平白的中文写在这里：只翻译，不解释，不加你没说的话。speak 本来就是普通中文时给 null。',
      '- impression：对玩家的新看法，{"text":"…","evidence":["E12"]}；没有新看法就 null。',
      '- satisfaction：这一轮的事让你们家对楼下的日子更满意（正数）或更不满（负数），{"delta":2,"reason":"…","evidence":["E12"]}，-10 到 10。大多数时候给 null。光是聊得愉快最多 +1、+2；被冒犯、被骗、被失约可以更多。',
      '- reveal：你这句话里说出了上面某个秘密、障碍或旧事时才写，{"kind":"secret","id":"…"}（kind 是 secret、barrier 或 relation）；说出来的话要写在 speak 里。别人家的秘密不能 reveal。' + leanRule,
      "- evidence 只能引用下面「你经历过的事」和「这一轮」里的事件编号。"
    ].filter((x) => x !== "").join("\n");

    const { history, thisRound } = characterHistory(state, id, view, ctx);
    // 这一轮他什么都没看到（玩家是对 GM 说的，或者他是玩家说完话才来的）：照实说，不把玩家的原话塞给他。
    // 只有没给 turnEvents 的老调用法才用 input
    const toWhom = ctx.addressee === id ? "对你" : ctx.addressee ? `对${nameOf(state, ctx.addressee)}` : "";
    const fallback = ctx.toGM || ctx.turnEvents ? "（这一轮你没看到、没听到什么新的事。）" : `玩家${toWhom}说：「${ctx.input || ""}」`;
    // 楼下的事一个十年才几件，放在历史前面；印象差不多每轮都可能加一条，和场景、这一轮一起放在最后
    const parts = [
      { cache: true, text: news.length ? "## 楼下这些年发生的事，落在你们家是什么样\n" + news.join("\n") + "\n\n" : "" }
    ].concat(historyParts(state, "## 你经历过的事（按时间先后，最新的在最后）", roundChunks(state, history)), [
      { text: "\n" + [
        "## 你对玩家的印象",
        imps.length ? imps.join("\n") : `你还不认识这个人。你对这种人的第一印象：${L(state, r.first_view)}`,
        "",
        sceneBlockForCharacter(state, id, ctx),
        "",
        "## 这一轮",
        thisRound.length ? thisRound.map((e) => eventLine(state, e)).join("\n") : fallback,
        "你怎么回应？"
      ].join("\n") }
    ]);
    return Object.assign({ system, seen: seenOf(history, thisRound) }, assemble(parts));
  }
  // 住户的历史：自己经历过的事，到上一轮为止；这一轮看到的单独给
  function characterHistory(state, id, view, ctx) {
    const mine = view.events.filter((e) => e.turn < state.turn);
    return { history: windowOf(mine, WINDOW_CHAR), thisRound: (ctx.turnEvents || []).filter((e) => e.perceivedBy.includes(id)) };
  }

  // 住户没给翻译、这句话又看着难懂时，请 GM 补一句（10-29 Polaris）
  function glossPrompt(state, e) {
    const name = nameOf(state, e.actor);
    if (state.lang === "en") return {
      system: "You are the GM of the tabletop game \"Downstairs\", set in a Singapore HDB block. A resident has just said something a reader might not follow (another language, a dialect, heavy Singlish). Write what the whole line means in plain English: translate only; no explanation, no additions, no comment. Output a single JSON object and nothing else: {\"gloss\":\"…\"}",
      user: `Speaker: ${name}\nThe line: "${e.summary}"`
    };
    return {
      system: "你是跑团《楼下》的 GM，故事在新加坡的一座组屋。一位住户刚说了一句话，里面有读的人可能看不懂的方言或外语。把整句话的意思用平白的中文写出来：只翻译，不解释，不补充，不点评。只输出一个 JSON 对象，不要别的文字：{\"gloss\":\"…\"}",
      user: `说话的人：${name}\n这句话：「${e.summary}」`
    };
  }

  // 住户重写用：代码只收没通过的那几栏，所以可以整段重给
  function retryNote(errors, lang) {
    if (lang === "en") return "Some parts of your last output did not pass the checks:\n" + errors.map((e) => `- ${e}`).join("\n") + "\nPlease output the whole JSON again, with those parts fixed and everything else unchanged.";
    return "上一次的输出有些地方没通过检查：\n" + errors.map((e) => `- ${e}`).join("\n") + "\n请重新输出完整的 JSON，把没通过的地方改掉，其余照旧。";
  }
  // GM 重给没通过的操作（11-02 试玩：以前也用上面那句"重新输出完整的 JSON，其余照旧"，后面再补一句"只输出改好的那几条"，
  // 前后矛盾，GM 就把已经生效的叙述又写了一遍）。已经通过的已经做了，只要改好的那几条。
  // passed 是已经通过的操作名；told：这一轮玩家已经看到了叙述（检定分支里写的也算），不给就按 passed 里有没有叙述算
  function gmRetryNote(errors, passed, lang, told) {
    const kinds = [...new Set(passed || [])];
    if (told == null) told = kinds.includes("narrate") || kinds.includes("gm_reply");
    if (lang === "en") return "Some ops in your last output did not pass the checks:\n" + errors.map((e) => `- ${e}`).join("\n")
      + (kinds.length ? `\nThe rest (${kinds.join(", ")}) have already taken effect${told ? ", and the player has already read that narration" : ""}.` : "")
      + "\nThis time output only the fixed ops: {\"ops\":[…]}. Don't write again the ones that already took effect"
      + (told ? ", and don't retell the narration the player has already read" : "") + "; drop any you can't fix.";
    return "上一次的输出有些操作没通过检查：\n" + errors.map((e) => `- ${e}`).join("\n")
      + (kinds.length ? `\n其余的（${kinds.join("、")}）已经生效了${told ? "，那段叙述玩家已经看到了" : ""}。` : "")
      + "\n这一次只输出改好的那几条：{\"ops\":[…]}。已经生效的不要再写" + (told ? "，玩家看过的叙述也不要换个说法再写一遍" : "") + "；改不了的就不要了。";
  }

  // ================= English =================
  // 和上面的中文版一一对应；改规则时两边一起改。
  function residentBlockGMEn(state, hid) {
    const r = W.RESIDENTS[hid], year = state.time.year;
    const members = W.membersAt(hid, year);
    const ids = r.split ? members.map((m) => m.id) : [hid];
    const told = state.revealed;
    const out = [`### ${L(state, r.name)} (character id: ${ids.join(", ")})`];
    out.push(`Background: ${L(state, r.bio)}`);
    out.push(`Wants: ${L(state, r.goal)}`);
    const holder = r.split ? r.tension_holder : hid;
    const lean = state.minds[holder] ? state.minds[holder].lean : null;
    out.push(tensionLine(state, r.tension, lean) + (r.split ? ` (tracked on ${holder})` : ""));
    if (r.split) for (const m of members) {
      const bits = [m.bio && L(state, m.bio), m.goal && "Wants: " + L(state, m.goal), m.view && "Outlook: " + L(state, m.view), m.voice && "Voice: " + L(state, m.voice)].filter(Boolean);
      out.push(`- ${m.id} (${L(state, m.name)})${m.born ? `, ${year - m.born} years old` : ""}: ${bits.join("  ")}`);
      if (m.tension) out.push(`  ${m.id}'s own ${tensionLine(state, m.tension, state.minds[m.id] ? state.minds[m.id].lean : null)}`);
    }
    else out.push(`Voice: ${L(state, r.voice)}`);
    const barriers = r.barriers.map((b) => `${b} ${L(state, W.BARRIERS[b])}${(told.barriers[hid] || []).includes(b) ? " (already said out loud)" : ""}`).join("; ") || "none";
    out.push(`Needs: ${r.needs.map((n) => `${n} ${L(state, W.NEEDS[n])}`).join(", ")}. Barriers: ${barriers}`);
    const secrets = r.secrets.filter((s) => W.secretActive(s, year)).map((s) => `[${s.id}] ${L(state, s)}${s.holder ? ` (only ${s.holder} knows)` : ""}${s.known_to ? ` (also known to ${s.known_to.join(", ")} in another household)` : ""}${(told.secrets[hid] || []).includes(s.id) ? " (already said out loud)" : ""}`);
    if (secrets.length) out.push("Secrets: " + secrets.join("  "));
    out.push(`This decade: ${L(state, r.stages[Math.min(state.decade, r.stages.length) - 1])}`);
    if (r.everyday) out.push(`Everyday life: ${r.everyday.map((e) => L(state, e)).join("; ")}`);
    out.push(`Line from the original: ${L(state, r.quote)}`);
    return out.join("\n");
  }

  const GM_OPS_EN = `- {"op":"narrate","text":"…","noticed_by":["chen"]}  Narration: surroundings, actions and results the player can see or hear, written for the player, calling the player "you". noticed_by is optional; without it everyone on this map sees it. For a small gesture across a room, list only the resident ids who notice; [] means only the player knows.
- {"op":"gm_reply","text":"…"}  Answer the player out of character (when the player asks you something, wants a hint, or isn't clear what they want to do), one or two sentences. Only the player sees it; it never enters a resident's memory.
- {"op":"establish_fact","subject":"…","key":"…","value":"…"}  Settle an ordinary detail nobody has settled yet that will stay true (whether the television is on, what is on the table). subject is the id of a map (a home), character, household, supporting character or object; for anything downstairs or about the estate as a whole, use estate; key uses only lowercase English letters, digits and underscores; value is short. Not for one-off actions.
- {"op":"roll","dc":12,"reason":"…","on_success":[…],"on_failure":[…]}  A roll (d20, dc 5–25); only the player sees the dice. Branches hold only results: narrate, establish_fact with layer "stake", or move, leave, set_activity, objects, extras.
- {"op":"set_scene","map":"…","actors":[{"id":"chen","x":3,"y":3,"activity":"…"}],"props":[{"kind":"kopi_cup","x":4,"y":4}],"weather":"…","note":"…"}  Place people and objects on the fixed layout in one go (for a change of scene). Nobody can stand on furniture, and nothing can be set on top of it.
- {"op":"move","actor":"chen","x":5,"y":4}  Have someone walk to a cell on this map (to the player, say). Add "map" for someone arriving from elsewhere; without x and y they stand just inside the door. Nobody can stand on a door, or on the only open cell in front of one (that would block it). Without actor it moves the player: move the player only when the player tells you where they want to go, and only to a home with someone in.
- {"op":"leave","actor":"chen","to":"to the market"}  Someone leaves this map (to the market, to work, downstairs); to says where. If someone visiting another home leaves with to "home", they go back into their own home (so that home has someone in again). actor can also be an extras id.
- {"op":"set_activity","actor":"chen","activity":"packing up the chessboard"}  Change what someone is doing, without resetting the scene. actor can also be an extras id.
- {"op":"place_prop","kind":"kopi_cup","x":4,"y":4}  Set an object down on the player's map; kind must be one listed in the map section.
- {"op":"remove_prop","kind":"kuih_tray","x":11,"y":5}  Take an object away (someone packs it up or carries it off). Fixed furniture can't be taken. x and y are optional.
- {"op":"extras","id":"x1","label":"relatives","count":3,"x":4,"y":2,"activity":"eating kuih"}  Extras: a group of unnamed people who don't speak (visiting relatives, a neighbour's children, a repairman), drawn as one figure on the map. label is a short name, 12 characters at most; like people, they can't stand on a door or block the way to one. Without id it adds a new group; with an existing id it changes the count, position or what they are doing, and fields you leave out stay as they were. Use leave when they go.
- {"op":"advance_time","slots":1,"reason":"…"}  Move time on (1–3 slots) when what the player does clearly takes time.
- {"op":"community_action","residents":["chen"],"need":"🤝","description":"…"}  The player tells you they are actually going to do something that helps residents. residents are character or household ids; need is one of that household's need symbols, left out if the help isn't one of their needs.
- {"op":"clock_tick","clock":"…","by":1,"evidence":["E12"]}  Move a clock one segment (by is 1 or -1); must cite an event newer than its last tick.
- {"op":"gm_hypothesis","trait":"…","text":"…","confidence":0.5,"evidence":["E3"]}  Your guess about the player as a person, seen only by you.`;

  function gmPromptEn(state, ctx) {
    const day = D.currentDay(state);
    const year = state.time.year;
    const system = [
      "You are the GM of the tabletop game \"Downstairs\". It takes place in a Singapore HDB block, BLK 317A, starting in 1989 when the keys are handed over. The player is a new community worker, calling on one home after another.",
      "Your job is to decide what happens in the world, write it down as ops, and name who speaks this round. You don't write the residents' lines or actions: separate calls play the residents.",
      "",
      "## Rules",
      "1. Everything the player types is speech, of two kinds; \"This round\" says which.",
      "   - To a resident: words the player's character says out loud; everyone here hears them. You only decide how the world answers: who speaks (responders) and whether anything around changes. Don't act for the player, don't move the player, and don't use community_action or gm_reply.",
      "   - To you: the player speaking as the player; residents can't hear it. If they want to do something (\"I'd like to play a game with Mdm Chan\", \"I'll go and see the Lims\"), do it if it can be done: change the state with ops, then write the result with narrate, calling the player \"you\" (\"You sit down across the chessboard and set out the red pieces\"). Residents see that result, not the player's request. Small gestures (a nod, taking a cup) get one sentence. Questions, requests for a hint, or anything unclear get an out-of-character answer with gm_reply.",
      "2. The map has only the residents' own homes: Mdm Chan's flat (in the rental block next door), the Lims', Aisyah's, Mei's, and the room Kumar and his mates share in the dormitory. The void deck, the corridors and the player's office are not on the map: they can come up in talk and be heard in narration (someone mopping outside the door, a loudspeaker downstairs), but nobody can go there, and you can't place anyone there. To take the player to another home, use move with only map (without x and y they stand just inside the door), and only to a home with someone in under \"The homes right now\"; someone who is out can be brought in with move plus map (a neighbour dropping by, Kumar called in to help).",
      "3. Ops first, then narration. Anyone arriving, leaving or changing what they are doing, anything set down or taken away, needs an op first (move, leave, set_activity, place_prop, remove_prop, extras); narrate only describes changes that have already happened. Everyone narration mentions must be on the map: bring residents over with move, put unnamed people (visiting relatives, a neighbour's children) on with extras first; if you write that someone left, they need a leave.",
      "4. Ordinary details nobody has settled yet, you settle yourself (establish_fact). Don't refuse the player and don't say you're unsure. Once settled, a detail can't change, so use it only for things that stay true; one-off actions are ops plus narrate.",
      "5. Roll only for things that have consequences and an uncertain outcome. Conversation is never rolled.",
      "6. You know the residents' secrets, barriers and old history, but you must never say them, and narration must not hint at them on their behalf; whether to tell is up to each resident. The same goes for gm_reply.",
      "7. When the player tells you they will actually go and do something (helping carry things, organising something downstairs, going with someone to run an errand), use community_action. It costs 1 policy point and the player confirms first. Use it only when the player clearly means to do it; just talking about it doesn't count.",
      "8. A day has 6 slots: early morning, morning, noon, afternoon, evening, night. Use advance_time when what the player does clearly takes time. Never jump to another day.",
      "9. Narration covers only what the player can see or hear, one to three sentences, restrained. When the player is just talking to someone, you usually don't need narration. Residents write their own actions; don't write them for them.",
      "10. The player may see every word you write, so the same constraints below apply to you.",
      "",
      "## HDB life", L(state, W.SETTING_NOTES),
      "## Tone", L(state, W.TONE_NOTES),
      "## Never name it (hard constraint)", L(state, W.DISCLOSURE_NOTES),
      "",
      "## Ops (use only these)", GM_OPS_EN,
      "",
      "## Output",
      "Output a single JSON object and nothing else. Write every text and value in English:",
      '{"ops":[…],"responders":["character id"]}',
      "responders: who speaks this round, usually one person, at most two; only people on the same map as the player right now who can talk. On a round where the player spoke to you, list a resident only if they would react to the result you wrote. Give [] when nobody needs to speak.",
      'Example (the player talks to Mdm Chan): {"ops":[{"op":"establish_fact","subject":"flat_chen","key":"radio_today","value":"the radio is on, playing Cantonese opera"},{"op":"extras","label":"neighbour","count":1,"x":2,"y":3,"activity":"dropping by"}],"responders":["chen"]}',
      'Example (the player tells you "I\'d like to play a game with her"): {"ops":[{"op":"move","actor":"chen","x":4,"y":3},{"op":"move","x":6,"y":3},{"op":"narrate","text":"You sit down across the chessboard and set out the red pieces one by one."}],"responders":["chen"]}',
      'Example (the player tells you "I\'ll go and see the Lims"): {"ops":[{"op":"move","map":"flat_lin"},{"op":"narrate","text":"You knock on the Lims\' door and Hui Ling lets you in."}],"responders":["huiling"]}',
      'Example (narration has Hafiz leaving): {"ops":[{"op":"leave","actor":"hafiz","to":"down to play football"},{"op":"narrate","text":"Hafiz grabs his ball and is out of the door before his slippers are on."}],"responders":[]}'
    ].join("\n");

    const residents = Object.keys(W.RESIDENTS).filter((h) => W.livesHere(h, year)).map((h) => residentBlockGMEn(state, h));
    const relations = W.RELATIONS.filter((r) => r.between.every((h) => W.livesHere(h, year)))
      .map((r) => `- [${r.id}] ${L(state, r)}${r.members ? ` (only ${r.members.join(", ")} know)` : ""}${state.revealed.relations.includes(r.id) ? " (already said out loud)" : ""}`);
    const seeds = W.SCENE_SEEDS.filter((s) => s.year === year).map((s) => `- ${L(state, s)}`);
    const history = gmHistory(state);
    const thisRound = state.events.filter((e) => e.turn === state.turn);
    const details = detailsBlockGM(state, shownIds(history, thisRound)), hypotheses = hypothesesBlock(state);
    const said = ctx.toGM ? `The player says to you (the GM), as the player; residents can't hear it: "${ctx.input || ""}"`
      : ctx.to && W.CHARACTERS[ctx.to] ? `The player says to ${ctx.to} (${nameOf(state, ctx.to)}), out loud in character; everyone here hears it: "${ctx.input || ""}"`
      : `The player says, out loud in character, to no one in particular; everyone here hears it: "${ctx.input || ""}"`;

    const parts = [
      { cache: true, text: section([
        "## The player", identityText(state, ctx.identity),
        "",
        "## Residents (only you can see this)",
        residents.join("\n\n"),
        relations.length ? "\n## Old history between residents\n" + relations.join("\n") : "",
        seeds.length ? "\n## Things that could happen this year\n" + seeds.join("\n") : ""
      ]) + "\n\n" },
      { cache: true, text: section([
        `## Today (decade ${state.decade}, "${L(state, W.DECADES[state.decade - 1].title)}")`,
        day ? `${L(state, day.title)}\nToday's background (only you can see this): ${L(state, day.gm)}` : "",
        details ? "\n" + details : ""
      ]) + "\n\n" }
    ].concat(historyParts(state, "## What happened recently (in order, newest last)", roundChunks(state, history)), [
      { text: "\n" + section([
        "## Now",
        H.timeLabel(state),
        "",
        mapBlock(state),
        "",
        homesBlock(state),
        "",
        gameBlockGM(state),
        clocksBlock(state),
        hypotheses ? "\n" + hypotheses : "",
        "",
        "## This round",
        thisRound.map((e) => eventLine(state, e)).join("\n"),
        said
      ]) }
    ]);
    return Object.assign({ system, seen: seenOf(history, thisRound) }, assemble(parts));
  }

  function tensionForCharacterEn(state, t, lean) {
    const year = state.time.year;
    const showAbout = t.about_from == null || year >= t.about_from;
    const where = lean == null || lean === 0 ? "Right now you can't let go of either" : lean < 0 ? `Right now you lean a little more toward "${L(state, t.a)}"` : `Right now you lean a little more toward "${L(state, t.b)}"`;
    return [
      `You carry two things at once: "${L(state, t.a)}" and "${L(state, t.b)}". ${showAbout ? endEn(L(state, t.about)) : ""}${t.anchor ? " " + endEn(L(state, t.anchor)) : ""}`.replace(/\s+$/, "").replace(/ {2,}/g, " "),
      `If things like these happen, they push you toward "${L(state, t.a)}": ${L(state, t.toward_a)}. If things like these happen, they push you toward "${L(state, t.b)}": ${L(state, t.toward_b)}. (These are things that might happen, not things that have happened.) ${where}.`
    ].join("\n");
  }

  function characterPromptEn(state, id, ctx) {
    const year = state.time.year;
    const c = W.CHARACTERS[id], hid = c.household, r = W.RESIDENTS[hid], m = c.member;
    const view = H.getView(state, id);
    const name = nameOf(state, id);
    const age = m && m.born ? year - m.born : !m && r.born ? year - r.born : null;

    const who = ["## Who you are", L(state, r.bio)];
    if (r.split && m) {
      who.push(`You are ${L(state, m.name)}${age != null ? `, ${age} years old this year` : ""}. ${m.bio ? L(state, m.bio) : ""}`.trim());
      const others = W.membersAt(hid, year).filter((x) => x.id !== id).map((x) => L(state, x.name));
      if (others.length) who.push(`Also at home now: ${others.join(", ")}.`);
    } else if (age != null) who.push(`You are ${age} this year.`);
    who.push(`What you want: ${L(state, (m && m.goal) || r.goal)}`);
    if (m && m.view) who.push(`How you see things: ${L(state, m.view)}`);
    who.push(`How you talk: ${L(state, (m && m.voice) || r.voice)}`);
    if (r.everyday) who.push(`Your family's everyday life: ${r.everyday.map((e) => L(state, e)).join("; ")}`);
    who.push(`It is ${year} now. You only know what has happened up to today; you don't know what comes later, and don't try to guess.`);

    const heart = [];
    const own = W.tensionOf(id);
    if (own) heart.push(tensionForCharacterEn(state, own, view.mind.lean));
    if (r.split && r.tension_holder === "family" && !own) heart.push(tensionForCharacterEn(state, r.tension, view.family ? view.family.lean : null));
    else if (r.split && r.tension_holder === "family") heart.push("Something your whole family shares: " + tensionForCharacterEn(state, r.tension, view.family ? view.family.lean : null));

    const knows = [];
    const secrets = view.secrets.map((k) => {
      const s = W.RESIDENTS[k.household].secrets.find((x) => x.id === k.id);
      const told = (state.revealed.secrets[k.household] || []).includes(k.id);
      const mine = k.household === hid;
      return `- [secret:${k.id}] ${L(state, s)}${told ? " (you've already told the player)" : ""}${mine ? "" : " (this is another family's business; you know it, but it isn't yours to tell)"}`;
    });
    if (secrets.length) knows.push("Secrets (whether to tell is your call; usually only when you trust the person and the talk has come round to it):\n" + secrets.join("\n"));
    const barriers = r.barriers.map((b) => `- [barrier:${b}] ${L(state, W.BARRIERS[b])}${(state.revealed.barriers[hid] || []).includes(b) ? " (you've already told the player)" : ""}`);
    if (barriers.length) knows.push("The real reasons your family can't use things downstairs (you wouldn't say them straight away):\n" + barriers.join("\n"));
    const rels = W.RELATIONS.filter((x) => x.between.includes(hid) && (!x.members || x.members.includes(id)) && x.between.every((h) => W.livesHere(h, year)))
      .map((x) => `- [relation:${x.id}] ${L(state, x)}${state.revealed.relations.includes(x.id) ? " (already said out loud)" : ""}`);
    if (rels.length) knows.push("Old history you know:\n" + rels.join("\n"));

    const news = householdNews(state, id);
    const imps = view.mind.impressions.filter((i) => i.about === "player").map((i) => `- ${i.text} (${i.evidence.join(", ")})`);

    const leanRule = own ? `\n- lean: which way this round nudged you a little (a is "${L(state, own.a)}", b is "${L(state, own.b)}"). Most of the time give null.` : "";
    const system = [
      `You are playing ${name} in a tabletop game set around a Singapore HDB block, BLK 317A. You are only ${name}: not the narrator, not the GM, and you don't speak for anyone else.`,
      "",
      who.join("\n"),
      heart.length ? "\n## What's on your mind (never say it out loud)\n" + heart.join("\n") + "\nThis can only show in what you do, what you say, what you leave unsaid, a sentence you stop halfway; don't use these words, and never spell out what they mean." : "",
      knows.length ? "\n## Things only you know\n" + knows.join("\n") : "",
      "",
      "## How you talk",
      L(state, W.SETTING_NOTES),
      L(state, W.TONE_NOTES),
      L(state, W.DISCLOSURE_NOTES),
      "- Say only what you have seen, heard, or already know; if you don't know another family's business, don't make it up.",
      "- One to three sentences at a time, like a real conversation; you may not answer, change the subject, or stay quiet.",
      "- Narration in the events below is written for the player: \"you\" there means the player, not you.",
      "- You can only touch people and things within one step of you. To hand something over, take someone's arm or sit beside someone, walk over first with move; if you can't reach, don't write it.",
      "- Write in English. If you would really be speaking Malay, Tamil, Bengali, Hokkien, Cantonese or Mandarin, write it as if translated, keeping a few of your own words where they come naturally. Singapore English is fine if that is how you talk. Whenever a reader might not follow something, put a plain-English version of the whole line in gloss.",
      "",
      "## Output",
      "Output a single JSON object and nothing else:",
      '{"speak":"what you say, or an empty string if you say nothing","gloss":null,"act":"your action or expression, one sentence, may be empty","move":null,"doing":null,"leave":null,"impression":null,"satisfaction":null,"reveal":null,"lean":null}',
      `- act: one line of narration for the player. Refer to yourself by name ("${name} puts the piece back in the box") and to the player as "you" ("pushes the tea toward you"). Only what you yourself do; never act for anyone else.`,
      '- move: to walk somewhere before you speak or act, give {"x":5,"y":4} (an empty cell on this map), or "player" (to the player\'s side). null if you stay put.',
      '- doing: what you are doing after this round, a short phrase ("packing up the chessboard"); null if unchanged.',
      '- leave: if you are leaving, say where to ("to the market", "home"); you go once you have spoken and acted this round. null if you stay. If act says you leave, this must be filled in.',
      '- gloss: if speak has words a reader might not follow (Malay, Tamil, Bengali, Hokkien, Cantonese, Mandarin, heavy Singlish), write the whole line here in plain English: translate only, no explanation, nothing you didn\'t say. null if speak is already plain English.',
      '- impression: a new view of the player, {"text":"…","evidence":["E12"]}; null if nothing new.',
      '- satisfaction: whether this round made your family more satisfied (positive) or less (negative) with life downstairs, {"delta":2,"reason":"…","evidence":["E12"]}, -10 to 10. Most of the time give null. A pleasant chat is worth +1 or +2 at most; being offended, lied to or stood up can be worth more.',
      '- reveal: only when what you say tells one of the secrets, barriers or old history above, {"kind":"secret","id":"…"} (kind is secret, barrier or relation); the words themselves go in speak. Never reveal another family\'s secret.' + leanRule,
      '- evidence may only cite event ids from "What you have been through" and "This round" below.'
    ].filter((x) => x !== "").join("\n");

    const { history, thisRound } = characterHistory(state, id, view, ctx);
    const toWhom = ctx.addressee === id ? " to you" : ctx.addressee ? ` to ${nameOf(state, ctx.addressee)}` : "";
    const fallback = ctx.toGM || ctx.turnEvents ? "(You saw and heard nothing new this round.)" : `The player says${toWhom}: "${ctx.input || ""}"`;
    const parts = [
      { cache: true, text: news.length ? "## What happened downstairs over the years, and how it landed on your family\n" + news.join("\n") + "\n\n" : "" }
    ].concat(historyParts(state, "## What you have been through (in order, newest last)", roundChunks(state, history)), [
      { text: "\n" + [
        "## Your impression of the player",
        imps.length ? imps.join("\n") : `You don't know this person yet. Your first impression of people like this: ${L(state, r.first_view)}`,
        "",
        sceneBlockForCharacter(state, id, ctx),
        "",
        "## This round",
        thisRound.length ? thisRound.map((e) => eventLine(state, e)).join("\n") : fallback,
        "How do you respond?"
      ].join("\n") }
    ]);
    return Object.assign({ system, seen: seenOf(history, thisRound) }, assemble(parts));
  }

  root.V2Prompts = { DEFAULT_IDENTITY, DEFAULT_IDENTITY_EN, WINDOW_GM, WINDOW_CHAR, defaultIdentity, identityText, eventLine, windowOf, gmPrompt, characterPrompt, glossPrompt, retryNote, gmRetryNote, nameOf };
})(typeof window !== "undefined" ? window : globalThis);
