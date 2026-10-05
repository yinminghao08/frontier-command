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
| 首次接触、10 分钟失联重获、首次敌对升级、同一步合并、各倍率同 tick 暂停        | command-v9.test.ts、command-v9.spec.ts、desktop.spec.ts                   |
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
