# Lv1 + Lv2 / v6 验收

使用生产引擎、生产 IPC 和真实 Electron。测试夹具只在启动前写入隔离用户目录；Renderer 没有调试 WorldState 写入接口。实际游玩与自动化测试分别记录。

| 要求 | 自动化与实测入口 |
| --- | --- |
| REPLACE / QUEUE / INTERRUPT；全舰级四类活动；途中、战斗、装弹改令；货物/损伤保留 | engine.test.ts；desktop.spec.ts 的实际 UI 改令 |
| ROE 约束自主行为，明确攻击有效；Intercept / Escort / Drive Off / Disable / Shadow | engine.test.ts、frontier.test.ts |
| 稀疏 Sector、独立坐标 seed、顺序独立、永久实体、重复调查无重复收入 | geography.test.ts、engine.test.ts；两种子实玩 |
| 实物采集、满舱、矿藏枯竭、循环采集、货物守恒、出口消费 | engine.test.ts、frontier.test.ts |
| 航线物理距离、ETA、风险差异、循环货运和建设物资到场 | geography.test.ts、frontier.test.ts；desktop.spec.ts |
| 新矿场/前哨/殖民地；未到物资不施工；设施独立库存与自卫 | frontier.test.ts 三种建设、普通袭击增援窗口 |
| 五模块能力、槽位、五基地升级、制造、实际新舰籍 | frontier.test.ts；desktop.spec.ts、STARBASE 八模块显示检查 |
| Orion 真实侦察、货值/护航判断、盗取货物、返港、资源维修/补弹/建造，无无限补敌 | frontier.test.ts；1× 实玩库存增长 → 袭击与货损 |
| Shadow 找 Hideout；Romulan 中立、跨境/攻击 tension、真实报告升级 | frontier.test.ts |
| 全舰损、永久档案、零库存恢复最低舰级约五分钟 | frontier.test.ts；persistence.test.ts 空舰队续存 |
| 确定性、途中续跑、无效命令无副作用、公开快照不泄漏私有状态、冻结 LKP | architecture.test.ts、engine.test.ts |
| 严格 v6 存档，物理容量、引用、预留、历史序列、午夜、原子写入与封存恢复 | persistence.test.ts；desktop.spec.ts 午夜、恢复失败不切换 |
| LCARS shell/设置/动画/声音保持，六尺寸、125/150/200% 缩放 | lcars.test.ts；lcars.spec.ts |
| 首次发现 1–2 分钟、行动/收益/成长 2–5 分钟、生态响应 5–10 分钟 | docs/verification.md，三种子真实 Electron 1× 实玩日志与截图 |

## 运行与证据

`npm test` 验证规则、确定性、存档与地图数学；`npm run test:e2e` 构建并启动真实 Electron。实玩脚本 `scripts/play-v6.mjs` 提供基于 Playwright 的真实 UI 控制，并把时间、操作、公开快照摘要和截图写到 `docs/verification/v6/`；它不向世界注入调试状态或推进模拟时钟。

默认世界至少 10 分钟 1× 持续运行，另用 seed 42、1701 复查。重大暂停若发生，记录原因后由玩家继续。变更导致的失败须修复并重跑；测试通过不替代实际观察。发布包不在本轮范围。
