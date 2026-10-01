# AGENTS.md

## 项目定位

Frontier Command 是“Agent 时代的 MMO 生态模拟经营游戏”，Star Trek 是世界包装，不是传统舰队 RTS。

真人玩家身份是 Dawn Frontier Command 的 Admiral。核心循环是：

观察持续运行的边疆世界 → 接收报告/事件 → 制定高层任务 → 分配舰船与资源 → 由角色/Agent自主执行 → 世界状态长期变化。

长期目标是让独立 Agent 成为世界中的真正参与者。当前阶段若仍使用规则 AI，只能称为规则 AI，占位于未来 Agent 运行时；不得把脚本或规则自动驾驶包装成 LLM Agent。

## 产品原则

- 玩家是 Admiral，不是舰长。正式玩法以战略决策、资源分配、任务制定和人员管理为核心，不以 WASD/逐帧操舰为核心。
- Agent 与舰船必须是独立实体。能力、记忆、人格、成长属于 Agent；Hull、Shield、Core、Warp、Cargo、Weapons 属于舰船。
- 世界必须能扩展到大量 Agent、舰船、殖民地、矿区和敌对势力；禁止围绕“当前只有几艘船”硬编码 UI 或规则。
- 三类/多类任务必须在适配对象、注意力、风险、收益和后续影响上真正不同，不能只是文案不同。
- Star Trek 设定用于增强沉浸感，但玩法清晰度和系统一致性优先于正史考据。

## UI / UX 方向

主界面是 Admiral 的 LCARS 战略指挥终端，不是普通 dark dashboard。

固定信息架构：
- 顶部：游戏时间/倍速、Priority Communications、核心战略状态。
- 左侧：SECTOR / OPERATIONS / PERSONNEL / STARBASE / COLONIES / ARCHIVE。
- 中央：Strategic Map，是主要工作区且占最大面积。
- 右侧：Context Inspector；点选地图对象后查看状态并下达高层命令。
- 底部：紧凑的 Active Operations。

LCARS 必须体现为明显的大色块、粗功能条、肘形/圆角分区和非对称信息层级；不要退化成通用卡片式后台。

管理页面优先使用抽屉、侧板或覆盖层；不要反复挤压地图。

## 战略地图原则

Strategic Map 是“世界本身”，不是一张可任意缩成小邮票的 SVG 图片。

- 最小缩放必须等于 fit-to-sector：整个世界刚好填满当前地图 viewport。
- 永远不得显示世界边界外的大块空白。
- 平移限制在合法世界边界内。
- 滚轮围绕指针位置平滑缩放；提供 + / - / FIT。
- viewport 尺寸变化时重新计算相机边界。
- 使用 semantic zoom：
  - 远景：势力区域、主要星系/基地、重大威胁、主要行动。
  - 中景：殖民地、矿区、舰队、路线、已知接触。
  - 近景：舰名、详细标签、传感器和局部行动信息。
- 标签不能随所有对象一起无限缩放并堆叠。
- Federation Space → Dawn Frontier → Neutral Zone → Romulan Frontier 必须形成有意义的交通、防御与情报空间，而不是简单三条竖色带。
- `StrategicMap` 与未来局部战斗用的 `TacticalView` 分开，不混为一个组件。

UI 相关任务完成前，实际运行 Electron 检查至少 1920×1080 与 1600×900；不能只以单元测试或构建通过作为视觉验收。

## 引擎与数据边界

- Electron 主进程拥有唯一权威 `SimulationEngine`。
- React/Renderer 只保存 UI 状态和只读 Snapshot，不维护第二份可结算世界。
- 所有世界修改都必须通过结构化、可验证的 Command 进入引擎。
- 隐藏敌方状态、AI 意图、随机源等不得泄露到 Renderer Snapshot。
- 游戏规则使用 simulation time；不要用 wall-clock 时间驱动游戏结果。
- 保持确定性 fixed-step 模拟与可复现随机源。
- 保存格式必须版本化；新增持久字段时同步更新 schema 与相关测试。
- 高层决策与物理模拟分离：决策层给出 defend / engage / retreat / scan / transport 等意图，引擎负责移动、射程、命中、伤害、库存和结算。

未来接入 LLM Agent 时：
- observation → model decision → structured action → validation → engine command。
- 模型不得直接修改 WorldState。
- 不按 simulation tick 调模型，只在有意义的决策点调用。
- Agent 只能看到其权限允许观察的信息。
- 不要求模型输出逐帧坐标、转向或伤害计算。

## 代码组织

- `src/engine/`：世界状态、规则、命令、模拟、存档。
- `src/ui/`：界面组件、hooks、格式化与交互。
- `src/StrategicMap.*`：战略地图；不要继续把战略世界塞进名为 TacticalMap 的组件。
- `electron/`：主进程、preload、持久化。
- `tests/`：确定性规则、存档和 Electron E2E。
- `docs/architecture.md`：涉及引擎边界/数据流时阅读。
- `docs/worldbuilding.md`：涉及世界设定与阵营规则时阅读。
- `docs/acceptance.md`：涉及当前 LV 验收时阅读。
- `README.md`：了解当前已实现能力与运行方式。

不要为了简单任务预读全部文档；只阅读与当前改动相关的来源。

## 开发行为

- 先理解现有实现，再修改；优先修根因，不要用 CSS/条件分支掩盖架构问题。
- 用户要求“重做/返工”时，可以重构错误实现，不需要为了保留旧代码而继续堆补丁。
- 不要擅自实现用户未要求的下一 LV 功能。
- 不要因为当前 UI/规则只是占位，就把占位实现固化成未来架构。
- 大改动保持模块边界清楚；`App.tsx` 负责组装，不继续膨胀成所有功能的单文件。
- 对可配置的舰级、武器、地点、数值优先使用数据定义，不散落魔法常量。
- 保持 TypeScript 类型严格，避免 `any` 绕过领域模型。

## 验证

本地测试使用隔离/一次性数据，可以直接运行，无需逐次询问。

按改动范围验证：
- 引擎/规则：`npm test`，并修复由本次改动造成的失败。
- 类型/构建：`npm run build`。
- UI/交互：运行相关 Playwright/Electron E2E，并实际检查窗口截图/界面。
- 发布相关改动才运行 package/release smoke tests。

不要为了一个小文案修改机械运行所有重型测试；但任何完成声明都必须有与改动相匹配的验证。

## 完成标准

任务完成意味着：
1. 用户要求的行为真正可用，而不是只有 UI 或占位代码。
2. 没有破坏现有核心规则和存档边界。
3. 视觉任务实际看过 Electron 结果。
4. 相关测试通过，或明确说明无法验证的具体原因。
5. 不把未实现功能写成“已完成”。
