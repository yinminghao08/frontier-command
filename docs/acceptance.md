# Lv1 + Lv2 / v7 验收

使用生产引擎、生产 IPC、真实 Electron。规则/UI 测试允许隔离夹具；完整经济链实玩必须从正常新世界开始，不注入库存、移除敌人或直接推进引擎时钟。

| 要求 | 入口 |
| --- | --- |
| 指令接续、货物保留、单舰 Override、组令原子失败、成员损失 | engine.test.ts、v7.test.ts、desktop.spec.ts |
| 600 货舱、总量分摊、协调航行、队列不预留 | v7.test.ts、编队 UI 和正常世界日志 |
| 设施容量、仓满停产/恢复、断供、实物交付、遭抢预留 | v7.test.ts、engine.test.ts、frontier.test.ts |
| Colony 独立物资/预算生产、真实工业、有限付费贸易、全舰损恢复 | v7.test.ts、frontier.test.ts |
| 人员培养、任职会合、岗位效果与经验 | v7.test.ts、PERSONNEL 实玩 |
| 事件状态证据、选择、现场行动、拒绝/延误、后续与续存 | v7.test.ts、正常世界事件响应 |
| Wormhole 配对/路线、未知出口；生成顺序与战斗随机独立 | geography.test.ts、v7.test.ts |
| Orion 本地/已收到情报、真实盗抢/返港、护航风险、资产损失 | frontier.test.ts、v7.test.ts、正常物流日志 |
| Romulan 非默认敌对、现役资产部署、Hail/警告/撤离、政治后果 | frontier.test.ts、v7.test.ts |
| v7 严格存档、旧目录保留、原子恢复、午夜与确定性 | architecture.test.ts、persistence.test.ts、desktop.spec.ts |
| LCARS 图标、中文详情、地图坐标指令、编队与人员 UI、长标题/DPI | lcars.spec.ts、v7-ui.spec.ts |
| 原字体、动画、音效、八模块与六分辨率/125/150/200% | lcars.test.ts、lcars.spec.ts |

必跑 `npm test`、`npm run build`、`npm run test:e2e`。实际经济链：探索新 Sector → 调查矿藏 → 建设物资到场 → 矿场生产/满仓 → 编队运回 → 真实情报形成压力 → 护航/拦截 → Materials 造舰 → Colony 产补给与预算 → 事件响应及后果。

`node scripts/acceptance-v7.mjs 236807 --observe` 包含十分钟连续 1× 观察；seed 42、1701 复查。输出位于 `docs/verification/v7/`。失败尝试保留在原始日志中，以最后一次正常初始化后的成功段作为完成证据。发布旧包不在本轮范围，测试通过不代替实玩。
