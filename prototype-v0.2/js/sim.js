/* 游戏端模拟器：代替真正的 Downstairs，负责建设、政策、满意度和政策点。
 * V0.2 只读它发出的事件（pushGameEvent），只能通过 applyTrpg 回传小幅满意度变化和政策点消耗。
 * 可达性判定照搬 Downstairs engine.js 的 hiddenAccess；满意度是 [决定]（原作只有笑脸）。不依赖 DOM。 */
(function (root) {
  "use strict";
  const W = root.V2World;
  const POINTS_PER_DECADE = 3;
  const BUILD_COST = 1;
  const START_SATISFACTION = { chen: 55, lin: 60, aisyah: 60, mei: 45, kumar: 40 };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function createSim() {
    return {
      decade: 1, year: W.START_YEAR, points: POINTS_PER_DECADE,
      plots: Array(7).fill(null), unlocked: 4, used: {}, flags: {},
      stars: { lively: 0, green: 0, tidy: 0, standard: 0 },
      satisfaction: Object.assign({}, START_SATISFACTION),
      seq: 0, log: [], outbox: []
    };
  }

  const built = (s, id) => s.plots.some((p) => p && p.card === id);

  // Downstairs engine.js hiddenAccess：某户能不能用某设施，返回挡住他们的障碍
  function barriersFor(s, card, resident) {
    const b = [];
    if (card === "club") { if (resident === "chen") b.push("📱"); if (resident === "mei") b.push("🗣"); }
    if (card === "smart") { if (resident === "chen" && !s.flags.humanWindow) b.push("📱"); if (resident === "kumar") b.push("🚫"); }
    if (card === "hawker") {
      if (resident === "aisyah") b.push("🍲");
      if (s.flags.rent && ["aisyah", "mei", "kumar"].includes(resident)) b.push("💲");
    }
    if (["childcare", "daycare"].includes(card) && (resident === "kumar" || (resident === "chen" && !s.flags.registration))) b.push("📝");
    if (card === "feedback" && resident === "chen") b.push("📱");
    return b;
  }

  function emit(s, ev) {
    const e = Object.assign({ id: "G" + (++s.seq), source: "game", decade: s.decade, year: s.year, points: s.points }, ev);
    s.log.push(e); s.outbox.push(e);
    return e;
  }

  function addStars(s, stars) {
    for (const k of Object.keys(s.stars)) s.stars[k] = clamp(s.stars[k] + ((stars || {})[k] || 0), 0, 3);
    const total = Object.values(s.stars).reduce((a, b) => a + b, 0);
    s.unlocked = Math.max(s.unlocked, 4 + [3, 6, 9].filter((n) => total >= n).length);
  }

  function applyDeltas(s, deltas) {
    for (const [r, d] of Object.entries(deltas)) s.satisfaction[r] = clamp(s.satisfaction[r] + d, 0, 100);
  }

  // 建设施对各户满意度的影响 [决定]：需求对口且用得上 +8；对口但被挡住 -3（看着别人能用）；智能中心让陈阿姨额外 -6
  function buildDeltas(s, card) {
    const f = W.FACILITIES[card], out = {};
    for (const [id, r] of Object.entries(W.RESIDENTS)) {
      if (!f.needs.some((n) => r.needs.includes(n))) continue;
      out[id] = barriersFor(s, card, id).length ? -3 : 8;
    }
    if (card === "smart") out.chen = (out.chen || 0) - 6;
    return out;
  }

  // reason 是中文，reason_en 给英文界面用
  function fail(reason, reason_en) { return { ok: false, reason, reason_en: reason_en || reason }; }

  function build(s, card, plot) {
    if (!W.FACILITIES[card]) return fail("没有这种设施：" + card, "No such facility: " + card);
    if (s.used[card]) return fail("这种设施已经建过了", "That facility has already been built");
    if (s.points < BUILD_COST) return fail("这个十年的政策点用完了", "This decade's policy points are used up");
    const index = plot == null ? s.plots.findIndex((p, i) => i < s.unlocked && !p) : plot;
    if (!Number.isInteger(index) || index < 0 || index >= s.unlocked || s.plots[index]) return fail("请选一块已解锁的空地块", "Pick an empty plot that is unlocked");
    s.points -= BUILD_COST;
    s.plots[index] = { card, decade: s.decade };
    s.used[card] = true;
    addStars(s, W.FACILITIES[card].stars);
    const deltas = buildDeltas(s, card);
    applyDeltas(s, deltas);
    return { ok: true, event: emit(s, { type: "build", card, plot: index + 1, deltas, barriers: barrierMap(s, card), satisfaction: Object.assign({}, s.satisfaction) }) };
  }

  function barrierMap(s, card) {
    const m = {};
    for (const id of Object.keys(W.RESIDENTS)) { const b = barriersFor(s, card, id); if (b.length) m[id] = b; }
    return m;
  }

  function enact(s, card) {
    const p = W.POLICIES[card];
    if (!p) return fail("没有这种政策：" + card, "No such policy: " + card);
    if (s.used[card] && !p.repeatable) return fail("这项政策已经执行过了", "That policy has already been enacted");
    if (p.requires && p.requires.built && !built(s, p.requires.built)) return fail("需要先建" + W.FACILITIES[p.requires.built].name.zh, "Build " + W.FACILITIES[p.requires.built].name.en + " first");
    if (p.requires && p.requires.flag && !s.flags[p.requires.flag]) return fail("现在不需要这项政策", "That policy isn't needed right now");
    if (s.points < p.cost) return fail("这个十年的政策点用完了", "This decade's policy points are used up");
    s.points -= p.cost;
    s.used[card] = true;
    Object.assign(s.flags, p.flags || {});
    addStars(s, p.stars);
    applyDeltas(s, p.delta || {});
    return { ok: true, event: emit(s, { type: "policy", card, deltas: Object.assign({}, p.delta || {}), flags: Object.assign({}, p.flags || {}), satisfaction: Object.assign({}, s.satisfaction) }) };
  }

  // 测试用：手动改某户满意度（模拟游戏里别的原因）
  function adjust(s, resident, delta, reason) {
    if (!W.RESIDENTS[resident]) return fail("没有这一户", "No such household");
    applyDeltas(s, { [resident]: delta });
    return { ok: true, event: emit(s, { type: "satisfaction", resident, deltas: { [resident]: delta }, reason: reason || "", satisfaction: Object.assign({}, s.satisfaction) }) };
  }

  function nextDecade(s) {
    if (s.decade >= W.DECADES.length) return fail("地契已经到期", "The lease has run out");
    s.decade += 1;
    s.year = W.DECADES[s.decade - 1].years[0];
    s.points = POINTS_PER_DECADE;
    return { ok: true, event: emit(s, { type: "decade", built: s.plots.filter(Boolean).map((p) => p.card), flags: Object.assign({}, s.flags), satisfaction: Object.assign({}, s.satisfaction) }) };
  }

  // V0.2 → 游戏端：只接受这两种
  function applyTrpg(s, ev) {
    if (ev.type === "trpg_spend") {
      if (s.points < ev.points) return fail("政策点不够", "Not enough policy points");
      s.points -= ev.points;
      s.log.push(Object.assign({ received: true }, ev));
      return { ok: true };
    }
    if (ev.type === "trpg_feedback") {
      if (!W.RESIDENTS[ev.resident] || !Number.isFinite(ev.delta)) return fail("回传格式不对", "Malformed feedback");
      applyDeltas(s, { [ev.resident]: ev.delta });
      s.log.push(Object.assign({ received: true }, ev));
      return { ok: true };
    }
    if (ev.type === "trpg_info") { s.log.push(Object.assign({ received: true }, ev)); return { ok: true }; }
    return fail("游戏端不接受这种事件：" + ev.type, "The game doesn't accept this event: " + ev.type);
  }

  function drain(s) { const out = s.outbox; s.outbox = []; return out; }

  // 预置剧本：每个十年一组操作，方便反复测试同一种局面
  const SCRIPTS = {
    efficiency: {
      name: { zh: "效率优先", en: "Efficiency first" },
      decades: [
        [["build", "smart"], ["build", "hawker"], ["enact", "cleanup"]],
        [["enact", "rent_rise"], ["build", "bus"], ["build", "childcare"]],
        [["enact", "tighten_quota"], ["build", "solar"], ["build", "feedback"]]
      ]
    },
    warmth: {
      name: { zh: "人情优先", en: "People first" },
      decades: [
        [["build", "blank"], ["build", "childcare"], ["enact", "cooking_corner"]],
        [["build", "rest"], ["build", "hawker"], ["enact", "keep_stalls"]],
        // 人情路线拿的星少，到这里 4 块地已经用完、没有解锁新地块（原作的设计），所以只剩政策
        [["enact", "register"]]
      ]
    }
  };

  function runScript(s, name, decade) {
    const steps = (SCRIPTS[name] && SCRIPTS[name].decades[(decade || s.decade) - 1]) || [];
    return steps.map(([verb, card]) => (verb === "build" ? build(s, card) : enact(s, card)));
  }

  root.V2Sim = { POINTS_PER_DECADE, BUILD_COST, START_SATISFACTION, SCRIPTS, createSim, build, enact, adjust, nextDecade, applyTrpg, drain, runScript, barriersFor, built };
})(typeof window !== "undefined" ? window : globalThis);
