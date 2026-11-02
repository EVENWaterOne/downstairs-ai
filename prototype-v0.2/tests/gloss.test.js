// 翻译（10-29 Polaris："每个人说话至少得让人看得懂"）：
// 住户的台词里有方言或外语时，住户自己在 gloss 里给整句翻译；没给、这句话又看着难懂，就由 GM 补一句。
const test = require("node:test");
const assert = require("node:assert/strict");
const { W, H, API, B, D, P, Mock, Turn } = require("./load");

function game(lang) {
  const s = API.createSession({ lang });
  D.begin(s.state);
  return s;
}
function nextTo(state, id) {
  const a = state.actors[id];
  for (const [dx, dy] of B.DIRS) {
    if (B.free(state, a.map, a.x + dx, a.y + dy, "player") && !B.exitAt(a.map, a.x + dx, a.y + dy)) {
      Object.assign(state.actors.player, { map: a.map, x: a.x + dx, y: a.y + dy });
      return;
    }
  }
  throw new Error("no free cell next to " + id);
}
// 第一天早上在楼下、会说话的人
function talker(state) {
  const id = W.charactersAt(state.time.year).find((x) => state.actors[x].map && W.canTalk(x, state.time.year));
  nextTo(state, id);
  return id;
}

test("看不懂的判断：广东话、整句马来语、整句英文（中文局）要翻译；夹几个词、人名不算", () => {
  const zh = game("zh").state, en = game("en").state;
  for (const t of ["后生仔，又系拿表格来嘅？坐啦，坐低先。", "你识唔识捉棋？", "Duduk, duduk。", "Dulu kampung tak macam ni.", "Boss，ok ok，no problem。"]) assert.ok(H.needsGloss(zh, t), t);
  for (const t of ["Hello！我妈妈在里面。", "Kumar uncle 会补车胎的。", "Tak payah，不用麻烦你们。", "有些地方 residents only，我们不能进去坐。", "唔，好吧。", "早晨，陈阿姨。"]) assert.ok(!H.needsGloss(zh, t), t);
  for (const t of ["Duduk, duduk.", "Dulu kampung tak macam ni.", "吃饱了吗？"]) assert.ok(H.needsGloss(en, t), t);
  for (const t of ["Come, come, makan dulu, eat something first.", "Never mind lah.", "Tak payah, no need to trouble yourselves."]) assert.ok(!H.needsGloss(en, t), t);
});

test("规则层：台词带翻译就记在这句话上；翻译同样过设定门；GM 只能给住户的话补翻译，补过就不能再补", () => {
  for (const lang of ["zh", "en"]) {
    const s = game(lang), state = s.state, id = talker(state);
    const r = H.applyOp(state, { op: "speak", npc: id, text: "Duduk, duduk.", gloss: lang === "en" ? "Sit, sit." : "坐，坐。" }, { by: "character" });
    assert.ok(r.ok, r.reason);
    assert.equal(r.event.gloss, lang === "en" ? "Sit, sit." : "坐，坐。");
    // 翻译里点题，整句不说
    const bad = H.applyOp(state, { op: "speak", npc: id, text: "Duduk.", gloss: lang === "en" ? "My tension is obvious." : "我的张力很明显。" }, { by: "character" });
    assert.equal(bad.ok, false);
    // GM 补翻译
    const plain = H.applyOp(state, { op: "speak", npc: id, text: "Dulu kampung tak macam ni." }, { by: "character" }).event;
    assert.equal(plain.gloss, undefined);
    assert.ok(H.applyOp(state, { op: "gloss", event: plain.id, text: "x" }, { by: "gm" }).ok);
    const again = H.applyOp(state, { op: "gloss", event: plain.id, text: "y" }, { by: "gm" });
    assert.equal(again.ok, false);
    const narr = H.applyOp(state, { op: "narrate", text: lang === "en" ? "Rain." : "下雨了。" }, { by: "system" }).event;
    const notSpeech = H.applyOp(state, { op: "gloss", event: narr.id, text: "x" }, { by: "gm" });
    assert.equal(notSpeech.ok, false);
    if (lang === "en") assert.ok(!/\p{Script=Han}/u.test(again.reason + notSpeech.reason), again.reason + notSpeech.reason);
    // 住户不能自己调 gloss 操作
    assert.equal(H.applyOp(state, { op: "gloss", event: plain.id, text: "z" }, { by: "character" }).ok, false);
  }
});

test("住户的提示词要它给翻译；别人听到的那句话带着翻译", () => {
  for (const lang of ["zh", "en"]) {
    const s = game(lang), state = s.state, id = talker(state);
    const p = P.characterPrompt(state, id, { input: "hi", turnEvents: [] });
    assert.ok(p.system.includes('"gloss":null'), lang);
    const e = H.applyOp(state, { op: "speak", npc: id, text: "Duduk, duduk.", gloss: lang === "en" ? "Sit, sit." : "坐，坐。" }, { by: "character" }).event;
    assert.match(P.eventLine(state, e), lang === "en" ? /\(meaning: Sit, sit\.\)/ : /（意思是：坐，坐。）/);
  }
});

test("一轮：住户给了翻译就不多调用；没给而这句话难懂，GM 补一句", async () => {
  for (const lang of ["zh", "en"]) {
    // 给了翻译
    let s = game(lang), id = talker(s.state);
    let calls = [];
    const gave = async (call) => { calls.push(call); return { text: JSON.stringify(call.role === "gm" ? { ops: [], responders: [id] } : { speak: "Duduk, duduk.", gloss: lang === "en" ? "Sit, sit." : "坐，坐。" }) }; };
    let res = await Turn.playerTurn(s, "hi", { llm: gave, focus: id });
    assert.equal(calls.length, 2, lang);
    assert.ok(res.items.find((e) => e.kind === "speech").gloss);
    // 没给翻译
    s = game(lang); id = talker(s.state); calls = [];
    const forgot = async (call) => {
      calls.push(call);
      if (call.ctx && call.ctx.translate) return { text: JSON.stringify({ gloss: lang === "en" ? "Sit, sit." : "坐，坐。" }) };
      return { text: JSON.stringify(call.role === "gm" ? { ops: [], responders: [id] } : { speak: "Duduk, duduk." }) };
    };
    const phases = [];
    res = await Turn.playerTurn(s, "hi", { llm: forgot, focus: id, onStatus: (ph) => phases.push(ph) });
    assert.equal(calls.length, 3, lang);
    assert.ok(phases.includes("translate"));
    assert.equal(res.items.find((e) => e.kind === "speech").gloss, lang === "en" ? "Sit, sit." : "坐，坐。");
    assert.ok(!/\p{Script=Han}/u.test(lang === "en" ? calls[2].system + calls[2].user + calls[2].label : ""));
    // 普通的话不翻译，也不多调用
    s = game(lang); id = talker(s.state); calls = [];
    const plain = async (call) => { calls.push(call); return { text: JSON.stringify(call.role === "gm" ? { ops: [], responders: [id] } : { speak: lang === "en" ? "Morning. Eaten already?" : "早晨，吃了吗？" }) }; };
    res = await Turn.playerTurn(s, "hi", { llm: plain, focus: id });
    assert.equal(calls.length, 2, lang);
  }
});

test("离线演示：看着难懂的台词都带翻译，翻译本身看得懂、过得了设定门", () => {
  for (const [lang, LINES] of [["zh", Mock.LINES], ["en", Mock.LINES_EN]]) {
    const state = game(lang).state;
    for (const [id, lines] of Object.entries(LINES)) for (const l of lines) {
      if (H.needsGloss(state, l.speak)) assert.ok(l.gloss, `${lang} ${id}: ${l.speak}`);
      if (l.gloss) {
        assert.ok(!H.needsGloss(state, l.gloss), l.gloss);
        assert.equal(H.leakCheck(state, l.gloss), null, l.gloss);
      }
    }
  }
});
