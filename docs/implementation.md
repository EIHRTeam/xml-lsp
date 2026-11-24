# 实施和验收报告

## 交付

工作区包括语言服务、Node stdio 和 Browser Worker LSP、Monaco 和 Ace 适配器与示例、VS Code Desktop 扩展和 Chromium MV3 示例。公开 npm 包 `@eihrteam/xml-lsp` 统一分发 API、适配器、Worker 和 stdio CLI。工作区子包保留独立构建边界。

P0 提供容错解析、语法、Schema 及转换诊断，上下文标签、属性和值补全，Hover、多文档生命周期和增量同步。P1 提供格式化、范围格式化、Quick Fix、大纲、折叠、联动编辑和文档链接。Ace 适配器展示 P0 和格式化。

## 技术验证

| 模块               | 版本及选择                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 编译器与构建       | TypeScript 7.1.0-beta、tsdown 0.23.7，TypeScript 编译器单独生成声明                                                              |
| XML 容错与严格校验 | @lezer/xml 1.0.6、@lezer/common 1.5.0、@xmldom/xmldom 0.9.12                                                                     |
| 上游转换器         | @eihrteam/xml 1.0.0，npm 发布源码对应上游提交 `09e3eb9`                                                                          |
| LSP                | vscode-languageserver 9.0.1、vscode-jsonrpc 8.2.0、vscode-languageserver-types 3.17.5、vscode-languageserver-textdocument 1.0.12 |
| 编辑器             | Monaco 0.58.0、Ace 1.45.2、vscode-languageclient 9.0.1                                                                           |
| 验证               | Vitest 5.1.1、Playwright 1.65.1、@vscode/test-electron 3.1.0、oxlint 1.95.0、oxfmt 0.80.0                                        |

XSD 来自当前仓库的参考文件。上游转换器没有随 npm 包分发 XSD 或结构化分层诊断 API。测试使用上游 `tests/fixtures/sample.xml` 的副本及随附 MIT 许可证。[上游样本](https://github.com/EIHRTeam/xml/blob/09e3eb9198fa0c5c0ff6c8879e3507aa80da8037/tests/fixtures/sample.xml)

工程验收包括生成元数据比较、类型、Lint、格式检查、15 项单元及 stdio 协议测试、包导出、干净安装、CLI 冒烟及 VSIX 打包。6 项 Playwright 测试均通过，覆盖 Monaco、Ace、Node 与两种浏览器上下文的一致性、真实 MV3 扩展和扩展源 iframe。MV3 验证默认 CSP、离线编辑、无远程请求和页面关闭释放 Worker。VS Code Desktop 1.147.0 使用独立 Extension Host 验证。`../xml` 的上游转换器测试共 144 项通过。

## 性能测量

使用 Apple M4 Pro、24 GiB RAM、macOS arm64、Node 24.21.0、Chromium 159.0.8154.6。10 KiB、100 KiB 和 1 MiB 各运行 10 次。5 MiB 和 20 MiB 各运行一次压力测试。样本由复杂表格、对话分支及富文本按固定算法生成。可用 `pnpm benchmark --browser` 重跑，输出完整 JSON。

| 文档    | 首次容错分析及补全 P95 | 首次诊断 P95 | 缓存补全 P95 | 缓存 Hover P95 | 单字符编辑及补全 P95 |
| ------- | ---------------------: | -----------: | -----------: | -------------: | -------------------: |
| 10 KiB  |                4.47 ms |     18.40 ms |      0.04 ms |        0.01 ms |              2.63 ms |
| 100 KiB |               63.79 ms |     83.07 ms |      0.05 ms |        0.03 ms |             10.44 ms |
| 1 MiB   |              171.48 ms |    397.99 ms |      0.02 ms |        0.01 ms |             62.26 ms |
| 5 MiB   |              350.00 ms |    370.25 ms |            — |              — |                    — |
| 20 MiB  |               30.53 ms |     32.48 ms |            — |              — |                    — |

诊断计算耗时独立于默认的 200 ms 防抖。5 MiB 样本触发语法节点预算，20 MiB 样本触发文档大小预算。高密度 1 MiB 文档的单字符编辑加补全超过 50 ms 的建议目标。该样本的进程峰值采样 RSS 约 768 MiB，关闭文档和主动 GC 后约 754 MiB。此 RSS 包含 V8 保留的堆内存。

Node stdio 初始化 P95 为 46.27 ms，空闲 RSS P95 为 61.84 MiB。浏览器 Worker 从创建到 LSP 初始化完成 P95 为 16.10 ms。打开、分析并释放 50 个小文档约 11.94 ms。

| 分发文件              |    原始 |    gzip | Brotli |
| --------------------- | ------: | ------: | -----: |
| Language Service      | 248 KiB |  72 KiB | 62 KiB |
| Node stdio Server     | 415 KiB | 107 KiB | 89 KiB |
| Browser Worker Server | 386 KiB | 100 KiB | 85 KiB |
| Monaco 适配器         |  76 KiB |  19 KiB | 17 KiB |
| Ace 适配器            |  75 KiB |  18 KiB | 17 KiB |
| VSIX                  | 357 KiB |       — |      — |

适配器数据包含共享 JSON-RPC 客户端。示例另含编辑器自身代码、CSS、字体及必要的本地资源。

## 已知边界

工作区 npm 注册名与目标仓库按实际交付采用 `EIHRTeam/xml-lsp` 和 `@eihrteam/xml-lsp`。仓库沿用 Apache-2.0。TypeScript 使用 7.1 系列 beta，工具链已验证。

VS Code Web 入口可打包，集成验收覆盖桌面 Extension Host。Chromium 159 实测 Content Script 在网页源直接创建扩展 Worker 时返回 `SecurityError`，从同一 Content Script 嵌入扩展源 iframe 后 Worker 可正常初始化。完整通用 XSD 验证、Astrivagant Profile、InPageEdit 和本地资源索引属于后续范围。

转换器 1.0.0 提供文档级首条领域错误。详细的 XSD 与转换范围差异和诊断策略见架构说明。[架构和兼容性](architecture.md)
