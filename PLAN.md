# EIHRTeam/xml Language Server 实施规划

**项目名称：** SKLand XML Language Server
**目标仓库：** `EIHRTeam/xml`
**技术路线：** TypeScript 7.1 / Language Server Protocol / Local-first
**文档用途：** Implementation Agent Specification
**状态：** Proposed

---

## 1. 项目背景

`@eihrteam/xml` 是用于 SKLand Endfield Wiki JSON 与 XML 互转的工具库，已经具备 XML 解析、结构化文档模型、领域语义校验、JSON 转换及 CLI 等能力。

为了改善人工编辑 XML 文档时的体验，并为 EIHRTeam 自有编辑工具提供统一的语言智能基础设施，计划在现有项目基础上建设专用 Language Service 和 Language Server。

Language Server 应通过标准 Language Server Protocol（LSP）向多个编辑器提供一致的语言智能能力，并支持桌面和浏览器环境下的完全本地运行。

项目应充分复用现有 XSD 1.0 Schema、转换逻辑、领域语义规则及测试资源，而不是重新实现一套独立的 XML 工具链。

## 2. 项目目标

### 2.1 核心目标

- 建立专用于 SKLand Wiki XML 的 Language Service。
- 建立符合标准 LSP 的 Language Server。
- 同时支持 Node.js 和 Browser Web Worker 运行环境。
- 将 LSP 作为所有目标编辑器的统一语言智能通信协议。
- 基于现有 XSD 1.0 Schema 提供上下文感知的语言智能。
- 复用 `@eihrteam/xml` 的领域语义校验能力。
- 保证不同编辑器中的核心语言分析结果一致。
- 支持 Chromium Manifest V3 扩展环境。
- 保持现有转换库及 CLI 的兼容性。
- 建立可持续维护、测试、扩展和独立发布的模块化架构。

### 2.2 目标编辑器

以下编辑器均为正式支持目标：

| 编辑器             | 运行环境                     | 通信方式       |
| --------------- | ------------------------ | ---------- |
| Monaco Editor   | Web / Chromium Extension | Web Worker |
| Ace Editor      | Web / Chromium Extension | Web Worker |
| VS Code Desktop | Node.js Extension Host   | stdio      |
| VS Code Web     | Browser Extension Host   | Web Worker |

VS Code Web 可在桌面版完成后实施，不作为首个 MVP 的发布阻塞项。

应通过标准 LSP 保留对 Neovim、Zed、Helix、VSCodium 等其他兼容编辑器的潜在支持能力，但暂不针对这些编辑器开发专用集成。

## 3. 技术栈

### 3.1 基础技术选型

| 类别               | 技术选型                                        |
| ---------------- | ------------------------------------------- |
| 开发语言             | TypeScript 7.1.x                            |
| 桌面运行时            | Node.js 24 LTS / 兼容的 VS Code Extension Host |
| 浏览器运行时           | Dedicated Web Worker                        |
| 包管理              | pnpm                                        |
| 仓库组织             | pnpm Workspace                              |
| 模块格式             | ESM                                         |
| 构建工具             | tsdown                                      |
| 类型检查             | TypeScript 7.1                              |
| 单元测试             | Vitest                                      |
| 浏览器测试            | Playwright                                  |
| 静态分析             | oxlint                                      |
| 格式化              | oxfmt                                       |
| LSP 协议基线         | LSP 3.17                                    |
| Schema 格式        | XSD 1.0                                     |
| Browser Baseline | MDN Baseline Widely Available               |
| Chromium 支持基线    | Chromium 145+                               |
| License          | MIT                                         |

TypeScript 必须使用 7.1.x，不得擅自降级至 7.0 或迁移至其他主版本。

实施前应确认所选定的 TypeScript 7.1 具体版本与 tsdown、声明文件生成、Vitest 及其他构建工具的兼容性。若存在实际工具链阻塞，应明确记录，不得静默替换版本要求。

应尽可能沿用仓库已有的构建、测试及发布约定。不得仅为了统一技术栈而对无关模块进行大规模格式化、依赖升级或重构。

### 3.2 Language Server 相关依赖

| 模块                       | 推荐依赖                                 |
| ------------------------ | ------------------------------------ |
| LSP Server SDK           | `vscode-languageserver`              |
| LSP Types                | `vscode-languageserver-types`        |
| Document Synchronization | `vscode-languageserver-textdocument` |
| JSON-RPC                 | `vscode-jsonrpc`                     |
| 容错 XML 解析                | `@lezer/xml`                         |
| Lezer Runtime            | `@lezer/common`                      |
| 严格 XML 解析                | 现有 `@eihrteam/xml`                   |
| Monaco Client            | `monaco-languageclient`              |
| Ace Client               | `ace-linters`                        |
| VS Code Client           | `vscode-languageclient`              |

所有依赖应通过 PoC 验证实际 API、版本兼容性、许可证、维护状态及浏览器打包行为后锁定。

`@lezer/xml` 为优先候选解析器。如果无法满足实际 XML 文档的容错解析需求，可以评估其他纯 JavaScript / TypeScript 解析器，但不得引入 Native 或 WASM 运行时依赖。

### 3.3 纯 TypeScript 约束

项目自身的运行时代码应使用 TypeScript 实现。

允许使用成熟的纯 JavaScript / TypeScript 第三方依赖，但最终 Language Server、Language Service 和编辑器客户端运行时不得依赖：

- WASM。
- Node.js Native Addon。
- 外部原生可执行程序。
- Java Runtime。
- 动态 JavaScript 代码生成。
- 远程代码加载。

开发和构建工具内部使用 Rust、Go 或其他原生实现不属于此限制，只要不会成为最终运行时依赖。

## 4. 总体架构

采用 Language Service、Language Server、Editor Client 三层架构。

```text
                     Editor Clients
       ┌───────────────┬───────────────┐
       │               │               │
    Monaco            Ace           VS Code
       │               │               │
       └───────┬───────┘               │
               │                       │
       LSP / postMessage          LSP / stdio
               │                       │
       Browser Entrypoint       Node Entrypoint
               │                       │
               └───────────┬───────────┘
                           │
                Shared LSP Server
                           │
                 XML Language Service
                           │
       ┌───────────────────┼───────────────────┐
       │                   │                   │
 Tolerant Parser      Schema Model       Semantic Analysis
       │                   │                   │
   Lezer XML          XSD Metadata       @eihrteam/xml
```

### 4.1 架构原则

1. **Single Source of Truth**

   尽可能由现有 XSD 和核心转换库提供语言规范及领域规则，避免重复维护。

2. **Protocol-independent Language Service**

   Language Service 不依赖具体编辑器或 LSP Transport。

3. **Thin Language Server**

   Language Server 主要负责协议处理、文档生命周期、能力协商、请求调度及结果传输。

4. **Runtime-neutral Core**

   Language Service 应能够在 Node.js、浏览器 Worker 及普通 JavaScript 环境中运行。

5. **Local-first**

   所有语言分析均在用户设备本地执行。

6. **Progressive Enhancement**

   根据客户端声明的能力提供功能，不要求所有编辑器具有完全相同的 UI 表现。

7. **Backward Compatibility**

   不得因引入 Language Server 而破坏现有转换库的公开 API、CLI 行为和浏览器兼容性。

## 5. Repository 与模块划分

优先在现有 `EIHRTeam/xml` 仓库中实施，采用 pnpm Workspace 管理。

建议目标结构：

```text
EIHRTeam/xml/
├── packages/
│   ├── xml/
│   ├── language-service/
│   │   ├── src/
│   │   │   ├── parser/
│   │   │   ├── schema/
│   │   │   ├── documents/
│   │   │   ├── diagnostics/
│   │   │   ├── completion/
│   │   │   ├── hover/
│   │   │   ├── formatting/
│   │   │   ├── symbols/
│   │   │   ├── code-actions/
│   │   │   └── index.ts
│   │   └── package.json
│   ├── language-server/
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   ├── node.ts
│   │   │   ├── browser.ts
│   │   │   ├── capabilities.ts
│   │   │   ├── handlers/
│   │   │   └── lifecycle/
│   │   └── package.json
│   ├── monaco-client/
│   └── ace-client/
├── extensions/
│   └── vscode/
├── schemas/
├── tooling/
│   └── schema-compiler/
├── tests/
│   ├── fixtures/
│   ├── conformance/
│   ├── protocol/
│   ├── integration/
│   ├── browser/
│   └── benchmarks/
├── examples/
│   ├── monaco/
│   ├── ace/
│   └── chromium-extension/
├── docs/
├── pnpm-workspace.yaml
└── package.json
```

该目录结构为目标建议，而非强制要求实施 Agent 一次性移动所有现有文件。

如果现有仓库结构更适合渐进式迁移，应优先采用最小破坏性调整，保持现有包构建和发布路径的连续性。

### 5.1 Package 划分

| Package                          | 职责                  |
| -------------------------------- | ------------------- |
| `@eihrteam/xml`                  | 核心转换、严格解析、领域语义规则    |
| `@eihrteam/xml-language-service` | 容错分析与语言智能           |
| `@eihrteam/xml-language-server`  | LSP Server 与运行时入口   |
| `@eihrteam/xml-monaco-client`    | Monaco LSP 集成       |
| `@eihrteam/xml-ace-client`       | Ace LSP 集成          |
| VS Code Extension                | VS Code 客户端、命令和扩展配置 |

客户端 Package 名称为暂定名称。

不要求所有模块在首个版本中均独立发布至 npm。内部模块可首先以 private workspace package 形式存在，待公开 API 稳定后再独立发布。

### 5.2 依赖方向

```text
Editor Clients
    ↓
Language Server
    ↓
Language Service
    ↓
@eihrteam/xml
```

约束：

- 核心转换库不得反向依赖 Language Service。
- Language Service 不得依赖具体编辑器。
- Language Service 不得依赖 Node.js 专用 LSP Server Runtime。
- Browser Entrypoint 不得引入 Node.js Entrypoint。
- Monaco Client 与 Ace Client 不得相互依赖。
- Schema Compiler 仅作为构建期工具存在。
- 避免循环依赖。
- 不得通过公共入口的隐式副作用启动 Worker 或 Language Server。

## 6. XML Language Service

### 6.1 职责

Language Service 负责：

- XML 容错解析。
- 文档语法树管理。
- 源文本位置映射。
- 光标上下文分析。
- Schema 元数据查询。
- 静态结构诊断。
- 领域语义诊断。
- 标签与属性补全。
- Hover 文档。
- 文档结构分析。
- 文本编辑建议。
- 格式化及快速修复。

Language Service 不应承担进程管理、网络通信、编辑器 UI 或业务认证。

### 6.2 双解析路径

采用容错解析和严格解析相互配合的设计。

```text
XML Source
    │
    ├── Tolerant Parser
    │     ├── Syntax Tree
    │     ├── Source Ranges
    │     ├── Completion Context
    │     └── Recoverable Syntax Diagnostics
    │
    └── Strict Parser
          ├── DocumentModel
          ├── Domain Validation
          └── Conversion Compatibility
```

容错解析器必须能够处理编辑过程中不完整的 XML，例如：

- 未闭合标签。
- 未完成的属性。
- 未闭合引号。
- 不完整的结束标签。
- 临时存在的多个根节点。
- 局部结构错误。

不应因为文档某处存在语法错误而完全禁用补全或 Hover。

严格解析路径应尽可能复用现有 `@eihrteam/xml` 实现。

对于不满足 XML well-formedness 的文档，不应强行执行完整的领域转换。应跳过依赖完整文档结构的校验，并尽量保留局部语法和结构诊断。

### 6.3 文档缓存

每个打开的文档应维护必要的分析状态，例如：

```typescript
interface DocumentState {
  uri: string
  version: number
  text: string
  syntaxTree: SyntaxTree
  schemaVersion: string
}
```

上述接口仅用于表达设计意图，实际实现可以调整。

缓存应按文档 URI 和版本号管理，支持文档关闭后的资源释放。

补全、Hover、诊断和文档大纲应复用已有分析结果，避免每次请求均重新解析完整文档。

应优先利用 Lezer 的增量解析机制，但不要求第一阶段实现完整的增量语义分析。

### 6.4 公共 API

Language Service 应提供独立、可测试的公共 API。

建议接口形态：

```typescript
interface XmlLanguageService {
  openDocument(document: XmlDocument): void

  updateDocument(
    uri: string,
    version: number,
    changes: readonly TextChange[]
  ): void

  closeDocument(uri: string): void

  diagnostics(
    uri: string
  ): Promise<Diagnostic[]>

  completion(
    uri: string,
    position: Position
  ): Promise<CompletionList>

  hover(
    uri: string,
    position: Position
  ): Promise<Hover | null>

  formatting(
    uri: string,
    options: FormattingOptions
  ): Promise<TextEdit[]>

  documentSymbols(
    uri: string
  ): Promise<DocumentSymbol[]>

  codeActions(
    uri: string,
    range: Range,
    diagnostics: readonly Diagnostic[]
  ): Promise<CodeAction[]>

  dispose(): void
}
```

可复用 `vscode-languageserver-types` 中与协议传输无关的数据结构。

应避免为 LSP 已标准化的数据结构重复定义大量等价类型。

## 7. XSD 1.0 Schema 集成

### 7.1 基本原则

现有 XSD 1.0 Schema 作为静态结构规范的重要参考与数据源。

实施 Agent 必须首先检查实际 XSD 内容、版本、来源、许可证、引用关系及与现有转换实现的一致性。

不得假定现有 XSD 已完整覆盖所有 Wiki XML 语义。

应明确区分：

- XML well-formedness。
- XSD 静态结构约束。
- SKLand Wiki 领域语义约束。
- 实际转换兼容性。

当 XSD 与核心转换实现出现冲突时，应记录差异，并通过测试及规范审查确定处理方式。不得静默修改既有转换行为，也不得未经确认直接放宽或收紧 XSD。

### 7.2 构建期 Schema Compiler

建议实现一个针对现有 Schema 特性范围的纯 TypeScript Schema Compiler。

```text
XSD 1.0 Sources
        ↓
Schema Compiler
        ↓
Resolved Schema Graph
        ↓
Generated Language Metadata
        ↓
XML Language Service
```

Schema Compiler 应在构建期运行。

默认不在浏览器中动态读取、编译或下载 XSD。

根据实际 Schema 使用情况，按需支持：

- `xs:element`
- `xs:attribute`
- `xs:complexType`
- `xs:simpleType`
- `xs:sequence`
- `xs:choice`
- `xs:all`
- `xs:group`
- `xs:attributeGroup`
- `xs:extension`
- `xs:restriction`
- `xs:enumeration`
- `xs:include`
- `xs:import`
- `xs:annotation`
- `xs:documentation`
- `minOccurs`
- `maxOccurs`
- `default`
- `fixed`
- `ref`
- 类型引用及命名空间解析

不要求实现未被现有 Schema 使用的全部 XSD 特性。

对于无法正确解释的 Schema 构造，Compiler 应明确报错或输出可追踪的 unsupported-feature 信息，不得静默忽略后仍声称生成结果完整。

### 7.3 Schema Model

生成的元数据应支持：

- 全局元素与局部元素声明。
- 元素所属上下文。
- 属性定义。
- 必填属性。
- 数据类型与枚举。
- 默认值与固定值。
- 子元素内容模型。
- 元素排列顺序。
- 出现次数限制。
- 元素与属性说明文档。
- 类型引用。
- Schema 来源及版本。

不应将整个 Schema 简单扁平化为以标签名称为唯一键的字典。

同名元素可能出现在不同上下文中，并具有不同的内容模型和属性约束。

### 7.4 生成产物管理

生成产物应满足：

- 确定性生成。
- 不包含依赖机器环境的绝对路径。
- 不在运行时执行动态代码。
- 可直接被 ESM Bundle 使用。
- 具有稳定的 Schema 版本或内容哈希。
- 可通过 CI 检查是否过期。

建议提供：

```bash
pnpm generate:schema
pnpm check:schema
```

CI 应检查原始 XSD 与生成产物是否一致。

### 7.5 校验范围

本项目不自行实现完整的通用 XSD 1.0 Validator。

运行时基于已编译 Schema Model 提供语言服务所需的静态结构诊断。

如果某些 XSD 约束尚未实现，应明确标记支持范围，而不是宣称提供完整 XSD 合规性验证。

必要时可以在开发或 CI 环境中使用独立的标准 XSD Validator 验证测试样本，但不得将外部工具作为 Language Server 运行时依赖。

## 8. Diagnostics 系统

### 8.1 分层诊断

诊断系统应分为三个层级。

| 层级       | Source                | 职责             |
| -------- | --------------------- | -------------- |
| Syntax   | `skland-xml/syntax`   | XML 基础语法错误     |
| Schema   | `skland-xml/schema`   | 静态内容模型与属性约束    |
| Semantic | `skland-xml/semantic` | Wiki 领域语义及转换约束 |

不同层级可以共享底层分析结果，但不得产生大量重复或级联错误。

### 8.2 结构化诊断

现有 `XmlWikiConversionError` 和字符串形式的 warnings 不足以直接提供完整的编辑器诊断。

应以向后兼容方式逐步引入结构化诊断能力。

建议数据结构：

```typescript
interface XmlDiagnostic {
  code: string

  message: string

  severity: 'error' | 'warning' | 'info' | 'hint'

  source: 'syntax' | 'schema' | 'semantic'

  range?: {
    start: number
    end: number
  }

  relatedInformation?: readonly RelatedInformation[]

  data?: Readonly<Record<string, unknown>>
}
```

要求：

- 错误代码稳定。
- 诊断严重程度明确。
- 源文本位置尽可能精确。
- 支持多个独立问题同时返回。
- 支持相关位置。
- 可用于生成 Quick Fix。
- 保持现有异常类型及转换 API 的兼容性。

对于暂时无法精确定位的历史转换错误，应使用能够可靠确定的父节点或文档范围，并明确其定位粒度。

不得通过解析错误消息字符串来构建长期依赖的诊断代码或源位置映射机制。

### 8.3 领域语义复用

应优先复用现有转换器中的校验函数。

包括但不限于：

- 对话章节结构。
- 对话分支发言顺序。
- 表格尺寸及跨度关系。
- 注释嵌套限制。
- 富文本容器允许的子元素。
- 图片及媒体属性。
- 特殊标签约束。
- 历史兼容格式。

在需要重构现有校验逻辑时，应优先将校验规则抽取为共享函数，而不是在 Language Service 中复制一套等价规则。

严格转换与语言服务不要求使用完全相同的错误收集策略，但必须共享关键规则判断逻辑。

### 8.4 诊断调度

初期采用 Push Diagnostics：

```text
textDocument/publishDiagnostics
```

文档修改后建议默认使用 200 ms 防抖。

应支持：

- 文档版本检查。
- 过期诊断结果丢弃。
- 请求取消。
- 文档关闭后的诊断清除。
- 同一文档重复任务合并。
- 错误数量限制。
- 大型文档的合理降级策略。

不得将过期版本的诊断覆盖当前编辑器结果。

## 9. LSP 功能范围

### 9.1 P0：MVP

| 功能       | LSP Method                        |
| -------- | --------------------------------- |
| 初始化      | `initialize`                      |
| 初始化完成    | `initialized`                     |
| 文档打开     | `textDocument/didOpen`            |
| 增量文档同步   | `textDocument/didChange`          |
| 文档关闭     | `textDocument/didClose`           |
| 实时诊断     | `textDocument/publishDiagnostics` |
| 标签补全     | `textDocument/completion`         |
| 属性补全     | `textDocument/completion`         |
| 属性值补全    | `textDocument/completion`         |
| Hover    | `textDocument/hover`              |
| Shutdown | `shutdown`                        |
| Exit     | `exit`                            |

补全应具备上下文感知能力：

- 根据当前父节点推荐合法子元素。
- 根据当前元素推荐允许的属性。
- 避免重复添加已存在的属性。
- 为枚举属性提供合法值。
- 支持不完整标签和属性输入。
- 根据已存在的兄弟节点及内容模型缩小候选范围。
- 必要时提供带必填属性的 Snippet。
- 在客户端不支持 Snippet 时提供普通文本补全。

### 9.2 P1：编辑体验增强

| 功能     | LSP Method                        |
| ------ | --------------------------------- |
| 全文格式化  | `textDocument/formatting`         |
| 范围格式化  | `textDocument/rangeFormatting`    |
| 快速修复   | `textDocument/codeAction`         |
| 文档大纲   | `textDocument/documentSymbol`     |
| 折叠范围   | `textDocument/foldingRange`       |
| 标签联动编辑 | `textDocument/linkedEditingRange` |
| URL 识别 | `textDocument/documentLink`       |

### 9.3 P2：可选增强

- `textDocument/documentColor`
- `textDocument/colorPresentation`
- `textDocument/semanticTokens/full`
- `textDocument/definition`
- `textDocument/references`
- `workspace/symbol`
- Pull Diagnostics
- 本地 Wiki 资源索引
- Astrivagant Template Profile

P2 功能不作为 MVP 发布条件。

### 9.4 Capability Negotiation

应根据客户端声明的 capabilities 决定返回的数据格式和启用功能。

不得默认假设 Monaco、Ace 和 VS Code 支持全部 LSP 3.17 能力。

客户端能力不足时，应优先进行合理降级，而不是拒绝初始化整个 Language Server。

基础实现应使用稳定标准协议，不依赖不必要的 Proposed Features。

## 10. 格式化与文档语义安全

SKLand XML 包含 mixed content、富文本、特殊换行规则及空白归一化语义。

因此，不得直接使用：

```typescript
renderXml(parseXml(source))
```

作为默认格式化实现。

现有转换器以语义等价为目标，并不承诺源文本级无损往返。

格式化实现应：

- 尽可能保留文本内容。
- 保留注释。
- 保留 CDATA。
- 保留 XML 声明。
- 保留有语义意义的空白和换行。
- 避免改变富文本节点之间的文字边界。
- 不自动生成或修改业务 ID。
- 不随意改变实体引用或命名空间声明。
- 支持 tabSize 和 insertSpaces。
- 优先返回最小范围的 TextEdit。

对于不完整或结构严重错误的 XML，可以拒绝格式化，而不是尝试进行可能改变文档内容的自动修复。

格式化前后必须通过语义等价测试。

Quick Fix 应区分安全的机械修复与可能改变业务含义的修改。后者不得默认自动执行。

## 11. Language Server 实现

### 11.1 共享 Server

Language Server 应采用统一的 Server 实现。

```text
language-server/src/
├── server.ts
├── node.ts
├── browser.ts
├── capabilities.ts
└── handlers/
```

`server.ts` 负责：

- 初始化。
- 能力协商。
- 文档管理。
- Handler 注册。
- 请求调度。
- 诊断发布。
- 生命周期管理。

`node.ts` 和 `browser.ts` 仅负责运行时初始化、通信及必要的宿主差异处理。

### 11.2 Node Entrypoint

使用：

```typescript
import {
  createConnection,
} from 'vscode-languageserver/node'
```

通过标准 stdio 提供 LSP。

建议 CLI 命令：

```bash
skland-xml-language-server --stdio
```

stdout 必须专用于 LSP 协议消息。

普通日志及错误信息不得直接输出至 stdout，应通过 stderr 或标准 LSP Logging Mechanism 输出。

### 11.3 Browser Entrypoint

使用 Browser MessageReader / MessageWriter 与：

```typescript
import {
  createConnection,
} from 'vscode-languageserver/browser'
```

构建 Dedicated Web Worker Language Server。

通过 `postMessage` 传递 JSON-RPC 消息。

不得在 Worker 中启动 HTTP 服务或 WebSocket 服务。

Browser Entrypoint 必须可独立打包，且不依赖 Node.js 内置模块。

### 11.4 Document Synchronization

使用标准 LSP 文档同步机制：

```text
TextDocumentSyncKind.Incremental
```

服务端应支持：

- 完整文档初始化。
- 增量文本变更。
- 连续版本管理。
- 多文档会话。
- URI 区分。
- 文档关闭及资源释放。

应明确区分 LSP 增量同步、增量语法解析和增量语义分析。

首个版本无需实现复杂的增量语义分析。

### 11.5 Position Encoding

默认支持 UTF-16 Position Encoding。

应正确处理：

- 中文。
- 英文。
- Unicode supplementary characters。
- Emoji。
- CRLF。
- LF。
- CR。
- Unicode combining characters。

内部建议使用 UTF-16 offset 作为文本索引，并通过统一工具函数转换为 LSP Position。

禁止混用字符数、UTF-8 字节数与 UTF-16 code unit 数量。

## 12. 编辑器客户端

### 12.1 共同约束

所有目标编辑器必须通过标准 LSP 调用 Language Server。

不得在 Monaco 或 Ace 客户端中复制语言分析逻辑。

允许客户端承担：

- 编辑器位置转换。
- UI Provider 注册。
- 文档 URI 管理。
- Worker 生命周期管理。
- 诊断展示。
- 编辑器命令。
- LSP Capability 声明。
- 连接状态展示。
- 编辑器特有交互。

不允许通过自定义协议绕过 LSP 实现核心语言智能功能。

基础语法高亮、括号匹配等已有编辑器功能可继续使用原生实现。

### 12.2 Monaco Client

优先验证：

```text
monaco-languageclient
```

需要重点评估：

- `@codingame/monaco-vscode-api` 相关依赖。
- Monaco 与 Language Client 版本匹配。
- Bundle Size。
- 多 Model 支持。
- Worker 生命周期。
- Chromium MV3 CSP。
- 是否引入不必要的 VS Code Workbench 功能。
- 多编辑器实例之间的连接管理。

如果现成客户端不满足体积、稳定性或 CSP 要求，可基于 `vscode-jsonrpc/browser` 实现轻量 LSP Client。

轻量 Client 仍必须遵守标准 LSP。

不得因此回退为独立的 Monaco 语言分析实现。

### 12.3 Ace Client

优先验证：

```text
ace-linters
```

重点验证：

- 标准 LSP Server 连接。
- Browser Worker Transport。
- Completion。
- Hover。
- Diagnostics。
- Formatting。
- EditSession 生命周期。
- 多文档管理。
- Code Actions 等高级能力的覆盖范围。

应尽量只引入必要的客户端部分，避免打包其他不相关的语言服务器。

Ace 的高级 UI 能力可以低于 Monaco 和 VS Code，但核心诊断、补全和 Hover 结果应保持一致。

### 12.4 VS Code Extension

使用：

```text
vscode-languageclient
```

桌面端由 Extension Host 启动随扩展分发的 Node.js Language Server。

不应要求用户：

- 全局安装 Language Server。
- 手动安装额外 Node.js Runtime。
- 配置外部服务器地址。
- 安装 Java 或其他运行时。

VS Code Web 后续使用 Browser Client 连接本地 Worker。

建议专用 Language ID：

```text
skland-xml
```

可选文件名约定：

```text
*.skland.xml
```

对于普通 `.xml` 文件，应支持显式语言模式选择或项目级关联。

不得无条件接管全部 XML 文档。

应考虑与现有通用 XML 扩展共存，避免重复诊断、补全和格式化冲突。

## 13. Browser 与 Chromium MV3

### 13.1 强制要求

Browser Target 必须：

- 完全本地运行。
- 支持离线语言智能。
- 使用本地打包的 JavaScript。
- 不使用远程代码。
- 不使用 `eval`。
- 不使用 `new Function`。
- 不依赖 WebAssembly。
- 不要求 `wasm-unsafe-eval`。
- 不依赖 Node.js 内置模块。
- 不要求 SharedArrayBuffer。
- 不要求跨源隔离。
- 不要求修改宿主网页 CSP。

对于扩展页面，应保持默认安全 CSP 兼容性。

### 13.2 Worker 部署

优先支持：

- 普通网页 Dedicated Worker。
- Extension Page Dedicated Worker。
- Extension Side Panel。
- Extension-origin iframe 内的 Worker。

Content Script 直接创建 Worker 的可行性必须在真实 Chromium MV3 环境中验证。

如果受到资源来源或宿主页面约束，应优先考虑 Extension-origin iframe 等具有明确安全边界的部署方案。

不得假定 Extension Service Worker 具有适合长期 LSP 会话的稳定生命周期。

### 13.3 DOMParser 兼容性

现有 `@eihrteam/xml` 可能根据运行时选择原生 DOMParser 或 `@xmldom/xmldom`。

Web Worker 中不应假定存在 `DOMParser`。

必须验证：

- Node.js 严格解析路径。
- Browser Main Thread 严格解析路径。
- Browser Worker 严格解析路径。
- Chromium MV3 Worker 严格解析路径。

对于相同输入，应保证最终语义校验结果一致。

### 13.4 安全边界

Language Server 应默认只分析客户端显式提供的文档。

不得自动：

- 请求 Wiki API。
- 读取认证信息。
- 上传 XML 内容。
- 获取文档中引用的远程资源。
- 下载任意远程 Schema。
- 访问任意文件路径。
- 解析不受信任的外部实体。
- 执行 XML 文档中的脚本或命令。

应防止不受控的实体展开、极深节点嵌套、超大文档及其他可能造成资源耗尽的输入。

禁止默认采集或记录完整 XML 文档内容。

## 14. 性能设计

### 14.1 基本原则

优先使用简单、可预测、容易测试的实现。

不得在缺乏性能证据时引入复杂的缓存层、线程池、增量依赖图或多进程架构。

建议每个 Web 编辑工作台共享一个 Language Server Worker，并由单一逻辑客户端管理多个文档。

不要默认每个 Editor Instance 创建独立 Worker。

### 14.2 建议性能预算

以下为初期验收目标，不代表现有实测性能。

| 指标                     |           目标 |
| ---------------------- | -----------: |
| Completion P95         |      ≤ 50 ms |
| Hover P95              |      ≤ 30 ms |
| 100 KiB 文档语义校验 P95     |     ≤ 100 ms |
| 1 MiB 文档语义校验 P95       |     ≤ 500 ms |
| Browser Worker 冷启动 P95 |     ≤ 500 ms |
| Node Server 冷启动 P95    |        ≤ 1 s |
| 输入诊断防抖                 |    默认 200 ms |
| Node Server 空闲 RSS     | 建议 ≤ 100 MiB |

上述目标应在具有明确硬件与软件配置的测试环境中测量。

浏览器冷启动应包含 Worker 创建、语言服务初始化及 Schema 元数据加载，不得仅测量 JavaScript 函数执行时间。

诊断耗时应分别记录防抖等待和实际分析时间。

### 14.3 性能优化顺序

1. 消除不必要的重复解析。
2. 复用容错语法树。
3. 复用 Schema 元数据。
4. 使用增量文档同步。
5. 使用增量语法解析。
6. 延迟执行完整语义校验。
7. 合并连续请求。
8. 限制级联诊断。
9. 根据真实性能数据优化数据结构。

不得引入 Rust/WASM 作为本阶段的性能优化手段。

### 14.4 Benchmark

建立可重复运行的 Benchmark，覆盖：

- 10 KiB XML。
- 100 KiB XML。
- 1 MiB XML。
- 5 MiB XML。
- 20 MiB 压力测试样本。
- 大量复杂表格。
- 大量对话分支。
- 大量富文本。
- 不完整 XML。
- 单字符连续编辑。
- 大段文本粘贴。
- 多文档同时打开。

优先使用脱敏后的真实项目样本，并辅以确定性生成的压力测试文档。

记录：

- Cold Start。
- Warm Start。
- Parsing Latency。
- Completion Latency。
- Hover Latency。
- Diagnostic Latency。
- Peak Memory。
- Idle Memory。
- 文档关闭后的资源释放。
- JS Bundle Size。
- Gzip / Brotli 压缩体积。

应将 Language Server 自身体积与编辑器客户端新增依赖体积分开统计。

## 15. 构建与分发

### 15.1 Language Server Package

建议提供明确的运行时入口：

```json
{
  "name": "@eihrteam/xml-language-server",
  "type": "module",
  "bin": {
    "skland-xml-language-server": "./dist/node.js"
  },
  "exports": {
    ".": "./dist/index.js",
    "./node": "./dist/node.js",
    "./browser": "./dist/browser.js"
  }
}
```

实际 package exports 应同时提供所需类型声明，并根据最终打包方式调整。

公共入口不应在被 import 时自动启动 Server。

### 15.2 构建目标

| Target                  | 产物                           |
| ----------------------- | ---------------------------- |
| Core XML                | ESM Library + CLI            |
| Language Service        | Platform-neutral ESM         |
| Node Language Server    | Node.js ESM                  |
| Browser Language Server | Worker-compatible ESM Bundle |
| Monaco Client           | Browser ESM                  |
| Ace Client              | Browser ESM                  |
| VS Code Extension       | VSIX                         |

Browser Bundle 应独立进行依赖检查。

不得因为共享 barrel exports 而意外将 Node.js Server Runtime 引入 Browser Bundle。

### 15.3 版本管理

核心转换库、Schema Model 和 Language Service 之间应具有明确的兼容关系。

建议在内部 workspace 中锁定兼容版本。

Schema 更新后，应重新生成元数据并运行完整一致性测试。

如公开 Package 独立发布，应在 package metadata 或文档中明确兼容的核心库版本范围。

## 16. 测试体系

### 16.1 Unit Tests

覆盖：

- Schema Compiler。
- 内容模型解析。
- Schema Metadata 查询。
- 容错 XML 解析。
- 位置转换。
- 诊断规则。
- Completion。
- Hover。
- 文档缓存。
- 格式化。
- Quick Fix。

### 16.2 Conformance Tests

验证：

- 现有合法 XML 样本不会产生错误诊断。
- 现有非法 XML 样本产生预期诊断。
- Language Service 与核心转换器在共同支持的规则范围内保持一致。
- Schema 生成产物与原始 XSD 保持一致。
- 历史兼容格式不会被意外拒绝。
- Schema 与转换器存在的已知差异具有明确测试记录。
- 格式化不改变文档语义。

应优先复用现有 `@eihrteam/xml` 测试样本。

### 16.3 LSP Contract Tests

覆盖：

- Initialize。
- Capability Negotiation。
- didOpen。
- Incremental didChange。
- Completion。
- Hover。
- Diagnostics。
- Cancellation。
- Stale Document Versions。
- Multiple Documents。
- didClose。
- Shutdown。
- Exit。

测试应从真实 JSON-RPC / LSP 协议边界发起，而不是仅调用内部 Handler。

### 16.4 Runtime Parity Tests

对同一批输入比较：

```text
Node Language Server
        vs
Browser Language Server
```

应确保以下结果一致：

- Diagnostic Code。
- Diagnostic Severity。
- Diagnostic Range。
- Completion Candidates。
- Hover Content。
- Document Symbols。
- Formatting TextEdits。

允许因客户端能力协商产生有明确理由的数据表示差异。

### 16.5 Editor Integration Tests

分别验证：

- Monaco Client。
- Ace Client。
- VS Code Extension。

确保真实编辑器中的文档同步、补全、诊断及资源释放行为正确。

### 16.6 Chromium MV3 E2E Tests

必须通过 Playwright 或等价自动化方式测试真实 Chromium MV3 扩展。

不得仅通过普通网页测试推断扩展兼容性。

至少覆盖：

- 默认扩展 CSP。
- Worker 加载。
- Language Server 初始化。
- 实时诊断。
- Completion。
- Hover。
- 扩展页面关闭及资源释放。
- 离线运行。
- 无外部网络请求。
- 无动态代码执行。
- 无 WASM 运行时依赖。

## 17. CI/CD

继续采用 GitHub Actions。

建议提供统一命令：

```bash
pnpm install --frozen-lockfile
pnpm generate:schema
pnpm check:schema
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:protocol
pnpm test:browser
pnpm test:mv3
pnpm check
```

根据现有仓库脚本适当整合，不要求无条件新增所有命令名称。

CI 应至少覆盖：

- Linux。
- Node.js 24 LTS。
- TypeScript 7.1。
- Chromium Browser Tests。
- Chromium MV3 Tests。
- Package Export Validation。
- Schema Generated Artifact Check。
- Core Conversion Regression Tests。

Windows 和 macOS 应至少进行必要的 Node Server / CLI 冒烟测试，VS Code 集成发布前应覆盖目标平台。

普通 Pull Request 不必重复运行所有大型压力测试。完整 Benchmark 可以通过独立 Workflow 或手动触发执行。

## 18. 实施阶段

### Phase 0 — Repository Audit & Technical PoC

实施前完成以下工作：

- 审查现有 Repository、公开 API、CLI 和测试体系。
- 定位实际 XSD 文件及其来源。
- 审查 XSD 所使用的具体构造。
- 检查转换器的语义校验与错误定位能力。
- 确认 TypeScript 7.1 工具链兼容性。
- 验证 Lezer 对真实 XML 文档的容错解析能力。
- 创建最小 Node Language Server。
- 创建最小 Browser Worker Language Server。
- 使用 Monaco、Ace、VS Code 连接同一 Server 实现。
- 验证真实 Chromium MV3 CSP。
- 测量各客户端的新增 Bundle Size。

PoC 只需要提供固定的 Diagnostic、Completion 和 Hover，不必实现真实领域规则。

输出：

- PoC 代码。
- 技术验证结果。
- 依赖选型记录。
- 已知阻塞项。
- 最终架构决策记录（ADR）。

未经验证的客户端能力不得直接作为后续阶段的既定事实。

### Phase 1 — Foundation

- 建立 Workspace 模块边界。
- 保持现有核心转换包兼容。
- 实现共享位置映射工具。
- 实现结构化诊断基础设施。
- 实现 Schema Compiler。
- 实现 Schema Metadata。
- 建立基础一致性测试。

验收：

- 原有转换及 CLI 测试全部通过。
- XSD 元数据可确定性生成。
- Browser Target 无 Node.js 运行时依赖。

### Phase 2 — Language Service MVP

- 容错解析。
- 文档状态管理。
- 光标上下文分析。
- 基础语法诊断。
- Schema 结构诊断。
- 核心领域语义诊断。
- 标签、属性和属性值补全。
- Hover 文档。

验收：

- 不完整 XML 可正常提供局部语言智能。
- 合法样本不存在已知误报。
- 诊断具有稳定代码及可靠源范围。
- 所有核心功能独立于编辑器运行。

### Phase 3 — Language Server MVP

- Shared Server。
- Node Entrypoint。
- Browser Entrypoint。
- Capability Negotiation。
- Incremental Synchronization。
- Push Diagnostics。
- Cancellation。
- Lifecycle Management。
- Protocol Tests。

验收：

- 两种运行时使用同一核心实现。
- 标准 LSP 请求可正常交互。
- Node 与 Browser 分析结果一致。
- Server 能正确处理文档关闭及退出。

### Phase 4 — Editor Integration

- Monaco Client。
- Ace Client。
- VS Code Desktop Extension。
- 集成示例。
- Chromium MV3 示例扩展。
- 浏览器端 E2E 测试。

验收：

- 三个目标编辑器均完成实际集成。
- Web 端不依赖远程服务器。
- Chromium MV3 测试通过。
- 无 Native / WASM 运行时依赖。
- 客户端不包含重复的领域语言分析逻辑。

完成本阶段后可发布首个 MVP。

### Phase 5 — Enhanced Language Features

- 语义安全格式化。
- Range Formatting。
- Quick Fix。
- Document Symbols。
- Folding Range。
- Linked Editing。
- Document Links。

所有新增功能均应具备独立测试及客户端兼容性验证。

### Phase 6 — Optimization & Ecosystem Integration

根据实际需求实施：

- Benchmark 驱动的性能优化。
- Browser Bundle Size 优化。
- VS Code Web 支持。
- Astrivagant Template Profile。
- InPageEdit 集成。
- 本地资源索引。
- 高级 LSP 功能。

不得在缺乏明确需求时提前实现本阶段的全部能力。

## 19. MVP Definition of Done

以下条件全部满足后，方可认为 MVP 完成。

### 架构

- [ ] 使用 TypeScript 7.1.x。
- [ ] Language Service 与 Language Server 独立。
- [ ] Node 与 Browser 共享 Server 核心实现。
- [ ] 三个主要编辑器通过标准 LSP 集成。
- [ ] 不存在 Native 或 WASM 运行时依赖。
- [ ] 核心转换库不依赖 LSP 模块。
- [ ] 不存在循环依赖。

### 功能

- [ ] 支持不完整 XML 的容错解析。
- [ ] 支持 XML 语法诊断。
- [ ] 支持已声明范围内的 XSD 结构诊断。
- [ ] 支持核心 Wiki 领域语义诊断。
- [ ] 支持上下文感知标签补全。
- [ ] 支持属性及枚举值补全。
- [ ] 支持 Hover。
- [ ] 支持多文档管理。
- [ ] 支持增量文档同步。
- [ ] 支持文档关闭与资源释放。

### 兼容性

- [ ] 现有 XML/JSON 转换 API 无非预期破坏。
- [ ] 现有 CLI 行为保持兼容。
- [ ] 原有测试全部通过。
- [ ] Monaco 集成通过。
- [ ] Ace 集成通过。
- [ ] VS Code Desktop 集成通过。
- [ ] Node 与 Browser 一致性测试通过。
- [ ] 真实 Chromium MV3 测试通过。

### 安全与性能

- [ ] 无远程代码加载。
- [ ] 无动态代码执行。
- [ ] 无默认外部网络请求。
- [ ] 无 Node.js 内置模块泄漏至 Browser Bundle。
- [ ] 不解析未经授权的外部实体或远程 Schema。
- [ ] 过期诊断不会覆盖最新文档状态。
- [ ] 完成基础性能测试。
- [ ] 完成 Bundle Size 测量。
- [ ] 记录性能预算偏差及已知限制。

### 工程质量

- [ ] 类型检查通过。
- [ ] Lint 通过。
- [ ] 单元测试通过。
- [ ] Protocol Tests 通过。
- [ ] Browser Tests 通过。
- [ ] Schema Metadata 一致性检查通过。
- [ ] 构建产物验证通过。
- [ ] 公共 API 及集成文档完整。
- [ ] CI Workflow 可正常执行。

## 20. Implementation Agent 行为约束

实施 Agent 必须遵循以下原则：

1. 首先阅读现有代码及测试，不得仅根据本规划猜测实现细节。
2. 优先复用现有模块、规则、依赖和测试资源。
3. 不得擅自引入 Rust、WASM 或 Native Runtime。
4. 不得擅自改变 TypeScript 7.1 版本要求。
5. 不得为了使用 LSP 而重写核心 XML 转换库。
6. 不得在不同编辑器中复制领域语义逻辑。
7. 不得将完整通用 XSD Validator 作为隐含开发目标。
8. 不得静默忽略不支持的 XSD 构造。
9. 不得为了处理少见情况引入不成比例的架构复杂度。
10. 不得依靠降低诊断准确性来达到性能目标。
11. 不得通过宽松的类型断言、`any` 或关闭类型检查掩盖实际问题。
12. 不得通过禁用测试、修改预期结果或删除合法测试样本掩盖回归。
13. 不得在未验证的情况下声称支持 Chromium MV3、特定 LSP Capability 或完整 Schema 校验。
14. 所有新增公共 API 必须具有明确的类型定义。
15. 对于实质性架构偏离，应记录原因、影响及替代方案。
16. 在存在多个可行方案时，优先选择依赖较少、维护成本较低、能够满足验收要求的实现。
17. 发现现有 Schema、规范与转换行为不一致时，应形成明确的差异报告。
18. 将实现复杂度与实际需求保持相称，遵循 KISS、YAGNI 和必要的模块化原则。

## 21. 最终交付物

实施完成后应交付：

- 可构建的 `@eihrteam/xml-language-service`。
- 可构建的 `@eihrteam/xml-language-server`。
- Node.js stdio Language Server。
- Browser Worker Language Server。
- Monaco 集成模块及示例。
- Ace 集成模块及示例。
- VS Code Desktop Extension。
- Chromium MV3 集成示例。
- Schema Compiler。
- 生成的 Schema Metadata。
- 单元测试及协议测试。
- Browser / MV3 集成测试。
- Benchmark 脚本及实际测试结果。
- API Reference。
- Editor Integration Guide。
- Architecture Documentation。
- Architecture Decision Records。
- CI/CD Workflow。
- 已知限制及后续改进事项。

最终实施报告应明确列出：

- 已完成的功能。
- 实际采用的依赖及版本。
- 与本规划存在的差异。
- 尚未实现的功能。
- 已知兼容性问题。
- Schema 与转换器的一致性问题。
- 性能测试结果。
- 分发产物大小。
- 测试执行结果。
- 后续建议。

## 22. 最终架构决策

本项目确定采用：

**Pure TypeScript 7.1 + Shared Language Service + Dual-runtime Language Server + Standard LSP Clients**

核心目标不是建设通用 XML Language Server，而是为 SKLand Wiki XML 建设一套轻量、统一、语义准确、可维护的专用语言智能工具链。

所有语言分析逻辑应集中在共享 Language Service 中，所有目标编辑器应通过标准 LSP 获取能力，所有默认运行环境均应支持完全本地、离线且无原生运行时依赖的使用方式。
