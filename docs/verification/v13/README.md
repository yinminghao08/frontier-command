# Frontier Command v13 验证记录

基线：最新 `main` 的 `32c7ee70e42f5f11f1ba1236836e4ed7bb04dc8a`。在 v12 上增量实现，保留主进程权威引擎、确定性固定步、Battle / Logistics、独立模型、Chat Completions、Journey Planner、LCARS 和真实经济。未新增职业或薪酬、晋升、离职系统。

本文件原有验证数字为 v13 初始实现的历史记录；当前调用上限与任务判断修订的结果见[本轮回归记录](agent-feedback-fix.md)。

## 自动验证

| 检查               | 结果与证据                                                                             |
| ------------------ | -------------------------------------------------------------------------------------- |
| 最终全量单元       | 21 个文件、296 项通过；机器结果（历史产物，仅本地保留：`unit-last-run.json`）                                  |
| 最终生产构建       | TypeScript、Vite 和 Electron 编译通过；构建记录（历史产物，仅本地保留：`build-last-run.txt`）                  |
| 完整 Electron 回归 | 55 项已覆盖；首跑 53/55，最终相关复验 14/14，无跳过或重试；汇总（历史产物，仅本地保留：`checks-summary.json`） |

首次 Electron 回归的一项自动保存测试遇到临时文件读写失败，引擎保护性暂停；相同隔离场景单独重跑通过。另一项布局测试在紧凑窗口未先打开 MENU 导航，导致定位超时；修正测试操作后重验四组窗口/文字尺寸。保留失败事实，不将首跑描述为无失败。

最终复验使用最后一次生产构建，覆盖 v13 五项验收、Agent 四项回归、Admiral 聊天三项回归及暂停/保存两项回归，14 项全部通过，无跳过、失败或重试，用时 6 分 17 秒。最终机器结果（历史产物，仅本地保留：`electron-final-related.json`）。首跑失败上下文保留为 [保存错误](first-run-save-error.md) 和 [布局测试错误](first-run-layout-error.md)。

所有 Electron 测试使用隔离 userData；迁移输入来自仓库 `tests/fixtures/v12/in-progress.json`。本地 HTTP provider 只存在于测试中，用于重复指定接受、拒绝、维修反提议等分支。未调用玩家真实外部模型，也未读取玩家 API Key 或生产 APPDATA。

## 核心规则证据

- `v13-contracts.test.ts`：系统报告零唤醒/零旁观记忆；一次性决策；相同动作和请求去重；同职业人格差异；真实消息反馈；拒绝、协商上限；维修、连续 REST、实际护航会合、真实建设支援；交接货物守恒；奖励托管、兑现/违约/退款；双人履约；任务失败不重启；多提议和额度等待恢复。
- `v13-budget.test.ts`：取消调用额度与全局并发上限；1×/4×/16× 无变化零调用；兼容/纠错/连接测试统计；共享 45 秒网络超时；usage 未知；新输入取消过期决策及打断暂时错误退避；认证恢复；消息数组超过 3 条可执行。
- `task-judgment.test.ts`：专门的短 LLM 接受/拒绝判断；请求大小、无等待占位回执、拒绝不执行、一次短纠错。
- `ammo-alerts.test.ts`：持续缺弹仅提醒一次；部分与完整补弹；控制权切换；旧存档和重启；不同速度下的确定性。
- `v13-migration.test.ts`：冻结的严格旧 schema；v11/v12 主档、备份、每日档和终局迁移；分支和 ID；原字节保留；新时间线损坏/更高版本保护；旧聊天不重放；承诺和结算校验。
- `agent-demo.test.ts`：固定 seed、本地 HTTP 完整协作链、真实维修/会合/运输/卸货、奖励和关系变化、恢复确定性及影响下一次模型选择。

## 实际界面与演示

维修与奖励反提议（历史产物，仅本地保留：`request-negotiation.png`）

真实系统报告（历史产物，仅本地保留：`system-reports.png`）

人格、心理和关系（历史产物，仅本地保留：`personality-relationship.png`）

1024×768 / 1366×900，文字 100% / 200% 的请求、报告和心理状态截图分别使用 `requests-*`、`reports-*`、`agents-*` 文件名。其他原有功能的本轮截图独立放在 `regression-v9/`、`regression-v10/` 和 `mine-accidents/`，历史版本记录不覆盖。

演示使用 seed `236807`，没有预填接受或履约结果。ARCHIVE 可生成演示；[演示说明](../../../demo/README.md) 包含真实模型试玩步骤及本地 provider 验收命令。仓库导出 `demo/agent-demo-v13.json` 和 `demo/user-data/frontiers-v13`，原 v11/v12 文件保留。
