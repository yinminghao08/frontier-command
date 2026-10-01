# LV1 v5 演示步骤

从源码运行 `npm start`。既有 release 目录未随本次返工重新打包。

1. 新世界在Day 1 00:00暂停。展示LCARS Communications、六项导航、中央StrategicMap、Inspector及底部ActiveOperations。点击FIT、围绕鼠标缩放、边界拖动；打开PERSONNEL抽屉，地图尺寸保持不变。
2. 地图选择新曙殖民地：创建Antares Transport运输30补给，再创建Peregrine Patrol Craft防御。选择琥珀星云，创建Constitution探索。展示真实货舱与Commander Intent参数。
3. 16×继续。新情报暂停后查看通信与LKP，再继续。调查到达后打开底部行动，选择远距或近距。舰船消耗Core、承担真实风险，完成后报告并返航。
4. STARBASE查看真实Photon／Quantum库存；选舰指定装弹数量。库存不足拒绝，不允许用Materials免费补满。维修和装弹是不同命令。
5. ARCHIVE查看行动、永久舰损与时间线。舰损不会复活；基地毁灭显示COMMAND LOST。Day3恢复Yesterday进入Day2 00:00新分支，失败分支保留。

场景耗时由航程与暂停次数决定，不承诺固定两分钟。毁舰／基地失守／跨日演示可运行隔离的Electron E2E场景，不修改玩家存档、不提供正式游戏作弊按钮。完整可复现命令和截图见verification.md。
