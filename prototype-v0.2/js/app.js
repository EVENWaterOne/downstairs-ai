/* 界面（M2）：顶栏是日子和时间，左边是平面图和对话，右边是写字板（游戏端模拟 / 你知道的事 / 调用记录）。
 * 规则都在别的文件里，这里只管显示和把玩家的操作交给它们。
 * 中文和英文两套界面：界面上的字都经过 t(中文, 英文)；设定里的字用 L(对象)。换语言会从第一天重来。
 * 11-02 流式输出：设置里打开时（默认打开），GM 写叙述的时候就一段段显示在对话最下面（ui.streaming），写完、校验过再换成真正的事件。 */
(function () {
  "use strict";
  const W = window.V2World, M = window.V2Maps, H = window.V2Harness, S = window.V2Session, Sim = window.V2Sim;
  const B = window.V2Board, D = window.V2Days, P = window.V2Prompts, LLM = window.V2LLM, Mock = window.V2Mock, Turn = window.V2Turn, R = window.V2Render, Tok = window.V2Tokens;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const LS = "emergent-trpg.v0.2.settings";

  // ---------------- 设置和身份 ----------------
  // 身份按语言各存一份：中文默认何志强，英文默认 Ho Chee Keong
  const hasPage = !!(window.claude && typeof window.claude.use === "function");
  const defaults = { lang: "zh", provider: hasPage ? "claude_page" : "mock", model: "", baseUrl: "", apiKey: "", remember: false, stream: true,
    identities: { zh: Object.assign({}, P.DEFAULT_IDENTITY), en: Object.assign({}, P.DEFAULT_IDENTITY_EN) } };
  let settings = JSON.parse(JSON.stringify(defaults));
  try {
    const saved = JSON.parse(localStorage.getItem(LS) || "{}");
    const ids = saved.identities || (saved.identity ? { zh: saved.identity } : {});
    delete saved.identity; delete saved.identities;
    Object.assign(settings, saved);
    settings.identities = { zh: Object.assign({}, P.DEFAULT_IDENTITY, ids.zh || {}), en: Object.assign({}, P.DEFAULT_IDENTITY_EN, ids.en || {}) };
  } catch (e) { /* 浏览器存储不可用时用默认值 */ }
  if (settings.lang !== "en") settings.lang = "zh";
  settings.stream = settings.stream !== false;
  const en = () => settings.lang === "en";
  const t = (zh, enText) => (en() ? enText : zh);
  const L = (o) => (o ? o[settings.lang] || o.zh || "" : "");
  const sep = () => t("、", ", ");
  const gap = () => t("　", "  ");
  const blank = () => t("　", "\u00a0");
  const identity = () => settings.identities[settings.lang];
  if (!LLM.PRESETS[settings.provider] || (settings.provider === "claude_page" && !hasPage)) settings.provider = defaults.provider;
  function saveSettings() {
    const copy = JSON.parse(JSON.stringify(settings));
    if (!copy.remember) delete copy.apiKey;
    try { localStorage.setItem(LS, JSON.stringify(copy)); } catch (e) { /* 忽略 */ }
  }

  // ---------------- 状态 ----------------
  let session = null;
  // pick：输入框对谁说。"auto" 身边有人就对人说、没人就对 GM；"say" 说出口；"gm" 对 GM 说
  // streaming：GM 正在写、还没校验的几段叙述（流式输出），null 是没有
  const ui = { focus: null, pick: "auto", thinking: new Set(), spoke: {}, busy: false, tab: "game", dayStartSeq: 0, turns: [], notes: [], walking: null, dirty: true, lastPos: "", streaming: null };
  const st = () => session.state;
  const renderer = R.createRenderer($("#map"));

  function newGame() {
    stopWalk();
    session = S.createSession({ lang: settings.lang });
    D.begin(st());
    Object.assign(ui, { focus: null, pick: "auto", thinking: new Set(), spoke: {}, busy: false, turns: [], notes: [], dayStartSeq: st().seq, streaming: null });
    staticText();
    setStatus(t("方向键或 WASD 走动，点地图上的格子走过去。点一个人，就对着他说话；想做什么、想问什么，切到“对 GM”。", "Arrow keys or WASD to walk, or tap a square on the map. Tap a person to talk to them; to do something or ask something, switch to “To GM”."));
    renderAll();
  }

  // index.html 里写死的字，按语言换掉
  function staticText() {
    document.documentElement.lang = t("zh-CN", "en");
    document.title = t("楼下的另一面", "The Other Side of Downstairs");
    const set = (sel, text, attr) => { const el = $(sel); if (!el) return; if (attr) el.setAttribute(attr, text); else el.textContent = text; };
    set("#points", t("这个十年还能花的政策点", "Policy points you can still spend this decade"), "title");
    set("#waitBtn", t("等一会儿", "Wait a while"));
    set("#waitBtn", t("过一个时段，大家会按自己的日子走动", "Let one time slot pass; everyone goes about their day"), "title");
    set("#endBtn", t("结束今天", "End the day"));
    set("#panelBtn", t("写字板", "Clipboard"));
    set("#settingsBtn", t("设置", "Settings"));
    set("#settingsBtn", t("模型和身份", "Model, identity and language"), "title");
    set("#map", t("平面图：点格子走过去，点人就对着他说话", "Floor plan: tap a square to walk there, tap a person to talk to them"), "aria-label");
    const tabs = { game: t("游戏端（模拟）", "Game (simulated)"), known: t("你知道的事", "What you know"), calls: t("调用记录", "Call log") };
    document.querySelectorAll("#tabs button").forEach((b) => { b.textContent = tabs[b.dataset.tab]; });
  }

  function caller() { return settings.provider === "mock" ? Mock.caller() : LLM.caller(settings); }
  function nameOf(id) { return id === "player" ? t("你", "You") : L(W.characterName(id)) || id; }
  function colorOf(id) { return R.HOUSE[W.householdOf(id)] || "#6b7280"; }

  // ---------------- 顶栏 ----------------
  function renderTop() {
    const s = st(), day = D.currentDay(s), list = D.daysOf(s.decade);
    $("#dayTitle").textContent = day ? L(day.title) : "";
    $("#when").textContent = H.timeLabel(s) + (day ? t(`　第 ${list.indexOf(day) + 1} / ${list.length} 天`, ` · Day ${list.indexOf(day) + 1} of ${list.length}`) : "");
    $("#slots").innerHTML = H.SLOTS.map((_, i) => `<i class="${i < s.time.slot ? "past" : i === s.time.slot ? "now" : ""}"></i>`).join("");
    const pts = s.game.points;
    $("#points").innerHTML = t("政策点 ", "Policy points ") + Array.from({ length: Sim.POINTS_PER_DECADE }, (_, i) => `<span class="dot${i < pts ? " on" : ""}"></span>`).join("");
    $("#waitBtn").disabled = ui.busy || s.time.slot >= D.LAST_SLOT;
    $("#endBtn").disabled = ui.busy;
    // 一轮还没跑完时不能打开设置（从第一天重来会让还在跑的那一轮写进新的一局）
    $("#settingsBtn").disabled = ui.busy;
    $("#endBtn").classList.toggle("primary", s.time.slot >= D.LAST_SLOT);
    $("#where").textContent = L(M.MAPS[s.actors.player.map].name);
  }

  // ---------------- 对话 ----------------
  function lineFor(e) {
    switch (e.kind) {
      case "player_input": return `<div class="line you">${esc(e.summary)}</div>`;
      // 对 GM 说的话和 GM 的出戏回答：灰色小字，和故事里的话分开（住户听不到）
      case "player_to_gm": return `<div class="line you ooc"><span class="tag">${t("对 GM", "To GM")}</span>${esc(e.summary)}</div>`;
      case "gm_reply": return `<div class="line gm"><span class="tag">GM</span>${esc(e.summary)}</div>`;
      // 有翻译的台词，翻译写在下面一行（10-29 Polaris：每个人说话至少得让人看得懂）
      case "speech": return `<div class="line speech"><span class="who" style="background:${colorOf(e.actor)}">${esc(nameOf(e.actor))}</span><span>${esc(e.summary)}${e.gloss ? `<span class="gloss">${t("意思是：", "Meaning: ")}${esc(e.gloss)}</span>` : ""}</span></div>`;
      case "narration": case "world": case "consequence": return `<div class="line narr">${esc(e.summary)}</div>`;
      case "scene": return e.summary && e.summary !== L(M.MAPS[e.map] && M.MAPS[e.map].name) ? `<div class="line narr">${esc(e.summary)}</div>` : "";
      case "action": return `<div class="line action">${esc(e.summary)}<span class="chip">${t("用了 1 个政策点", "1 policy point used")}</span></div>`;
      case "roll": return `<div class="line sys">🎲 ${esc(e.summary)}</div>`;
      case "game": return `<div class="line sys">${esc(e.summary)}</div>`;
      case "time": return `<div class="divider">${esc(L(H.SLOTS[e.time.slot]))}</div>`;
      case "reveal":
        // 障碍是游戏里看得到的图标，可以写出来；秘密和旧事不写原文（不能把设定直接说出来），只说你记住了
        if (e.reveal.kind === "barrier") return `<div class="line reveal">${t("记下了：", "Noted: ")}${esc(L(W.RESIDENTS[W.householdOf(e.actor)].name))}${gap()}${esc(e.reveal.id)} ${esc(L(W.BARRIERS[e.reveal.id]))}</div>`;
        return `<div class="line reveal">${esc(t(`你把${nameOf(e.actor)}刚才说的话记在了心里。`, `You keep what ${nameOf(e.actor)} just said in mind.`))}</div>`;
      default: return "";
    }
  }
  function renderFeed() {
    const s = st(), day = D.currentDay(s), feed = $("#feed");
    const items = s.events.filter((e) => e.seq > ui.dayStartSeq && e.perceivedBy.includes("player"));
    const when = H.timeLabel(s, items.length ? items[0].time : s.time), place = L(M.MAPS[day ? day.player.map : s.actors.player.map].name);
    const intro = `<div class="intro"><b>${esc(day ? L(day.title) : "")}</b><span>${esc(t(`${when}，你在${place}。走到人旁边跟他说话；想做什么、想问什么，对 GM 说。`, `${when}. You start at: ${place}. Walk up to someone to talk to them; to do something or ask something, tell the GM.`))}</span></div>`;
    const notes = ui.notes.filter((n) => n.seq > ui.dayStartSeq);
    const rows = [];
    let ni = 0;
    for (const e of items) {
      while (ni < notes.length && notes[ni].seq < e.seq) rows.push(noteLine(notes[ni++]));
      rows.push(lineFor(e));
    }
    while (ni < notes.length) rows.push(noteLine(notes[ni++]));
    // 正在写的那几段不给读屏念（feed 是 aria-live，每多几个字就会再念一遍）；写完换成真正的事件时再念
    feed.innerHTML = intro + rows.join("") + `<div id="streamBox" class="stream" aria-hidden="true">${streamLines()}</div>`;
    feed.scrollTop = feed.scrollHeight;
  }
  // GM 正在写的叙述：和写完的长得一样，末尾多一个光标；出戏的回答照 GM 那一行的样子
  function streamLines() {
    return (ui.streaming || []).map((it) => {
      const caret = it.done ? "" : `<span class="caret" aria-hidden="true"></span>`;
      return it.kind === "gm_reply" ? `<div class="line gm live"><span class="tag">GM</span>${esc(it.text)}${caret}</div>` : `<div class="line narr live">${esc(it.text)}${caret}</div>`;
    }).join("");
  }
  // 流式输出的回调：list 是正在写的几段；null 表示这一次写完了、操作也做完了，换成真正的事件
  function showStream(list) {
    // 写完了：GM 可能还要重给没通过的操作，状态回到"在看"
    if (list === null) { ui.streaming = null; setStatus(t("GM 在看这一轮会发生什么……", "The GM is working out what happens…")); renderFeed(); return; }
    ui.streaming = list;
    if (list.length) setStatus(t("GM 在写……", "The GM is writing…"));
    const box = $("#streamBox"), feed = $("#feed");
    if (!box) { renderFeed(); return; }
    // 玩家往上翻着看的时候不把他拉回底部
    const atEnd = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
    box.innerHTML = streamLines();
    if (atEnd) feed.scrollTop = feed.scrollHeight;
  }
  function noteLine(n) { return `<div class="line ${n.kind === "error" ? "error" : "sys"}">${esc(n.text)}</div>`; }
  function note(text, kind) { ui.notes.push({ seq: st().seq, text, kind: kind || "sys" }); }

  // 这一句对谁说（10-29 Polaris：玩家打的字都是话，要么作为角色对住户说，要么作为玩家对 GM 说）
  // 默认：对着谁或者身边有人，就对人说；身边没人，就对 GM 说
  function target() {
    const s = st(), p = s.actors.player;
    const focus = ui.focus && s.actors[ui.focus].map === p.map ? ui.focus : null;
    const near = B.adjacent(s).filter((id) => W.canTalk(id, s.time.year));
    // 手动选的只在选的那张图上算数：被 GM 挪到别处、换了一天，都回到默认
    const pick = ui.pickMap === p.map ? ui.pick : "auto";
    if (pick === "gm") return { gm: true, who: null };
    const who = focus || (near.length === 1 ? near[0] : null);
    if (pick === "say" || who || near.length) return { gm: false, who };
    return { gm: true, who: null };
  }
  function renderComposer() {
    const f = $("#focus"), tg = target();
    const person = tg.who ? t("对着 ", "To ") + esc(nameOf(tg.who)) : t("说出口", "Say aloud");
    f.className = "target";
    f.innerHTML = `<button type="button" id="toSay" class="${tg.gm ? "" : "on"}" aria-pressed="${!tg.gm}" title="${t("角色说出口的话，在场的人都听得到", "Your character speaks out loud; everyone here hears it")}">${person}</button>`
      + (ui.focus && !tg.gm ? `<button type="button" id="unfocus" class="x" aria-label="${t("不对着谁", "Talk to no one in particular")}">×</button>` : "")
      + `<button type="button" id="toGM" class="${tg.gm ? "on" : ""}" aria-pressed="${tg.gm}" title="${t("用玩家身份跟 GM 说：想做什么、问一句。住户听不到", "Speak to the GM as the player: what you want to do, or a question. Residents can't hear it")}">${t("对 GM", "To GM")}</button>`;
    $("#toSay").onclick = () => { ui.pick = "say"; ui.pickMap = st().actors.player.map; renderComposer(); $("#say").focus({ preventScroll: true }); };
    $("#toGM").onclick = () => { ui.pick = "gm"; ui.pickMap = st().actors.player.map; renderComposer(); $("#say").focus({ preventScroll: true }); };
    if ($("#unfocus")) $("#unfocus").onclick = () => { ui.focus = null; ui.dirty = true; renderComposer(); };
    $("#say").placeholder = tg.gm ? t("想做什么、想问什么（住户听不到）", "What you want to do, or a question (residents can't hear)")
      : tg.who ? t(`对${nameOf(tg.who)}说一句话`, `Say something to ${nameOf(tg.who)}`) : t("说一句话，在场的人都听得到", "Say something; everyone here can hear");
    $("#sendBtn").textContent = tg.gm ? t("告诉 GM", "Tell GM") : t("说", "Say");
    $("#say").disabled = ui.busy;
    $("#sendBtn").disabled = ui.busy;
    f.querySelectorAll("button").forEach((b) => { b.disabled = ui.busy; });
  }
  function setStatus(text) { $("#status").textContent = text; }

  // ---------------- 写字板 ----------------
  function renderPanel() {
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === ui.tab));
    const body = $("#tabbody");
    body.innerHTML = ui.tab === "game" ? gameTab() : ui.tab === "known" ? knownTab() : callsTab();
    if (ui.tab === "game") bindGame();
    if (ui.tab === "calls") $("#exportBtn").onclick = showExport;
  }

  function gameTab() {
    const sim = session.sim, year = st().time.year;
    const bars = Object.entries(W.RESIDENTS).map(([id, r]) => {
      const v = sim.satisfaction[id], here = W.livesHere(id, year);
      return `<div class="bar${here ? "" : " away"}"><span>${esc(L(r.name))}</span><span class="track"><span class="fill" style="width:${here ? v : 0}%;background:${R.HOUSE[id]}"></span></span><span class="num" title="${here ? "" : t("还没搬来", "Not moved in yet")}">${here ? v : "—"}</span></div>`;
    }).join("");
    const plots = sim.plots.map((p, i) => {
      const cls = p ? "plot built" : i < sim.unlocked ? "plot" : "plot locked";
      return `<div class="${cls}"><b>${i + 1}</b>${p ? esc(L(W.FACILITIES[p.card].name)) : i < sim.unlocked ? t("空地", "Empty") : t("未解锁", "Locked")}</div>`;
    }).join("");
    const facOpts = Object.entries(W.FACILITIES).filter(([id]) => !sim.used[id]).map(([id, f]) => `<option value="${id}">${esc(L(f.name))}</option>`).join("");
    const plotOpts = sim.plots.map((p, i) => (!p && i < sim.unlocked ? `<option value="${i}">${t("地块", "Plot")} ${i + 1}</option>` : "")).join("");
    const polOpts = Object.entries(W.POLICIES).filter(([id, p]) => !(sim.used[id] && !p.repeatable)).map(([id, p]) => {
      const need = p.requires && p.requires.built && !Sim.built(sim, p.requires.built) ? t(`（要先建${L(W.FACILITIES[p.requires.built].name)}）`, ` (build ${L(W.FACILITIES[p.requires.built].name)} first)`) : p.requires && p.requires.flag && !sim.flags[p.requires.flag] ? t("（现在用不上）", " (not needed now)") : "";
      return `<option value="${id}"${need ? " disabled" : ""}>${esc(L(p.name) + need)}</option>`;
    }).join("");
    const scripts = Object.entries(Sim.SCRIPTS).map(([id, sc]) => `<button data-script="${id}">${esc(L(sc.name))}</button>`).join("");
    const log = sim.log.slice(-40).reverse().map(logLine).join("") || `<div>${t("还没有发生什么。", "Nothing has happened yet.")}</div>`;
    return `
      <div class="note">${t("这一栏代替 Downstairs 游戏本体。正式接入后，建设和政策在游戏里做，这里的数字只在游戏端看得到，住户和 GM 只知道发生了什么。",
        "This panel stands in for the Downstairs game itself. Once they are connected, building and policies happen in the game; these numbers stay on the game side, and the residents and the GM only know what happened.")}</div>
      <section><h3>${t("政策点", "Policy points")}</h3><div class="points">${Array.from({ length: Sim.POINTS_PER_DECADE }, (_, i) => `<span class="dot${i < sim.points ? " on" : ""}"></span>`).join("")}<span>${t(`这个十年还剩 ${sim.points} 个`, `${sim.points} left this decade`)}</span></div></section>
      <section><h3>${t("满意度", "Satisfaction")}</h3><div class="bars">${bars}</div></section>
      <section><h3>${t("楼下的地块", "Plots downstairs")}</h3><div class="plots">${plots}</div></section>
      <section class="controls"><h3>${t("在游戏端操作", "Act on the game side")}</h3>
        <div class="row"><select id="facSel" aria-label="${t("设施", "Facility")}">${facOpts}</select><select id="plotSel" aria-label="${t("地块", "Plot")}">${plotOpts}</select><button id="buildBtn"${plotOpts && facOpts ? "" : " disabled"}>${t("建", "Build")}</button></div>
        <div class="row"><select id="polSel" aria-label="${t("政策", "Policy")}">${polOpts}</select><button id="enactBtn">${t("执行", "Enact")}</button></div>
        <div class="row">${scripts}</div>
        <span class="hint">${t("剧本会把这个十年的建设和政策一次做完，方便看同一种局面下大家的反应。", "A script does the whole decade's building and policies in one go, so you can see how everyone reacts to the same situation.")}</span>
        <div class="row"><button disabled>${t("进入下一个十年", "Go to the next decade")}</button></div>
        <span class="hint">${t("第一个十年先做到这里，下一个十年等 M3。", "This version stops at the first decade; the next one comes in M3.")}</span>
      </section>
      <section><h3>${t("游戏端收到和发出的", "What the game sent and received")}</h3><div class="log">${log}</div></section>`;
  }
  function logLine(e) {
    const r = (id) => esc(L(W.RESIDENTS[id] && W.RESIDENTS[id].name));
    const d = e.delta > 0 ? "+" + e.delta : e.delta;
    if (e.received) {
      if (e.type === "trpg_spend") return `<div class="in">← ${t(`跑团用了 ${e.points} 个政策点：`, `The TRPG spent ${e.points} policy point${e.points === 1 ? "" : "s"}: `)}${esc(e.reason)}</div>`;
      if (e.type === "trpg_feedback") return `<div class="in">← ${r(e.resident)} ${t(`满意度 ${d}（${esc(e.reason)}）`, `satisfaction ${d} (${esc(e.reason)})`)}</div>`;
      if (e.type === "trpg_info") return `<div class="in">← ${t(`知道了 ${r(e.resident)} 的障碍 ${esc(e.barrier)}`, `Learned ${r(e.resident)}'s barrier ${esc(e.barrier)}`)}</div>`;
      return "";
    }
    if (e.type === "build") return `<div>→ ${t(`建成 ${esc(L(W.FACILITIES[e.card].name))}（地块 ${e.plot}）`, `Built ${esc(L(W.FACILITIES[e.card].name))} (plot ${e.plot})`)}</div>`;
    if (e.type === "policy") return `<div>→ ${t("执行 ", "Enacted ")}${esc(L(W.POLICIES[e.card].name))}</div>`;
    if (e.type === "satisfaction") return `<div>→ ${r(e.resident)} ${t("满意度变化", "satisfaction changed")}</div>`;
    if (e.type === "decade") return `<div>→ ${t(`进入第 ${e.decade} 个十年`, `Entered decade ${e.decade}`)}</div>`;
    return "";
  }
  function afterGame(results) {
    const bad = [].concat(results).find((r) => r && !r.ok);
    if (bad) toast(en() && bad.reason_en ? bad.reason_en : bad.reason);
    renderAll();
  }
  function bindGame() {
    $("#buildBtn").onclick = () => afterGame(S.gameAction(session, "build", $("#facSel").value, Number($("#plotSel").value)));
    $("#enactBtn").onclick = () => afterGame(S.gameAction(session, "enact", $("#polSel").value));
    document.querySelectorAll("[data-script]").forEach((b) => {
      b.onclick = () => { const rs = Sim.runScript(session.sim, b.dataset.script); S.syncFromGame(session); afterGame(rs); };
    });
  }

  function knownTab() {
    const s = st(), year = s.time.year;
    const reveals = s.events.filter((e) => e.kind === "reveal" && e.perceivedBy.includes("player"));
    const houses = Object.entries(W.RESIDENTS).filter(([id]) => W.livesHere(id, year)).map(([hid, r]) => {
      const said = s.events.filter((e) => e.kind === "speech" && W.householdOf(e.actor) === hid && e.perceivedBy.includes("player"));
      const met = [...new Set(said.map((e) => e.actor))];
      const items = reveals.filter((e) => W.householdOf(e.actor) === hid).map((e) => {
        const quote = s.events.find((x) => x.kind === "speech" && x.actor === e.actor && x.turn === e.turn);
        const head = e.reveal.kind === "barrier" ? `${esc(e.reveal.id)} ${esc(L(W.BARRIERS[e.reveal.id]))}` : t("一件他们的事", "Something about them");
        return `<li>${head}${quote ? `<br><q>${esc(quote.summary)}</q>${gap()}${esc(nameOf(e.actor))}${quote.gloss ? `<span class="gloss">${t("意思是：", "Meaning: ")}${esc(quote.gloss)}</span>` : ""}` : ""}</li>`;
      }).join("");
      const meta = met.length ? t("说过话：", "Talked with: ") + met.map(nameOf).join(sep()) : t("还没说过话", "Haven't talked yet");
      return `<div class="house"><div class="name"><span class="swatch" style="background:${R.HOUSE[hid]}"></span>${esc(L(r.name))}</div><div class="meta">${esc(meta)}</div>${items ? `<ul>${items}</ul>` : ""}</div>`;
    }).join("");
    return `<div class="note">${t("这里只记你亲耳听到的。别人家里的事，要他们自己愿意说。", "Only what you heard yourself is kept here. Other families' business is theirs to tell.")}</div>${houses}`;
  }

  // ---------- 调用记录和用量 ----------
  // ≈ 表示估算（接口没报 token 数）；报了的就是准确数
  const num = (n) => Number(n || 0).toLocaleString("en-US");
  const approx = (exact) => (exact ? "" : "≈");
  const kb = (b) => (b / 1024).toFixed(b < 10240 ? 1 : 0) + " KB";
  const pct = (x) => (x < 0.001 ? "<0.1%" : x < 0.1 ? (x * 100).toFixed(1) + "%" : Math.round(x * 100) + "%");
  const allCalls = () => ui.turns.flatMap((x) => x.calls);
  function bar(x, plain) {
    const level = plain ? "" : x >= 0.8 ? " bad" : x >= 0.5 ? " warn" : "";
    return `<span class="meter${level}" aria-hidden="true"><span style="width:${Math.max(1.5, Math.min(100, x * 100))}%"></span></span>`;
  }
  // 这次调用离上限多远：网页内置的 Claude 先看字节上限，其他看上下文窗口
  function contextLine(k) {
    if (k.limit === "bytes") return `${bar(k.byteShare)}<span>${t("网页一次最多发 ", "The page sends at most ")}${kb(k.limitBytes)}${t("，这次 ", "; this one ")}${kb(k.bytes)}${t("，占 ", ", ")}${pct(k.byteShare)}${k.share != null ? t(`（上下文窗口 ${pct(k.share)}）`, ` (context window ${pct(k.share)})`) : ""}</span>`;
    if (k.limit === "window") return `${bar(k.share)}<span>${t("占上下文 ", "Context used ")}${pct(k.share)}${t("，窗口 ", " of ")}${Tok.compact(k.window)}${t("（", " (")}<span class="model">${esc(k.windowModel)}</span>${t("）", ")")}</span>`;
    return `<span>${t("不知道这个模型的上下文窗口有多大，只记 token 数。", "Context window unknown for this model; only token counts are kept.")}</span>`;
  }
  function tokenLine(k) {
    const a = approx(k.exact);
    return `<div class="tok" title="${k.exact ? t("接口报的准确数", "Exact, reported by the API") : t("按字数估算", "Estimated from the text length")}">${t("输入 ", "In ")}${a}${num(k.input)}${cacheNote(k)}${t(" · 输出 ", " · Out ")}${a}${num(k.output)}${k.maxOutput ? t(` / 上限 ${num(k.maxOutput)}`, ` of ${num(k.maxOutput)} max`) : ""} tokens</div><div class="ctx">${contextLine(k)}</div>`;
  }
  // 缓存读了多少、写了多少（11-02；只有接口报了才有，写入只有 Anthropic 报）
  function cacheNote(k) {
    const bits = [k.cached ? t(`缓存读 ${num(k.cached)}`, `cache read ${num(k.cached)}`) : "", k.written ? t(`写 ${num(k.written)}`, `written ${num(k.written)}`) : ""].filter(Boolean);
    return bits.length ? t(`（${bits.join("，")}）`, ` (${bits.join(", ")})`) : "";
  }
  // 提示词里各部分多大：先是系统提示，再是这一轮发的内容
  function sectionList(k) {
    const top = Math.max(1, ...k.sections.map((x) => x.tokens));
    const group = (where, title) => {
      const rows = k.sections.filter((x) => x.where === where).map((x) => {
        const name = esc(x.title || t("开头", "Opening"));
        return `<li><span class="sec" title="${name}">${name}</span>${bar(x.tokens / top, true)}<span class="n">${approx(false)}${num(x.tokens)}</span></li>`;
      }).join("");
      return rows ? `<li class="grp">${title}</li>${rows}` : "";
    };
    return `<div class="hint">${t("提示词里各部分大约多少 token：", "Roughly how many tokens each part of the prompt takes:")}</div><ul class="secs">${group("system", t("系统提示", "System prompt"))}${group("user", t("这一轮发的内容", "This round's message"))}</ul>`;
  }
  function usageSummary() {
    const calls = allCalls(), u = Tok.sum(calls), a = approx(!u.estimated);
    const big = u.largest;
    const turnOf = (c) => ui.turns.find((x) => x.calls.includes(c));
    const lines = [
      `<div class="sum-head"><b>${t("这一局", "This game")}</b><span>${t(`${ui.turns.length} 轮 · ${u.calls} 次调用`, `${ui.turns.length} ${ui.turns.length === 1 ? "round" : "rounds"} · ${u.calls} ${u.calls === 1 ? "call" : "calls"}`)}</span></div>`,
      `<div class="nums"><div><span>${t("输入", "In")}</span><b>${a}${num(u.input)}</b></div><div><span>${t("输出", "Out")}</span><b>${a}${num(u.output)}</b></div><div><span>${t("合计", "Total")}</span><b>${a}${num(u.input + u.output)}</b></div></div>`
    ];
    if (big) lines.push(`<div class="hint">${t("最大的一次：", "Largest call: ")}${esc(big.label)}${t(`（第 ${turnOf(big).n} 轮）`, ` (round ${turnOf(big).n})`)}${t("，输入 ", ", in ")}${approx(big.tokens.exact)}${num(big.tokens.input)} tokens</div><div class="ctx">${contextLine(big.tokens)}</div>`);
    const notes = [t("每次调用都是单独发出去的，不带之前的对话，所以“占上下文”就是这一次的提示词占多少。", "Every call is sent on its own, without earlier conversation, so “context used” is just how much of the window that one prompt takes.")];
    if (calls.some((c) => c.tokens.reference)) notes.push(t(`离线演示不调用模型，占比按 ${Tok.REFERENCE_MODEL} 算。`, `The offline demo calls no model, so shares are worked out against ${Tok.REFERENCE_MODEL}.`));
    if (u.estimated) notes.push(t("带 ≈ 的是估算：claude.ai 内置的 Claude 和离线演示不报 token 数，只能按字数算，差一两成很正常。填 API Key 的接口会报准确数。", "Numbers with ≈ are estimates: Claude built into claude.ai and the offline demo don't report token counts, so they are worked out from the text length and can be off by 10–20%. Connections with an API key report exact counts."));
    if (u.exactInput) lines.push(`<div class="hint">${t(`提示词缓存：有准确数的输入里 ${u.cached ? pct(u.cached / u.exactInput) : "0%"} 是从缓存读的（${num(u.cached)} tokens）`, `Prompt cache: ${u.cached ? pct(u.cached / u.exactInput) : "0%"} of the exactly counted input was read from the cache (${num(u.cached)} tokens)`)}${u.written ? t(`，写进缓存 ${num(u.written)} tokens`, `; ${num(u.written)} tokens written to it`) : ""}${t("。", ".")}</div>`);
    if (u.ratio) notes.push(t(`有准确数的 ${u.exact} 次调用里，实际输入是估算的 ${u.ratio.toFixed(2)} 倍。`, `Across the ${u.exact} ${u.exact === 1 ? "call" : "calls"} with exact counts, the real input was ${u.ratio.toFixed(2)}× the estimate.`));
    return `<div class="usage">${lines.join("")}<div class="hint">${notes.join(" ")}</div></div>`;
  }
  function callBlock(c) {
    const m = c.meta || {};
    const badges = (m.fallback ? `<span class="badge bad" title="${t("请求的是 ", "Requested ")}${esc(m.requested)}">${t("不是指定的模型", "Not the requested model")}</span>` : "") + (m.truncated ? `<span class="badge warn">${t("输出被截断", "Output cut off")}</span>` : "");
    // skipped：GM 重给时照抄了已经生效的那条，代码没有再做
    // trimmed：开头抄了已经显示的叙述，只写了后面新的那部分
    const res = (c.results || []).map((r) => r.skipped ? `<span class="skip">${esc(r.part || r.op)} ↷ ${esc(r.reason)}</span>` : `<span class="${r.ok ? "ok" : "no"}">${esc(r.part || r.op)}${r.ok ? " ✓" + (r.trimmed ? t("（开头和已经显示的重复，只写了后面新的）", " (its opening repeated what was shown; only the new part was written)") : "") : " ✗ " + esc(r.reason)}</span>`).join(gap());
    return `<div class="call"><div class="head"><b>${esc(c.label)}</b><span>${esc(m.model || "")}</span><span>${m.ms != null ? m.ms + " ms" : ""}</span>${badges}</div>
        ${c.tokens ? tokenLine(c.tokens) : ""}
        ${res ? `<div class="res">${res}</div>` : ""}
        <details><summary>${t("提示词和原始输出", "Prompts and raw output")}</summary>${c.tokens ? sectionList(c.tokens) : ""}<pre>${esc(c.system)}</pre><pre>${esc(c.user)}</pre><pre>${esc(c.text)}</pre></details></div>`;
  }
  function turnBlock(x) {
    const u = Tok.sum(x.calls), a = approx(!u.estimated);
    const said = x.input.length > 24 ? x.input.slice(0, 24) + "…" : x.input;
    return `<section class="turn"><div class="turn-head"><b>${t(`第 ${x.n} 轮`, `Round ${x.n}`)}</b><span class="said">${t("“", "“")}${esc(said)}${t("”", "”")}</span>${x.failed ? `<span class="badge bad">${t("没跑完", "Didn't finish")}</span>` : ""}<span class="n">${t(`${u.calls} 次 · `, `${u.calls} ${u.calls === 1 ? "call" : "calls"} · `)}${a}${num(u.input + u.output)} tokens</span></div>${x.calls.slice().reverse().map(callBlock).join("")}</section>`;
  }
  function callsTab() {
    const head = `<div class="controls"><div class="row"><span class="hint" style="flex:1">${t("每一轮的 GM 和住户调用都记在这里，最新的在上面。", "Every GM and resident call is logged here, newest first.")}</span><button id="exportBtn">${t("导出记录", "Export log")}</button></div></div>`;
    if (!allCalls().length) return head + `<div class="note">${t("还没有调用过模型。", "No model calls yet.")}</div>`;
    return head + usageSummary() + ui.turns.slice().reverse().filter((x) => x.calls.length).map(turnBlock).join("");
  }
  // 导出时带上每次调用的用量（不带提示词全文，太长）
  function usageExport() {
    // seen：这次调用给了哪些事件（查"为什么忘了""有没有泄露"用）
    const calls = ui.turns.flatMap((x) => x.calls.map((c) => ({ round: x.n, input: x.input, failed: !!x.failed, role: c.role, label: c.label, model: (c.meta || {}).model, ms: (c.meta || {}).ms, tokens: c.tokens, seen: c.seen || null })));
    const u = Tok.sum(allCalls());
    return { usage: { rounds: ui.turns.length, calls: u.calls, input: u.input, output: u.output, exact_calls: u.exact, estimated_calls: u.estimated, exact_over_estimate: u.ratio, cache_read: u.cached, cache_written: u.written, per_call: calls } };
  }

  function renderAll() {
    renderTop(); renderFeed(); renderComposer(); renderPanel();
    ui.dirty = true;
  }

  // ---------------- 棋盘 ----------------
  function boxSize() {
    const board = $("#board"), narrow = window.innerWidth < 900;
    return { width: board.clientWidth - 20, height: narrow ? 330 : Math.max(240, Math.min(window.innerHeight * 0.46, 460)), min: narrow ? 0.72 : 0.5 };
  }
  function frame(now) {
    if (session) {
      const busyAnim = ui.thinking.size || Object.values(ui.spoke).some((t) => now - t < 4200);
      if (ui.dirty || busyAnim || renderer.animating(st())) {
        renderer.draw(st(), ui, boxSize(), now);
        ui.dirty = false;
        followPlayer();
      }
    }
    requestAnimationFrame(frame);
  }
  // 地图比屏幕宽（手机上）时，让玩家留在视野里
  function followPlayer() {
    const p = st().actors.player, key = p.map + p.x + "," + p.y;
    if (key === ui.lastPos) return;
    ui.lastPos = key;
    const board = $("#board");
    if (board.scrollWidth <= board.clientWidth && board.scrollHeight <= board.clientHeight) return;
    const [cx, cy] = renderer.playerCenter(st());
    board.scrollLeft = Math.max(0, cx - board.clientWidth / 2);
    board.scrollTop = Math.max(0, cy - board.clientHeight / 2);
  }

  let toastTimer = null;
  function toast(text) {
    const t = $("#toast");
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  function stopWalk() { if (ui.walking) { clearInterval(ui.walking); ui.walking = null; } }
  function afterMove(r) {
    const s = st();
    if (r && r.changedMap) {
      stopWalk();
      if (ui.focus && s.actors[ui.focus].map !== s.actors.player.map) ui.focus = null;
      ui.pick = "auto";
      D.clearMet(s);
      toast(L(M.MAPS[s.actors.player.map].name));
      renderTop();
    }
    renderComposer();
    ui.dirty = true;
  }
  function tryStep(dx, dy) {
    const p = st().actors.player;
    return tryMove(p.x + dx, p.y + dy);
  }
  function tryMove(x, y) {
    const r = B.moveTo(st(), x, y);
    if (!r.ok) {
      if (r.reason) toast(typeof r.reason === "object" ? L(r.reason) : r.reason);
      else if (r.bump && W.CHARACTERS[r.bump]) setFocus(r.bump);
    }
    afterMove(r);
    return r;
  }
  function walk(route) {
    stopWalk();
    if (!route || !route.length) return;
    ui.walking = setInterval(() => {
      const next = route.shift();
      if (!next) return stopWalk();
      const r = tryMove(next[0], next[1]);
      if (!r.ok || r.changedMap || !route.length) stopWalk();
    }, 115);
  }
  function setFocus(id) {
    ui.focus = id;
    ui.pick = "auto";
    renderComposer();
    ui.dirty = true;
  }
  function onBoardClick(ev) {
    if (!session || ui.busy) { if (ui.busy) toast(t("等他们说完。", "Wait until they finish.")); return; }
    const s = st(), p = s.actors.player;
    const [x, y] = renderer.cellAt(ev.clientX, ev.clientY);
    if (M.tile(p.map, x, y) == null) return;
    const who = B.personAt(s, p.map, x, y, "player");
    if (who && who.kind === "resident") setFocus(who.id);
    const thing = B.furnitureAt(s, p.map, x, y);
    if (thing) toast(L(M.PROPS[thing.kind].name));
    const extras = B.extrasAt(s, p.map, x, y);
    if (extras) toast(H.extrasName(s, extras) + (extras.activity ? t("：", ": ") + extras.activity : ""));
    const route = B.path(s, p.map, [p.x, p.y], [x, y]);
    if (route === null && !who && !thing && !extras) { toast(t("走不过去。", "You can't get there.")); return; }
    walk(route || []);
    if (who) $("#say").focus({ preventScroll: true });
  }

  // ---------------- 一轮 ----------------
  async function send(ev) {
    if (ev) ev.preventDefault();
    const input = $("#say"), text = input.value.trim();
    if (!text || ui.busy || !session) return;
    stopWalk();
    input.value = "";
    ui.busy = true; renderTop(); renderComposer();
    const s = st(), tg = target();
    try {
      const res = await Turn.playerTurn(session, text, {
        llm: caller(), to: tg.gm ? "gm" : tg.who, focus: ui.focus && s.actors[ui.focus].map === s.actors.player.map ? ui.focus : null, identity: identity(),
        confirmSpend: askSpend, onStream: settings.stream ? showStream : null,
        onStatus: (phase, ids) => {
          if (phase === "gm") { ui.thinking = new Set(); setStatus(t("GM 在看这一轮会发生什么……", "The GM is working out what happens…")); }
          if (phase === "translate") setStatus(t("GM 在把听不懂的话翻出来……", "The GM is translating what was hard to follow…"));
          if (phase === "characters") { ui.thinking = new Set(ids); setStatus(t(ids.map(nameOf).join("、") + " 在想怎么回你……", ids.map(nameOf).join(" and ") + (ids.length > 1 ? " are" : " is") + " thinking how to answer…")); }
          renderFeed(); ui.dirty = true;
        }
      });
      ui.turns.push({ n: ui.turns.length + 1, input: text, calls: res.calls });
      const now = performance.now();
      for (const e of res.items) if (e.kind === "speech") ui.spoke[e.actor] = now;
      setStatus(settings.provider === "mock" ? t("离线演示：台词是写好的，只用来把流程走一遍。", "Offline demo: the lines are pre-written, just to walk through the flow.") : turnUsage(res.usage));
    } catch (e) {
      if (e && e.calls && e.calls.length) ui.turns.push({ n: ui.turns.length + 1, input: text, calls: e.calls, failed: true });
      const why = e && e.message ? e.message : e;
      note(t("这一轮没有跑完：" + why + "　你说的话已经记下了，可以再说一次，或者在设置里换成离线演示。",
        "This round didn't finish: " + why + "  What you said is kept. You can say it again, or switch to the offline demo in Settings."), "error");
      setStatus(blank());
    } finally {
      ui.busy = false; ui.thinking = new Set(); ui.streaming = null;
      if (ui.focus && st().actors[ui.focus].map !== st().actors.player.map) ui.focus = null;
      renderAll();
      $("#say").focus({ preventScroll: true });
    }
  }

  // 这一轮用了多少（显示在输入框下面）
  function turnUsage(u) {
    if (!u || !u.calls) return blank();
    const a = approx(!u.estimated);
    return t(`这一轮调用了 ${u.calls} 次模型，共 ${a}${num(u.input + u.output)} tokens。详细的在写字板的“调用记录”里。`,
      `This round made ${u.calls} model ${u.calls === 1 ? "call" : "calls"}, ${a}${num(u.input + u.output)} tokens in all. Details are in the Call log on the clipboard.`);
  }

  // ---------------- 对话框 ----------------
  let closeDialog = null;
  function openDialog(html, bind) {
    $("#dialog").innerHTML = html;
    $("#overlay").hidden = false;
    return new Promise((resolve) => {
      closeDialog = (v) => { $("#overlay").hidden = true; closeDialog = null; resolve(v); };
      bind(closeDialog);
      const first = $("#dialog").querySelector("[autofocus], button.primary");
      if (first) first.focus();
    });
  }
  function ask(title, body, yes, no) {
    return openDialog(`<h2>${esc(title)}</h2><p>${esc(body)}</p><div class="actions"><button id="dlgNo">${esc(no)}</button><button class="primary" id="dlgYes">${esc(yes)}</button></div>`, (close) => {
      $("#dlgYes").onclick = () => close(true);
      $("#dlgNo").onclick = () => close(false);
    });
  }
  function askSpend(op) {
    const who = (op.residents || []).map(nameOf).join(sep());
    const left = st().game.points;
    if (en()) return ask("Go and do this?", `${op.description || "Pitch in"}${who ? " (" + who + ")" : ""}. This uses 1 policy point; ${left} left this decade.`, "Do it", "Not now");
    return ask("要去做这件事吗？", `${op.description || "动手帮忙"}${who ? "（" + who + "）" : ""}。这会用掉 1 个政策点，这个十年还剩 ${left} 个。`, "去做", "先不做");
  }

  // 语言：开始界面上点了马上换；设置里换了，保存时从第一天重来
  function langFields() {
    const b = (code, label) => `<button type="button" data-lang="${code}" class="${settings.lang === code ? "on" : ""}" aria-pressed="${settings.lang === code}">${label}</button>`;
    return `<fieldset><legend>${t("语言", "Language")}</legend><div class="seg" id="langSeg">${b("zh", "中文")}${b("en", "English")}</div></fieldset>`;
  }
  const GENDERS = { zh: [["男", "男"], ["女", "女"], ["不说", "不说"]], en: [["male", "Male"], ["female", "Female"], ["unsaid", "Prefer not to say"]] };
  function identityFields() {
    const id = identity(), def = P.defaultIdentity(settings.lang);
    const eth = t(["华人", "马来人", "印度人", "欧亚裔"], ["Chinese", "Malay", "Indian", "Eurasian"]).map((x) => `<option value="${x}"></option>`).join("");
    return `<fieldset id="idFields"><legend>${t("你是谁", "Who you are")}</legend>
      <div class="grid2">
        <label class="field"><span>${t("名字", "Name")}</span><input id="idName" value="${esc(id.name)}" maxlength="30" /></label>
        <label class="field"><span>${t("出生年份", "Year of birth")}</span><input id="idBorn" type="number" min="1935" max="1971" value="${esc(id.born)}" /></label>
        <label class="field"><span>${t("性别", "Gender")}</span><select id="idGender">${GENDERS[settings.lang].map(([v, label]) => `<option value="${v}"${v === id.gender ? " selected" : ""}>${label}</option>`).join("")}</select></label>
        <label class="field"><span>${t("族群", "Ethnicity")}</span><input id="idEth" list="ethList" value="${esc(id.ethnicity)}" maxlength="30" /></label>
      </div>
      <datalist id="ethList">${eth}</datalist>
      <label class="field"><span>${t("会说的话", "Languages you speak")}</span><input id="idLang" value="${esc(id.languages)}" maxlength="80" /></label>
      <label class="field"><span>${t("别的（可以不填）", "Anything else (optional)")}</span><textarea id="idAbout" rows="2" maxlength="200" placeholder="${t("比如：在这一区长大，刚从大学毕业", "e.g. grew up in this estate, just graduated from university")}">${esc(id.about)}</textarea></label>
      <div class="actions" style="justify-content:flex-start"><button type="button" id="idReset" class="quiet">${t(`换回默认身份（${def.name}）`, `Back to the default (${def.name})`)}</button></div>
    </fieldset>`;
  }
  function readIdentity() {
    const born = parseInt($("#idBorn").value, 10), def = P.defaultIdentity(settings.lang);
    settings.identities[settings.lang] = {
      name: $("#idName").value.trim() || def.name, gender: $("#idGender").value, ethnicity: $("#idEth").value.trim(),
      born: Number.isFinite(born) ? Math.max(1935, Math.min(1971, born)) : def.born,
      languages: $("#idLang").value.trim(), about: $("#idAbout").value.trim()
    };
  }
  function providerFields() {
    const opts = Object.entries(LLM.PRESETS).filter(([id]) => id !== "claude_page" || hasPage).map(([id, p]) => `<option value="${id}"${id === settings.provider ? " selected" : ""}>${esc(L(p.label))}</option>`).join("");
    return `<fieldset><legend>${t("谁来当 GM 和住户", "Who plays the GM and the residents")}</legend>
      <label class="field"><span>${t("模型", "Model")}</span><select id="provSel">${opts}</select></label>
      <div id="provMore"></div>
      <label class="hint"><input type="checkbox" id="provStream" style="width:auto"${settings.stream ? " checked" : ""} /> ${t("流式输出：GM 的叙述边写边显示（写完、检查过才算数）", "Streaming: show the GM's narration as it is written (it only counts once finished and checked)")}</label>
    </fieldset>`;
  }
  function renderProvMore() {
    const id = $("#provSel").value, p = LLM.PRESETS[id], box = $("#provMore");
    if (p.kind === "mock") box.innerHTML = `<p class="hint">${t("不调用模型，用写好的台词把流程走一遍。看界面和规则可以，看不出模型的表现。", "Doesn't call a model; walks through the flow with pre-written lines. Good for checking the interface and the rules, not for judging a model.")}</p>`;
    else if (p.kind === "page") box.innerHTML = `<label class="field"><span>${t("指定模型", "Requested model")}</span><input id="provModel" value="${esc(settings.model || "")}" placeholder="${esc(p.model)}" /></label><p class="hint">${t("用你自己的 Claude 账号和额度。实际回答的模型记在调用记录里，不是指定的那个会标红。", "Uses your own Claude account and usage. The model that actually answered is shown in the call log, marked red if it isn't the one requested.")}</p>`;
    else box.innerHTML = `<div class="grid2"><label class="field"><span>${t("接口地址", "API endpoint")}</span><input id="provBase" value="${esc(settings.baseUrl || "")}" placeholder="${esc(p.base)}" /></label>
      <label class="field"><span>${t("模型", "Model")}</span><input id="provModel" value="${esc(settings.model || "")}" placeholder="${esc(p.model)}" /></label></div>
      <label class="field"><span>API Key</span><input id="provKey" type="password" value="${esc(settings.apiKey || "")}" /></label>
      <label class="hint"><input type="checkbox" id="provRemember" style="width:auto"${settings.remember ? " checked" : ""} /> ${t("在这个浏览器里记住 Key", "Remember the key in this browser")}</label>`;
  }
  function readProvider() {
    const id = $("#provSel").value;
    if (id !== settings.provider) { settings.model = ""; settings.baseUrl = ""; }
    settings.provider = id;
    if ($("#provModel")) settings.model = $("#provModel").value.trim();
    if ($("#provBase")) settings.baseUrl = $("#provBase").value.trim();
    if ($("#provKey")) settings.apiKey = $("#provKey").value.trim();
    if ($("#provRemember")) settings.remember = $("#provRemember").checked;
    if ($("#provStream")) settings.stream = $("#provStream").checked;
  }
  function bindSetup() {
    $("#provSel").onchange = renderProvMore;
    renderProvMore();
    bindIdReset();
  }
  function bindIdReset() { $("#idReset").onclick = () => { settings.identities[settings.lang] = Object.assign({}, P.defaultIdentity(settings.lang)); $("#idFields").outerHTML = identityFields(); bindIdReset(); }; }

  function showStart() {
    const body = () => `<h2>${t("楼下的另一面", "The Other Side of Downstairs")}</h2>
      <p>${t("1989 年，新加坡，一座刚交钥匙的组屋，BLK 317A。你是楼下办公室新来的社区工作者。这一版先过第一个十年里的八个日子，每个日子从早到晚，你想去哪、跟谁说话都可以。",
        "Singapore, 1989: BLK 317A, an HDB block whose keys have just been handed over. You are the new community worker in the office downstairs. This version covers eight days in the first decade. Each day runs from morning to night, and you can go anywhere and talk to anyone.")}</p>
      ${langFields()}${providerFields()}${identityFields()}
      <div class="actions"><button class="primary" id="startBtn">${t("开始第一天", "Start day one")}</button></div>`;
    return openDialog(body(), (close) => {
      const bind = () => {
        bindSetup();
        $("#startBtn").onclick = () => { readProvider(); readIdentity(); saveSettings(); close(true); };
        // 还没开始玩，换语言就直接换掉整局
        $("#langSeg").onclick = (e) => {
          const b = e.target.closest("button[data-lang]");
          if (!b || b.dataset.lang === settings.lang) return;
          readProvider(); readIdentity();
          settings.lang = b.dataset.lang;
          saveSettings(); newGame();
          $("#dialog").innerHTML = body(); bind();
          $("#startBtn").focus();
        };
      };
      bind();
    });
  }
  function showSettings() {
    const was = settings.lang;
    let pick = settings.lang;
    return openDialog(`<h2>${t("设置", "Settings")}</h2>${langFields()}<p class="hint" id="langHint" hidden>${t("换语言会从第一天重来。", "Changing the language starts again from day one.")}</p>${providerFields()}${identityFields()}
      <p class="hint">${t("改了身份，从下一句话开始算。", "Identity changes count from your next line.")}</p>
      <div class="actions"><button id="restartBtn">${t("从第一天重来", "Start again from day one")}</button><button id="cancelBtn">${t("取消", "Cancel")}</button><button class="primary" id="saveBtn">${t("保存", "Save")}</button></div>`, (close) => {
      bindSetup();
      $("#langSeg").onclick = (e) => {
        const b = e.target.closest("button[data-lang]");
        if (!b) return;
        pick = b.dataset.lang;
        document.querySelectorAll("#langSeg button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
        $("#langHint").hidden = pick === was;
      };
      const commit = () => { readProvider(); readIdentity(); settings.lang = pick; saveSettings(); };
      $("#saveBtn").onclick = () => { commit(); close(pick !== was ? "restart" : "save"); };
      $("#cancelBtn").onclick = () => close(null);
      $("#restartBtn").onclick = () => { commit(); close("restart"); };
    }).then((v) => { if (v === "restart") newGame(); renderAll(); });
  }
  function showExport() {
    const text = S.exportLog(session, usageExport());
    openDialog(`<h2>${t("导出记录", "Export log")}</h2><p class="hint">${t("整局的状态、游戏端模拟和每次调用的用量，复制下来发给我就能复盘。", "The whole game's state, the game-side simulation and each call's token use. Copy it and send it over, and the session can be replayed.")}</p><textarea id="exportText" rows="12" readonly>${esc(text)}</textarea>
      <div class="actions"><button id="copyBtn">${t("复制", "Copy")}</button><button class="primary" id="closeBtn">${t("关闭", "Close")}</button></div>`, (close) => {
      $("#closeBtn").onclick = () => close();
      $("#copyBtn").onclick = () => {
        const ta = $("#exportText");
        Promise.resolve().then(() => navigator.clipboard.writeText(text)).then(() => toast(t("复制好了。", "Copied.")), () => { ta.focus(); ta.select(); toast(t("自动复制不了，已经全选，按 Ctrl+C 复制。", "Couldn't copy automatically. It's all selected; press Ctrl+C.")); });
      };
    });
  }

  // ---------------- 换日子 ----------------
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  async function endDay() {
    if (ui.busy) return;
    const s = st();
    const sure = en() ? ask("The day isn't over yet", "Go to the next day now? The rest of today will be skipped.", "Next day", "Stay a bit longer")
      : ask("这一天还没过完", "现在就去下一个日子吗？今天剩下的时间就跳过了。", "去下一个日子", "再待一会儿");
    if (s.time.slot < D.LAST_SLOT && !(await sure)) return;
    stopWalk();
    const next = D.nextDay(s);
    if (!next) return decadeEnd();
    const d = next.date, wd = new Date(d.year, d.month - 1, d.day).getDay();
    const what = L(next.title).split(" · ")[1] || "";
    const date = en() ? `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][wd]}, ${d.day} ${MONTHS[d.month - 1]}` : `${d.month} 月 ${d.day} 日，星期${"日一二三四五六"[wd]}`;
    await openDialog(`<div class="daycard"><div class="date">${d.year}</div>${what ? `<h2>${esc(what)}</h2>` : ""}<div class="sub">${date}</div><div class="actions" style="margin-top:18px"><button class="primary" id="goBtn">${t("开始这一天", "Start the day")}</button></div></div>`, (close) => { $("#goBtn").onclick = () => close(); });
    D.startDay(s, next.id);
    Object.assign(ui, { focus: null, pick: "auto", dayStartSeq: s.seq, spoke: {} });
    renderAll();
  }
  function decadeEnd() {
    const s = st();
    const spoke = new Set(s.events.filter((e) => e.kind === "speech" && e.perceivedBy.includes("player")).map((e) => e.actor));
    const acts = s.events.filter((e) => e.kind === "action").length;
    const known = Object.values(s.revealed.barriers).reduce((n, l) => n + l.length, 0) + Object.values(s.revealed.secrets).reduce((n, l) => n + l.length, 0) + s.revealed.relations.length;
    const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
    const sum = en() ? `You talked with ${n(spoke.size, "person", "people")}, pitched in ${n(acts, "time", "times")}, and noted ${n(known, "thing", "things")} people chose to tell you.`
      : `你跟 ${spoke.size} 个人说过话，动手帮过 ${acts} 次忙，记下了 ${known} 件别人愿意告诉你的事。`;
    return openDialog(`<div class="daycard"><div class="date">1989–1998</div><h2>${t("第一个十年过完了", "The first decade is over")}</h2>
      <p>${sum}</p>
      <p class="hint">${t("下一个十年还没做好（M3）。可以从第一天重来，换个身份或换个做法再走一遍。", "The next decade isn't built yet (M3). You can start again from day one, with a different identity or a different approach.")}</p>
      <div class="actions" style="margin-top:18px"><button id="stayBtn">${t("留在这里", "Stay here")}</button><button class="primary" id="againBtn">${t("从第一天重来", "Start again from day one")}</button></div></div>`, (close) => {
      $("#stayBtn").onclick = () => close(false);
      $("#againBtn").onclick = () => close(true);
    }).then((again) => { if (again) newGame(); });
  }

  function onWait() {
    if (ui.busy) return;
    stopWalk();
    const r = D.wait(st());
    if (!r.ok && r.endOfDay) toast(t("已经是晚上了，可以结束今天了。", "It's already night. You can end the day."));
    if (ui.focus && st().actors[ui.focus].map !== st().actors.player.map) ui.focus = null;
    renderAll();
  }

  // ---------------- 事件绑定 ----------------
  $("#composer").addEventListener("submit", send);
  $("#map").addEventListener("click", onBoardClick);
  $("#waitBtn").onclick = onWait;
  $("#endBtn").onclick = endDay;
  $("#settingsBtn").onclick = showSettings;
  $("#panelBtn").onclick = () => $("#panel").classList.toggle("open");
  $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (b) { ui.tab = b.dataset.tab; renderPanel(); } });
  const KEYS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
  document.addEventListener("keydown", (e) => {
    if (!$("#overlay").hidden) { if (e.key === "Escape" && closeDialog) closeDialog(false); return; }
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") { if (e.key === "Escape") e.target.blur(); return; }
    if (!session || ui.busy || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = KEYS[e.key] || KEYS[e.key.toLowerCase()];
    if (k) { e.preventDefault(); stopWalk(); tryStep(k[0], k[1]); return; }
    if (e.key === "Enter") { e.preventDefault(); $("#say").focus(); }
  });
  window.addEventListener("resize", () => { ui.dirty = true; });

  // 给测试和调试用：在控制台里看当前的局面
  window.V2App = { session: () => session, ui, settings };

  newGame();
  requestAnimationFrame(frame);
  showStart();
})();
