# Frontier Command v8 验收

基于 GitHub main `7131c31` 的现有主进程引擎、固定步、指令、事件与 LCARS 架构。不接入 LLM，不迁移旧世界。

| 约束 | 验证位置 |
| --- | --- |
| 无周期维护；3000 Mine；Colony Credits；Dawn Materials 守恒；真实成本与贸易恢复 | v8.test.ts、frontier.test.ts、recon.test.ts |
| 默认空闲、低弹药、非战斗低状态、完成、取消、失联和重启后不移动 | recon.test.ts、v8.test.ts |
| 明确 RETURN / DOCK、REPLACE / QUEUE / INTERRUPT、紧急本地脱离分别成立 | engine.test.ts、frontier.test.ts、recon.test.ts、desktop.spec.ts |
| v8 严格库存/schema、拒绝旧格式、日快照、分支恢复和永久舰损 | architecture.test.ts、persistence.test.ts、clock.test.ts |
| 多 seed 与生成顺序独立；密度/60/70/180 间距；固定通道 | geography.test.ts、recon.test.ts |
| 唯一 Veil 接管、延误、改名、续存和永久损失；手动/自动 Cloak、能源及开火 | recon.test.ts、recon.spec.ts |
| 普通 Orion/Romulan 尾随暴露、甩尾优先于返港、隐形秘密尾随、10 分钟地点确认与打击 | recon.test.ts、recon.spec.ts |
| 隐藏基地、AI intent、目的地、证据和假航点不进入公开输出 | architecture.test.ts、recon.test.ts、recon.spec.ts |
| 跟踪/甩尾/部分地点情报/隐形保存恢复与固定步确定性 | recon.test.ts、clock.test.ts |
| 三层地图语义缩放、真实标签碰撞检查、同类固定色、图例 | camera.test.ts、recon.spec.ts、v8-ui.spec.ts |
| 中文阿里巴巴普惠体、英文数字 Antonio，离线实际字体、字面高度/基线实测；同一行同字号导航/标题 | recon.spec.ts、lcars.spec.ts、v8-ui.spec.ts |
| 六种原尺寸、125/150/200% 缩放、长中文名字、八基地模块、音频/动画/焦点 | lcars.spec.ts、v8-ui.spec.ts |

必跑 `npm test`、`npm run build`、`npm run test:e2e`。后者启动真正的 Electron 主进程和渲染页面；专项恢复与尾随包含可见窗口并保存截图，公开 API 不提供测试专用世界修改口。

`node scripts/acceptance-v8.mjs 236807` 使用正常新世界和隔离用户目录，通过真实 UI 验证待命、固定通道、现场调查、接管和隐形。多 seed 规则验证用 42、1701、236807。运行证据存于 `docs/verification/v8/`，实际结果见 verification.md。测试夹具为 v8；旧验证存档与过时脚本已替换。现有 release EXE/ZIP 未重新发布。
