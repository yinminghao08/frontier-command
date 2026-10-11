FRONTIER COMMAND — OPERATION LAST LIGHT v3 / REAL AGENTS
完全离线，直接用本地 v16 demo/agent-demo-v16.json 构建，不连接 GitHub。

【修改内容】
- Mira 与 Talia 的 CognitionResponse 完全交给真实 LLM；不覆写 accept/reject/counter，不预填 Agent 聊天或合同。
- 对 Mira 的自愿 + risky 高风险运输提供明确、真实的 Orion 风险信息和结构化护航协商指导。
- Talia 独立决定是否接受 Mira 的护航请求，必须有真正的 ESCORT、会合和联动。
- MERIDIAN-1 必须实际装有材料且通过虫洞返回 Dawn 一侧，才触发 11 艘 Orion 同步到达。
- 只产生一次 Orion 舰队新接敌警告；每艘 Orion 仍独立受真实模拟和战斗控制。
- 最后一艘可追踪目标叫 orion-escape，Raider 级（无无敌保护）。
- 两艘初始 Galaxy：HORIZON / RESOLUTE，Battle Agents：Talia / Rhea；物流 Mira，另有 USS VEIL。
- Credits 12500；Materials 3600，矿场 1800，鱼雷库存丰富。可亲手再造第三艘 Galaxy。
- 使用真实 v16 的 World Schema 和 SaveStore 检验并诊断可恢复的备份。

【安装】
1. 退出 Frontier Command 所有游戏窗口和进程，别打开 npm start。
2. 解压 ZIP 到磁盘文件夹。
3. 双击 INSTALL-AND-RUN.cmd。
4. 等待 Vitest 与 TypeScript 检查完毕，出现 SUCCESS 才算安装成功。
5. 游戏应使用数据目录：%LOCALAPPDATA%\FrontierCommand-LastLight-Offline-v16
6. 在存档管理器选择 OPERATION LAST LIGHT v3 - REAL AGENTS。
7. 以后使用 RUN-DEMO.cmd 继续相同数据目录，不会重新生成新世界。

【模型是真实决策，不能预先承诺它一定同意】
Mira 经过真实模型的意愿判断决定 accept/reject/counter；本版不会把接受修改成反提议。
为了最大程度得到你想要的剧情，请先通过舰船任务界面选择：
HAUL / AURORA MINE → Dawn Starbase / Materials / 500 / risky / Agent 判断后执行。
如果 Mira counter 提出 escort 条件，去 Requests 确认，等待 Talia 在真实模型里响应。
如果 Mira 没有申请护航，仍保留她的自主性。不要为了演出编造 LLM 答复；可询问她风险和可行的护航条件，或者从独立原始存档重新录制。

【可恢复的存档】
本次会验证新存档和本地复制功能。对旧存档，仅在找到通过同代 parseSave 校验的 .bak 时修复。
如果旧 head.json 和备份都不合法，保留文件并报告；没有办法凭空恢复损坏内容。
安装器不会覆盖既有正式游戏世界或用户 Key。

【安全性】
- 安装只修改 worktree 的 engine.ts / sensors.ts / cognition.ts / orion/tactics.ts，新增 last-light.ts。
- 原文件备份在该解压文件夹下的 backups/ 目录。
- 校验失败时自动还原本次修改，不安装新的 Demo 时间线。
- 如果发现残留 v2 强制覆写模型结果，先运行 RESTORE-OLD-PATCH.cmd，然后重试。
- 未来正常存档不受场景逻辑影响；只通过独立 v3 ID 激活。
