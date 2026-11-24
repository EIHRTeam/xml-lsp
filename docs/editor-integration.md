# 编辑器接入

将 `@eihrteam/xml-lsp/worker` 的产物放在编辑器应用的同源静态目录。在工作区构建中，它位于 `packages/language-server/dist/worker.js`。示例统一使用 Module Worker 及 UTF-16 位置。一个客户端会话可以服务多个打开的文档。

## Monaco

```ts
import * as monaco from 'monaco-editor'
import { createMonacoClient } from '@eihrteam/xml-lsp/monaco'

const languageId = 'skland-xml'
monaco.languages.register({ id: languageId })

const worker = new Worker('/workers/xml-worker.js', { type: 'module' })
const client = await createMonacoClient(monaco, worker, languageId)
const model = monaco.editor.createModel(
  '<sklandDocument/>',
  languageId,
  monaco.Uri.parse('inmemory:///page.skland.xml'),
)
const attachment = client.attachModel(model)
```

按需为该语言注册 XML 的 Monarch 高亮。自定义 Monaco 构建需引入需要展示的编辑器贡献模块。可以用 `attachment.dispose()` 关闭单个模型的 LSP 文档。模型销毁或切换到其他语言时也会自动解除绑定。工作台关闭时调用 `await client.dispose()`。

## Ace

```ts
import ace from 'ace-builds'
import 'ace-builds/src-noconflict/ext-language_tools.js'
import { createAceClient } from '@eihrteam/xml-lsp/ace'

const worker = new Worker('/workers/xml-worker.js', { type: 'module' })
const client = await createAceClient(ace, worker)
const attachment = client.attachEditor(editor, 'inmemory:///page.skland.xml')
await attachment.format()
```

使用 `attachment.format(true)` 格式化选区。多文档宿主可以为 `attachEditor` 传入从 EditSession 到 URI 的函数。初始化时请确保 XML mode 和 `ext-language_tools` 已加载。示例在扩展页面上配置了静态 Ace 资源、Strict CSP 样式和无 Blob 的 Worker 路径。Ace 集成提供诊断、补全、悬停和格式化。

## VS Code

运行 `pnpm build && pnpm package:vscode` 后安装 `dist/skland-xml-0.1.0.vsix`。扩展选择语言 ID `skland-xml`，默认文件关联为 `*.skland.xml`。普通 XML 可以手动切换语言模式，或在项目级文件关联中使用 `skland-xml`。

## Chromium MV3

在 Chromium 145 或更新版本中启用开发者模式，加载 `examples/dist/chromium-extension`。通过扩展工具栏的弹出页可打开两个扩展源编辑器。编辑器页面创建并拥有自己的 Dedicated Worker，适合直接作为扩展页面或扩展源 iframe 的起点。

示例使用浏览器默认扩展 CSP，所有脚本、编辑器资源和 Schema 元数据随包分发。每个扩展页面关闭时会释放其 Worker。浏览器测试覆盖普通网页和真实已加载的扩展页面。

从 Content Script 接入时，让扩展源 iframe 内的编辑器创建 Worker。真实 Chromium MV3 测试验证了该入口和网页源直接创建 Worker 所触发的同源限制。
