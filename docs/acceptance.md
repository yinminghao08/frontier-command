# LV1 v5 验收矩阵

本矩阵描述必须真实成立的行为，不能用测试数量或文档自称替代。自动化使用生产引擎、生产IPC及真实Electron；边界场景在启动前建立隔离v5存档，不向Renderer添加调试写入接口。

| #   | 要求                                                                                          | 可复现证据                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Pirate比较收益与护航风险，袭击运输舰／殖民地／矿场／前哨，转移真实库存并活着撤离              | frontier.test.ts：profit preference、三类设施抢掠、raids actual stock then leaves alive；Electron永久舰损场景使用真实海盗火力                                     |
| 2   | Scout共享报告使远处Warbird选择攻击或继续观察；过期报告不能授权新袭击                          | frontier.test.ts：Scout reports、stale reports；desktop.spec.ts：Scout intelligence 的弱防御／强防御两次独立启动                                                  |
| 3   | UI创建防御、运输、探索并执行、决策、结算、返航；三类具有不同失败路径                          | desktop.spec.ts：create three concurrent orders、failed defense and energy-starved recon、real hostile fire；engine.test.ts：货损、取消、超时、失联、调查重复收益 |
| 4   | Core与真实鱼雷消耗，未命中也消耗；装弹不能超库存且转移守恒                                    | engine.test.ts：武器／库存测试；frontier.test.ts：扫描能耗；desktop.spec.ts：explicit ammunition loading，UI拒绝4发、接受实际3 Photon＋1 Quantum                  |
| 5   | Hull归零永久移出舰队，Archive保留，权限撤销、任务失败，保存／重启不复活                       | frontier.test.ts：destroyed operators；persistence.test.ts：空舰队；desktop.spec.ts：real hostile fire，Archive与重启                                             |
| 6   | Dawn真实受击归零，COMMAND LOST停止步进并拒绝游戏命令                                          | frontier.test.ts：hostile weapons destroy Dawn；desktop.spec.ts：COMMAND LOST，重启保持终态                                                                       |
| 7   | 初始日与每个午夜准确独立快照；16×不串步；Day3恢复Day2新分支，失败字节保持不变                 | persistence.test.ts：1/4/16×、fork Day3、写入失败、终态优先；desktop.spec.ts：16x midnight、COMMAND LOST、Day1 new frontier                                       |
| 8   | 失联冻结LKP并过期；改变隐藏位置／意图／库存不改变公开投影                                     | frontier.test.ts：hidden state changes；engine.test.ts：分级探测、失联、重新观测；architecture.test.ts：权限与白名单边界                                          |
| 9   | 1920×1080和1600×900真实Electron默认／FIT／8×／四向边界拖动／Resize／选中；抽屉不挤地图        | camera.test.ts：数学边界与锚点；desktop.spec.ts：LCARS map boundaries，实际鼠标事件与尺寸断言                                                                     |
| 10  | 整个界面及所有控件为LCARS，实际看主界面、表单、抽屉、正常／选中／失效／危险状态和COMMAND LOST | test-results/v5-\*.png；人工查看后保留代表截图到docs/screenshots；记录见verification.md                                                                           |

## 任务差异

| 维度     | Battle / Defense                          | Cargo Transport                      | Exploration / Recon                    |
| -------- | ----------------------------------------- | ------------------------------------ | -------------------------------------- |
| 适配     | 武器、护盾、速度，多舰资产                | 货舱、实际库存与存活能力，单舰       | 科学、传感器、Core，单舰               |
| 玩家决策 | 保护／拦截对象、Priority、ROE、Withdrawal | 起终点、货种数量、路线、另外安排护航 | 调查对象、远近方案、边界授权和撤退     |
| 消耗     | 弹药、Core、舰体、在场时间                | 源库存、货物、航行与装卸时间         | 扫描Core、工作时间、近距环境损伤       |
| 失败     | 目标毁灭、执行资产耗尽、超时、未确认战果  | 舰损、货损、设施毁坏、超时           | 能源不足、失联、舰损、撤退、超时       |
| 收益     | 保全对象、防卫配额、情报                  | 目的地真实库存、运输配额             | 一次性科研成果、调查知识与路线风险更新 |

## 范围与重跑

`npm test`执行确定性、权限、资源守恒、存档续跑、任务与地图数学测试；`npm run test:e2e`先构建，再运行真实Electron。存档目录均为临时目录。日快照由主进程完整步回调持久化，不是测试事后重写时间。

当前不实现LLM、成长、造船、制造、完整生产经济或战术操舰界面。PERSONNEL仅呈现真实规则操作者和分配。科研／配额保存为成果，不伪造升级用途。永久舰损、COMMAND LOST与分支恢复属于本次必须实现范围。

本次没有发布打包任务，不以既有旧版EXE／ZIP作为v5验收产物。验证失败必须修复或如实记录，不删除行为要求来适配旧代码。
