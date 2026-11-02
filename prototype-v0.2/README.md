# Prototype V0.2 · Downstairs · 楼下的另一面

以 team-4 的 Downstairs 为背景：1989 年交钥匙的新加坡组屋 BLK 317A，你是新来的社区工作者，和五户住户面对面说话。游戏本体负责建设、政策和满意度，V0.2 是同一个世界的另一个视角。

- 计划：[docs/V0.2_PLAN.md](../docs/V0.2_PLAN.md)
- 世界观与角色：[docs/V0.2_WORLD.md](../docs/V0.2_WORLD.md)
- 设计说明（参考 vs 决定）：[docs/PROTOTYPE_V0.2_DESIGN.md](../docs/PROTOTYPE_V0.2_DESIGN.md)，M2 的部分在第 11 节，10-29 试玩之后的修改在 11.10，上下文和缓存在 11.11

## 现在有什么（M2）

第一个十年（1989–1998）可以玩，中文和英文（开始界面第一栏选语言）：

- 八个挑出来的日子，每个日子从早到晚，想去哪、跟谁说话都可以
- 平面图上走动（方向键 / WASD，或者点格子），点一个人就"对着"他说话
- 你打的字都是话：对住户说是角色说出口的，在场的人都听得到；想做什么、想问什么，切到"对 GM"，住户听不到，GM 去做，再告诉你和在场的人结果
- 有人来、走、换手上的事，地图会跟着变；GM 写到的无名配角（"老伯 ×3"）也画在地图上
- GM 和住户由模型扮演；花政策点的事要你确认
- 住户说方言或外语时，台词下面会给一句翻译
- 右边的写字板：游戏端模拟（建设、政策、满意度）、你知道的事、每次模型调用的记录
- 每次调用的 token 数和占上下文多少，每轮、整局的合计（claude.ai 内置的 Claude 不报用量，按字数估算）
- 填 Anthropic API Key 时用提示词缓存：不常变的部分放前面，历史按最近两个时段取，写字板里看缓存命中了多少（设计说明 11.11）
- 默认身份是何志强（英文版是 Ho Chee Keong），可以在开始界面改

## 怎么打开

- 网页版：用下面的打包命令加 `--artifact` 发布到 claude.ai，就可以用自己的 Claude 账号当 GM 和住户
- 本地：直接用浏览器打开 `prototype-v0.2/index.html`

模型可以选：

- **离线演示**：不调用模型，用写好的台词把流程走一遍
- **Claude（claude.ai 网页内置）**：在 claude.ai 上打开发布的网页时可用，用你自己的账号
- **Anthropic API** 或 **OpenAI 兼容**（DeepSeek 等）：填 API Key

打包成一个文件：

```sh
python3 prototype-v0.2/tools/build_single.py out.html             # 双击就能打开
python3 prototype-v0.2/tools/build_single.py out.html --artifact  # 发布到 claude.ai 用
```

## 文件

- `js/world.js`：住户、设施、政策、十个十年、钟种子，中英两份
- `js/maps.js`：固定底图、家具和物件清单
- `js/sim.js`：游戏端模拟器
- `js/harness.js`：规则层
- `js/session.js`：对外接口
- `js/board.js`、`js/days.js`：棋盘规则；日子和日程
- `js/llm.js`、`js/tokens.js`、`js/prompts.js`、`js/turn.js`、`js/mock.js`：模型调用、token 数和上下文用量、提示词（中英两套）、一轮的流程、离线演示
- `js/render.js`、`js/app.js`、`index.html`、`styles.css`：界面

## 测试

```sh
node --test prototype-v0.2/tests/*.test.js
```
