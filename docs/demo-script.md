# v8 Admiral 演示

1. 在 SECTOR 查看战略对象与图例，缩放到 LOCAL 或选中系统展开次级天体。左侧导航和栏标题均为英文后接中文。
2. MERIDIAN 从 Helios 运送真实 Materials 到 Dawn，HORIZON 巡逻矿场。矿场仓位 3000，满仓报告一次，运走后恢复；Colony 的 Credits 收益不需要维持物资。
3. OPERATIONS 选择近距调查过的矿藏，建立 Mine 项目；从 COLONIES 项目安排现场 Materials。没有周期维护。
4. 舰船完成 MOVE、HAUL、取消指令或失联后留在实际位置。返回基地必须显式 RETURN 或 DOCK；REPLACE / QUEUE / INTERRUPT 保留原语义。
5. VERITY 穿越 FRONTIER 0/0 的 DAWN PASSAGE，近距 SURVEY 幽影残骸，再 ASSIST_EVENT 接管 USS VEIL。该事件可以以后处理，接管与永久舰损都进入存档。
6. 用普通舰 SHADOW Orion / Romulan，可能暴露并被假航点甩尾。用 VEIL 执行 SHADOW 自动隐形，也可在 Inspector 手动开关。
7. 尾随过程中地图只出现实际观测到的接触。到真实目的地附近出现未确认设施，连续现场侦察 10 游戏分钟后才显示基地名称并允许 ATTACK。
8. ARCHIVE 保存并重启，检查隐形、跟踪、地点情报、名字和舰籍续存。旧版本世界不会载入 v8。

验证入口：`npm test`、`npm run test:e2e`、`node scripts/acceptance-v8.mjs 236807`。截图和公开状态结果写入 `docs/verification/v8/`。
