# 仓库维护规则

源码、正式 Markdown、必要运行资源和冻结测试 Fixture 入库。截图、日志、验收 JSON、临时存档、字体原稿、模板压缩包、演示导出和构建缓存只留本地。清理使用 `git rm --cached`，不删除原件，不改写历史。

## 本机保护

新克隆运行 `npm run hooks:install`。当前仓库已配置 `core.hooksPath=.githooks`；hook 使用 Git 自带的 sh 和 Node，不依赖全局 hook 安装。`npm run git:check` 审计当前索引；pre-commit 读取暂存 blob 而非工作区；pre-push 检查待推送各提交中的新增/修改文件和最终树，支持多 ref、删除 ref 和合并提交。

默认上限 1 MiB。字体、图像、音频、档案和 Fixture 需要在 `scripts/git-policy.json` 中逐个列出；运行字体有单独大小上限。目录白名单不能豁免密钥文件。检查拒绝常见密钥路径、私钥和常见 token 特征。hooks 是本地防误操作机制，可被 `--no-verify` 绕过；敏感信息检查不保证识别所有供应商或所有格式。

历史文件仍在 Git 对象库。正常删除不会减小历史 clone 体积。pre-push 不要求改写已经在远端的历史，但新增提交重新引入这些文件会被拒绝。检查器和白名单的修改也必须审阅。

## 测试输出

Vitest、Playwright 和独立验收脚本使用 `.test-data/tmp` 作为隔离临时存档目录；截图、trace、报告和验收结果输出到 `.test-data/`。可复现 demo 导出也写入 `.test-data/demo/`。Fixture 生成器输出 `.test-data/generated-fixtures/`，更新冻结 Fixture 时需人工比较后复制。`tests/fixtures/demo/` 保存有效测试实际读取的旧 demo 数据；原始 `demo/` 本地副本停止跟踪。

## 字体及打包

保留四份运行字体，以保证完整克隆、浅克隆、离线构建和已安装程序均可用。历史源字体、重复 WOFF 和模板示例停止跟踪。制作流程与校验见 [字体说明](../fonts/README.md)。

Electron Builder 仅收入 `dist`、`dist-electron`、图标和 package.json；README 作为独立文件。正式文档不再随程序复制，历史验证目录不会出现在 ASAR 或外层资源中。字体授权说明应与构建一起保留。

## 本次审计结果

原跟踪 668 文件；清理后 314 文件（含新增保护工具及必要 Fixture）。停止跟踪 372 个旧路径，所有原件均已核实保留。完整清单见 [停止跟踪清单](repository-cleanup-files.md)。体积按索引 blob 原始字节计，不是压缩后 .git 大小；本次约从 105.63 MiB 降至 27.25 MiB。

构建、最终隔离打包、暂存/全索引检查及隔离 Git hooks 集成验证通过；打包无历史截图/验收目录，字体通知保留。此前运行的 478 项单元测试通过；Electron 显示验证 2 项通过、125% 项因窗口关闭失败，未进一步扩展游戏排查。

历史中仍有以下 ≥1 MiB blob（全部 refs，按对象去重）：

| 路径 | bytes |
| --- | ---: |
| `fonts/AlibabaPuHuiTi-LCARS-Bold.ttf` | 16638176 |
| `fonts/AlibabaPuHuiTi-3-55-Regular.ttf` | 8532824 |
| `fonts/AlibabaPuHuiTi-3-65-Medium.ttf` | 8429388 |
| `fonts/AlibabaPuHuiTi-LCARS-Regular.ttf` | 8355400 |
| `projects/frontier-command-interview_ppt169_20261010/sources/Codex.pptx` | 5373875 |
| `projects/frontier-command-interview_ppt169_20261010/analysis/template-preview/幻灯片13.PNG` | 1353443 |
| `projects/frontier-command-interview_ppt169_20261010/analysis/template-preview/幻灯片1.PNG` | 1078096 |
| `projects/frontier-command-interview_ppt169_20261010/analysis/template-preview/幻灯片2.PNG` | 1073365 |
| `projects/frontier-command-interview_ppt169_20261010/analysis/template-preview/幻灯片21.PNG` | 1063403 |

历史保留原样；其中两份 LCARS 中文运行字体仍在当前白名单，其余源字体和演示材料不在当前索引。普惠体源文件未内嵌授权条款，官网声明本次无法读取；保留原有版权元数据和来源链接，未声称已重新核验完整再分发/修改授权。
