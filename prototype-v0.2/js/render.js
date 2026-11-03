/* 画棋盘：平面图 + 棋子（M2 的占位美术，10-28 Polaris：朴素简单，但不能难看）。
 * 全部用 canvas 现画，不用外部素材：墙、地面、门是色块，家具是带图标的小方块，人是圆形棋子。
 * 11-02 只剩各家：不再画楼下的草地、栏杆、柱子和地块，门一律写"出门"（换家用门牌栏，见 app.js）。
 * 以后换成生成的图，只改这个文件。 */
(function (root) {
  "use strict";
  const W = root.V2World, M = root.V2Maps, B = root.V2Board, H = root.V2Harness;
  const T = 32;

  const PALETTE = {
    wall: "#4d5560", wallTop: "#677080", grid: "rgba(90,70,40,0.07)",
    floor: { flat: "#f2e9d8", dorm: "#e6e1d6" },
    door: "#c9a46a", doorText: "#fffaf0",
    furn: "#e2d5bd", furnEdge: "#cbb995",
    ink: "#2b2f36", inkSoft: "#6b7280", halo: "rgba(255,255,255,0.85)",
    player: "#1f2933", focus: "#e8833a", extras: "#9aa1aa"
  };
  // 每户一个颜色，棋子上写一个字
  const HOUSE = { chen: "#c2524a", lin: "#3d6fa8", aisyah: "#2f8a64", mei: "#b5822b", kumar: "#7b5ba8" };
  const MARK = { chen: "陈", weiming: "明", huiling: "玲", junhao: "豪", rahman: "R", aisyah_kassim: "A", nurul: "N", hafiz: "H", mak_esah: "E", kumar: "K", wangmei: "美", jianguo: "国", xiaoyu: "雨" };
  // 英文版用名字的首字母；同一户里重了就多取一个字母
  const MARK_EN = { chen: "C", weiming: "WM", huiling: "HL", junhao: "JH", rahman: "R", aisyah_kassim: "A", nurul: "N", hafiz: "H", mak_esah: "E", kumar: "K", wangmei: "M", jianguo: "JG", xiaoyu: "XY" };
  const GLYPH = {
    chess_board: "♟️", red_headscarf: "🧣", clogs: "👡", long_table: "🥘",
    prayer_mat: "🕌", kuih_tray: "🍡", laundry_pole: "👕", potted_plant: "🪴", altar: "🏮", tv: "📺", sofa: "🛋️",
    flashcards: "🔤", bicycle: "🚲", skateboard: "🛹", boxes: "📦", calendar: "📅", couplets: "🧧", bunk: "🛏️", locker: "🗄️",
    family_photo: "🖼️", shrine: "🪔", lunch_tiffin: "🍱", kopi_cup: "☕", flyer: "📄",
    forms: "📋", bed: "🛏️", table: "🍽️", stove: "🍳", wardrobe: "👔"
  };
  const FONT_ZH = '"PingFang SC","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif';
  const FONT_EN = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans SC",sans-serif';
  let FONT = FONT_ZH;
  const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

  function floorFor(mapId) { return mapId.startsWith("flat_") ? PALETTE.floor.flat : PALETTE.floor[mapId] || PALETTE.floor.flat; }
  const L = (lang, o) => (o ? o[lang] || o.zh : "");

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function label(ctx, text, x, y, size, color, weight) {
    ctx.font = `${weight || 500} ${size}px ${FONT}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 3; ctx.strokeStyle = PALETTE.halo; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  function glyph(ctx, g, x, y, size) {
    ctx.font = `${size}px ${EMOJI}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = PALETTE.ink; ctx.fillText(g, x, y + 1);
  }

  function createRenderer(canvas) {
    const ctx = canvas.getContext("2d");
    const disp = {}; // 棋子显示的位置（走动有一点动画）
    let scale = 1, mapId = null, fitKey = "";

    function fit(state, box) {
      const m = M.MAPS[state.actors.player.map];
      const cols = Math.max(...m.rows.map((r) => r.length)), rows = m.rows.length;
      const w = box.width, h = box.height;
      scale = Math.max(box.min || 0.5, Math.min(w / (cols * T), h / (rows * T), 2));
      const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
      canvas.style.width = Math.round(cols * T * scale) + "px";
      canvas.style.height = Math.round(rows * T * scale) + "px";
      canvas.width = Math.round(cols * T * scale * dpr);
      canvas.height = Math.round(rows * T * scale * dpr);
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    }

    function drawTiles(state, id) {
      const m = M.MAPS[id];
      m.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const t = row[x], px = x * T, py = y * T;
          if (t === "#") {
            ctx.fillStyle = PALETTE.wall; ctx.fillRect(px, py, T, T);
            ctx.fillStyle = PALETTE.wallTop; ctx.fillRect(px, py, T, 5);
            continue;
          }
          ctx.fillStyle = floorFor(id);
          ctx.fillRect(px, py, T, T);
          ctx.strokeStyle = PALETTE.grid; ctx.lineWidth = 1; ctx.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);
          if (m.exits[t]) {
            // 门：写"出门"。换一家用地图上面的门牌，不走门
            ctx.fillStyle = PALETTE.door;
            rr(ctx, px + 3, py + 3, T - 6, T - 6, 4); ctx.fill();
            const name = state.lang === "en" ? "Out" : "出门";
            ctx.font = `600 10px ${FONT}`;
            ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = PALETTE.doorText;
            ctx.fillText(name, px + T / 2, py + T / 2 + 1);
          }
        }
      });
    }

    function drawThings(state, id) {
      const scene = state.scene.map === id ? state.scene.props : [];
      for (const f of B.furniture(state, id).concat(scene)) {
        const px = f.x * T, py = f.y * T;
        ctx.fillStyle = PALETTE.furn; rr(ctx, px + 3, py + 3, T - 6, T - 6, 5); ctx.fill();
        ctx.strokeStyle = PALETTE.furnEdge; ctx.lineWidth = 1; ctx.stroke();
        glyph(ctx, GLYPH[f.kind] || "▪️", px + T / 2, py + T / 2, 16);
      }
    }

    // 无名配角（老伯 ×3）：灰色小棋子，写人数，名字写在下面；只占格子、不说话
    function extrasToken(state, g) {
      const cx = g.x * T + T / 2, cy = g.y * T + T / 2;
      ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.beginPath(); ctx.ellipse(cx, cy + 10, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PALETTE.extras; ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = `700 10px ${FONT}`; ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(g.count > 1 ? String(g.count) : "·", cx, cy + 1);
      label(ctx, g.label, cx, cy + 19, 9, PALETTE.inkSoft, 500);
    }

    function token(state, a, ui, now, above) {
      const d = disp[a.id];
      const cx = d.x * T + T / 2, cy = d.y * T + T / 2;
      const isPlayer = a.id === "player";
      const color = isPlayer ? PALETTE.player : HOUSE[a.household] || "#777";
      if (ui.focus === a.id) {
        ctx.setLineDash([4, 3]); ctx.strokeStyle = PALETTE.focus; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.fillStyle = "rgba(0,0,0,0.14)"; ctx.beginPath(); ctx.ellipse(cx, cy + 11, 10, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.stroke();
      const mark = isPlayer ? (state.lang === "en" ? "You" : "你") : (state.lang === "en" ? MARK_EN : MARK)[a.id] || "?";
      ctx.font = `700 ${mark.length > 1 ? 9 : 12}px ${FONT}`; ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(mark, cx, cy + 1);
      const name = isPlayer ? "" : L(state.lang, W.characterName(a.id));
      if (name) label(ctx, name, cx, above ? cy - 19 : cy + 20, 9.5, PALETTE.ink, 600);
      if (ui.thinking && ui.thinking.has(a.id)) {
        const dots = ".".repeat(1 + (Math.floor(now / 350) % 3));
        ctx.fillStyle = "#ffffff"; rr(ctx, cx + 4, cy - 26, 22, 14, 6); ctx.fill();
        ctx.strokeStyle = PALETTE.inkSoft; ctx.lineWidth = 1; ctx.stroke();
        ctx.font = `700 10px ${FONT}`; ctx.fillStyle = PALETTE.ink; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(dots, cx + 15, cy - 20);
      } else if (ui.spoke && ui.spoke[a.id] && now - ui.spoke[a.id] < 4000) {
        glyph(ctx, "💬", cx + 13, cy - 15, 12);
      }
    }

    function draw(state, ui, box, now) {
      const p = state.actors.player;
      if (!p.map) return;
      FONT = state.lang === "en" ? FONT_EN : FONT_ZH;
      if (p.map !== mapId) { mapId = p.map; for (const k of Object.keys(disp)) delete disp[k]; }
      // 换图或容器大小变了才重设画布（重设会清空画布，也比较慢）
      const key = p.map + "|" + (box ? box.width + "x" + box.height : "");
      if (box && key !== fitKey) { fit(state, box); fitKey = key; }
      const m = M.MAPS[p.map];
      ctx.clearRect(0, 0, Math.max(...m.rows.map((r) => r.length)) * T, m.rows.length * T);
      drawTiles(state, p.map);
      drawThings(state, p.map);
      for (const g of H.extrasOn(state, p.map)) extrasToken(state, g);
      const people = Object.values(state.actors).filter((a) => a.map === p.map && (a.kind === "player" || W.characterPresent(a.id, state.time.year)));
      for (const a of people) {
        const d = disp[a.id];
        if (!d || Math.abs(d.x - a.x) + Math.abs(d.y - a.y) > 3) disp[a.id] = { x: a.x, y: a.y };
        else { d.x += (a.x - d.x) * 0.35; d.y += (a.y - d.y) * 0.35; if (Math.abs(a.x - d.x) < 0.02) d.x = a.x; if (Math.abs(a.y - d.y) < 0.02) d.y = a.y; }
      }
      for (const id of Object.keys(disp)) if (!people.some((a) => a.id === id)) delete disp[id];
      // 左右挨着的两个人，名字一个写在下面、一个写在上面，免得叠在一起
      const above = {};
      const at = new Map(people.map((a) => [a.x + "," + a.y, a.id]));
      people.sort((a, b) => a.y - b.y || a.x - b.x).forEach((a) => {
        const left = at.get((a.x - 1) + "," + a.y);
        above[a.id] = !!left && !above[left];
      });
      people.forEach((a) => token(state, a, ui || {}, now || 0, above[a.id]));
    }

    function cellAt(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      return [Math.floor((clientX - r.left) / (T * scale)), Math.floor((clientY - r.top) / (T * scale))];
    }

    // 玩家棋子在画布上的中心（像素），界面用它把地图滚到玩家那里
    function playerCenter(state) {
      const p = state.actors.player;
      return p.map ? [(p.x + 0.5) * T * scale, (p.y + 0.5) * T * scale] : [0, 0];
    }
    function animating(state) {
      return Object.values(state.actors).some((a) => disp[a.id] && (disp[a.id].x !== a.x || disp[a.id].y !== a.y));
    }

    return { draw, cellAt, playerCenter, animating };
  }

  root.V2Render = { T, PALETTE, HOUSE, MARK, MARK_EN, GLYPH, createRenderer };
})(typeof window !== "undefined" ? window : globalThis);
