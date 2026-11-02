// 按浏览器里的顺序加载普通脚本（它们挂在 globalThis 上）
const path = require("path");
for (const f of ["world", "maps", "sim", "harness", "session", "board", "days", "llm", "tokens", "prompts", "mock", "turn"]) require(path.join(__dirname, "..", "js", f + ".js"));
const g = globalThis;
module.exports = {
  W: g.V2World, M: g.V2Maps, S: g.V2Sim, H: g.V2Harness, API: g.V2Session,
  B: g.V2Board, D: g.V2Days, LLM: g.V2LLM, P: g.V2Prompts, Mock: g.V2Mock, Turn: g.V2Turn, Tok: g.V2Tokens
};
