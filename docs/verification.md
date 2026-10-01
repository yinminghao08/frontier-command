# LV1 v5 实际验证记录

日期：2026-09-29。源码版本1.1.0，世界格式v5。Windows x64，Node.js24.18.0、npm11.16.0、Electron41.10.7、Vite6.4.3。

## 实际结果

| 检查                                                                                                 | 结果                                                               |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `npm test`                                                                                           | 7个文件，86项通过                                                  |
| `npm run build`                                                                                      | TypeScript、Vite、Electron编译通过                                 |
| `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`                                             | 通过                                                               |
| `npx playwright test`                                                                                | 完整10项真实Electron测试通过；最终结果副本见electron-last-run.json |
| `npx playwright test --grep 'COMMAND LOST\|Day 1 has no restore' --output .test-data/final-terminal` | 最后消除时间控制的过时通知后，2项终态／新世界场景复验通过          |

没有运行发布打包、EXE或ZIP烟测；已有release目录仍是旧版，不能作为v5产物。本次交付是源码及可运行构建。

## Electron场景

1. 用UI创建运输、防御、探索三项并发任务，16×推进，选择近距方案，全部成功结算并返航；保存、关闭、重启后行动记录一致。
2. 从调查待决继续、修改ROE；超货舱运输由引擎拒绝并显示LCARS错误通知，未创建部分行动。
3. 1920×1080与1600×900内容视口：遍历五个管理抽屉并关闭，地图边界盒不变；鼠标中心缩放、8×极限、四方向拖至相机边界、FIT、地图选择、Resize保留世界中心、表单开启与滚动提交均验证。不存在页面级溢出。
4. 真实海盗火力使运输舰Hull归零，Archive显示永久损失；保存／重启不复活，任务失败。
5. Day3基地被真实海盗武器摧毁，COMMAND LOST出现；继续命令被拒绝、tick冻结。重启仍为终态；RESTORE PREVIOUS DAY恢复Day2 00:00并建立新分支，原failure.json字节不变。
6. 16×从午夜前一tick跨日，day-2.json恰为tick14400；day-1.json仍为tick0。
7. UI装弹4 Photon而库存只有3时拒绝；3 Photon＋1 Quantum先预留、再按时间转入舰船，基地与预留最终归零，舰船得到精确数量。
8. 独立弱防御／强防御世界中，Scout报告使远处Valdore分别选择probe／observe；Renderer始终不包含敌方实体和Romulan报告。
9. 防御设施被摧毁和调查Core不足分别产生实际失败反馈。
10. Day1 COMMAND LOST恢复按钮禁用；BEGIN NEW FRONTIER经LCARS确认后创建新世界，失败记录和旧版文件保持不变。

测试使用临时用户数据目录，通过生产Electron、preload、命令校验和引擎运行。边界测试在启动前生成隔离场景；没有给正式Renderer开放修改世界的测试接口。两种分辨率通过Electron BrowserWindow.setContentSize设置，系统125%显示缩放使PNG物理尺寸为2400×1350／2000×1125。

## 规则证据

- Pirate对货物价值和护航变化改变目标，殖民地／矿场／前哨均可被真实抢掠；取得20战利品后活着离场，撤离不同于Hull归零。
- Scout报告来源与观测时间保留；强防御、无目标和过期报告可以阻止Warbird袭击。
- Phaser／鱼雷发射的Core、弹药与未命中消耗；零弹药不能开火；真实装弹守恒；新增伤害不被既有维修额度免费修复。
- 舰损事件撤销操作者权限，销毁货物和任务关联归档；允许全部舰船被毁、操作者未分配；28舰防御编队不受初始舰数限制。
- Priority按已观测攻击证据改变目标排序；规则操作者不能调任自己或越过暂停命令。
- 隐藏位置、意图与库存改变不改变Snapshot；失联位置冻结，超过30分钟不再提供地图接触。
- 固定步长、同种子复现、存档续跑一致、库存预留与取消回收、调查重复奖励抑制、整段跨境授权。
- 1×／4×／16×的午夜快照、Day3→Day2分支、恢复写入失败不切换、损坏终态不回退至存活备份、旧版／未来版本保护。
- 默认世界运行一个游戏日或至终态，持续满足v5保存校验。

## 实际视觉检查

已打开检查以下真实Electron截图：主界面、两种尺寸的全部管理抽屉、Commander Intent表单及底部提交状态、装弹禁用状态、Archive舰损、COMMAND LOST与新世界确认。黑底、连续粗色带、双肘区域、非对称布局、胶囊按钮、LCARS输入／选择／复选及计量条保持一致。抽屉覆盖地图，不改变相机尺寸。表单独立滚动，标题与关闭按钮保持可见。

| 画面         | 1920×1080                                         | 1600×900                                          |
| ------------ | ------------------------------------------------- | ------------------------------------------------- |
| 主界面       | [截图](screenshots/v5-sector-1920.png)            | [截图](screenshots/v5-sector-1600.png)            |
| 任务表单     | [截图](screenshots/v5-composer-1920.png)          | [截图](screenshots/v5-composer-1600.png)          |
| 表单提交控件 | [截图](screenshots/v5-composer-controls-1920.png) | [截图](screenshots/v5-composer-controls-1600.png) |
| 人员分配     | [截图](screenshots/v5-personnel-1920.png)         | [截图](screenshots/v5-personnel-1600.png)         |
| COMMAND LOST | [截图](screenshots/v5-command-lost-1920.png)      | [截图](screenshots/v5-command-lost-1600.png)      |

另见[舰损档案](screenshots/v5-vessel-loss.png)、[实物装弹](screenshots/v5-armory-loading.png)、[Day1恢复禁用](screenshots/v5-day-one-lost.png)、[新世界确认](screenshots/v5-new-frontier-confirm.png)。其余抽屉截图保存在同目录v5前缀文件中；旧截图仅为历史产物，不作为此次验收证据。

## 验证中修复的问题

修复了安全路线重算时往返振荡、Point参数扩散其他领域字段、未观测罗慕兰设施误画成毁坏、永久终态因序列化字段顺序误判变更、恢复误用失败前备份、低刷新率下缩放迟迟不收敛、拖动离开窗口丢失结束事件、原生表单气泡绕过LCARS反馈及时间控制通知在失守后短暂过时等问题。未删除对应行为要求来让测试通过。
