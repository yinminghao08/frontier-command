# v15 指挥、回复、物流和状态验证

实现清单和固定数值见 [完整修复计划](../../plan-v15.md)。

2026-10-08 最终验证：构建通过；25 个测试文件、387 项测试全部通过；实际 Electron 的 4 个 v15 场景全部通过，另有 5 个聊天、任务反馈与协作回归场景通过。`git diff --check` 通过。未把完整 Electron 测试集声明为已运行。

`tests/v15-command-feedback.test.ts` 验证原句清剿、真实开火和连续目标、公开新情报、RETURN FIRE 下的明确授权、有序攻击存档恢复、结构化按钮任务、当前运输补装及守恒、实际容量/仓位/库存/建设需求/循环货运、状态变化与实际战斗、暂停和等时确定性、关联回复/取消/超时/重试，以及 v14 全时间线迁移和中断恢复。

`tests/v13-budget.test.ts` 验证兼容及纠错共享绝对截止，最多一次纠错；挂起请求释放槽位，不按游戏倍率改变 HTTP 时间。现有规则、协作、Orion、持久化和模型协议测试继续回归。

`tests/e2e/v15.spec.ts` 在实际 Electron 中验证 Ctrl 敌舰多选及己方保留、五个命令按钮的两种指挥方式和记忆、真实模型协议拒绝与无 Agent 阻碍、有序集中攻击；复现出航后 50→600 的当前运输修改，原会话回执、界面速率；以及实际挂起 socket 的 20 秒截止、取消和原消息重试。

截图与隔离供应商遥测运行产物保存在 `.test-data/verification/v15/`：`multi-target-control.png`、`haul-amendment-chat.png`、`agent-rates.png`、`timeout-retry.png`、`v14-migrated-underway.png`、`isolated-provider-telemetry.json`。实际主进程迁移验证了在途货物保留以及 v14 原文件逐字节不变。

原句“去摧毁所有的orion”的隔离协议样例请求为 2720 字节，使用 JSON 对象协议、20 秒截止与最多一次纠错，记录见 `compact-request-metrics.json`。此数值只测请求体大小，不代表真实供应商延迟。Electron 挂起接口验证失败反馈、取消、原消息重试，以及每次请求共享截止不超过 20 秒。

截图测试使用本地 provider，只证明实际 Electron 与 API 协议链路。没有调用玩家真实 API，不能据此声称真实供应商已经达到数秒。应用的“模型调用统计”记录真实请求字节、请求/接收阶段、首字节和总耗时、校验耗时、重试原因；不包含 Key 或隐藏敌方状态。
