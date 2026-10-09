# FAR v16 验证记录

版本1.6.0，feature/agent-core-v2；发布基线c83889a。

- npm test：33文件 /472项全部通过（基线26文件 /411项）。
- npm run build：Renderer与Electron严格TypeScript、Vite构建通过；完整输出在electron.log开头。
- npm run test:e2e：真实Electron，68项全部通过，14.7分钟，FRONTIER_E2E_WORKERS=2，每实例独立userData与本地Mock。
- git diff --check：通过；原8项源码修改与保留基线内容比对8/8一致。
- v15/v14原文件保护、staging恢复、终态/中途任务、真实货物、付费、托管与消息恢复均通过。
- 600模拟分钟性能对比和50材料完整交付一致；未分舰自动请求0，普通物流请求0。详细数据见[performance.md](performance.md)及[far-performance.json](far-performance.json)。

原始日志：[unit.log](unit.log)、[electron.log](electron.log)。Task/Provider实际截图位于task/，Orion/救援/缩放证据位于orion/；历史v14证据文件未被本轮截图覆盖。核心规则证据见tests/far-runtime.test.ts、far-handlers.test.ts、far-dependencies.test.ts、cognition-runtime.test.ts及相关迁移/Provider测试。

真实供应商未验证；Mock耗时和未知usage不能用于宣称真实性能、Token成本或语义准确率。历史来源缺失保持证据不足，多年级Journal容量尚未认证。完整架构与清理记录见[交付说明](../../agent-core-v2-delivery.md)。
