/* 棋盘：走动、碰撞、门（M2）。
 * 地图在这里只是跑团的棋盘和辅助叙事（10-28 Polaris：RPG 部分从简，该抄就抄），规则照 RPG Maker 的老规矩：
 * 一步一格、四个方向；墙、家具和人挡路。寻路是最普通的广度优先搜索。
 * 11-02 只剩各家（maps.js）：门不再通到别的图，踩到门只提示去用门牌；换一家用 visit，站到那一家进门的地方，不花时间。
 * 家具 = maps.js 的 FURNITURE + 这一天临时摆出来的东西（state.day_props，由 days.js 写）。GM 的场景物件不挡路；无名配角（state.extras）挡路。
 * 不依赖 DOM。 */
(function (root) {
  "use strict";
  const W = root.V2World, M = root.V2Maps, H = root.V2Harness;
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const key = (x, y) => x + "," + y;

  // 这张图上挡路的东西：[{ kind, x, y }]
  function furniture(state, mapId) { return H.furnitureOn(state, mapId); }
  function furnitureAt(state, mapId, x, y) { return furniture(state, mapId).find((f) => f.x === x && f.y === y) || null; }

  function personAt(state, mapId, x, y, except) {
    return Object.values(state.actors).find((a) => a.id !== except && a.map === mapId && a.x === x && a.y === y && (a.kind === "player" || W.characterPresent(a.id, state.time.year))) || null;
  }

  // 无名配角（一组人一个棋子）
  function extrasAt(state, mapId, x, y) { return ((state && state.extras) || []).find((g) => g.map === mapId && g.x === x && g.y === y) || null; }

  // 能不能站：底图能站人、没有家具、没有别人
  function free(state, mapId, x, y, except) {
    return M.standable(mapId, x, y) && !furnitureAt(state, mapId, x, y) && !personAt(state, mapId, x, y, except) && !extrasAt(state, mapId, x, y);
  }

  function exitAt(mapId, x, y) {
    const t = M.tile(mapId, x, y), m = M.MAPS[mapId];
    if (!t || !m || !m.exits[t]) return null;
    return Object.assign({ char: t }, m.exits[t]);
  }

  function homeOf(mapId) { return Object.keys(W.RESIDENTS).find((id) => W.RESIDENTS[id].home === mapId) || null; }
  const DOOR_HINT = { zh: "要去别家，点地图上面的门牌。", en: "To go to another home, use the door plates above the map." };

  // 从 (x, y) 往外找最近的空位（包括它自己）
  function nearestFree(state, mapId, x, y, opts) {
    opts = opts || {};
    const taken = opts.taken || new Set();
    const ok = (cx, cy) => free(state, mapId, cx, cy, opts.except) && !taken.has(key(cx, cy)) && !(opts.noExit && exitAt(mapId, cx, cy));
    const m = M.MAPS[mapId];
    if (!m) return null;
    const seen = new Set([key(x, y)]);
    const queue = [[x, y]];
    while (queue.length) {
      const [cx, cy] = queue.shift();
      if (M.tile(mapId, cx, cy) != null && ok(cx, cy)) return [cx, cy];
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (seen.has(key(nx, ny)) || M.tile(mapId, nx, ny) == null) continue;
        seen.add(key(nx, ny));
        queue.push([nx, ny]);
      }
    }
    return null;
  }

  // 寻路：广度优先，返回不含起点的格子序列；目标站不了人（比如是某个人）时，走到他旁边
  function path(state, mapId, from, to) {
    const goals = new Set();
    if (free(state, mapId, to[0], to[1], "player")) goals.add(key(to[0], to[1]));
    else for (const [dx, dy] of DIRS) if (free(state, mapId, to[0] + dx, to[1] + dy, "player")) goals.add(key(to[0] + dx, to[1] + dy));
    if (goals.has(key(from[0], from[1]))) return [];
    if (!goals.size) return null;
    const prev = new Map([[key(from[0], from[1]), null]]);
    const queue = [from];
    while (queue.length) {
      const [cx, cy] = queue.shift();
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy, k = key(nx, ny);
        if (prev.has(k) || !free(state, mapId, nx, ny, "player")) continue;
        // 门只能当终点，不能穿过
        if (exitAt(mapId, nx, ny) && !goals.has(k)) continue;
        prev.set(k, [cx, cy]);
        if (goals.has(k)) {
          const out = [];
          for (let p = [nx, ny]; p && key(p[0], p[1]) !== key(from[0], from[1]); p = prev.get(key(p[0], p[1]))) out.unshift(p);
          return out;
        }
        queue.push([nx, ny]);
      }
    }
    return null;
  }

  // 玩家走一步。踩到门就换图（门关着就停在原地）
  function step(state, dx, dy) {
    const p = state.actors.player;
    const x = p.x + dx, y = p.y + dy;
    return moveTo(state, x, y);
  }
  function moveTo(state, x, y) {
    const p = state.actors.player;
    if (Math.abs(x - p.x) + Math.abs(y - p.y) !== 1) return { ok: false };
    if (!free(state, p.map, x, y, "player")) {
      const who = personAt(state, p.map, x, y, "player");
      return { ok: false, bump: who ? who.id : null };
    }
    // 踩到门：不换图，提示用门牌
    if (exitAt(p.map, x, y)) return { ok: false, door: true, reason: DOOR_HINT };
    return H.applyOp(state, { op: "move", actor: "player", x, y }, { by: "ui" });
  }

  // 去另一家（门牌栏）：还没搬来、家里没人的去不了（规则在 harness.js 的 canVisit，GM 带玩家过去也查同一条）。
  // 站到进门的那一格，被占了就站最近的空位
  function visit(state, mapId) {
    const p = state.actors.player, from = p.map;
    if (mapId === from) return { ok: false, same: true };
    const v = H.canVisit(state, mapId);
    if (!v.ok) return { ok: false, reason: v.reason };
    const [ex, ey] = M.entryOf(mapId);
    const spot = nearestFree(state, mapId, ex, ey, { except: "player", noExit: true });
    if (!spot) return { ok: false, reason: { zh: "屋里站满了人，进不去。", en: "The flat is packed; you can't get in." } };
    const r = H.applyOp(state, { op: "move", actor: "player", map: mapId, x: spot[0], y: spot[1] }, { by: "ui" });
    return Object.assign({ changedMap: !!r.ok, from }, r);
  }

  // 玩家身边（上下左右）的人
  function adjacent(state) {
    const p = state.actors.player;
    return DIRS.map(([dx, dy]) => personAt(state, p.map, p.x + dx, p.y + dy, "player")).filter(Boolean).map((a) => a.id);
  }
  // 同一张图上的人，按离玩家的远近排
  function nearby(state) {
    const p = state.actors.player;
    return Object.values(state.actors)
      .filter((a) => a.kind === "resident" && a.map === p.map && W.characterPresent(a.id, state.time.year))
      .sort((a, b) => (Math.abs(a.x - p.x) + Math.abs(a.y - p.y)) - (Math.abs(b.x - p.x) + Math.abs(b.y - p.y)))
      .map((a) => a.id);
  }

  root.V2Board = { DIRS, furniture, furnitureAt, personAt, extrasAt, free, exitAt, homeOf, nearestFree, path, step, moveTo, visit, adjacent, nearby, DOOR_HINT };
})(typeof window !== "undefined" ? window : globalThis);
