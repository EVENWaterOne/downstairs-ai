/* 流式输出（11-02 Polaris："gm 是可以设定成流式输出的"）：GM 的 JSON 还没写完，就先把里面的叙述拿出来给玩家看。
 * 只看最外层 ops 里的 narrate（对 GM 说的那一轮还有 gm_reply）：检定分支里的叙述要等掷完骰才知道走哪一支，不先放。
 * 先放出来的只是"正在写"的样子，不进世界：整段写完、Harness 校验过，才变成真正的事件（turn.js 里 onStream(null) 之后重画）。
 *   设定门（leakCheck）在放出来之前先查一遍；没写完的那一截留后面几个字不放，免得半句照抄设定、元语言先露出来；
 *   查到了就整条不再放，等 Harness 退回、GM 重写。
 * 不依赖 DOM。 */
(function (root) {
  "use strict";

  // 宽容地读一段可能没写完的 JSON：读到哪算哪。每层先建好容器、挂到父层上，再往里填，所以中途停下时外面几层读到的部分都在。
  // 返回 { value, cut }：cut 是最后那个没写完的字符串在哪个对象的哪个键上（{ obj, key }），没有就是 null
  function readPartial(text) {
    // 模型偶尔在前面加 ```json 或一句话：从第一个 { 读起
    const t = String(text || "");
    const start = t.indexOf("{");
    if (start < 0) return { value: null, cut: null };
    let i = start, cut = null;
    const STOP = new Error("stop");
    const ws = () => { while (i < t.length && /\s/.test(t[i])) i++; };
    function str() {
      i++;
      let out = "";
      while (i < t.length) {
        const c = t[i];
        if (c === '"') { i++; return { s: out, done: true }; }
        if (c === "\\") {
          if (i + 1 >= t.length) break;
          const e = t[i + 1];
          if (e === "u") {
            const hex = t.slice(i + 2, i + 6);
            if (hex.length < 4) break;
            if (/^[0-9a-fA-F]{4}$/.test(hex)) out += String.fromCharCode(parseInt(hex, 16));
            i += 6;
            continue;
          }
          out += { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" }[e] || e;
          i += 2;
          continue;
        }
        out += c;
        i++;
      }
      i = t.length;
      return { s: out, done: false };
    }
    // 读一个值，挂到 holder[key] 上；没写完就挂上已有的部分，然后停
    function into(holder, key) {
      ws();
      if (i >= t.length) throw STOP;
      const c = t[i];
      if (c === "{") { const o = {}; holder[key] = o; return fillObj(o); }
      if (c === "[") { const a = []; holder[key] = a; return fillArr(a); }
      if (c === '"') {
        const r = str();
        holder[key] = r.s;
        if (!r.done) { cut = { obj: holder, key }; throw STOP; }
        return;
      }
      const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(t.slice(i));
      if (!m || i + m[0].length >= t.length) throw STOP; // 认不出来，或者可能还没写完（数字后面还会有字）
      i += m[0].length;
      holder[key] = JSON.parse(m[0]);
    }
    function fillObj(o) {
      i++;
      for (;;) {
        ws();
        if (i >= t.length) throw STOP;
        if (t[i] === "}") { i++; return; }
        if (t[i] === ",") { i++; continue; }
        if (t[i] !== '"') throw STOP;
        const k = str();
        if (!k.done) throw STOP;
        ws();
        if (i >= t.length || t[i] !== ":") throw STOP;
        i++;
        into(o, k.s);
      }
    }
    function fillArr(a) {
      i++;
      for (;;) {
        ws();
        if (i >= t.length) throw STOP;
        if (t[i] === "]") { i++; return; }
        if (t[i] === ",") { i++; continue; }
        into(a, a.length);
      }
    }
    const box = {};
    try { into(box, "v"); } catch (e) { if (e !== STOP) throw e; }
    return { value: box.v || null, cut };
  }

  // 现在能先给玩家看的几段：最外层 ops 里的 narrate（gmReply 为真时还有 gm_reply），按顺序。
  // done：这一段的字已经写完了（引号关上了）
  function visible(text, opts) {
    const { value, cut } = readPartial(text);
    const ops = value && Array.isArray(value.ops) ? value.ops : [];
    const out = [];
    for (const op of ops) {
      if (!op || typeof op !== "object" || Array.isArray(op)) continue;
      const kind = op.op;
      if (kind !== "narrate" && !(kind === "gm_reply" && opts && opts.gmReply)) continue;
      // "op" 本身还没写完（"narr"）就不算；text 还没开始写就先不放
      if (cut && cut.obj === op && cut.key === "op") continue;
      if (typeof op.text !== "string" || !op.text) continue;
      out.push({ kind, text: op.text, done: !(cut && cut.obj === op && cut.key === "text") });
    }
    return out;
  }

  // 没写完的那一截留后面几个字不放：设定门按 12 个字（英文 8 个词）一段查照抄，元语言的词也就几个字，
  // 留着的这几个字查过了才放，免得露出半句。写完的整段一次放出来
  const HOLD_ZH = 12, HOLD_EN = 48;
  function holdBack(text, lang) {
    const chars = Array.from(text);
    if (lang === "en") {
      if (chars.length <= HOLD_EN) return "";
      const head = chars.slice(0, chars.length - HOLD_EN).join("");
      const sp = head.lastIndexOf(" ");
      return sp > 0 ? head.slice(0, sp) : "";
    }
    return chars.length <= HOLD_ZH ? "" : chars.slice(0, chars.length - HOLD_ZH).join("");
  }

  // 把模型一点点写出来的原文变成给玩家看的几段。check(text) 返回非空表示这段过不了设定门：这一段从此不再放。
  // show(list) 只在要看的东西变了时调用；list 里每项是 { kind, text, done }
  // 和 Harness 一样截：叙述最多 1200 个字符，出戏回答先去掉首尾空白、最多 600（harness.js 的 narrate、gm_reply）
  const LIMIT = { narrate: (t) => t.slice(0, 1200), gm_reply: (t) => t.trim().slice(0, 600) };
  function viewer(opts) {
    const blocked = new Set();
    let last = "";
    return function onText(raw) {
      const items = visible(raw, { gmReply: !!opts.gmReply });
      const out = [];
      items.forEach((it, n) => {
        if (blocked.has(n)) return;
        const text = LIMIT[it.kind](it.text);
        // 没写完时最后一个词可能只写了一半（"tension" 后面还有 "s"）：英文的元语言词按整词查，半个词会误报，先去掉再查。
        // 留着不放的字比这半个词多，所以放出来的部分都查过了
        const probe = it.done ? text : text.replace(/[A-Za-z0-9'’-]+$/, "");
        if (opts.check && probe && opts.check(probe)) { blocked.add(n); return; }
        const shown = it.done ? text : holdBack(text, opts.lang);
        if (shown) out.push({ kind: it.kind, text: shown, done: it.done });
      });
      const key = JSON.stringify(out);
      if (key === last) return;
      last = key;
      opts.show(out);
    };
  }

  root.V2Stream = { readPartial, visible, holdBack, viewer, HOLD_ZH, HOLD_EN };
})(typeof window !== "undefined" ? window : globalThis);
