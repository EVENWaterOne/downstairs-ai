/* 对外接口：V0.2 自己的界面和以后的真游戏都只走这几个函数。
 * 游戏端现在是模拟器（sim.js）；接入真游戏时，用游戏发来的事件替换 syncFromGame 的来源即可。不依赖 DOM。 */
(function (root) {
  "use strict";
  const H = root.V2Harness, S = root.V2Sim;

  function createSession(opts) {
    opts = opts || {};
    const session = { state: H.createState(opts), sim: opts.sim === false ? null : S.createSim() };
    return session;
  }

  // 游戏端 → V0.2
  function pushGameEvent(session, ev) { return H.pushGameEvent(session.state, ev); }
  function syncFromGame(session) {
    if (!session.sim) return [];
    return S.drain(session.sim).map((ev) => pushGameEvent(session, ev));
  }

  // V0.2 → 游戏端
  function flushToGame(session) {
    const out = H.drainOutbox(session.state);
    return out.map((ev) => (session.sim ? Object.assign({ event: ev }, S.applyTrpg(session.sim, ev)) : { event: ev, ok: true }));
  }

  // 一次提案（GM / 规划 / 角色输出 / 界面）。M2 里 act(text) 会在这之上跑模型调用
  function propose(session, proposal) {
    const results = H.apply(session.state, proposal);
    const sent = flushToGame(session);
    return { results, sent };
  }

  // 模拟器上的操作：做完立刻同步给 V0.2
  function gameAction(session, verb, ...args) {
    const r = S[verb](session.sim, ...args);
    return Object.assign(r, { synced: syncFromGame(session) });
  }
  function advanceDecade(session) { return gameAction(session, "nextDecade"); }

  function getView(session, perceiver) { return H.getView(session.state, perceiver); }
  // extra：界面另外要带上的东西（比如每次调用的用量）
  function exportLog(session, extra) {
    return JSON.stringify(Object.assign({ format: "emergent-trpg/v0.2-log", exported_from: "prototype-v0.2", state: session.state, sim: session.sim }, extra || {}), null, 2);
  }

  root.V2Session = { createSession, pushGameEvent, syncFromGame, flushToGame, propose, gameAction, advanceDecade, getView, exportLog };
})(typeof window !== "undefined" ? window : globalThis);
