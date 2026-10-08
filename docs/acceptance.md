# Frontier Command v15 验收

全部修复及固定选择见 [完整计划](plan-v15.md)，验证路径与供应商遥测范围见 [v15 记录](verification/v15/README.md)。

| 验收行为                                                                                 | 自动验证                                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原句清剿、实际火力/伤害、连续/新增公开目标、RETURN FIRE 授权、有序多目标与取消接管       | `tests/v15-command-feedback.test.ts`、`tests/e2e/v15.spec.ts`、`tests/e2e/admiral-chat.spec.ts`                                                             |
| 原会话关联回复、失败/取消/替代/重试、短 JSON 协议、无自动时间截止、流式兼容及一次纠错              | `tests/v15-command-feedback.test.ts`、`tests/task-judgment.test.ts`、`tests/v13-budget.test.ts`、`tests/e2e/task-feedback.spec.ts`、`tests/e2e/v15.spec.ts` |
| Ctrl 敌舰多选并保留己方、五种按钮共用指挥方式、记忆默认、真实拒绝和 Agent 缺失反馈       | `tests/e2e/v15.spec.ts`                                                                                                                                     |
| 当前趟继承路线/改单补装、600 满载、明确数量、库存/仓位/需求/在途约束、循环重算及预留守恒 | `tests/v15-command-feedback.test.ts`、`tests/v13-contracts.test.ts`、`tests/e2e/v15.spec.ts`                                                                |
| 实际活动速率、受击/舰体阈值去重、过劳不满、意愿变化、暂停、等时速度及状态界面            | `tests/v15-command-feedback.test.ts`、`tests/v13-contracts.test.ts`、`tests/e2e/v15.spec.ts`                                                                |
| 冻结 v14 校验后迁移全部时间线、保留原字节/历史、坏档保护和迁移中断恢复                   | `tests/v15-command-feedback.test.ts`、`tests/persistence.test.ts`、`tests/v13-migration.test.ts`                                                            |

## 历史 v14 验收

本轮替换 Orion 单舰与瞬时补舰逻辑，保留主进程权威、固定步长、经济、Agent 和 LCARS。新世界与存档独立使用 v14，旧文件不迁移、不删除。实测数据与 Electron 截图见 [v14 验证记录](verification/v14/README.md)。

| 验收行为                                                                           | 自动验证                                                                      |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 多 seed 远距隐藏总部、1–2补给点、十舰分散、首次搜索、自然货运遭遇                  | `tests/orion.test.ts`、`tests/e2e/orion.spec.ts`                              |
| 真实传感器、分跳情报、未知状态不影响决策、改线失联、协同位置                       | `tests/orion.test.ts`                                                         |
| 有限勒索、手动覆盖、暂停、瘫痪、登舰中断、大宗会合转运、批次去重、实际货损         | `tests/orion.test.ts`、`tests/e2e/orion.spec.ts`                              |
| Galaxy 撤退、反跟踪、秘密尾随、十分钟基地确认及打击                                | `tests/orion.test.ts`、`tests/v9.test.ts`、`tests/e2e/recon.spec.ts`          |
| 真实库存销赃、买方不足、维修补给、付费空仓造舰、上限、基地毁坏、残余重建、永久灭失 | `tests/orion.test.ts`、`tests/v10.test.ts`                                    |
| 物流危险去重、真实 reinforce/ESCORT、接受/拒绝、安全抵港、关系与 Admiral 优先      | `tests/orion.test.ts`、`tests/e2e/orion.spec.ts`、既有契约回归                |
| 1×/4×/16× 固定步、阶段重载不重复结算、严格 v14、旧文件保全                         | `tests/orion.test.ts`、`tests/v13-migration.test.ts`、`tests/e2e/v13.spec.ts` |
| Electron 策略/覆盖/重启、1024/1366宽及100%/200%文字                                | `tests/e2e/orion.spec.ts`                                                     |

## 历史 v13 验收

本轮保持 v12 模拟、经济、职业、API 和 LCARS 架构。当前规则和 Electron 验证记录见 [v13 验证记录](verification/v13/README.md)，完整可重复链路见 [演示说明](../demo/README.md)。

| 验收行为                                                                                   | 自动验证                                                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 短任务判断不发送完整协议、不协商条件、接受即执行                                           | `tests/task-judgment.test.ts`、`tests/v13-budget.test.ts`                                   |
| 缺弹每次持续状态仅提醒一次、补弹恢复、重启及确定性                                         | `tests/ammo-alerts.test.ts`                                                                 |
| 系统报告零唤醒、零旁观记忆、消息/决策/结算去重，无变化空闲零调用                           | `tests/v13-contracts.test.ts`、`tests/v13-budget.test.ts`                                   |
| 1×/4×/16× 无调用额度、无全局并发上限、兼容/纠错计数、45 秒超时、取消、退避与认证恢复       | `tests/v13-budget.test.ts`、`tests/e2e/v13.spec.ts`                                         |
| 同职业个体差异、真实拒绝/协商、两轮上限、真实消息反馈及关系影响下一次选择                  | `tests/v13-contracts.test.ts`、`tests/agent-demo.test.ts`                                   |
| 维修、连续休息、真实护航会合/运输/建设支援、交接货物守恒、托管/兑现/退款、双人履约         | `tests/v13-contracts.test.ts`、`tests/agent-demo.test.ts`、`tests/e2e/admiral-chat.spec.ts` |
| 短 LLM 判断接受/拒绝、即时任务指令、显式直接接管、旧响应失效、任务失败/取消/中断的独立结果 | `tests/v13-contracts.test.ts`、`tests/e2e/v13.spec.ts`                                      |
| 严格 v11/v12→v13、终局/备份/每日档/分支、损坏保护、不重放、不重复支付、确定性恢复          | `tests/v13-migration.test.ts`、`tests/v13-contracts.test.ts`、`tests/agent-demo.test.ts`    |
| 仓库内隔离 v12 fixture、完整协作链重启、旧调用额度失效、1024/1366 和 100%/200% 布局        | `tests/e2e/v13.spec.ts`                                                                     |

E2E 只使用隔离 userData 和本地 HTTP Chat Completions provider，不读取玩家 APPDATA 或外部 API 凭据。测试 provider 的选择用于复现验收分支；正常应用依赖玩家配置的真实模型，不替模型预先同意任务。

## 历史 v12 decision/chat regression acceptance

- Admiral private/group fire orders execute real ATTACK under RETURN FIRE against publicly observed unconfirmed targets, without changing hostile evidence. Autonomous attacks retain ROE restrictions; real outcomes grant executor XP.
- Group @ assignment modifies Assignment; another formal Agent is not displaced. Forged and cross-private authorization fails, and renderer cannot invoke the internal task grant.
- A mine consumes 165 Credits and 30 actual Materials through physical shipping and construction. Logistics cooperation and restart preserve the project. The supplied player v11 save is tested only in a disposable copy.
- Consecutive survey visits each requested sector, forbids wormholes when ordered, replays deterministically and yields to direct Admiral control.
- Invalid fields, targets and JSON receive bounded correction with exact paths; exhausted retries preserve world integrity. Local provider fixtures verify format fallback and NONE reasoning.
- Migrated names, branches, ancestry and daily saves preserve progress and original v11 files. Historical commands do not replay, and ACK replies do not generate feedback loops.

# Frontier Command v11 Agent 验收

当前 v11 使用新世界与独立存档目录，不迁移 v10。`tests/agents.test.ts` 验证独立 Agent、完整公开 observation、Admiral 优先级、原子拒绝非法决策、真实攻击/护航/运输、聊天与有限记忆、培养、经验及关系变化。`tests/agent-api.test.ts` 验证 main-only 协议、独立模型/NONE、兼容重试、显式取消、加密配置、凭据不进入记录、决策节点与过期响应。

`tests/e2e/agents.spec.ts` 实际启动 Electron：使用隔离存档和本地 Chat Completions 协议服务完成群聊/私聊/@ → 模型决策 → 校验 → 实际 HAUL/ESCORT → 已确认虫洞 → 真实卸货 → 经验/关系/记忆，以及拒绝、错误恢复、培养、分配、重启、拖动通讯和大字号布局。外部 provider 需玩家自行配置凭据；测试服务不在应用运行路径中。

Demo 的规则与确定性验收见 `tests/agent-demo.test.ts`；Electron 从随附的独立存档加载，并验证一键生成与库存/训练真实结算。[Demo 使用说明](../demo/README.md) · [v11 验证记录](verification/v11/README.md)。

# Frontier Command v10 历史验收

矿场事故修复：`tests/mine-accidents.test.ts` 验证现场／舰上／混合材料、预留守恒、缺料停工、真实补给恢复、多舰单次结算及超额工作旧存档的确定性恢复。`tests/e2e/mine-accidents.spec.ts` 使用隔离存档运行生产 Electron，验证缺料详情、一次性补给表单、航行／施工提示及恢复生产；截图位于 `docs/verification/mine-accidents/`。

当前变更的规则验收：`tests/v10.test.ts`；实际 Electron 操作验收：`tests/e2e/v10.spec.ts`。全部使用隔离数据，不接入生产存档或外部服务。

2026-10-06 实际验证：`npm run build` 成功，`npm test` 的 175 项测试全部通过。Electron 全量回归的 34 个用例已完成验证：首次运行 25 项通过，9 项旧英文文案断言更新后全部重跑通过；四项新增 v10 流程再次完整通过。最后复查中文通知、半单位材料显示及最远景右栏布局。

新增 Electron 流程包括“实际调查取得发现 → 船坞／军械库五折扣款”和“击败基地 → 现场接管 → 实际货运 → 改建 → 本地造舰／装弹／维修”。虫洞验证包含远方抵达、镜头跟随、隐藏出口不进入快照、原路返回与聚合标记展开。v9 历史截图保持原样；本轮截图独立存入 v10 目录。

| 行为                                                             | 验证                         |
| ---------------------------------------------------------------- | ---------------------------- |
| 基础光子／量子制造、永久精确五折、Galaxy 容量与速度              | 规则测试及生产 Electron 流程 |
| 弹仓、库存、预留显示；多舰需求、超量与并发预留守恒               | 规则测试及装弹 Electron 流程 |
| 现场接管、中断恢复、真实货运改建、稳定 ID、多基地本地生产与维修  | 规则测试及基地 Electron 流程 |
| 敌方不再使用被占领基地，基地毁坏后取消生产、升级可在其他基地重试 | 规则测试                     |
| v9 时间线整体迁移、原文件保留、v10 存取及确定性恢复              | 存档测试                     |
| 普通虫洞远距离双向配对、出口不泄露、实际穿越及镜头跟随           | 规则测试及地图 Electron 流程 |
| 右栏中文、玩家改名保留、殖民地分段条、放大文字                   | Electron 界面检查            |
| 最小缩放网格覆盖视口、远景聚合与点击展开                         | 相机规则及 Electron 检查     |

截图保存于 `docs/verification/v10/`。以下为此前 v9 功能的历史验收记录。

# Frontier Command v9 验收

基于本地提交 `49f5660`，沿用主进程唯一权威、确定性固定步、现有指令、事件和 LCARS 26 Classic。新建严格 v9 世界，不迁移 v8，不修改用户旧存档，不接入 LLM。

| 约束                                                                           | 验证位置                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 安全航线无危险直达、已知危险避让、路径仅含坐标、隐藏状态不影响规划             | command-v9.test.ts、geography.test.ts                                     |
| Ctrl 多选、选目标保留选舰、所有任务预选、临时批量 MOVE、每舰货运数量           | command-v9.spec.ts、v9-ui.spec.ts                                         |
| RETURN 保留货物、UNLOAD 到 Dawn、已装货无需重载、预留守恒                      | command-v9.test.ts、frontier.test.ts、desktop.spec.ts、command-v9.spec.ts |
| 实际穿越后镜头跟随、手动选择结束、事件仅公开己方 ID/实际出口/tick              | command-v9.test.ts、command-v9.spec.ts                                    |
| 近距调查完成同一步创建接管事件、上下文入口、无残骸建设、唯一幽影接管           | command-v9.test.ts、recon.test.ts、command-v9.spec.ts、recon.spec.ts      |
| 自有隐形状态在地图、舰船条和详情清晰可见，保存恢复                             | command-v9.spec.ts、recon.test.ts                                         |
| 每舰稳定 ID 仅首次接触暂停；重获、敌对升级与重载不重复暂停；各倍率同 tick 暂停 | command-v9.test.ts、command-v9.spec.ts、pause-regression.spec.ts          |
| 真实侦察后接管基地当步可保存；连续运行跨越自动保存周期，重载与确定性验证       | v10.test.ts、pause-regression.spec.ts                                     |
| 合并警报与单次音效、确认/定位/下令保持暂停、手动继续、静音和音量               | command-v9.spec.ts、lcars.spec.ts                                         |
| 标记有货物/奖励/事件/打捞时不可移除，无价值时移除并永久保存真实实体/历史       | command-v9.test.ts、command-v9.spec.ts                                    |
| 五项基地可用资源、扣除预留、零库存显示、文字放大后不重叠                       | command-v9.test.ts、command-v9.spec.ts                                    |
| 默认 18px 相对字号、文字与整体缩放独立 100%–200%、Ctrl+0 不重置文字            | command-v9.test.ts、command-v9.spec.ts、lcars.spec.ts                     |
| 全部管理页/八基地模块、125/150/200% 原生显示缩放、放大导航和资源可用           | command-v9.spec.ts、lcars.spec.ts、v9-ui.spec.ts                          |
| 五项升级按钮旁真实进度/剩余分钟/暂停/ONLINE、施工禁重复；造舰/制造/改装进度    | command-v9.spec.ts、desktop.spec.ts                                       |
| 标题不被圆角遮罩咬断、纯色色条；标签近邻连线不超过当前字号 4em                 | command-v9.spec.ts、command-v9.test.ts、camera.test.ts                    |
| 中文普惠体正文/粗体、英文数字 Antonio，离线平台字体、字面高度与笔画实测        | command-v9.spec.ts、lcars.spec.ts、v9-ui.spec.ts                          |
| 无周期维护、3000 Mine、Colony Credits、Dawn Materials 守恒和真实工业成本       | v9.test.ts、frontier.test.ts、recon.test.ts                               |
| 空闲/低弹药/低状态/完成/取消/失联/重启待命；显式返航与战斗本地脱离             | recon.test.ts、v9.test.ts、engine.test.ts、frontier.test.ts               |
| REPLACE / QUEUE / INTERRUPT、正式编队、严格 v9 保存、拒绝 v8、日快照与永久舰损 | architecture.test.ts、persistence.test.ts、clock.test.ts、desktop.spec.ts |
| 稀疏生成/最小间距/探索顺序确定性、固定 0/0 ↔ 0/12 通道                        | geography.test.ts、recon.test.ts                                          |
| Orion/Romulan 普通尾随暴露、假航点、隐形秘密尾随、连续 10 分钟基地确认与打击   | recon.test.ts、recon.spec.ts                                              |
| 隐藏基地/AI intent/真目的地/假航点/反跟踪证据/接触去重记录不进入公共输出       | architecture.test.ts、command-v9.test.ts、recon.test.ts、recon.spec.ts    |
| 跟踪/甩尾/部分情报/隐形/去重/清理保存恢复与各倍率确定性                        | command-v9.test.ts、recon.test.ts、clock.test.ts                          |

必跑 `npm test`、`npm run build`、`npm run test:e2e`。Electron E2E 启动生产主进程与页面，隔离存档和合法场景夹具只用于测试；公开 API 没有测试专用世界修改接口。

`node scripts/acceptance-v9.mjs 236807` 使用未修改资产的正常新世界和可见 Electron，通过真实按钮/表单下令、确认警报和手动继续，验证待命、固定通道、调查接管与隐形。多 seed 规则使用 42、1701、236807。真实截图和机器结果存于 `docs/verification/v9/`，已运行的检查见 [验证记录](verification.md)。历史 v8 证据保留于原目录。本轮不推送远程或重新发布 EXE/ZIP。


Agent transport regression: `tests/agent-transport.test.ts` covers delayed first responses beyond 20 seconds, cancellable indefinite waits, byte-split SSE/UTF-8/CRLF, reasoning isolation, usage, non-streaming compatibility, protocol/empty/truncated/credential failures, HTTP authentication/rate limits and stale authority. `tests/v13-budget.test.ts` covers a 32-second initial-plus-repair sequence without a deadline. `tests/e2e/v15.spec.ts` starts real Electron with isolated userData: a 25-second streaming reply completes in its original channel, cancellation and HTTP-error retry work, and the API test can be cancelled and restarted. These local protocol fixtures do not verify actual external provider availability.
