# FAR 实施检查点与续作说明

检查点日期：2026-10-09。项目尚未完成最终验收。

## 工作区与恢复

当前分支：`feature/agent-core-v2`。

独立工作区：`C:\Users\Administrator\.codex\worktrees\agent-core-v2\agent-mmo-game`。

原工作区保持 `main`，原有 8 个未提交修改仍在原处；独立分支已以 `93bebd7` 保存它们。不要在原工作区继续实施 FAR，也不要删除 node_modules junction。此文所在提交是 Phase 4 的本地检查点，不是完成提交。

架构审计、入口所有权、冻结 Schema、生命周期、参考源码与验收矩阵见 [agent-core-v2-architecture.md](agent-core-v2-architecture.md)。

## 已实现且有定向验证的内容

- 权威 Runtime、唯一根 Task、Interaction 与 Reply 索引、Domain Event、货物来源批次、LOAD，以及真实装货返航/多趟残骸交付。
- 返回保留货物，明确交付才卸货；零库存阻塞；中断保留进度，显式恢复；指令结束后仍须验证完整目标。
- 生产调度改用用途化 Cognition Schema 和世界会话请求身份。旧历史扫描入口已断开；取消、接管、分配变化及重新加载使迟到模型结果失效。
- 未分舰 Agent 不自动调用模型；普通物理任务推进和系统报告不调用模型、不触发递归群聊。
- Provider 能力注册、明确 Thinking/Effort、受限格式兼容和纠错、连接/空闲超时、取消、真实 usage/未知 usage、模型目录与独立配置。
- Assignment 是唯一持久舰船分配；Agent 舰船字段由其派生。v15 冻结验证和 v16 时间线迁移保留旧文件，来源不明货物不伪造证据。
- 同一根目标修订保留货物、历史和可继续的物理检查点；自愿任务修订重新同意。LCARS Task Card、历史与证据、取消/修改/恢复，以及舰船/Agent/聊天的统一分配展示。

## 检查结果与范围

- `npm run build`：通过，含 Renderer/Electron TypeScript。最近日志 `far-pause-build.log`。
- 定向 7 文件、103 项：全部通过。覆盖 cognition-runtime、far-runtime、assignment、v13-contracts、persistence、save-manager、model-registry。日志 `far-pause-tests.log`。
- 实际 Electron 专项 `tests/e2e/far-v16.spec.ts`：此前两轮通过，本检查点第三轮复核也通过（1 项，47.7 秒）。使用隔离 userData 与本地 HTTP Mock；真实点击模型目录、独立配置、聊天、任务卡片和修订，核验实际库存、唯一主要答复、普通执行期间请求数不增长，以及存档无 API Key。
- 最近全量单元回归是 Phase 3 的 394/432 通过、38 失败，日志 `far-full-phase3.log`。Phase 4 后尚未全量重新运行，不能把定向通过写成全量通过。
- 截图保存在 `.test-data/verification/v16/`：`far-provider-settings.png`、`far-task-loading.png`、`far-task-verified.png`。
- 所有供应商行为验证均为本地 Mock；没有真实供应商性能、成本或生产 API 验证。没有完成最终性能对比。

日志、构建产物与截图按项目规则被 Git 忽略；代码、测试和此说明提交进分支。

## 续作优先顺序

1. 收拢实际 TaskHandler/Planner 的所有权。当前 handlers 临时适配器仍修改 Objective 的旧执行字段，声明的 Handler 接口尚未成为统一调用机制；不要以增加文件或接口替代迁移。
2. 建立真实 Task 依赖图及护航会合/准备条件，确保无环、依赖事实与合同单次结算。当前协调执行只由 Runtime 调用，但 dependencyTaskIds 尚未完整启用。
3. Standing Orders 和应急撤退改由唯一 Gateway 提交；导入无旧 AdmiralTask 的在途 Directive 时绑定授权根，不重放货物/付费/XP。加入真实循环运输事件与任务循环进度。
4. 删除旧 client.decide/judgeTask、巨型混合协议和 engine-local negotiation bridge。生产 Service 已不用旧路径，但测试 API 和旧 Command 仍保留；先迁移有效协作能力再移除。
5. 补齐自主策略、协作发起、外交/事件等有效认知能力；当前小型策略仅覆盖公开机会的有限确定性选项。未完成的服务/协作选项草稿已撤回，不保留假实现。
6. 修复全量回归。旧 provider 静默推理降级、错误追加聊天、混合 JSON、旧正则解析和周期矿难断言应按新架构迁移；真实库存、同意、关系、XP、航线、战斗和协作断言必须保留，不能统一认定为过时或跳过。
7. 扩大异常与恢复矩阵：目标竞争、货损/满仓、多次修订的约定条件和托管、所有服务/建设证据、导入在途任务、迁移发布中断、速度与确定性。当前目标跨族修订有明确限制，不应冒充任意修改能力。
8. 最后运行完整 `npm run build`、`npm test`、`npm run test:e2e`，实际 Electron 全流程检查、同场景 Mock 性能对比，更新旧代码清理/兼容/风险记录。只有这些完成后才声明交付完成。

注意 v16 文件布局：`timeline-v16.json` 位于 userData 根；分支文件位于 `frontiers-v16/`。保留 v15 文件与冻结 Schema，不将实时请求身份或 API Key 写入游戏存档。
