# Frontier Agent Runtime v16 交付与审计记录

实施及最终完整验收已完成。版本 1.6.0 / v16 存档，独立分支 feature/agent-core-v2。

## 实现与唯一所有权

Interaction 在聊天写入和结构化 UI 命令进入引擎时创建稳定身份，不再扫描聊天历史重建任务。Intent Gateway 对明确简单输入确定性解析；复合、指代和条件由用途 Schema 理解，再由本地公开 ID、权限、能力与参数验证。缺失关键事实提交澄清，不将复合装载目标缩成 RETURN。

Objective 保存原始授权、原指令、修订、目标、约束、条件与完成标准。Task Runtime 维护唯一根任务、确定性 TaskHandler 注册表、生命周期、队列、优先级、步骤、依赖和显式恢复。导航、探索、测绘、巡逻、护航、交战、建设、维修、装弹、改装、休整、外交、事件响应及 Standing Orders 都通过此所有者；Handler 只产生只读计划，由 Gateway 提交既有 Command。

Authoritative Engine 保留导航、战斗、经济、Orion、建设和库存规则。LOAD 使用现场未预留库存、实际货舱与既有装载耗时；RETURN 保留货物；明确交付才 UNLOAD。Domain Journal 记录执行和物资事实，不重新发放或扣减库存。材料批次区分任务、来源、交付、转交其他地点和实际损失；已结束任务可追加后来发生的货物归属事实，但不重新完成或结算。

Cognition 仅暴露 TaskJudgment、ObjectiveProposal、CollaborationDecision、CommunicationDecision、StrategicDecision。Service 按真实事件、请求身份和每 Agent 一个有效请求调度，忙碌时保留新事件，拒绝迟到、旧配置、旧分配、旧版本和重新加载后的响应。普通库存增长、XP 和机会消失只更新观察。未分舰角色自动调用为零；玩家主动聊天保留。

Reply Coordinator 独占主要答复索引 sourceMessageId + recipientAgentId。格式错误和网络失败持久记录在原消息等待状态，取消与重试更新记录；不创建第二条主要答复。普通装卸更新 Task Card/Journal；重要任务结果和合同结算以真实任务及事件身份通知。协作群聊只展示协议，不执行物理交易或承担合同事实。

Assignment 是唯一持久舰船分配。换舰立即解除已中断任务的原 Directive，保留原舰物资和 checkpoint；新舰不能代替旧舰提供完成证据。编队 MOVE 复用同一队形几何函数，编队 HAUL 核验真实分摊及全编队交付，包含零分摊成员和保存恢复。

Provider 保留主进程安全 Key 存储、可取消传输，加入模型目录、路径前缀、模型能力 supported/unsupported/unknown、全局/独立模型/Thinking/Effort、输出预算、连接和空闲超时、协议兼容降级、格式修复上限与阶段遥测。显式推理不支持时失败，不默默改变模式；每决策最多四次 HTTP 尝试、一轮格式修复。缺失 usage 显示未知。

## 删除和保留

- 删除 admiral-intent.ts、admiral-tasks.ts、admiral-task-schema.ts 的生产解析/推进，替换为 intent-gateway、objectives 和 agent-runtime。
- 删除 decision-protocol.ts、Electron context.ts、task-judgment.ts，以及生产 AgentDecision Command、decide/judgeTask 客户端能力。
- agents.ts 保留人物、技能、经历、关系反馈、验证与决策提交；chat.ts 保留通讯存储。原重复回复和物理提交入口移除。
- contracts.ts 保留带版本协商、条件、托管、依赖与单次结算；全部物理执行由 Runtime 提交。
- command-system.ts、execution.ts、inventory.ts、journey、combat、Orion 继续拥有原规则；只增加授权上下文、LOAD 和必要因果记录。
- 已发布 v15/v14 及其依赖 Schema 冻结；未将冻结类型中的历史 AgentDecision 当作生产接口。

## 存档与 UI

新数据使用 timeline-v16.json、frontiers-v16。迁移先验证已发布旧 Schema，再 staging/恢复标记/原子发布，涵盖 head、backup、daily、终态记录；旧原文件保留。持久货物、预留、付费、合同、奖励、消息和已提交索引不重放。无法证明旧来源的货物保持 unattributed，无法证明完成的目标保持证据不足。旧矿场停工以规则移除结束，保留历史及已花资源，不发成功奖励或惩罚。

UI 使用 LCARS 26 Classic。舰船按钮、Agent 名册、详情、通讯统一读取 Assignment；直接接管单独标识。共享 Task Card 显示状态、排队、步骤、进度、来源、阻塞、风险与完成证据，支持权限允许的修订、取消和显式恢复。设置提供 Fetch Models、手动模型、独立推理控制与遥测；原消息显示等待/接收/验证/失败/取消，可取消或重试。

## 验证与性能

基线 26 文件 /411 单元；最终当前 33 文件 /472 单元全部通过。Renderer/Electron 严格构建通过。最终 `npm run test:e2e`：68 项全部通过，14.7 分钟，两个隔离实例。此前失败项经根因修复后已重新纳入这次全量执行。完整日志见 verification/v16/unit.log 与 electron.log。

真实引擎证明矿场满载/低库存返航、零库存阻塞、RETURN 留货与显式交付不同；Scout 多趟、新发现、混装、货损、第三方取走、取消、修订和保存恢复；不同速度与确定性；直接接管、换舰恢复、拒绝/协商零物理执行；真实护航、准备条件、托管、关系与单次结算；来源证据不能由旧交付或旧同意复用。

600 模拟分钟基线与 FAR 对比：未分舰自动请求 1 → 0，普通货运均 0 请求且都实际交付 50 材料；主动问候请求体 13062 → 2898 字节。用途 Schema 分别 740/629/1545/8107 字节，旧混合协议 20699 字节。FAR 增加独立任务验证，单步中位数有额外开销；不宣称引擎更快。精确 p50/p95、场景方法与原始 JSON 见 performance.md。

## 启动最新版

本机最新版位于独立工作区 C:/Users/Administrator/.codex/worktrees/agent-core-v2/agent-mmo-game，分支 feature/agent-core-v2。原工作区和原八项未提交修改仍保留。

在 PowerShell 切到上述目录执行 npm start。首次从 GitHub 获取时切到 feature/agent-core-v2，先 npm ci，再 npm start。正常启动使用本机原 userData，v16 迁移保留旧文件；测试使用独立 userData，未访问玩家 API。

创建演示：存档管理器 → AGENT DEMO，配置模型，然后主动在 Mira 私聊发送“请评估当前矿场运输与护航风险。”。保存配置本身不唤醒模型。模型可拒绝或协商，直接控制仍受 Admiral 授权。

## 剩余风险

本轮只验证本地 Mock，不证明真实供应商的推理模式、连接性能、语义准确率或费用。未知模型能力明确显示未知。旧存档缺少来源证据时无法事后证明完整交付。Journal 保留必要因果历史，长期巨量时间线的容量和查询成本尚未作多年级负载认证。性能为单次探索性测量，不作统计显著性或生产吞吐声明。
