# v11 Agent Demo

最快入口：游戏中打开 **SAVE MANAGER / 存档管理器 → AGENT DEMO / 演示存档**。会创建一个独立存档并暂停，原进度自动保存。点击 **继续**，默认速度为 **16×**。

这个场景预置了经 Command validation 接受的 Agent 决策，接下来的装货、航行、护航、卸货、训练和经验全部由真实模拟规则推进。预置决策属于演示场景编排；运行时没有脚本代替 LLM 的决策。

建议用约两分钟演示：

1. 点击悬浮 **CHAT / 通讯**。群聊已有 Mira 的 `@Talia` 护航请求、Talia 的接受答复以及两条执行报告；两人的独立私聊也已有消息。
2. 进入 **AGENTS**，查看 Battle 的 Talia / USS HORIZON 与 Logistics 的 Mira / SS MERIDIAN-1。Talia 独立推理为 `low`，Mira 为 `none`，模型继承全局设置。
3. 点击 **继续**。货船从 AURORA 矿场实际装载 **40 Materials**，选择已确认虫洞的捷径返回 Dawn，Talia 执行真实 ESCORT。约几十秒内群聊出现 HAUL 与护航完成报告，库存、经验、关系与记忆同步改变。
4. 学院已有支付 **60 录取 + 90 训练 Credits** 的 Battle 学员，训练已进行约 **85 / 90 游戏分钟**。继续后很快毕业，可手动分配 USS VERITY；另有未录取候选人可选择 Battle / Logistics 培养。Credits 充足，可查看完整培养流程。
5. 在 **Console Settings → Agent API** 填写自己的兼容接口和 API Key，测试连接并保存。在 Agent 详情设置独立模型或推理强度，点 **再次决策**。私聊要求改变任务，或在群里 `@Mira` / `@Talia`，可继续体验真实模型决策与行为。

虫洞出口由 USS VERITY 在准备阶段实际 TRANSIT 确认，Journey Planner 只用已知信息。初始场景暂时没有附近敌舰，便于集中观察物流和培养；Battle 的自主攻击与击杀有规则测试，护航接受与拒绝有 Electron 验收。未配置 API 时已提交任务仍能完成，下一次决策会显示离线提示，等待配置。

## 独立存档文件

- `agent-demo-v11.json`：完整 v11 世界，方便检查与测试。
- `user-data/timeline-v11.json` 与 `user-data/frontiers-v11/frontier-000001/head.json`：可直接由 Electron 加载的演示存档目录。
- 不包含 API Key、账户或外部网络配置。

也可用隔离目录启动，不影响日常存档。PowerShell 在仓库根目录运行：

```powershell
$env:FRONTIER_USER_DATA = Join-Path (Get-Location) 'demo/user-data'
npm start
```

体验后删除本会话的环境变量即可恢复正常存档目录：

```powershell
Remove-Item Env:FRONTIER_USER_DATA
```

运行 `npm run demo:save` 可从同一场景重新生成演示文件。该命令只更新仓库中的 demo 目录；游戏内的一键入口每次创建新的独立存档。
