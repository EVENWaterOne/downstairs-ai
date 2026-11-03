/* 一轮：玩家说一句话 → GM 调用 → Harness 校验 → 开口的住户各一次调用（同时跑）→ Harness 校验。
 * 沿用 V0.1 的分工（D-016、D-017）：模型只提案，Harness 决定什么写进世界。
 * 玩家的话分两种（10-29 Polaris）：对住户说（opts.to 是住户或不写）是角色说出口的话；对 GM 说（opts.to 是 "gm"）是玩家身份的请求或提问，
 *   住户听不到，由 GM 去做（操作）、再写结果，住户看到的是结果。动作都经过 GM：对住户说话的这一轮，GM 不能替玩家花政策点、不能挪玩家。
 * - 叙述说有人走了、那人却还在地图上（harness.leaveClaims）：退回给 GM 补一次 leave；住户自己的 act 说走了却没写 leave，也重写一次。
 * - GM 的操作没通过：把没通过的原因给 GM，重给一次那几条；还不过就丢掉。
 * - 花政策点的行动（community_action）先问玩家确认，确认了才执行。
 * - 住户的话被设定门拦下：重写一次；还不过，这句话就不说出来，只留动作（都没有就由代码写一句"没说话"）。
 * - 住户的话里有读的人看不懂的方言或外语：住户自己在 gloss 里给翻译；没给、这句话又看着难懂，就请 GM 补一句（再一次调用）。
 * - 只有玩家走动不调用模型（那在 board.js）。
 * - 每次调用记下 token 数和占上下文多少（tokens.js），返回值里的 usage 是这一轮的合计。
 * - 11-02：调用带上 prompts.js 给的 parts（llm.js 拿去打缓存断点；重试时 user 后面多出的一段不打）和 seen（这次给了哪些事件），seen 记进调用记录。
 * - 11-02 试玩：同一段叙述出了两遍、时间也多推了一段。GM 重给没通过的操作时，把已经生效的也照抄了一遍（重试提示词前后矛盾：
 *   通用的那句说"重新输出完整的 JSON，其余照旧"，后面又说"只输出改好的那几条"）。现在 GM 有自己的重试说明，
 *   重给的操作里和这一轮已经生效的重复的，代码也不再做（dedupe），调用记录里标"重复，没有再做"；
 *   叙述里抄了已经显示的那段、后面又写了新的，只做新的那部分。
 * - 11-02 流式输出：opts.onStream 有的话，GM 的第一次调用边写边把最外层的叙述交给界面（stream.js 读没写完的 JSON、先过设定门）；
 *   这一次的操作做完就 onStream(null)，界面换成真正的事件。重给、补翻译、住户的调用不流式。
 * llm(call) → { text, meta }：call = { role, label, system, user, ctx }，ctx 给离线演示用。不依赖 DOM。 */
(function (root) {
  "use strict";
  const W = root.V2World, H = root.V2Harness, B = root.V2Board, D = root.V2Days, P = root.V2Prompts, LLM = root.V2LLM, S = root.V2Session, Tok = root.V2Tokens, St = root.V2Stream;
  const GM_ALLOWED = new Set(["narrate", "gm_reply", "establish_fact", "roll", "set_scene", "move", "leave", "set_activity", "place_prop", "remove_prop", "extras", "advance_time", "community_action", "clock_tick", "gm_hypothesis"]);
  // 玩家只是在对住户说话的这一轮，GM 不能替玩家做事：这些要玩家对 GM 说了才行
  const ONLY_WHEN_ASKED = new Set(["community_action", "gm_reply"]);
  // 检定分支里只放结果：花政策点、推进时间要走确认和日程，不能藏在分支里
  const BRANCH_OK = new Set(["narrate", "establish_fact", "move", "leave", "set_activity", "place_prop", "remove_prop", "extras"]);
  const MAX_RESPONDERS = 2;
  const T = (state, zh, en) => (state.lang === "en" ? en : zh);

  // 调一次模型并解析 JSON；不是合法 JSON 就追问一次
  async function callJSON(opts, rec, call) {
    const t0 = Date.now();
    let r = await opts.llm(call);
    rec.calls.push(record(call, r, t0));
    let parsed = LLM.parseJSON(r.text);
    if (!parsed) {
      const en = call.ctx && call.ctx.state && call.ctx.state.lang === "en";
      // 追问那次不流式；界面上先放出来的那段先收掉
      if (typeof call.onDiscard === "function") call.onDiscard();
      const again = Object.assign({}, call, { onText: null, onDiscard: null }, en
        ? { label: call.label + " (JSON again)", user: call.user + "\n\n## Your last output\n" + (r.text || "(empty)") + "\n\nThat was not valid JSON. Please output only one JSON object in the required format." }
        : { label: call.label + "（重给 JSON）", user: call.user + "\n\n## 你上一次的输出\n" + (r.text || "（空）") + "\n\n上一条不是合法的 JSON。请只输出一个符合格式的 JSON 对象。" });
      const t1 = Date.now();
      r = await opts.llm(again);
      rec.calls.push(record(again, r, t1));
      parsed = LLM.parseJSON(r.text);
    }
    const last = rec.calls[rec.calls.length - 1];
    last.parsed = parsed;
    return { parsed, text: r.text, rec: last };
  }
  // 每次调用都记下提示词、原始输出和用量（tokens.js：接口报了就用准确数，没报就按字数估）
  function record(call, r, t0) {
    const c = { role: call.role, label: call.label, system: call.system, user: call.user, text: r.text, meta: Object.assign({ ms: Date.now() - t0 }, r.meta || {}), seen: call.seen || null, results: [] };
    c.tokens = Tok.forCall(c);
    return c;
  }

  // ---------- GM ----------
  // 这一轮能不能用这条操作（检定分支里的操作也逐条查，免得从分支里绕过去）
  function gmRefusal(state, op, toGM, inBranch) {
    if (!op || typeof op.op !== "string") return T(state, "操作格式不对", "Malformed op");
    if (!GM_ALLOWED.has(op.op)) return op.op === "jump_time" ? T(state, "跳到别的日子由日程决定，GM 不能跳", "Moving to another day is up to the schedule; the GM can't jump") : T(state, `GM 不能用 ${op.op}`, `The GM can't use ${op.op}`);
    if (!toGM && (ONLY_WHEN_ASKED.has(op.op) || (op.op === "move" && (!op.actor || op.actor === "player"))))
      return T(state, "玩家这一句是对住户说的话，没有请你去做什么；要做事、要你回答，玩家会对 GM 说", "The player was talking to a resident, not asking you to do anything; to act or to get an answer, the player talks to the GM");
    if (op.op === "roll" && [op.on_success, op.on_failure].some((b) => b != null && !Array.isArray(b))) return T(state, "检定的分支要写成列表 […]", "A roll's branches must be lists […]");
    if (inBranch && !BRANCH_OK.has(op.op)) return T(state, `检定的分支里不能用 ${op.op}（只能写结果：narrate、establish_fact、走动、离开、物件、配角）`, `${op.op} can't go inside a roll branch (only results: narrate, establish_fact, moving, leaving, objects, extras)`);
    if (op.op === "roll") for (const sub of [].concat(op.on_success || [], op.on_failure || [])) {
      const why = gmRefusal(state, sub, toGM, true);
      if (why) return why;
    }
    return null;
  }
  function gmOp(state, op, rec, pending, toGM) {
    const why = gmRefusal(state, op, toGM, false);
    if (why) return { op: op && op.op, ok: false, reason: why };
    if (op.op === "community_action") {
      if (pending.action) return { op: op.op, ok: false, reason: T(state, "一轮只能有一个花政策点的行动", "Only one action that costs a policy point per round") };
      pending.action = op;
      return { op: op.op, ok: true, deferred: true };
    }
    // 推进时间也放到最后：先把这一轮的事做完（包括玩家确认的行动），再过时间
    if (op.op === "advance_time") {
      const sofar = pending.advance ? pending.advance.slots : 0;
      const left = D.slotsLeft(state) - sofar;
      if (!Number.isInteger(op.slots) || op.slots < 1) return { op: op.op, ok: false, reason: T(state, "slots 要是正整数", "slots must be a positive integer") };
      if (left <= 0) return { op: op.op, ok: false, reason: T(state, "已经是晚上了，这一天不能再往后推", "It's already night; this day can't go any further") };
      pending.advance = { op: "advance_time", slots: sofar + Math.min(op.slots, left), reason: op.reason || (pending.advance && pending.advance.reason) || null };
      return { op: op.op, ok: true, deferred: true };
    }
    return Object.assign({ op: op.op }, safeApply(state, op, "gm"));
  }

  // 这一轮 GM 写的叙述里说走了、人却还在地图上的。这一轮真的挪了位置的不算：叙述写的多半就是那一步
  // （按位置比，不按操作：move、配角换位置、检定分支里的 move、set_scene 都算；配角只改人数或在做什么、没挪，不算）
  function strandedLeavers(state, sinceSeq, before) {
    const texts = state.events.filter((e) => e.seq > sinceSeq && e.kind === "narration").map((e) => e.summary);
    const moved = movedSince(state, before);
    return [...new Set(texts.flatMap((t) => H.leaveClaims(state, t)))].filter((id) => !moved.has(id));
  }
  function positions(state) {
    const at = new Map();
    for (const a of Object.values(state.actors)) at.set(a.id, a.map + ":" + a.x + "," + a.y);
    for (const g of state.extras || []) at.set(g.id, g.map + ":" + g.x + "," + g.y);
    return at;
  }
  function movedSince(state, before) {
    const now = positions(state);
    return new Set([...now].filter(([id, p]) => before.get(id) !== p).map(([id]) => id));
  }
  function strandedNote(state, ids) {
    const who = ids.map((id) => (W.CHARACTERS[id] ? `${id}（${P.nameOf(state, id)}）` : id)).join(T(state, "、", ", "));
    return T(state, `叙述里像是写了 ${who} 离开，可是地图上还在。真的离开了这张图，就补上 {"op":"leave","actor":"…","to":"去哪"}，不要重写原来的叙述；只是在这张图上走动，就用 move 挪到那一格；都不是，就输出 {"ops":[]}。`,
      `The narration seems to say ${who} left, but they are still on the map. If they really left this map, add {"op":"leave","actor":"…","to":"where to"} and don't rewrite the narration; if they only moved within this map, move them to that cell; otherwise output {"ops":[]}.`);
  }

  // 重给的这一条和这一轮已经生效的比（模型常把通过的也照抄一遍）：
  //   { skip: 原因 }：重复了，不再做；{ op }：开头抄了已经显示的那几段、后面又写了新的，只做新的那部分；null：照常做。
  // refused：第一次没通过的那几条（重给的多半就是在改它们）。
  // 叙述和出戏回答按字比（这一轮已经有的都算，检定分支里写的也算）：
  //   - 去掉已经显示的那几段（在哪儿都算）以后没剩什么新的：不做；
  //   - 已经显示的那几段在开头（差个标点也算）：去掉开头，只做后面新的；
  //   - 夹在中间：整段照做（会重复一句，但不把一段话从中间剪开，也不丢新写的）。
  // 推进时间、花政策点的行动一轮一次；检定：原因一样（去掉标点）的不再掷第二次，不然失败了能白捡一次；
  //   原因差不多、骰子难度也一样的也算重复，除非它更像是第一次没通过的那条检定改好了（"听林家门口" 和 "听陈家门口" 只差一个字）；
  // 别的操作一模一样才算
  function dedupe(state, op, passed, startSeq, refused) {
    if (!op || typeof op !== "object" || typeof op.op !== "string") return null;
    const skip = { skip: T(state, "和这一轮已经生效的重复了，没有再做", "Repeats one that already took effect this round; not done again") };
    if (op.op === "narrate" || op.op === "gm_reply") {
      if (typeof op.text !== "string" || !op.text.trim()) return null;
      const said = state.events.filter((e) => e.seq > startSeq && (e.kind === "narration" || e.kind === "gm_reply")).map((e) => e.summary)
        .filter((x) => norm(x).length >= 2);
      if (said.some((x) => repeats(x, op.text))) return skip;
      const shownN = said.map((x) => norm(x).join("")).filter((x) => Array.from(x).length >= 6);
      let left = norm(op.text).join("");
      for (const x of shownN) left = left.split(x).join("");
      if (Array.from(left).length < 2 || said.some((x) => repeats(x, left))) return skip;
      const rest = afterShown(op.text, said);
      return rest == null ? null : { op: Object.assign({}, op, { text: rest }) };
    }
    if (op.op === "advance_time" || op.op === "community_action") return passed.some((p) => p.op === op.op) ? skip : null;
    if (op.op === "roll") {
      const rolls = passed.filter((p) => p && p.op === "roll");
      const same = (a, b) => norm(a).join("") === norm(b).join("");
      if (rolls.some((p) => same(p.reason, op.reason))) return skip;
      if ((refused || []).some((p) => p && p.op === "roll" && (same(p.reason, op.reason) || similar(p.reason, op.reason)))) return null;
      return rolls.some((p) => similar(p.reason, op.reason) && p.dc === op.dc) ? skip : null;
    }
    const key = canon(op);
    return passed.some((p) => canon(p) === key) ? skip : null;
  }
  // 去掉空白和标点，按字（不是按 UTF-16）
  const NOISE = /[\s\p{P}\p{S}]/u;
  function norm(x) { return Array.from(String(x || "").toLowerCase()).filter((c) => !NOISE.test(c)); }
  // 已经显示的那几段在 text 的开头（按去掉标点后的字比，一段接一段地去）：返回后面新写的那部分（原文），开头不是就返回 null。
  // 每段去掉以后，它原文末尾的标点（比如 '。"'）在 text 里也照样有的话一起去掉；再去掉开头的空白和逗号句号
  function afterShown(text, said) {
    const chars = Array.from(String(text));
    const kept = [];   // [去掉标点后的字, 它在 chars 里的下标]
    chars.forEach((c, i) => { if (!NOISE.test(c)) kept.push([c.toLowerCase(), i]); });
    let k = 0, cutAt = 0, cut = false;
    for (let again = true; again;) {
      again = false;
      for (const x of said) {
        const n = norm(x);
        if (n.length < 6 || k + n.length > kept.length) continue;
        if (!n.every((c, j) => kept[k + j][0] === c)) continue;
        k += n.length;
        cutAt = kept[k - 1][1] + 1;
        const tail = Array.from(String(x).trimEnd()).reverse().findIndex((c) => !NOISE.test(c));
        const end = tail > 0 ? Array.from(String(x).trimEnd()).slice(-tail).join("") : "";
        if (end && chars.slice(cutAt).join("").startsWith(end)) cutAt += Array.from(end).length;
        cut = again = true;
        break;
      }
    }
    if (!cut) return null;
    return chars.slice(cutAt).join("").replace(/^[\s，,。.；;：:、]+/u, "").trim();
  }
  // 两段差不多：去掉空白和标点后一样，或者两字一组的重合度到八成
  function similar(a, b) {
    const x = norm(a), y = norm(b);
    if (!x.length || !y.length) return false;
    if (x.join("") === y.join("")) return true;
    return dice(x, y) >= 0.8;
  }
  function dice(x, y) {
    const grams = (c) => { const m = new Map(); for (let i = 0; i + 1 < c.length; i++) { const g = c[i] + c[i + 1]; m.set(g, (m.get(g) || 0) + 1); } return m; };
    const gx = grams(x), gy = grams(y);
    let both = 0;
    for (const [g, n] of gx) both += Math.min(n, gy.get(g) || 0);
    const total = Math.max(0, x.length - 1) + Math.max(0, y.length - 1);
    return total > 0 ? (2 * both) / total : 0;
  }
  // 重给的这段（retry）对已经显示的那段（said）没有新东西：去掉标点后一样；或者整段都在 said 里（至少 10 个字）；
  // 或者差不多、又没比 said 长出一成半（长出很多的，可能是在后面接着写了新的，照常做）
  function repeats(said, retry) {
    const x = norm(said), y = norm(retry);
    if (!x.length || !y.length) return false;
    const xs = x.join(""), ys = y.join("");
    if (xs === ys) return true;
    if (y.length >= 10 && xs.includes(ys)) return true;
    return y.length <= x.length * 1.15 + 2 && dice(x, y) >= 0.8;
  }
  function canon(v) {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
    return JSON.stringify(v);
  }

  async function runGM(session, input, opts, rec) {
    const state = session.state;
    const toGM = opts.to === "gm";
    const ctx = { input, toGM, to: opts.to || null, focus: opts.focus || null, identity: opts.identity };
    const prompt = P.gmPrompt(state, ctx);
    const startSeq = state.seq, before = positions(state);
    // 流式：只有这第一次调用。对住户说的那一轮 gm_reply 会被拦下，不先放
    const live = opts.onStream ? St.viewer({ lang: state.lang, gmReply: toGM, check: (text) => H.leakCheck(state, text), show: (list) => opts.onStream(list) }) : null;
    // 先放出来的那段收掉，界面换成真正写进世界的事件（重给的那次调用还要等一会儿，这时已经通过的叙述先显示着）。
    // 不是合法 JSON 的那次，在追问之前就收掉（onDiscard）：那段不会写进世界
    const settled = () => { if (live) opts.onStream(null); };
    const out = await callJSON(opts, rec, { role: "gm", label: "GM", system: prompt.system, user: prompt.user, parts: prompt.parts, seen: prompt.seen, onText: live, onDiscard: live ? settled : null, ctx: Object.assign({ state }, ctx) });
    const pending = { action: null, advance: null };
    if (!out.parsed) { settled(); return { responders: null, pending }; }
    const ops = Array.isArray(out.parsed.ops) ? out.parsed.ops : [];
    const results = ops.map((op) => gmOp(state, op, rec, pending, toGM));
    out.rec.results = results;
    settled();
    const passed = ops.filter((op, i) => results[i].ok);
    const failed = results.map((r, i) => ({ r, op: ops[i] })).filter((x) => !x.r.ok);
    const stranded = strandedLeavers(state, startSeq, before);
    if (failed.length || stranded.length) {
      const errors = failed.map((x) => `${JSON.stringify(x.op)}${T(state, "：", ": ")}${x.r.reason}`).concat(stranded.length ? [strandedNote(state, stranded)] : []);
      // 玩家看过的叙述：最外层的 narrate、检定分支里的都算
      const told = state.events.some((e) => e.seq > startSeq && (e.kind === "narration" || e.kind === "gm_reply"));
      const note = P.gmRetryNote(errors, passed.map((op) => op.op), state.lang, told);
      const retry = await callJSON(opts, rec, { role: "gm", label: T(state, "GM（重给没通过的操作）", "GM (retrying failed ops)"), system: prompt.system, user: prompt.user + T(state, "\n\n## 你上一次的输出\n", "\n\n## Your last output\n") + out.text + "\n\n" + note, parts: prompt.parts, seen: prompt.seen, ctx: Object.assign({ state, retry: true, stranded }, ctx) });
      const ops2 = retry.parsed && Array.isArray(retry.parsed.ops) ? retry.parsed.ops : [];
      retry.rec.results = ops2.map((op) => {
        const d = dedupe(state, op, passed, startSeq, failed.map((x) => x.op));
        if (d && d.skip) return { op: op.op, ok: true, skipped: true, reason: d.skip };
        const use = d && d.op ? d.op : op;
        const r = gmOp(state, use, rec, pending, toGM);
        if (r.ok) passed.push(use);
        return d && d.op ? Object.assign({ trimmed: true }, r) : r;
      });
      // 还对不上就放过去，但记在调用记录里，方便以后统计
      const still = strandedLeavers(state, startSeq, before);
      if (still.length) retry.rec.results.push({ op: "check", ok: false, reason: strandedNote(state, still) });
    }
    const responders = Array.isArray(out.parsed.responders) ? out.parsed.responders : [];
    return { responders, pending };
  }

  // ---------- 住户 ----------
  // 住户输出的各个部分 → Harness 操作（npc 一律是他自己，不能替别人说话）
  // 顺序：先走过去，再说话、做动作，最后才离开（离开以后就说不了话、也说不出秘密了）
  // addressed：玩家这句是对他说的。他离玩家超过一格、自己又没写 move 或 leave，就替他走到玩家旁边（兜底）
  function characterOps(state, id, out, addressed) {
    const ops = [];
    const to = moveTarget(state, id, out.move || (addressed && !out.leave ? "player" : null));
    // auto：是代码替他走的，不是他自己写的 move
    if (to) ops.push({ part: "move", auto: !out.move, op: { op: "move", actor: id, x: to[0], y: to[1] } });
    if (out.speak && String(out.speak).trim()) ops.push({ part: "speak", op: { op: "speak", npc: id, text: String(out.speak).trim(), gloss: out.gloss && typeof out.gloss === "string" ? out.gloss : null } });
    if (out.act && String(out.act).trim()) ops.push({ part: "act", op: { op: "narrate", text: String(out.act).trim() } });
    if (out.reveal && out.reveal.kind) ops.push({ part: "reveal", op: { op: "reveal", npc: id, kind: out.reveal.kind, id: out.reveal.id } });
    if (out.impression && out.impression.text) ops.push({ part: "impression", op: { op: "impression", npc: id, about: "player", text: out.impression.text, evidence: out.impression.evidence } });
    if (out.satisfaction && out.satisfaction.delta) ops.push({ part: "satisfaction", op: { op: "satisfaction", npc: id, delta: out.satisfaction.delta, reason: out.satisfaction.reason, evidence: out.satisfaction.evidence } });
    if (out.lean && out.lean.toward && W.tensionOf(id)) ops.push({ part: "lean", op: { op: "lean", npc: id, toward: out.lean.toward, evidence: out.lean.evidence } });
    if (typeof out.doing === "string" && out.doing.trim()) ops.push({ part: "doing", op: { op: "set_activity", actor: id, activity: out.doing.trim() } });
    if (out.leave) ops.push({ part: "leave", op: { op: "leave", actor: id, to: typeof out.leave === "string" ? out.leave : out.leave.to || "" } });
    return ops;
  }
  // 住户的 move：{"x":5,"y":4}，或者 "player"（走到玩家旁边，挑离自己最近的空位）。已经在玩家旁边就不动
  function moveTarget(state, id, m) {
    if (!m) return null;
    const a = state.actors[id], p = state.actors.player;
    if (!a || !a.map) return null;
    if (m === "player" || m.to === "player") {
      if (p.map !== a.map || Math.abs(p.x - a.x) + Math.abs(p.y - a.y) <= 1) return null;
      const spots = B.DIRS.map(([dx, dy]) => [p.x + dx, p.y + dy]).filter(([x, y]) => B.free(state, p.map, x, y, id) && !B.exitAt(p.map, x, y) && !H.blocksDoor(state, p.map, x, y, id));
      spots.sort((u, v) => (Math.abs(u[0] - a.x) + Math.abs(u[1] - a.y)) - (Math.abs(v[0] - a.x) + Math.abs(v[1] - a.y)));
      return spots[0] || null;
    }
    return Number.isInteger(m.x) && Number.isInteger(m.y) && (m.x !== a.x || m.y !== a.y) ? [m.x, m.y] : null;
  }
  // act 里写自己走了，却没有 leave：这一句先不放出来，和 leave 一起重写（第二次还这样就放过去，记在调用记录里）。
  // 他自己写了 move 的不算（act 写的多半就是那几步）；代码替他走过去的那一步不算他写的
  function selfLeaveUnmatched(state, id, parts) {
    const act = parts.find((p) => p.part === "act");
    return !!act && !parts.some((p) => p.part === "leave" || (p.part === "move" && !p.auto)) && H.leaveClaims(state, act.op.text, { self: id, map: state.actors[id].map }).includes(id);
  }
  const LEAVE_NOTE = (state) => T(state, "act 里写了你要走，就在 leave 里写去哪（比如 \"去巴刹\"）；不走的话，act 里别写走", "Your act says you are leaving: put where you are going in leave (e.g. \"to the market\"); if you are not leaving, don't write that you are");
  function applyParts(state, parts, only) {
    return parts.filter((p) => !only || only.has(p.part)).map((p) => Object.assign({ part: p.part, op: p.op.op }, safeApply(state, p.op, "character")));
  }
  // 模型写出怪东西（坐标是字符串、栏位是对象）时，规则层哪里没防到也不至于让整轮中断：当作这一条没通过
  function safeApply(state, op, by) {
    try { return H.applyOp(state, op, { by }); } catch (e) { return { ok: false, reason: T(state, "操作格式不对", "Malformed op") }; }
  }

  async function askCharacter(session, id, ctx, opts, rec) {
    const prompt = P.characterPrompt(session.state, id, ctx);
    const call = { role: "character", label: P.nameOf(session.state, id), system: prompt.system, user: prompt.user, parts: prompt.parts, seen: prompt.seen, ctx: Object.assign({ state: session.state, id }, ctx) };
    const out = await callJSON(opts, rec, call);
    return { id, prompt, call, out, addressed: !ctx.toGM && ctx.addressee === id };
  }

  // leave 一律最后做：重写、兜底的那句反应都在他还在场时做完（走了以后就说不了话），叙述里也是先说话、后离开
  async function settleCharacter(session, ask, opts, rec) {
    const state = session.state, id = ask.id;
    if (!ask.out.parsed) return fallbackSilence(state, id);
    const parts = characterOps(state, id, ask.out.parsed, ask.addressed);
    let leave = parts.find((p) => p.part === "leave") || null;
    const held = selfLeaveUnmatched(state, id, parts);
    // act 说要走：先不替他走到玩家旁边（走过来又走掉，地图上看着不对）
    const results = applyParts(state, parts.filter((p) => p.part !== "leave" && !(held && (p.part === "act" || p.auto))));
    if (held) results.push({ part: "act", op: "narrate", ok: false, reason: LEAVE_NOTE(state) });
    ask.out.rec.results = results;
    let last = results;
    const failed = results.filter((r) => !r.ok);
    let shown = results.some((r) => r.ok && (r.part === "speak" || r.part === "act"));
    if (failed.length) {
      const note = P.retryNote(failed.map((r) => `${r.part}${T(state, "：", ": ")}${r.reason}`), state.lang);
      const again = await callJSON(opts, rec, Object.assign({}, ask.call, { label: ask.call.label + T(state, "（重写）", " (rewrite)"), user: ask.call.user + T(state, "\n\n## 你上一次的输出\n", "\n\n## Your last output\n") + ask.out.text + "\n\n" + note, ctx: Object.assign({}, ask.call.ctx, { retry: true, failed: failed.map((r) => r.part) }) }));
      if (again.parsed) {
        const only = new Set(failed.map((r) => r.part));
        const parts2 = characterOps(state, id, again.parsed, ask.addressed);
        // act 因为没写 leave 被退回的：重写时 leave 一起收，用重写给的去处
        if (held) leave = parts2.find((p) => p.part === "leave") || null;
        const res2 = applyParts(state, parts2.filter((p) => p.part !== "leave"), only);
        if (held && !leave && selfLeaveUnmatched(state, id, parts2.filter((p) => only.has(p.part)))) res2.push({ part: "check", op: "check", ok: false, reason: LEAVE_NOTE(state) });
        again.rec.results = res2;
        last = res2;
        if (res2.some((r) => r.ok && (r.part === "speak" || r.part === "act"))) shown = true;
      }
      // 重写也没写出能看的：被扣下的那句原样放出来，免得什么都不说
      if (held && !shown) {
        const act = parts.find((p) => p.part === "act");
        if (safeApply(state, act.op, "character").ok) shown = true;
      }
    }
    if (!shown) fallbackSilence(state, id);
    if (leave) last.push(Object.assign({ part: "leave", op: "leave" }, safeApply(state, leave.op, "character")));
  }
  // 模型两次都没写出能给玩家看的东西：由代码写一句，保证这一轮有回应
  function fallbackSilence(state, id) {
    if (!W.CHARACTERS[id]) return;
    H.applyOp(state, { op: "narrate", text: T(state, P.nameOf(state, id) + "看了你一眼，没有说话。", P.nameOf(state, id) + " glances at you and says nothing.") }, { by: "system" });
  }

  // 看不懂又没翻译的台词，请 GM 翻一句；翻不出来就照原样留着
  async function glossMissing(session, startSeq, opts, rec) {
    const state = session.state;
    const todo = state.events.filter((e) => e.seq > startSeq && e.kind === "speech" && !e.gloss && H.needsGloss(state, e.summary));
    if (todo.length && opts.onStatus) opts.onStatus("translate");
    await Promise.all(todo.map(async (e) => {
      const prompt = P.glossPrompt(state, e);
      const out = await callJSON(opts, rec, { role: "gm", label: T(state, "GM（翻译）", "GM (translation)"), system: prompt.system, user: prompt.user, ctx: { state, translate: true, event: e } });
      const text = out.parsed && typeof out.parsed.gloss === "string" ? out.parsed.gloss : "";
      out.rec.results = text ? [Object.assign({ op: "gloss" }, H.applyOp(state, { op: "gloss", event: e.id, text }, { by: "gm" }))] : [];
    }));
  }

  function pickResponders(state, list, focus) {
    const ok = (id) => W.CHARACTERS[id] && W.characterPresent(id, state.time.year) && state.actors[id].map === state.actors.player.map && W.canTalk(id, state.time.year);
    let out = [...new Set((list || []).filter(ok))];
    // GM 的输出解析不了时，至少让玩家对着的人回答
    if (list === null && focus && ok(focus)) out = [focus];
    return out.slice(0, MAX_RESPONDERS);
  }

  // ---------- 一轮 ----------
  // 中途出错也把已经发出的调用交出去（用量照样算）
  async function playerTurn(session, input, opts) {
    const rec = { calls: [], notes: [] };
    try { return await runTurn(session, input, opts, rec); } catch (e) {
      if (e && typeof e === "object") e.calls = rec.calls;
      throw e;
    }
  }
  async function runTurn(session, input, opts, rec) {
    const state = session.state;
    input = String(input || "").trim();
    if (!input) return { items: [], calls: [], usage: Tok.sum([]) };
    const startSeq = state.seq;
    // to："gm" 是对 GM 说；住户 id 是对他说；不写就是说给在场的人听（对着谁看 focus）
    const toGM = opts.to === "gm";
    const addressee = toGM ? null : (opts.to && opts.to !== "gm" ? opts.to : opts.focus || null);
    H.apply(state, { by: "ui", ops: [{ op: "player_say", text: input, to: toGM ? "gm" : addressee }] });
    const status = opts.onStatus || (() => {});

    status("gm");
    const gm = await runGM(session, input, Object.assign({}, opts, { to: toGM ? "gm" : addressee }), rec);
    // 对 GM 说的话总要有个回音：GM 的输出解析不了，或者什么给玩家看的都没写
    if (toGM && !state.events.some((e) => e.seq > startSeq && e.perceivedBy.includes("player") && (e.kind === "narration" || e.kind === "gm_reply")) && !gm.pending.action)
      H.applyOp(state, { op: "gm_reply", text: T(state, "（GM 没听明白，换个说法再说一次？）", "(The GM didn't catch that. Try saying it another way?)") }, { by: "gm" });

    // 花政策点的行动：先问玩家。没做成的几句只给玩家看（是在回玩家对 GM 说的话，住户没听到那个请求）
    if (gm.pending.action) {
      const op = gm.pending.action;
      const toPlayer = (text) => H.applyOp(state, { op: "narrate", text, noticed_by: [] }, { by: "system" });
      if (state.game.points < 1) {
        toPlayer(T(state, "这个十年的政策点已经用完了，这件事这次做不了。", "The policy points for this decade are used up, so this can't be done this time."));
      } else {
        const yes = opts.confirmSpend ? await opts.confirmSpend(op) : false;
        const r = yes ? safeApply(state, op, "gm") : toPlayer(T(state, "你想了想，这次没有去做。", "You think it over and decide not to, this time."));
        rec.notes.push({ action: op, confirmed: yes, result: r });
        if (yes && !r.ok) toPlayer(T(state, "这件事没做成：", "It didn't work out: ") + r.reason);
      }
    }
    // GM 推进了时间：没在跟玩家说话的人按日程走动
    if (gm.pending.advance && H.applyOp(state, gm.pending.advance, { by: "gm" }).ok) {
      const here = Object.values(state.actors).filter((a) => a.kind === "resident" && a.map === state.actors.player.map).map((a) => a.id);
      D.placeBySchedule(state, { keep: here });
    }

    const responders = pickResponders(state, gm.responders, addressee);
    if (responders.length) {
      status("characters", responders);
      const turnEvents = state.events.filter((e) => e.seq > startSeq);
      const ctx = { input, toGM, addressee, focus: opts.focus || null, identity: opts.identity, turnEvents };
      const asks = await Promise.all(responders.map((id) => askCharacter(session, id, ctx, opts, rec)));
      for (const ask of asks) await settleCharacter(session, ask, opts, rec);
      await glossMissing(session, startSeq, opts, rec);
    }

    const sent = S.flushToGame(session);
    D.clearMet(state);
    status("done");
    const items = state.events.filter((e) => e.seq > startSeq && e.perceivedBy.includes("player"));
    return { items, calls: rec.calls, notes: rec.notes, sent, usage: Tok.sum(rec.calls) };
  }

  root.V2Turn = { playerTurn, pickResponders, characterOps, dedupe, repeats, similar, GM_ALLOWED };
})(typeof window !== "undefined" ? window : globalThis);
