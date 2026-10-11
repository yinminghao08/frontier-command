# FAR v16 自主协作演示

在游戏 **存档管理器 → AGENT DEMO / 演示存档** 创建独立场景，原进度先保存。场景使用固定 seed 236807，暂停于已确认虫洞、公开 AURORA 库存和受损 HORIZON 的状态。没有预置 Agent 决策、接受或承诺。

1. 在 **Console Settings → Agent API** 配置自己的 Chat Completions 兼容接口、Key 和模型。默认使用供应商默认推理模式，可在 Agents 中独立修改；显式 Thinking/Effort 必须有已确认的模型能力。每 Agent 保留一个有效逻辑决策，应用不设每分钟调用额度。
2. 在 Mira 私聊发送“请评估当前矿场运输与护航风险。”，明确发起本轮意图。保存 API 配置本身不会自动调用模型。观察其自主选择：提出护航请求、选择别的任务或暂缓。模型具有最终自主选择权，实际输出不会被场景脚本强制。
3. 同僚根据人格、舰损、疲劳和关系接受、拒绝或反提议。打开 **通讯 → REQUESTS / 待处理请求** 查看参与者、条件版本和最多两次协商。等待模型不会造成请求超时。
4. 如果提出维修和奖励条件，Admiral 确认后奖励从预算托管。点击继续，默认 16×；引擎实际消耗现场 Materials 维修，让护航舰会合，再执行装货、已确认虫洞航行和卸货。
5. 打开通讯或 Agent 详情的 **Task Card** 查看库存归属、步骤和交付证据；**SYSTEM REPORTS / 系统报告** 查看重要承诺结果。普通报告没有弹窗、声音或额外模型调用。Agents 详情显示奖励账本、心理状态、偏好及关系变化原因。
6. 再向 Mira 提出评估第二轮协作对象的意图。模型观察新的舰况、库存、信任与记忆，重新选择合作对象或条件。期间可保存并重启，准备、在途货物、托管与单次结算继续保留。

场景另有已支付 60 录取 + 90 训练 Credits、训练约 85/90 游戏分钟的学员。继续后真实毕业，可手动分舰。准备阶段的虫洞出口由实际 TRANSIT 确认；模型只能使用公开地图信息。

本地 HTTP provider 可重复验证完整链路，包括维修/奖励反提议、预算确认、实际交付及关系影响下一轮选择：

```powershell
npm test -- tests/agent-demo.test.ts
npm run build
npx playwright test tests/e2e/v13.spec.ts
```

测试 provider 只在 `tests/e2e/agent-provider.ts` 中使用，不是应用的决策回退。拒绝和直接接管分别有规则与 Electron 回归。没有 API 时，自愿任务等待判断；Admiral 仍能通过地图或直接接管模式指挥舰船。

运行 `npm run demo:save` 导出到 `.test-data/demo/` 下的 `agent-demo-v16.json` 和 `user-data/frontiers-v16` / `timeline-v16.json`，不包含 API Key。场景保留实际运行的 Orion 舰队；发布的旧版存档先验证再迁移，新时间线保留原文件。测试不读取玩家 APPDATA。

用隔离演示目录启动：

```powershell
$env:FRONTIER_USER_DATA = Join-Path (Get-Location) '.test-data/demo/user-data'
npm start
# 结束后恢复默认目录
Remove-Item Env:FRONTIER_USER_DATA
```
