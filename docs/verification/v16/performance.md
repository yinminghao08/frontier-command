# FAR v16 本地性能与物理结果对比

基线：c83889a2044616ec5791385ff01337c632b162fc。Actual baseline/current engine, service and client; identical deterministic seed, 600 simulation minutes, same 5ms in-process completion fixture. No real Provider or Token estimates. Step times exclude Service pump and Mock waits. One exploratory run, no significance claims.

| 场景 | 基线请求 / 请求字节 | FAR 请求 / 请求字节 | 真实物理结果 |
|---|---:|---:|---|
| conversation | 1 / 13062 | 1 / 2898 | 同一主动问候，各请求 1 次 |
| unassigned | 1 / 9059 | 0 / 0 | 未分舰 600 模拟分钟，FAR 自动调用 0 |
| logistics | 0 / 0 | 0 / 0 | 双方矿场 50 → 0，基地 70 → 120，留舰 0；FAR 完整目标 completed |

单次聊天请求字节下降 77.8%。这衡量实际发送的 JSON 请求体，不是 Token 或计费估算。HTTP fixture 不返回 usage，有请求的场景保留未知。

| 协议 | JSON Schema 字节 |
|---|---:|
| legacyMixed | 20699 |
| communication | 740 |
| strategy | 629 |
| judgment | 1545 |
| intent | 8107 |

| 场景 | 基线引擎单步 p50 / p95 ms | FAR 引擎单步 p50 / p95 ms |
|---|---:|---:|
| unassigned | 0.0185 / 0.1329 | 0.0228 / 0.1203 |
| logistics | 0.0162 / 0.1162 | 0.0211 / 0.1386 |

本次为单次探索性运行。FAR 单步中位数有额外任务与验证开销，不能据此宣称引擎更快；请求体和无效唤醒数量的下降有实际记录。Mock p50/p95 保留在 JSON，仅反映本地定时器与进程调度，不代表真实供应商的连接、首字节、推理、费用或可用性。完整回收、取消、来源批次与存档恢复另由真实引擎测试覆盖。

重现：先将基线源码 `git archive c83889a src/engine electron/agents` 导出到 `.test-data/far-baseline`，然后在工作区执行 `node scripts/benchmark-far.cjs`。未引入服务端或外部供应商访问。原始数据见 far-performance.json（历史产物，仅本地保留：`far-performance.json`）。
