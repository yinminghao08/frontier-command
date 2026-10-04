# v7 Admiral 演示

从正常暂停的新世界开始，六舰与原始库存不作调试注入。可使用 UI 16× 完成旅行和生产，再切换 1× 观察持续世界。

1. VERITY 探索 UNKNOWN 0/-1，近距调查资源。HORIZON 巡逻 Helios；运输舰补充矿场维护 Supplies。
2. 从 OPERATIONS 打开新矿藏，建立 Mine 项目；COLONIES 打开项目，安排现场 Materials 和 Supplies。等建成后继续真实补给。
3. 观察生产与仓储。若矿场事故出现，派科研舰现场响应；等仓满，检查停产和运输请求。移出材料后观察产线恢复。
4. FLEET 创建 MERIDIAN 编队，三运输舰总容量 1800。组 HAUL 输入总量 600，从满仓 Mine 运至 Dawn，查看每舰分摊与共同航行。VIGIL 护航，HORIZON 巡逻；观察真实 Scout 情报、Orion 压力和拦截机会。
5. Colony 生产 Supplies 和 Credits；安排 Supplies 运输至 Dawn。SHIPYARD 建新舰，检查 20 Materials、10 Supplies 与 180 Credits 支付和独立舰籍。
6. PERSONNEL 接受 Commander 推荐的候选人，支付培养，毕业后在殖民地实际任职。可派舰抵达再任职舰船。
7. OPERATIONS 响应持续事件；确认通信不会结案。可调查遗迹、救援事故、治疗疫情、运输难民或探索 Wormhole。
8. 选舰后点击星图点，查看目的点和“前往此处”，分别验证替换、排队和中断。Esc 取消目的点，拖动不发令。
9. STARBASE 八模块与 Colony 四项发展继续支付实际库存。Hail 与边境进出产生政治历史，未确认敌对 Romulan 不自动攻击。
10. 保持至少十分钟 1× 持续运行，记录补给、生产、仓满、收入、人员、敌方行动和事件。ARCHIVE 保存后重启，核对续存；另以 seed 42、1701 复查。

真实 UI 验收脚本为 `scripts/acceptance-v7.mjs`；交互式检查工具为 `scripts/play-v7.mjs`。脚本只初始化正常新世界，通过实际控件发令，从公开 Snapshot 观察，并保存隔离日志和截图。
