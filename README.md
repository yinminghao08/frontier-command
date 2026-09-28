# STARFLEET: FRONTIER COMMAND

星际舰队：边境指挥 · 极创工作室二面 LV1

一款离线运行的 Electron 舰队模拟游戏。玩家从 LCARS 指挥终端管理曙光基地与三艘星舰，执行科学探索、后勤补给和边境巡逻，也可以在二维战术图内直接操舰。

当前阶段是 **LV1 世界与任务规则**。规则自动驾驶不是 LLM Agent；不需要 API Key，不调用模型，不消耗二面工具 token。

## 直接游玩

Windows 发布目录：`release/win-unpacked/`。双击其中的 **Frontier Command.exe**。

分发时必须保留整个 `win-unpacked` 目录，不能只复制 exe。也可将发布 zip 解压到任意可写目录后运行；运行本身不需要 Node.js 或网络。

首次打开世界暂停。在顶部“任务中心”选择任务与舰船，授权派遣，然后点击顶部“继续”。

建议第一次这样分工：

1. 明理号 USS VERITY → 琥珀星云探索。
2. 子午号 USS MERIDIAN → 信标前哨补给，安全航线。
3. 守望号 USS VIGIL → K-7 边境巡逻。
4. 使用 4× 加速旅行；探索抵达后选择调查方案，巡逻抵达后可直接接管并处置接触。

## 从源码运行

本机验证环境：Windows、Node.js 24、npm 11。依赖版本以 `package-lock.json` 为准。

```powershell
npm ci
npm start
```

其他命令：

```powershell
npm run dev       # Vite 界面热更新；引擎或 Electron 代码改动后重启
npm test          # 确定性规则和存档测试
npm run test:e2e  # 构建后启动真实 Electron 做端到端测试
npm run package   # 生成 release/win-unpacked
npm run package:zip # 将完整运行目录与文档压缩为 ZIP
npm run test:release # 解压 ZIP 后验证实际程序
npm run test:package # 隐藏窗口验证打包后的exe、离线运行与存档恢复
```

首次安装需要下载 Electron 与依赖；安装完成、构建成功后即可离线运行。使用开发模式时关闭测试启动的其他窗口，避免失焦自动暂停影响操作判断。

## 操作与规则

| 操作 | 方式 |
|---|---|
| 选择舰船 | 左侧舰船面板、星图点击或舰队状态条 |
| 派遣任务 | 任务中心 → 任务 → 执行舰船 → 授权派遣 |
| 暂停、倍速 | 顶部继续／暂停与 1×、2×、4× |
| 探索决策 | 右侧选择远距或近距调查；20秒未决定则采用远距 |
| 补给改道 | 去程中右侧选择安全／快速航线 |
| 扫描与警告 | 扫描接触 → 选择已识别目标 → 警告驱离 |
| 直接操舰 | 接管后 W/S 增减推进，A/D 转向，Space 开火；也可按住屏幕按钮 |
| 释放控制 | 恢复原任务，或保持位置；保持位置后可点“恢复原任务” |
| 维修 | 舰队管理 → 安排维修；材料不足自动使用较慢的基础抢修 |
| 再玩一轮 | 舰船返航后，在已完成／失败任务中重新开放行动窗口 |

直接操舰固定1×，失去窗口焦点自动暂停。键盘不会在输入框或下拉框中触发操舰。

相位武器射程145，舰艏射界±60°，冷却3秒；扫描范围220，警告范围240。所有命令都由引擎检查，无法通过前端伪造收益或直接设置舰体数值。

三类任务的差异详见 [LV1 验收表](docs/acceptance.md)。完整背景见 [世界观文档](docs/worldbuilding.md)，也可直接在游戏“星区档案”中阅读。现场演示见 [两分钟演示脚本](docs/demo-script.md)。

## 程序结构

```text
src/engine/      实体类型、合法命令、固定步长模拟、版本化存档与迁移
src/engine/definitions/  只读阵营、舰型、地点和资源定义
src/App.tsx     界面组合、跨页面导航与选择状态
src/ui/         六个页面、共享 LCARS 组件、快照与输入 hooks
src/TacticalMap.tsx  Canvas 战术图与快照插值
src/styles.css / src/lcars.css  原创组件与 Classic LCARS 双肘形框架
electron/       主进程、有限 preload 接口、本地原子存档
tests/          引擎／存档测试与真实 Electron 端到端测试
docs/           世界观、验收、演示、参考与实现边界
scripts/        开发启动与原创程序图标生成
```

数据流：界面提交命令 → preload 的有限 IPC → 主进程引擎校验／执行 → 状态快照 → React 与 Canvas。React 不拥有另一份可结算的游戏世界。

引擎每0.1秒一个固定步长，倍速增加执行的步数。Canvas 独立使用动画帧对收到的位置快照做插值，不影响模拟结果。没有联网服务器、游戏数据库或多进程服务框架。

## 为 Agent 预留的接口

`SimulationEngine.getObservation(operatorId)` 返回操作者舰船、可见接触、任务、资源和当前合法动作名称；未知操作者返回 null。调用者应根据任务与接触ID构造命令，所有参数仍会再次验证。

`SimulationEngine.dispatchCommand(command, actorId = 'commander')` 返回 `{ ok, reason }`。操作者只能向自己的舰船发出合法高层命令；指挥官可以干预任意己方舰船。世界快照不会包含未发现的接触位置。

`SimulationEngine.step(0.1)` 推进固定规则。相同初始种子与同一时间步命令序列得到相同状态；不是以模型生成的文本作为任务结果。

未来接模型时，让适配器只调用 observation／command；不要把 API Key 放入渲染进程，也不要把整个可写世界对象交给模型。本阶段没有创建模型连接或伪装成 Agent 的聊天功能。

`SimulationEngine.controllerPort(operatorId)` 提供绑定操作者的 `AgentControllerPort`，仅包含 `getObservation()` 和 `dispatchCommand(command)`。Operator 独立保存身份、规则控制器类型与 `shipId` 分配；Ship 保存舰船实体状态，不再反向保存操作者身份。没有新增 Agent 持久化实体或模型运行时。结构与扩展约束见 [架构说明](docs/architecture.md)。

## 存档与恢复

默认位于 Electron 用户数据目录：`%APPDATA%/frontier-command/world-v2.json`。备份为同目录的 `.bak` 文件。打包程序与源码启动使用同一应用名称，因此可以继续同一世界。

当 v2 主文件和备份都不存在时，自动读取 `world-v1.json` 或其备份，并在内存中迁移；下次保存写入 v2。正常迁移和保存保留原 v1 文件，舰船已有属性、任务进度和随机数状态不会被配置默认值覆盖。旧版程序只能读取保留的 v1 进度，不能读取后续 v2 进度。v2 文件一旦存在，不会因损坏而回退到更早的 v1 世界；遇到不支持的存档版本会阻止覆盖。

重要命令、世界事件、每10秒模拟时间和正常关闭时保存。保存先写临时文件，再替换主文件；之前的合法主存档进入备份。程序关闭期间不推进时间，重启后暂停并清除操舰按键。

主存档损坏时读取备份，并在下一次写入前把坏文件归档为 `.corrupt-时间戳`。主存档与备份都损坏时使用临时世界并阻止保存；系统页“归档旧存档并重置”会保留旧文件并创建新世界。

上述损坏文件归档适用于当前 v2 文件；从损坏的 v1 主文件恢复备份时，两个旧文件均保持原样。显式重置会归档 v1、v2 主文件及备份，避免旧世界再次被自动载入。

## 当前边界

- 完成 LV1 的三类任务与真人操作加分方向；没有实现 LV2 的成长系统或 LV3 的模型 Agent。
- 科研数据、情报和行动配额会保存，但尚不解锁升级；基地只有指挥与保障，没有建造。
- 边境规则、二维操舰和舰船轮廓都是游戏抽象，不是 Bridge Commander remake。
- 任务可重复开放；没有胜利剧情、永久舰船损失或无限扩张地图。
- Windows 发布程序未申请代码签名证书；本地打包已包含运行所需文件。

## 参考与署名

项目要求：[极创二面题](https://join.geek-tech.club/problems2/agent-mmo-game)。视觉参考：[TheLCARS.com](https://www.thelcars.com/)，LCARS 原设计 Michael Okuda。界面 HTML/CSS、舰船示意和图标均为本项目自行实现，没有再分发原站模板。

Antonio 字体来自 `@fontsource/antonio`，使用 SIL Open Font License；应用包含本地字体和许可。Star Trek 及相关标识属于其权利人。本项目为非官方学习展示。详细阅读记录见 [参考资料](docs/references.md)。
