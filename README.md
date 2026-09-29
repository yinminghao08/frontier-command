# STARFLEET: FRONTIER COMMAND

星际舰队：边疆指挥 · **新版 LV1 / 1.1.0**

一款离线 Electron 战略指挥游戏。你担任 Admiral，从 Dawn Starbase 调度四艘不同舰型，在同一张持续运行的星图中保护殖民地、运输物资、调查异常与侦察敌情。

**所有自动行为都是 LV1 确定性规则 AI。没有 LLM、API Key、Agent 等级或记忆、学员培养、造船和制造成长。** 角色、注意力、风险与收益的差异通过实际任务机制体现，不是六张改文案的脚本卡。

## 开始游玩

Windows：运行 `release/win-unpacked/Frontier Command.exe`。分发时复制整个目录，或解压 `Frontier-Command-1.1.0-win-x64.zip` 后运行；无需安装 Node.js，不依赖网络。

新世界暂停于 **Day 1 00:00**。左侧进入 **OPERATIONS**，分别创建：

1. **运输**：Antares／子午号，Dawn → 新曙殖民地，30 补给，安全航线。
2. **战斗／防御**：Peregrine／守望号，保护新曙殖民地，ENGAGE HOSTILES，45 游戏分钟。
3. **探索／侦察**：Constitution／明理号，调查琥珀星云，保留远距方案。
4. Galaxy／地平线号留作增援。点击 **16×** 和 **继续**。新敌情、调查决策、低舰体等关键事件会自动暂停。

调查抵达后从底部行动条打开 Inspector，选择远距或近距。完成结算后舰船仍需返航，抵港后才能再次派遣。受损舰可在 STARBASE 选择后维修；鱼雷不会免费即时重置，需要停靠装弹。

## 界面与真实决策

- 顶部左：日历、暂停和 1×／4×／16×；中间：按优先级排列的求援、报告与敌情；右侧：可用舰船、行动、已知威胁和补给。
- 左栏：SECTOR、OPERATIONS、PERSONNEL、STARBASE、COLONIES、ARCHIVE。舰船从星图、人员／基地面板或行动 Inspector 选择。
- 中央星图始终保留。拖动平移、滚轮缩放，点击地点、舰船、敌方接触或空白坐标。五个图层可独立切换。
- 右侧 Inspector 显示所选对象的实时状态；底部显示进行中的行动。通信可定位关联对象并标记已读。
- 不使用 WASD 操舰。通过目标、舰船组合、ROE、撤退条件、航线、调查方案和跨境授权进行指挥。

## 三种任务

| 类型       | 执行机制                                 | 玩家判断                                   | 结算与后续价值                                       |
| ---------- | ---------------------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| 防御／拦截 | 到场防御、真实战斗、确认驱离或击毁、返航 | 保护谁、派几艘、何时交战、何时撤退         | 保全设施／舰船、配额、情报；为运输提供安全窗口       |
| 运输       | 起点预留库存、真实装货、航行、卸货、返航 | 起终点、货种数量、安全／快速路线、另派护航 | 目的地库存与维修材料发挥实际作用；稳定配额           |
| 探索／侦察 | 到场选择、扫描或近距采样、报告、返航     | 科学舰适配、远近方案、跨境和撤退风险       | 科研、地图调查记录、目标识别；为路线判断提供已知风险 |

没有合适角色、超容量、重复分配或库存不足的命令会被引擎拒绝，拒绝没有部分副作用。每舰同时参与一项行动；战斗可多舰，运输与探索指定单舰。每项行动只结算一次，同一未变化地点不能重复刷科研奖励。

## 战斗、传感器与威胁

联邦舰型：Antares、Peregrine、Constitution、Galaxy。罗慕兰舰型：Romulan Scout、Valdore-type、D’Deridex；另有 Pirate Raider。舰体、护盾和恢复、能源和恢复、航速、货舱、传感器、武器、Photon／Quantum 库存均在配置中定义。

- 相位武器消耗 Core Power；鱼雷发射即扣库存，未命中也消耗。引擎计算射程、冷却、命中、护盾吸收和舰体伤害。
- HOLD FIRE 永不开火；RETURN FIRE 仅还击攻击本舰或保护目标的敌人；ENGAGE HOSTILES 主动攻击确认敌对目标；WEAPONS FREE 可主动攻击已识别非友军，不能攻击未知信号。
- 隐形降低探测概率并持续耗能；隐形中和解除隐形过渡中不能开火。
- 海盗从边缘入口航行而来，偏好弱防御的货船与殖民地，抢掠、遇到强防御或受损后撤退。罗慕兰进行侦察、试探和选择性攻击，无合适目标时不攻击。
- 情报依次为 UNKNOWN → CONTACT → CLASSIFIED → IDENTIFIED → TRACKED。失联显示 Last Known Position，位置冻结，30 游戏分钟后地图标记失效。
- 基地长程传感器覆盖290距离单位，不会无条件看见罗慕兰全境。隐藏世界由主进程保护，渲染器拿不到敌方真实实体或 AI 意图。
- 默认只允许联邦空间行动；命令可显式授权中立区或罗慕兰空间。跨境风险与 ROE 分别控制。

## 从源码运行

已安装依赖后可离线构建。Node.js 24、npm 11、Windows；具体依赖以锁文件为准。

```powershell
npm ci
npm run dev
npm start
npm test
npm run test:e2e
npm run build
npm run package
npm run test:package
npm run package:zip
npm run test:release
```

测试使用临时用户数据目录；打包烟测启动隐藏的真实 Electron 窗口，不操作用户桌面。E2E 截图和失败 trace 位于 `test-results/`。

## 架构与存档

主进程拥有唯一 SimulationEngine：UI → 受限 preload IPC → 命令校验／固定步长引擎 → 白名单 Snapshot。固定步长仍为 0.1 游戏分钟，倍速增加步数；约1真实秒对应1游戏分钟。暂停冻结世界，关闭期间不追赶时间。

`getObservation(operatorId)` 和 `controllerPort(operatorId)` 保留操作者边界，规则控制器没有可写世界入口。细节见 [架构](docs/architecture.md)。

本版本从新世界开始，**不迁移旧任务进度**。默认存档 `%APPDATA%/frontier-command/world-v4.json`，同代备份 `.bak`。旧 v1–v3 文件不加载、不修改。v4 保存行动阶段、库存预留、弹药、能源、敌方 AI、隐形、情报、通信及随机源。重启后暂停，不离线推进。

主文件损坏时只尝试 v4 备份；两份均损坏则进入禁止保存的临时世界。ARCHIVE 的“新世界”可归档当前 v4 后重置。未知未来版本禁止覆盖。保存采用临时文件替换与有效主文件备份。

## 文档与范围

- [世界观与规则手册](docs/worldbuilding.md)
- [LV1 验收矩阵](docs/acceptance.md)
- [两分钟演示脚本](docs/demo-script.md)
- [实际验证记录](docs/verification.md)

本阶段支持重复行动、常规补给、维修与应急拖航，维持可持续游玩；不包含完整经济、永久舰船损失、胜利剧情或领土扩张。科研和配额保留为成果，不宣称已完成 LV2 成长循环。

题目：[极创二面题](https://join.geek-tech.club/problems2/agent-mmo-game)。LCARS 视觉灵感来自 [TheLCARS.com](https://www.thelcars.com/)，原设计 Michael Okuda；本项目自行编写界面、地图与图标，未再分发模板。Antonio 字体使用 SIL OFL。Star Trek 相关标识属于其权利人，本项目为非官方学习展示；舰型混编和数值属于游戏抽象。
