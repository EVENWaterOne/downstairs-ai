// 11-02 试玩：同一段叙述出了两遍（GM 重给没通过的操作时把已经生效的也照抄了一遍，时间也多推了一段）；
// 11-02 Polaris："gm 是可以设定成流式输出的"。
const test = require("node:test");
const assert = require("node:assert/strict");
const { H, API, D, P, LLM, Mock, Turn, St } = require("./load");

function downstairs(lang) {
  const s = API.createSession({ lang: lang || "zh" });
  D.begin(s.state);
  const st = s.state;
  // 陈阿姨家：(5,3) 是那副旧象棋盘（家具，人不能站上去），她坐在棋盘这一边，你站在另一边
  Object.assign(st.actors.chen, { map: "flat_chen", x: 4, y: 3, activity: lang === "en" ? "sitting by the chessboard" : "坐在棋盘边" });
  Object.assign(st.actors.player, { map: "flat_chen", x: 6, y: 4 });
  return s;
}
// byRole[role](ctx, n)：n 是这个角色第几次被调用（从 1 起）。call.onText 有的话，把输出一个字一个字地交出去
function fake(byRole, log) {
  const n = {};
  return async (call) => {
    n[call.role] = (n[call.role] || 0) + 1;
    const f = byRole[call.role];
    const body = typeof f === "function" ? f(call.ctx, n[call.role]) : f;
    const text = typeof body === "string" ? body : JSON.stringify(body);
    if (log) log.push({ call: call.label, streamed: typeof call.onText === "function" });
    if (typeof call.onText === "function") { const cs = Array.from(text); for (let i = 1; i <= cs.length; i++) call.onText(cs.slice(0, i).join("")); }
    return { text, meta: { model: "fake" } };
  };
}
const NARR = {
  zh: "你在棋盘对面坐下，执红先行。棋子一粒粒落下，陈阿姨出手很快，几步之后你的一只马就被她吃了。一盘下完，日头已经爬高，窗外晒得发白。",
  en: "You sit down across the chessboard and take red. The pieces click down one by one; Mdm Chan moves fast, and a few moves in she has taken one of your horses. By the time the game ends the sun is high and it is glaring white outside the window."
};
const narrations = (res) => res.items.filter((e) => e.kind === "narration");

// ---------------- 重复的叙述 ----------------
for (const lang of ["zh", "en"]) {
  test(`GM 重给时照抄了已经生效的叙述和推进时间：只算一次，调用记录里标出来（${lang}）`, async () => {
    const s = downstairs(lang), st = s.state;
    const slot = st.time.slot;
    // 第一次：坐到棋盘那一格（有家具）没通过；重给：按"其余照旧"把整段又写了一遍
    const llm = fake({
      gm: (ctx, n) => ({ ops: [{ op: "move", x: n === 1 ? 5 : 6, y: 3 }, { op: "narrate", text: NARR[lang] }, { op: "advance_time", slots: 1 }], responders: ["chen"] }),
      character: { speak: lang === "en" ? "Your horse is gone, lah." : "哈，你隻马冇咗，仲想点？", gloss: lang === "en" ? null : "哈，你的马没了，还想怎样？" }
    });
    const res = await Turn.playerTurn(s, lang === "en" ? "Play chess with Mdm Chan for a while" : "与陈阿姨对弈一段时间", { llm, to: "gm" });
    assert.equal(narrations(res).length, 1, JSON.stringify(res.items.map((e) => e.summary)));
    assert.equal(st.time.slot, slot + 1, "时间只推一段");
    assert.deepEqual([st.actors.player.x, st.actors.player.y], [6, 3]);
    const retry = res.calls.find((c) => /重给|retrying/.test(c.label));
    assert.deepEqual(retry.results.map((r) => [r.op, r.ok, !!r.skipped]), [["move", true, false], ["narrate", true, true], ["advance_time", true, true]]);
    // 重试提示词不再前后矛盾：不叫它"整段重给、其余照旧"，并告诉它哪些已经生效
    assert.doesNotMatch(retry.user, /完整的 JSON|whole JSON/);
    assert.match(retry.user, lang === "en" ? /already taken effect/ : /已经生效了/);
  });
}

test("叙述说陈阿姨走了、重给时补了 leave 又把叙述抄了一遍：叙述一次，人离开地图", async () => {
  const s = downstairs(), st = s.state;
  const text = "陈阿姨把棋盒夹在腋下，往巴刹的方向走去。";
  const llm = fake({ gm: (ctx, n) => (n === 1 ? { ops: [{ op: "narrate", text }], responders: [] } : { ops: [{ op: "leave", actor: "chen", to: "去巴刹" }, { op: "narrate", text }] }) });
  const res = await Turn.playerTurn(s, "陈阿姨要去哪？", { llm, to: "gm" });
  assert.equal(narrations(res).length, 1);
  assert.equal(st.actors.chen.map, null);
});

test("重给时把检定也抄了一遍：不再掷第二次", async () => {
  const s = downstairs(), st = s.state;
  const roll = { op: "roll", dc: 5, reason: "说服陈阿姨让你执红", on_success: [{ op: "narrate", text: "陈阿姨把红子推到你这边。" }], on_failure: [{ op: "narrate", text: "陈阿姨把红子留在自己这边。" }] };
  const llm = fake({ gm: (ctx, n) => (n === 1 ? { ops: [roll, { op: "move", x: 5, y: 3 }], responders: [] } : { ops: [roll, { op: "move", x: 6, y: 3 }] }) });
  const res = await Turn.playerTurn(s, "我想执红", { llm, to: "gm" });
  assert.equal(res.items.filter((e) => e.kind === "roll").length, 1);
  assert.equal(narrations(res).length, 1);
  assert.deepEqual([st.actors.player.x, st.actors.player.y], [6, 3]);
});

test("第一次的叙述没过设定门，重给的新叙述照常写进去", async () => {
  const s = downstairs();
  const llm = fake({ gm: (ctx, n) => (n === 1 ? { ops: [{ op: "narrate", text: "陈阿姨心里的张力很大。" }], responders: [] } : { ops: [{ op: "narrate", text: "陈阿姨捏着一枚棋子，半天没落下去。" }] }) });
  const res = await Turn.playerTurn(s, "看看陈阿姨", { llm, to: "gm" });
  assert.deepEqual(narrations(res).map((e) => e.summary), ["陈阿姨捏着一枚棋子，半天没落下去。"]);
});

test("重给的叙述有没有新东西", () => {
  // 一样、只差标点、整段都在已经显示的那段里：没有
  assert.ok(Turn.repeats("你在棋桌对面坐下。", "你在棋桌对面坐下"));
  assert.ok(Turn.repeats(NARR.zh, NARR.zh.replace("执红先行。", "执红先行，")));
  assert.ok(Turn.repeats(NARR.en, NARR.en.replace("one by one;", "one by one,")));
  assert.ok(Turn.repeats(NARR.zh, "棋子一粒粒落下，陈阿姨出手很快"));
  // 反过来（已经显示的那段在重给的里面，后面接着写了新的）不算：由 dedupe 去掉旧的那段
  assert.ok(!Turn.repeats("陈阿姨点了点头，没有说话。", "陈阿姨点了点头，没有说话。过了一会儿，她说起了七十年代搬进来的那年。"));
  assert.ok(!Turn.repeats("好。", "好的，我们走。"));
  assert.ok(!Turn.repeats("你在棋桌对面坐下。", "陈阿姨把棋盒收了起来。"));
  assert.ok(!Turn.repeats("", ""));
  // 检定的原因：差一个句号、换一个近义的词，算同一个
  assert.ok(Turn.similar("说服陈阿姨让你执红", "说服陈阿姨让你执红。"));
  assert.ok(Turn.similar("Persuade Mdm Chan to let you take red", "Persuade Mdm Chan to let you play red"));
  assert.ok(!Turn.similar("说服陈阿姨让你执红", "看林伟明在不在家"));
});

test("重给时把已经显示的叙述抄在前面、后面接着写了新的：只写新的那部分（审查时找到）", async () => {
  for (const lang of ["zh", "en"]) {
    const s = downstairs(lang);
    const shown = lang === "en" ? "Mdm Chan nods and says nothing." : "陈阿姨点了点头，没有说话。";
    const more = lang === "en" ? "After a while she talks about the year they moved in, back in the seventies." : "过了一会儿，她说起了七十年代搬进来的那年。";
    const bad = lang === "en" ? "The tension in her is huge." : "她心里的张力很大。";
    const llm = fake({ gm: (ctx, n) => (n === 1 ? { ops: [{ op: "narrate", text: shown }, { op: "narrate", text: bad }], responders: [] } : { ops: [{ op: "narrate", text: shown + (lang === "en" ? " " : "") + more }] }) });
    const res = await Turn.playerTurn(s, lang === "en" ? "Where did Mdm Chan live before?" : "陈阿姨以前住哪？", { llm, to: "gm" });
    assert.deepEqual(narrations(res).map((e) => e.summary), [shown, more], lang);
    const retry = res.calls.find((c) => /重给|retrying/.test(c.label));
    assert.equal(retry.results[0].trimmed, true);
  }
});

test("重给时把已经显示的几段合成一段：不再写；差个标点接着写新的：只写新的；夹在中间：整段照写，不剪开（第二次审查时找到）", async () => {
  const A = "陈阿姨点了点头，没有说话。", B = "风从走廊那头吹过来，棋盘上的纸被掀起一角。";
  const run = async (retryText, lang) => {
    const s = downstairs(lang);
    const llm = fake({ gm: (ctx, n) => (n === 1 ? { ops: [{ op: "narrate", text: A }, { op: "narrate", text: B }, { op: "move", x: 5, y: 3 }], responders: [] } : { ops: [{ op: "narrate", text: retryText }, { op: "move", x: 6, y: 3 }] }) });
    const res = await Turn.playerTurn(s, "陪陈阿姨坐一会儿", { llm, to: "gm" });
    return { got: narrations(res).map((e) => e.summary), retry: res.calls.find((c) => /重给|retrying/.test(c.label)).results[0] };
  };
  // A+B 合成一段，没有新的：不写
  let r = await run(A + B);
  assert.deepEqual(r.got, [A, B]);
  assert.equal(r.retry.skipped, true);
  // A+B 后面接着写了新的：只写新的
  r = await run(A + B + "她把红子推到你这边。");
  assert.deepEqual(r.got, [A, B, "她把红子推到你这边。"]);
  assert.equal(r.retry.trimmed, true);
  // A 的句号换成逗号再接着写：也只写新的
  r = await run("陈阿姨点了点头，没有说话，过了一会儿，她说起了七十年代搬进来的那年。");
  assert.deepEqual(r.got, [A, B, "过了一会儿，她说起了七十年代搬进来的那年。"]);
  // 引号收尾：开头的那段连同它的引号一起去掉
  const Q = "陈阿姨说：“落子无悔。”";
  const s2 = downstairs();
  const llm2 = fake({ gm: (ctx, n) => (n === 1 ? { ops: [{ op: "narrate", text: Q }, { op: "move", x: 5, y: 3 }], responders: [] } : { ops: [{ op: "narrate", text: Q + "她把棋盘转了个方向。" }, { op: "move", x: 6, y: 3 }] }) });
  const res2 = await Turn.playerTurn(s2, "下一盘", { llm: llm2, to: "gm" });
  assert.deepEqual(narrations(res2).map((e) => e.summary), [Q, "她把棋盘转了个方向。"]);
  // 已经显示的那段夹在新写的中间：整段照写（重复一句），不把它从中间剪开
  r = await run("你搬来一张矮凳坐下。回头看时，" + A + "她把红子推到你这边。");
  assert.deepEqual(r.got, [A, B, "你搬来一张矮凳坐下。回头看时，" + A + "她把红子推到你这边。"]);
  assert.ok(!r.retry.skipped && !r.retry.trimmed);
});

test("英文：句号换成分号接着写，只写新的；夹在中间的整段照写（第二次审查时找到）", async () => {
  const shown = "Mdm Chan nods and says nothing.";
  const run = async (retryText) => {
    const s = downstairs("en");
    const llm = fake({ gm: (ctx, n) => (n === 1 ? { ops: [{ op: "narrate", text: shown }, { op: "move", x: 5, y: 3 }], responders: [] } : { ops: [{ op: "narrate", text: retryText }, { op: "move", x: 6, y: 3 }] }) });
    const res = await Turn.playerTurn(s, "Sit with Mdm Chan for a while", { llm, to: "gm" });
    return narrations(res).map((e) => e.summary);
  };
  assert.deepEqual(await run("Mdm Chan nods and says nothing; after a while she talks about the year they moved in."), [shown, "after a while she talks about the year they moved in."]);
  const mid = "When you sit back down, Mdm Chan nods and says nothing. She pushes the red pieces over to you.";
  assert.deepEqual(await run(mid), [shown, mid]);
});

test("重给时改好了第一次没通过的那条检定（原因只差一个词）：照常掷，不当成重复（第二次审查时找到）", async () => {
  const s = downstairs("en");
  const lim = { op: "roll", dc: 10, reason: "Listen at the Lim family's door", on_success: [{ op: "narrate", text: "You hear a radio inside." }], on_failure: [{ op: "narrate", text: "You hear nothing." }] };
  const tan = (dc) => ({ op: "roll", dc, reason: "Listen at the Tan family's door", on_success: [{ op: "narrate", text: "Someone is arguing about money." }], on_failure: [{ op: "narrate", text: "The flat is quiet." }] });
  assert.ok(Turn.similar(lim.reason, tan(12).reason), "两个原因按字看确实差不多");
  const llm = fake({ gm: (ctx, n) => (n === 1 ? { ops: [lim, tan(30)], responders: [] } : { ops: [tan(12)] }) });
  const res = await Turn.playerTurn(s, "I want to listen at both doors", { llm, to: "gm" });
  assert.equal(res.items.filter((e) => e.kind === "roll").length, 2);
  // 原因差不多、难度也一样、又不是在改没通过的那条：算重复
  const s2 = downstairs("en");
  const red = (reason) => ({ op: "roll", dc: 8, reason, on_success: [{ op: "narrate", text: "Mdm Chan slides the red pieces to you." }], on_failure: [{ op: "narrate", text: "Mdm Chan keeps red." }] });
  const llm2 = fake({ gm: (ctx, n) => (n === 1 ? { ops: [red("Persuade Mdm Chan to let you take red"), { op: "move", x: 5, y: 3 }], responders: [] } : { ops: [red("Persuade Mdm Chan to let you play red"), { op: "move", x: 6, y: 3 }] }) });
  const res2 = await Turn.playerTurn(s2, "Can I play red?", { llm: llm2, to: "gm" });
  assert.equal(res2.items.filter((e) => e.kind === "roll").length, 1);
});

test("重给时检定的原因多了个句号：还是不再掷（审查时找到）", async () => {
  const s = downstairs(), st = s.state;
  const roll = (reason) => ({ op: "roll", dc: 5, reason, on_success: [{ op: "narrate", text: "陈阿姨把红子推到你这边。" }], on_failure: [{ op: "narrate", text: "陈阿姨把红子留在自己这边。" }] });
  const llm = fake({ gm: (ctx, n) => (n === 1 ? { ops: [roll("说服陈阿姨让你执红"), { op: "move", x: 5, y: 3 }], responders: [] } : { ops: [roll("说服陈阿姨让你执红。"), { op: "move", x: 6, y: 3 }] }) });
  const res = await Turn.playerTurn(s, "我想执红", { llm, to: "gm" });
  assert.equal(res.items.filter((e) => e.kind === "roll").length, 1);
  assert.equal(narrations(res).length, 1);
  // 叙述是检定分支里写的：重试说明也要说玩家已经看到了
  const retry = res.calls.find((c) => /重给/.test(c.label));
  assert.match(retry.user, /那段叙述玩家已经看到了/);
  assert.deepEqual([st.actors.player.x, st.actors.player.y], [6, 3]);
});

test("GM 的重试说明：只要改好的那几条，叙述已经给玩家看了（中英一致）", () => {
  const zh = P.gmRetryNote(["move：有家具"], ["narrate", "advance_time"], "zh");
  assert.match(zh, /只输出改好的那几条/);
  assert.match(zh, /narrate、advance_time/);
  assert.match(zh, /玩家看过的叙述也不要换个说法再写一遍/);
  assert.doesNotMatch(zh, /完整的 JSON|其余照旧/);
  const en = P.gmRetryNote(["move: furniture"], ["narrate", "advance_time"], "en");
  assert.match(en, /only the fixed ops/);
  assert.match(en, /narrate, advance_time/);
  assert.doesNotMatch(en, /whole JSON|everything else unchanged/);
  // 叙述是检定分支里写的：按 told 说
  assert.match(P.gmRetryNote(["move：有家具"], ["roll"], "zh", true), /那段叙述玩家已经看到了/);
  assert.match(P.gmRetryNote(["move: furniture"], ["roll"], "en", true), /already read that narration/);
  // 什么都没通过：不说"其余的已经生效"
  assert.doesNotMatch(P.gmRetryNote(["x"], [], "zh"), /其余的/);
  assert.doesNotMatch(P.gmRetryNote(["x"], [], "en"), /The rest/);
});

// ---------------- 读没写完的 JSON ----------------
const FULL = '```json\n{"ops":[{"op":"move","x":7,"y":3},{"op":"narrate","text":"你在棋桌对面坐下，\\"执红\\"先行。\\u4e00盘下完。"},{"op":"roll","dc":10,"reason":"r","on_success":[{"op":"narrate","text":"赢了"}]},{"text":"好","op":"gm_reply"},{"op":"advance_time","slots":1}],"responders":["chen"]}\n```';

test("读没写完的 JSON：只拿最外层的叙述，字一个个多起来，写完的标 done", () => {
  let last = [];
  for (let k = 0; k <= FULL.length; k++) {
    const v = St.visible(FULL.slice(0, k), { gmReply: true });
    // 只会变长，不会缩回去，也不会换内容
    for (let i = 0; i < last.length; i++) assert.ok(v[i] && v[i].text.startsWith(last[i].text) && (!last[i].done || v[i].done), `第 ${k} 个字时变了`);
    last = v;
  }
  assert.deepEqual(last, [{ kind: "narrate", text: '你在棋桌对面坐下，"执红"先行。一盘下完。', done: true }, { kind: "gm_reply", text: "好", done: true }]);
  // 检定分支里的叙述不放；对住户说的那一轮 gm_reply 不放
  assert.deepEqual(St.visible(FULL).map((x) => x.kind), ["narrate"]);
  // 没写完的转义不露出来
  assert.equal(St.visible('{"ops":[{"op":"narrate","text":"一\\u4e')[0].text, "一");
  assert.equal(St.visible('{"ops":[{"op":"narrate","text":"一\\')[0].text, "一");
  // "op" 还没写完、不是 JSON、空的：什么都不放
  assert.deepEqual(St.visible('{"ops":[{"op":"narr'), []);
  assert.deepEqual(St.visible("不是 JSON"), []);
  assert.deepEqual(St.visible(""), []);
  assert.deepEqual(St.readPartial('{"a":[1,2,{"b":"c').value, { a: [1, 2, { b: "c" }] });
});

test("先放出来之前过设定门：没写完的留几个字不放；过不了的那段从此不放", () => {
  const shows = [];
  const st = downstairs().state;
  const on = St.viewer({ lang: "zh", check: (t) => H.leakCheck(st, t), show: (l) => shows.push(l) });
  const text = '{"ops":[{"op":"narrate","text":"陈阿姨捏着一枚棋子。她心里的张力很大，半天没落下去。"},{"op":"narrate","text":"风从走廊吹过来。"}]}';
  const cs = Array.from(text);
  for (let i = 1; i <= cs.length; i++) on(cs.slice(0, i).join(""));
  const seen = shows.flat().map((x) => x.text).join("\n");
  assert.doesNotMatch(seen, /张力/);
  // 第一段过不了，最后只剩第二段
  assert.deepEqual(shows[shows.length - 1], [{ kind: "narrate", text: "风从走廊吹过来。", done: true }]);
  // 英文：没写完的半个词不拿去查（"tension" 后面还有 "s"），写完的 tensions 不算元语言，不该被拦（审查时找到）
  const shownEn = [];
  const stEn = downstairs("en").state;
  const onEn = St.viewer({ lang: "en", check: (t) => H.leakCheck(stEn, t), show: (l) => shownEn.push(l) });
  const en = '{"ops":[{"op":"narrate","text":"You sit down across the chess table from Mdm Chan. She moves quickly, and everyone knows the tensions in the Lim flat are none of her business today."}]}';
  assert.equal(H.leakCheck(stEn, "everyone knows the tensions"), null);
  const at = en.indexOf("tensions") + "tension".length;
  onEn(en.slice(0, at));
  onEn(en);
  assert.ok(shownEn.every((l) => l.length === 1), JSON.stringify(shownEn));
  // 出戏回答和 Harness 一样最多 600 个字符（审查时找到：原来按 1200 放，写进世界只有 600）
  const long = "好".repeat(730);
  const shownGm = [];
  St.viewer({ lang: "zh", gmReply: true, show: (l) => shownGm.push(l) })('{"ops":[{"op":"gm_reply","text":"  ' + long + '"}]}');
  assert.equal(shownGm[0][0].text.length, 600);
  // 没写完时留后面 12 个字
  assert.equal(St.holdBack("一二三四五六七八九十一二三四五", "zh"), "一二三");
  assert.equal(St.holdBack("短", "zh"), "");
  assert.equal(St.holdBack("You sit down across the chess table and take red, then she moves.", "en"), "You sit down");
});

// ---------------- 一轮里的流式 ----------------
test("流式：GM 写的时候一段段交给界面，操作做完就收掉；重给那次不流式，叙述只有一段", async () => {
  const s = downstairs();
  const log = [], shown = [];
  const llm = fake({
    gm: (ctx, n) => ({ ops: [{ op: "move", x: n === 1 ? 5 : 6, y: 3 }, { op: "narrate", text: NARR.zh }, { op: "advance_time", slots: 1 }], responders: [] })
  }, log);
  const res = await Turn.playerTurn(s, "与陈阿姨对弈一段时间", { llm, to: "gm", onStream: (l) => { shown.push(l); log.push({ stream: l === null ? "end" : l.length }); } });
  assert.deepEqual(log.filter((x) => x.call).map((x) => x.streamed), [true, false]);
  // 收掉（null）在重给那次调用之前
  const end = log.findIndex((x) => x.stream === "end"), retry = log.findIndex((x) => x.call && /重给/.test(x.call));
  assert.ok(end >= 0 && end < retry, JSON.stringify(log.map((x) => x.call || x.stream)));
  assert.equal(shown.filter((l) => l === null).length, 1);
  const texts = shown.filter(Boolean).flat().map((x) => x.text);
  assert.ok(texts.length > 5);
  assert.equal(texts[texts.length - 1], NARR.zh);
  assert.equal(narrations(res).length, 1);
});

test("流式：不是合法 JSON、重新追问的那次不流式，先放的那段在追问之前就收掉（审查时找到）", async () => {
  const s = downstairs();
  const log = [], shown = [];
  const llm = fake({ gm: (ctx, n) => (n === 1 ? '{"ops":[{"op":"narrate","text":"陈阿姨抬起头看了你一眼，把棋盘往你这边推了推。"}]} 好的' + "}" : { ops: [{ op: "narrate", text: "陈阿姨抬头看了你一眼。" }], responders: [] }) }, log);
  const res = await Turn.playerTurn(s, "看看四周", { llm, to: "gm", onStream: (l) => { shown.push(l); log.push({ stream: l === null ? "end" : l.length }); } });
  assert.deepEqual(log.filter((x) => x.call).map((x) => x.streamed), [true, false]);
  const end = log.findIndex((x) => x.stream === "end"), again = log.findIndex((x) => x.call && /JSON/.test(x.call));
  assert.ok(end >= 0 && end < again, JSON.stringify(log.map((x) => x.call || x.stream)));
  assert.equal(shown[shown.length - 1], null);
  assert.deepEqual(narrations(res).map((e) => e.summary), ["陈阿姨抬头看了你一眼。"]);
});

test("流式关掉（不给 onStream）：调用里没有 onText", async () => {
  const s = downstairs();
  const log = [];
  await Turn.playerTurn(s, "看看四周", { llm: fake({ gm: { ops: [{ op: "narrate", text: "四周很安静。" }], responders: [] } }, log), to: "gm" });
  assert.deepEqual(log.map((x) => x.streamed), [false]);
});

test("离线演示也能流式：几个字一段交出去，最后一段是全文", async () => {
  const s = downstairs();
  const got = [];
  const r = await Mock.caller({ delay: 0 })({ role: "gm", label: "GM", system: "", user: "", onText: (t) => got.push(t), ctx: { state: s.state, toGM: true, to: "gm", input: "看看四周" } });
  assert.ok(got.length > 3);
  assert.equal(got[got.length - 1], r.text);
  const res = await Turn.playerTurn(s, "看看四周", { llm: Mock.caller({ delay: 0 }), to: "gm", onStream: () => {} });
  // GM 写的那句只有一次（陈阿姨自己的动作也是一段叙述，不算在内）
  assert.equal(narrations(res).filter((e) => /看了看四周/.test(e.summary)).length, 1);
});

// ---------------- 接口的流 ----------------
// 把一段 SSE 拆成很碎的几块（故意从多字节的汉字中间、从行中间切开）
function sseResponse(events, opts) {
  const raw = Buffer.from(events.map((e) => (typeof e === "string" ? e : `event: ${e.type || "message"}\ndata: ${JSON.stringify(e)}`) + "\n\n").join(""));
  const chunks = [];
  for (let i = 0; i < raw.length; i += 7) chunks.push(raw.subarray(i, i + 7));
  const body = new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new Uint8Array(x)); c.close(); } });
  return new Response(body, { status: (opts && opts.status) || 200, headers: { "content-type": "text/event-stream" } });
}
function withFetch(fn, impl) {
  const saved = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return impl(calls.length, JSON.parse(init.body)); };
  return fn(calls).finally(() => { globalThis.fetch = saved; });
}

test("Anthropic 流式：拼出全文、边收边回调、用量（含缓存）照样有", () => withFetch(async (calls) => {
  const got = [];
  const r = await LLM.caller({ provider: "anthropic", apiKey: "k" })({ role: "gm", label: "GM", system: "S", user: "U", onText: (t) => got.push(t) });
  assert.equal(calls[0].body.stream, true);
  assert.equal(r.text, '{"ops":[{"op":"narrate","text":"你在棋桌对面坐下。"}]}');
  assert.ok(got.length >= 2);
  assert.equal(got[got.length - 1], r.text);
  assert.deepEqual(r.meta.usage, { input_tokens: 12, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, output_tokens: 31 });
  assert.equal(r.meta.truncated, false);
  assert.equal(r.meta.model, "claude-sonnet-5-5");
}, () => sseResponse([
  { type: "message_start", message: { model: "claude-sonnet-5-5", usage: { input_tokens: 12, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "ping" },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '{"ops":[{"op":"narrate","text":"你在棋' } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '桌对面坐下。"}]}' } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 31, input_tokens: null } },
  { type: "message_stop" }
])));

test("Anthropic 流式：流里报错就整轮报错；没开流式就照旧一次拿完", async () => {
  await withFetch(async () => {
    await assert.rejects(LLM.caller({ provider: "anthropic", apiKey: "k" })({ system: "S", user: "U", onText: () => {} }), /Overloaded/);
  }, () => sseResponse([{ type: "message_start", message: { usage: { input_tokens: 1 } } }, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]));
  await withFetch(async (calls) => {
    const r = await LLM.caller({ provider: "anthropic", apiKey: "k" })({ system: "S", user: "U" });
    assert.equal(calls[0].body.stream, undefined);
    assert.equal(r.text, "{}");
  }, () => new Response(JSON.stringify({ content: [{ type: "text", text: "{}" }], usage: { input_tokens: 3, output_tokens: 1 }, stop_reason: "end_turn" }), { status: 200, headers: { "content-type": "application/json" } }));
});

test("OpenAI 兼容流式：拼出全文、[DONE] 跳过、最后一块里的用量；接口不认流式参数就退回不流式", async () => {
  await withFetch(async (calls) => {
    const got = [];
    const r = await LLM.caller({ provider: "openai", apiKey: "k" })({ system: "S", user: "U", onText: (t) => got.push(t) });
    assert.equal(calls[0].body.stream, true);
    assert.deepEqual(calls[0].body.stream_options, { include_usage: true });
    assert.equal(r.text, '{"ops":[]}');
    assert.deepEqual(got, ['{"ops"', '{"ops":[]}']);
    assert.deepEqual(r.meta.usage, { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55, prompt_cache_hit_tokens: 40 });
  }, () => sseResponse([
    { model: "deepseek-chat", choices: [{ index: 0, delta: { role: "assistant", content: "" } }] },
    { model: "deepseek-chat", choices: [{ index: 0, delta: { content: '{"ops"' } }] },
    { model: "deepseek-chat", choices: [{ index: 0, delta: { content: ":[]}" }, finish_reason: "stop" }] },
    { model: "deepseek-chat", choices: [], usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55, prompt_cache_hit_tokens: 40 } },
    "data: [DONE]"
  ]));
  await withFetch(async (calls) => {
    const got = [];
    const r = await LLM.caller({ provider: "openai", apiKey: "k" })({ system: "S", user: "U", onText: (t) => got.push(t) });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.stream, undefined);
    assert.equal(r.text, "{}");
    assert.deepEqual(got, ["{}"]);
  }, (n) => (n === 1 ? new Response(JSON.stringify({ error: { message: "unknown field stream_options" } }), { status: 400 }) : new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }), { status: 200 })));
  // 别的错（比如 Key 不对）不重发
  await withFetch(async (calls) => {
    await assert.rejects(LLM.caller({ provider: "openai", apiKey: "k" })({ system: "S", user: "U", onText: () => {} }), /HTTP 401/);
    assert.equal(calls.length, 1);
  }, () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 }));
});

test("界面那边的回调出错，不影响这次调用", () => withFetch(async () => {
  const r = await LLM.caller({ provider: "anthropic", apiKey: "k" })({ system: "S", user: "U", onText: () => { throw new Error("boom"); } });
  assert.equal(r.text, "{}");
}, () => sseResponse([{ type: "content_block_delta", delta: { type: "text_delta", text: "{}" } }, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }])));

test("网页内置的 Claude：onText 交给 sample，拿全文", async () => {
  let opts = null;
  const sample = async (input, o) => { opts = o; o.onText({ text: "{", delta: "{" }); o.onText({ text: "{}", delta: "}" }); return { text: "{}", truncated: false, modelApplied: "claude-sonnet-5-5" }; };
  sample.limits = async () => ({ maxPromptBytes: 262144 });
  globalThis.window = { claude: { use: async () => sample } };
  try {
    const got = [];
    const r = await LLM.caller({ provider: "claude_page" })({ system: "S", user: "U", onText: (t) => got.push(t) });
    assert.deepEqual(got, ["{", "{}"]);
    assert.equal(r.text, "{}");
    assert.equal(opts.cache, false);
  } finally { delete globalThis.window; }
});
