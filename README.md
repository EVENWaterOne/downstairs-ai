# Downstairs AI · 楼下

一个用大模型跑的单人跑团原型。1989 年，新加坡组屋 BLK 317A 刚交钥匙，你是新来的社区工作者，一家一家上门，打字和住户面对面说话。GM 和每位住户各由一次模型调用扮演，中间有一个规则层（Harness）决定哪些事能写进世界、谁知道什么。

世界来自 team-4 的游戏 **Downstairs · 99 Years**：游戏本体负责建设、政策和住户满意度，这里是同一个世界的另一个视角。来源见 [NOTICE.md](NOTICE.md)。

[English below](#english)

## 现在能玩什么

原型阶段（M2）：第一个十年（1989–1998）可以玩，中文和英文都有。还没有用真实模型系统地测过效果。

- 八个挑出来的日子，每天从早到晚，想去哪一家、跟谁说话都可以
- 地图只有住户自己的家（四户人家和 Kumar 他们的宿舍）；点地图上面的门牌去别家，屋里用方向键 / WASD 或点格子走动。楼下和走廊只在话里和旁白里出现
- 你打的字都是话：对住户说，在场的人都听得到；切到"对 GM"，是玩家身份说的，住户听不到，GM 去做，再告诉你结果
- 住户只知道自己家、自己所在的地方和自己经历过的事；不会知道自己的将来
- 住户说方言或外语时，台词下面有一句翻译
- 右边的写字板：游戏端模拟（建设、政策、满意度）、你知道的事、每次模型调用的提示词、输出和 token 用量
- 填 Anthropic API Key 时用提示词缓存，写字板里能看到命中了多少

## 怎么打开

不用构建，直接用浏览器打开 `prototype-v0.2/index.html`。开始界面选语言、模型和身份：

- **离线演示**：不调用模型，用写好的台词把流程走一遍
- **Anthropic API**：填自己的 API Key（默认 `claude-sonnet-5-5`）
- **OpenAI 兼容**：DeepSeek 等，填地址、模型名和 Key
- **Claude（claude.ai 网页内置）**：把它打包发布成 claude.ai 上的网页时可用，用浏览者自己的账号

API Key 只留在你的浏览器里：勾了"在这个浏览器里记住 Key"才存进 localStorage，请求直接从浏览器发到接口。

打包成一个文件：

```sh
python3 prototype-v0.2/tools/build_single.py out.html             # 双击就能打开
python3 prototype-v0.2/tools/build_single.py out.html --artifact  # 发布到 claude.ai 用
```

## 怎么做的

一轮是这样走的：GM 看完整的世界，提出操作（定细节、挪人、掷骰、叙述……）→ 规则层逐条校验后写入 → 被叫到的住户各自拿到只属于自己的视角，说话、做动作 → 规则层再校验一遍（不能把设定直接说出口，不能引用没经历过的事，离开要真的离开）。模型只提案，世界由规则层决定。

代码是普通脚本，不依赖构建工具，规则部分不依赖 DOM：

| 文件 | 内容 |
|---|---|
| `js/world.js` | 住户、设施、政策、十个十年、历史事件，中英两份 |
| `js/harness.js` | 规则层：事件和感知、操作校验、满意度回传、局势钟 |
| `js/sim.js` | 游戏端模拟器 |
| `js/prompts.js`、`js/turn.js` | 提示词和一轮的流程 |
| `js/llm.js`、`js/tokens.js` | 模型调用、token 用量和缓存 |
| `js/app.js`、`js/render.js` | 界面和平面图 |

测试（Node 20 以上）：

```sh
node --test prototype-v0.2/tests/*.test.js
```

## 文档（中文）

- [docs/V0.2_PLAN.md](docs/V0.2_PLAN.md)：计划和要测的问题
- [docs/V0.2_WORLD.md](docs/V0.2_WORLD.md)：世界观和角色设定，史实出处在第八节
- [docs/PROTOTYPE_V0.2_DESIGN.md](docs/PROTOTYPE_V0.2_DESIGN.md)：每个设计选择的来源（参考了什么、自己决定了什么）

这个仓库是从一个私有研究仓库里拿出来的 V0.2。文档里提到的 V0.1、`docs/DECISIONS.md` 等在那个仓库里，没有公开。

## 许可

目前不提供开源许可证：© 2026 Deqing RUAN，保留所有权利。来自 Downstairs · 99 Years 的部分经 team-4 组员同意收录，见 [NOTICE.md](NOTICE.md)。

---

## English

A single-player tabletop RPG prototype run by language models. It is 1989 and HDB block 317A in Singapore has just been handed over. You are the new community worker: go from home to home and type to talk with the residents face to face. The map is only the residents' own homes (four flats and the dormitory room Kumar shares); the void deck and corridors come up in talk and narration. The GM and each resident are separate model calls; a rules layer (the harness) decides what becomes true in the world and who knows what.

The world comes from **Downstairs · 99 Years**, a game by team-4, where the game itself handles building, policy and resident satisfaction; this is another view of the same world. See [NOTICE.md](NOTICE.md).

**Status:** prototype (M2). The first decade (1989–1998) is playable in Chinese and English. It has not yet been tested systematically with real models.

**Run it:** open `prototype-v0.2/index.html` in a browser, no build step. Pick a language, a model and an identity on the start screen: offline demo (no model calls), Anthropic API (your own key, default `claude-sonnet-5-5`), any OpenAI-compatible API (DeepSeek and others), or the Claude built into claude.ai when published there as an artifact. Your API key stays in your browser: it is saved to localStorage only if you tick "Remember the key in this browser", and requests go straight from the browser to the API.

**How it works:** each round the GM sees the whole world and proposes operations (settle a detail, move someone, roll, narrate); the harness validates and applies them one by one; each resident who is asked to respond gets only their own view (their home, where they are, what they perceived; never their own future) and speaks or acts; the harness checks that too (no stating the setting outright, no citing events they did not witness, leaving means leaving). Models only propose; the harness owns the world. Prompts are ordered by how often they change so Anthropic prompt caching can reuse most of each request.

**Tests** (Node 20+): `node --test prototype-v0.2/tests/*.test.js`

**Docs** are in Chinese: the plan, the world and character bible (sources in §8), and a design note that tags every choice by where it came from. This repository is the V0.2 part of a private research repository; V0.1 and docs such as `docs/DECISIONS.md` mentioned in the notes are not published.

**License:** none for now. © 2026 Deqing RUAN, all rights reserved. Material from Downstairs · 99 Years is included with the team-4 members' permission; see [NOTICE.md](NOTICE.md).
