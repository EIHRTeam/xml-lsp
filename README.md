# SKLand Wiki XML Language Server

为 SKLand Wiki XML 提供本地诊断、标签和属性补全、悬停说明与格式化。Monaco 和 Ace 通过 Dedicated Worker 使用同一套 LSP 服务，VS Code Desktop 使用随扩展分发的 stdio 服务。

## npm 安装

```sh
npm install @eihrteam/xml-lsp
npx skland-xml-language-server --stdio
```

纯分析 API 由 `@eihrteam/xml-lsp` 导出。Worker 和编辑器适配器可以从相应子路径导入。

## 快速开始

需要 Node.js 24 LTS 和 pnpm 12.11.2。项目锁定 TypeScript 7.1.0-beta。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm examples
```

打开 [Monaco 示例](http://127.0.0.1:4173/monaco/) 或 [Ace 示例](http://127.0.0.1:4173/ace/)。把 `examples/dist/chromium-extension` 加载为已解压的 Chromium 扩展后，可从工具栏打开同样的编辑器。

运行 `pnpm package:vscode` 生成 `dist/skland-xml-0.1.0.vsix`，通过 VS Code 的 **Install from VSIX…** 安装。打开 `*.skland.xml` 即可开始编辑。已有 LSP 客户端也可以直接运行本地服务。

```sh
node packages/language-server/dist/node.js --stdio
```

## 开发

```sh
pnpm check
pnpm exec playwright install --no-shell chromium
pnpm test:browser
pnpm test:mv3
pnpm test:vscode
pnpm benchmark --browser
```

`pnpm check` 检查生成 Schema、Lint、类型、分发产物和 stdio 协议。修改 XSD 后先运行 `pnpm generate:schema`。VS Code 集成测试需要可启动的桌面会话，连续集成使用 Xvfb。

- 接入桌面和网页编辑器。[编辑器接入](docs/editor-integration.md)
- 使用语言服务、Worker 和 LSP API。[API](docs/api.md)
- 查阅架构、XSD 覆盖范围与验收结果。[架构和限制](docs/architecture.md) · [实施报告](docs/implementation.md)
- 维护 npm 包版本与发布流程。[发布](docs/releasing.md)
