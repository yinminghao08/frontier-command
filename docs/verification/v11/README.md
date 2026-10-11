# v11 Agent 验证记录

2026-10-08，在 Windows 本地生产 Electron 中运行，存档、API 配置和协议服务均隔离。未提供外部 provider 凭据，LLM 协议测试使用 `tests/e2e/agent-provider.ts` 本地 HTTP 服务；应用本身没有 scripted decision fallback。

- `npm run build`：通过，严格 TypeScript、Vite 与 Electron main 编译成功。
- `npm test`：17 个文件、227 项测试全部通过。之后对 Demo 决策节点和转义凭据保护的补充检查分别通过 2 项和 7 项相关测试。
- Electron 全量回归初次运行 45 项：42 项通过，3 项旧用例预期需要更新。实际窗口尺寸改用 BrowserWindow content bounds 校验；矿场到场流程用 4× 消除 1× 的墙钟预算误差；虫洞断言允许已确认出口公开，未确认出口仍为 null。
- 针对性 Electron 检查：两个 Agent 协议闭环、便携 Demo 与一键生成、上述三项旧用例全部通过。新增通讯大字号检查最初等待了被窄屏收起的主导航，改为等待常驻通讯按钮后通过。合计 47 个独立 Electron 场景已分别完成验收；没有在最后重复执行全套。

## 新功能实际结果

| 流程 | 实际验证 |
| --- | --- |
| 运输/护航 | 公开矿场库存 → Mira 请求 `@Talia` → Talia 接受并提交真实 ESCORT → Mira HAUL → 实际装货 → 确认虫洞捷径 → 实际卸货 40 Materials → 群聊报告、XP、关系与记忆 |
| 拒绝与故障 | 疲劳 Battle 拒绝请求，运输暂缓；非法 JSON/schema 私聊报错，手动再次决策恢复，模拟保持可用 |
| 通讯 | 群聊、每人私聊、提及解析、私聊实际影响 DOCK 行动、未读清除、按钮拖动、窄窗口及 200% 文字输入/发送 |
| 培养与模型 | Credits 实际扣款，90 游戏分钟训练完成，新 Agent 手动分舰；独立 Model/effort、NONE 不发推理参数，不支持参数的 provider 兼容重试 |
| 存档与凭据 | 重启保留聊天、任务、培养和模型覆盖；Windows safeStorage 加密 Key，公开 settings/Snapshot/世界文件没有 Key；过期响应不能盖过 Admiral 指令 |
| Demo | 直接加载随附 SaveStore 目录，未配置 API 也能完成已提交任务；一键创建独立 Demo 保留原存档，重启正确加载 |

规则测试另验证 Battle Agent 实际 ATTACK 造成伤害、摧毁真实敌舰，随后获得 XP/记忆/聊天结果；运输中途保存恢复后继续与原世界完全一致。未知虫洞和隐藏敌方资产不会进入 observation 或自动规划。

AGENTS 名册（历史产物，仅本地保留：`agents-roster.png`）

私聊影响真实指令（历史产物，仅本地保留：`agent-private-chat.png`）

培养毕业与舰船分配（历史产物，仅本地保留：`agent-training-detail.png`）

Demo 群聊与已接受的护航（历史产物，仅本地保留：`demo-command-chat.png`）

Demo 实际交付与护航完成（历史产物，仅本地保留：`demo-delivery-completed.png`）

1024 窗口及 200% 文字通讯（历史产物，仅本地保留：`chat-1024-text-200.png`）

[Demo 使用说明](../../../demo/README.md) · 独立世界 JSON（历史产物，仅本地保留：`../../../demo/agent-demo-v11.json`） · [Agent 架构](../../architecture.md)
