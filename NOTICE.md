# NOTICE · 来源说明

## Downstairs · 99 Years（team-4）

本项目的世界来自 **Downstairs · 99 Years**，CDE5311-Aug2026 课程 team-4（ssykx4 等组员）的游戏，`downstairs-demo` 分支的 `engine.js`。从那里来的有：

- 新加坡组屋邻区、99 年地契、十个十年和它们的标题、五户住户和他们的 id；
- 住户的需求、障碍、记忆照片的标题和五句原作台词（`prototype-v0.2/js/world.js` 的 `needs`、`barriers`、`photo`、`quote`）；"不拜访就不知道障碍"的思路；
- 游戏端模拟器里设施的需求和星级、四类评价、7 个地块和解锁的星数（`prototype-v0.2/js/sim.js`）；
- 设施可达性的判定，照搬 `engine.js` 的 `hiddenAccess`（`sim.js`）；
- 原作信件里的冲突和抉择，改写成了局势钟的种子和几条政策。

这些内容经 team-4 组员同意收录在本仓库。其余的世界观和人物扩写、规则层、提示词和界面是本项目自己写的；哪些是参考、哪些是自己的决定，`docs/PROTOTYPE_V0.2_DESIGN.md` 第 1 节的来源图例和各节的标记都写了。

The world comes from **Downstairs · 99 Years**, a game by team-4 of the CDE5311-Aug2026 course (ssykx4 and teammates), `downstairs-demo` branch, `engine.js`: the HDB neighbourhood, the 99-year lease, the ten decades and their titles, the five households and their ids; the residents' needs, barriers, memory-photo titles and five original quotes (`world.js`); the simulator's facility needs and star ratings, review categories, plots and unlock thresholds (`sim.js`); the accessibility check copied from `hiddenAccess` (`sim.js`); and the conflicts and choices in the original letters, rewritten as clock seeds and policies. They are included here with the team-4 members' permission. Everything else (world and character expansion, rules layer, prompts, UI) was written for this project; `docs/PROTOTYPE_V0.2_DESIGN.md` §1 tags every design choice by source.

## 新加坡历史 · Singapore history

住户是虚构的，但背景依据真实的新加坡历史和制度（组屋、种族融合政策、客工宿舍等）。出处列在 `docs/V0.2_WORLD.md` 第八节。The residents are fictional; the historical and policy background is sourced in `docs/V0.2_WORLD.md` §8.

## 字体 · Fonts

界面运行时从 Google Fonts 加载 Barlow Condensed 和 Noto Sans SC（SIL Open Font License 1.1），仓库里不带字体文件。The UI loads Barlow Condensed and Noto Sans SC from Google Fonts at runtime (SIL OFL 1.1); no font files are bundled.
