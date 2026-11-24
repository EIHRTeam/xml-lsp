# API

## 语言服务

`@eihrteam/xml-lsp` 导出 `createXmlLanguageService()` 和 `schemaInfo`。包可在 Node.js、网页主线程和 Dedicated Worker 中导入。

```ts
import { createXmlLanguageService, schemaInfo } from '@eihrteam/xml-lsp'

const service = createXmlLanguageService()
const uri = 'inmemory:///wiki/page.skland.xml'
service.openDocument({ uri, version: 1, text: '<sklandDocument><description><' })

const { items } = service.completion(uri, { line: 0, character: 30 }, { snippets: true })
const diagnostics = service.diagnostics(uri)
console.log(schemaInfo.version, items, diagnostics)
service.closeDocument(uri)
service.dispose()
```

| 方法                                                     | 行为                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `openDocument({uri, version, text})`                     | 打开独立 URI，成功返回 `true`                                                    |
| `updateDocument(uri, version, changes)`                  | 按数组顺序应用每项变更。变更可包含 `range`，省略时替换全文。拒绝相同或更旧的版本 |
| `getVersion(uri)` / `closeDocument(uri)`                 | 查询版本或释放指定文档                                                           |
| `diagnostics(uri)`                                       | 返回语法、Schema 和转换器诊断                                                    |
| `completion(uri, position, options?)`                    | 返回 LSP `CompletionList`。可启用 `snippets`                                     |
| `hover(uri, position, options?)`                         | 返回 LSP `Hover`。设置 `markdown: false` 可获取纯文本                            |
| `formatting(uri, options, range?)`                       | 返回安全的全文或范围 `TextEdit[]`                                                |
| `documentSymbols(uri)` / `foldingRanges(uri, lineOnly?)` | 返回树状大纲和折叠区间                                                           |
| `linkedEditing(uri, position)` / `documentLinks(uri)`    | 返回匹配标签的名称区间和可识别的 HTTP(S) 链接                                    |
| `codeActions(uri, range, diagnostics)`                   | 根据当前版本的诊断返回显式 Quick Fix                                             |
| `dispose()`                                              | 释放全部文档                                                                     |

位置为从零开始的行号和 UTF-16 字符偏移。需要撤销或并发更新的宿主应为每次更新分配递增版本。服务端请求与浏览器客户端会在版本变化后丢弃旧结果。

## Language Server

- `@eihrteam/xml-lsp/server` 导出 `registerServer(connection, options?)`。在监听自定义 transport 前注册共享服务。
- `@eihrteam/xml-lsp/node` 导出 `startNodeServer(options?)`，在当前进程启动 stdio。npm CLI 名为 `skland-xml-language-server`。
- `@eihrteam/xml-lsp/browser` 导出 `startBrowserServer(scope, options?)`。它接收 Dedicated Worker 全局对象并返回可释放会话。
- `@eihrteam/xml-lsp/worker` 指向入口脚本。宿主应复制该模块到同源静态目录，再使用 `new Worker(url, { type: 'module' })`。

`ServerOptions.diagnosticDelayMs` 默认 200。LSP 3.17 提供增量同步和推送诊断。服务器根据客户端声明返回补全片段、诊断关联位置和版本、Markdown 或纯文本悬停、大纲格式及版本化快速修复。

## 无编辑器的 Worker 客户端

`@eihrteam/xml-lsp/browser-client` 的 `connectBrowserClient(worker, options?)` 负责 LSP 初始化和 Worker 生命周期。`client.open(uri, text, diagnosticsCallback)` 返回文档句柄，可调用 `change`、`completion`、`hover`、`formatting`、`symbols`、`folding`、`linkedEditing`、`links`、`codeActions`、`close`。需要释放整个会话时调用 `await client.dispose()`。传入 `options.signal` 可立即取消初始化或终止会话；初始化后的 Worker 错误通过 `options.onUnexpectedClose` 通知宿主。
