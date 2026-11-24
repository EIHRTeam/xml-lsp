import { createXmlLanguageService } from '@eihrteam/xml-language-service'
import { ErrorCodes, ResponseError, type CancellationToken } from 'vscode-jsonrpc/lib/common/api.js'
import type { Connection, InitializeResult, LinkedEditingRangeParams } from 'vscode-languageserver'
import type { CodeAction, DocumentSymbol, SymbolInformation } from 'vscode-languageserver-types'

declare const __SKLAND_XML_LSP_VERSION__: string
const version =
  typeof __SKLAND_XML_LSP_VERSION__ === 'string' ? __SKLAND_XML_LSP_VERSION__ : 'development'

export interface ServerOptions {
  diagnosticDelayMs?: number
  onExit?: () => void
}

export interface ServerSession {
  dispose(): void
}

function flatten(symbols: DocumentSymbol[], uri: string, parent?: string): SymbolInformation[] {
  return symbols.flatMap((item) => [
    {
      name: item.name,
      kind: item.kind,
      location: { uri, range: item.range },
      ...(parent && { containerName: parent }),
    },
    ...flatten(item.children ?? [], uri, item.name),
  ])
}

export function registerServer(connection: Connection, options: ServerOptions = {}): ServerSession {
  const service = createXmlLanguageService()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const openings = new Map<string, object>()
  let phase: 'created' | 'initializing' | 'running' | 'stopped' = 'created'
  const stopped = () => phase === 'stopped'
  let client = {
    snippets: false,
    hoverMarkdown: false,
    relatedDiagnostics: false,
    diagnosticVersions: false,
    hierarchicalSymbols: false,
    lineOnlyFolding: false,
    codeActions: false,
    versionedEdits: false,
  }

  const dispose = () => {
    phase = 'stopped'
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    service.dispose()
    openings.clear()
  }
  function cancelPending(uri: string): void {
    const timer = timers.get(uri)
    if (timer !== undefined) clearTimeout(timer)
    timers.delete(uri)
  }

  function publish(
    uri: string,
    version: number | undefined,
    diagnostics: ReturnType<typeof service.diagnostics>,
  ): void {
    void connection
      .sendDiagnostics({
        uri,
        diagnostics: client.relatedDiagnostics
          ? diagnostics
          : diagnostics.map((diagnostic) => {
              const result = { ...diagnostic }
              delete result.relatedInformation
              return result
            }),
        ...(client.diagnosticVersions && version !== undefined && { version }),
      })
      .catch(() => undefined)
  }

  function schedule(uri: string, version: number): void {
    cancelPending(uri)
    timers.set(
      uri,
      setTimeout(() => {
        timers.delete(uri)
        if (phase !== 'running' || service.getVersion(uri) !== version) return
        try {
          publish(uri, version, service.diagnostics(uri))
        } catch {
          // Keep document content out of logs, including exception messages from dependencies.
          connection.console.error('SKLand XML diagnostics failed unexpectedly.')
        }
      }, options.diagnosticDelayMs ?? 200),
    )
  }

  async function request<T>(uri: string, token: CancellationToken, run: () => T): Promise<T> {
    if (phase === 'created' || phase === 'initializing')
      throw new ResponseError(-32002, 'Server not initialized')
    if (phase === 'stopped')
      throw new ResponseError(ErrorCodes.InvalidRequest, 'Server has shut down')
    const version = service.getVersion(uri)
    const opening = openings.get(uri)
    // Yield to the message transport so queued cancellations and document notifications can run.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    if (token.isCancellationRequested) throw new ResponseError(-32800, 'Request cancelled')
    if (stopped()) throw new ResponseError(ErrorCodes.InvalidRequest, 'Server has shut down')
    if (version !== service.getVersion(uri) || opening !== openings.get(uri))
      throw new ResponseError(-32801, 'Document changed')
    try {
      return run()
    } catch {
      throw new ResponseError(ErrorCodes.InternalError, 'SKLand XML analysis failed')
    }
  }

  connection.onInitialize(({ capabilities }): InitializeResult => {
    if (phase !== 'created')
      throw new ResponseError(ErrorCodes.InvalidRequest, 'Already initialized')
    phase = 'initializing'
    const text = capabilities.textDocument
    client = {
      snippets: !!text?.completion?.completionItem?.snippetSupport,
      hoverMarkdown: text?.hover?.contentFormat?.[0] === 'markdown',
      relatedDiagnostics: !!text?.publishDiagnostics?.relatedInformation,
      diagnosticVersions: !!text?.publishDiagnostics?.versionSupport,
      hierarchicalSymbols: !!text?.documentSymbol?.hierarchicalDocumentSymbolSupport,
      lineOnlyFolding: !!text?.foldingRange?.lineFoldingOnly,
      codeActions: !!text?.codeAction?.codeActionLiteralSupport,
      versionedEdits: !!capabilities.workspace?.workspaceEdit?.documentChanges,
    }
    return {
      serverInfo: { name: 'SKLand XML Language Server', version },
      capabilities: {
        positionEncoding: 'utf-16',
        textDocumentSync: { openClose: true, change: 2 },
        completionProvider: { triggerCharacters: ['<', '/', ' ', '=', '"', "'"] },
        hoverProvider: true,
        documentSymbolProvider: true,
        documentFormattingProvider: true,
        documentRangeFormattingProvider: true,
        foldingRangeProvider: true,
        linkedEditingRangeProvider: true,
        documentLinkProvider: { resolveProvider: false },
        ...(client.codeActions && { codeActionProvider: { codeActionKinds: ['quickfix'] } }),
      },
    }
  })
  connection.onInitialized(() => {
    if (phase === 'initializing') phase = 'running'
  })
  connection.onDidOpenTextDocument(({ textDocument }) => {
    if (phase !== 'running') return
    const { uri, version } = textDocument
    if (service.openDocument(textDocument)) {
      openings.set(uri, {})
      schedule(uri, version)
    }
  })
  connection.onDidChangeTextDocument(({ textDocument: { uri, version }, contentChanges }) => {
    if (phase === 'running' && service.updateDocument(uri, version, contentChanges))
      schedule(uri, version)
  })
  connection.onDidCloseTextDocument(({ textDocument: { uri } }) => {
    if (phase !== 'running') return
    const wasOpen = service.closeDocument(uri)
    openings.delete(uri)
    cancelPending(uri)
    if (wasOpen) publish(uri, undefined, [])
  })
  connection.onCompletion(({ textDocument: { uri }, position }, token) =>
    request(uri, token, () => service.completion(uri, position, { snippets: client.snippets })),
  )
  connection.onHover(({ textDocument: { uri }, position }, token) =>
    request(uri, token, () => service.hover(uri, position, { markdown: client.hoverMarkdown })),
  )
  connection.onDocumentFormatting(({ textDocument: { uri }, options }, token) =>
    request(uri, token, () => service.formatting(uri, options)),
  )
  connection.onDocumentRangeFormatting(({ textDocument: { uri }, range, options }, token) =>
    request(uri, token, () => service.formatting(uri, options, range)),
  )
  connection.onDocumentSymbol(({ textDocument: { uri } }, token) =>
    request(uri, token, () => {
      const symbols = service.documentSymbols(uri)
      return client.hierarchicalSymbols ? symbols : flatten(symbols, uri)
    }),
  )
  connection.onFoldingRanges(({ textDocument: { uri } }, token) =>
    request(uri, token, () => service.foldingRanges(uri, client.lineOnlyFolding)),
  )
  connection.onDocumentLinks(({ textDocument: { uri } }, token) =>
    request(uri, token, () => service.documentLinks(uri)),
  )
  connection.onRequest(
    'textDocument/linkedEditingRange',
    ({ textDocument: { uri }, position }: LinkedEditingRangeParams, token) =>
      request(uri, token, () => service.linkedEditing(uri, position)),
  )
  connection.onCodeAction(({ textDocument: { uri }, range, context }, token) =>
    request(uri, token, () => {
      if (!client.codeActions || (context.only && !context.only.includes('quickfix'))) return []
      const actions = service.codeActions(uri, range, context.diagnostics)
      if (client.versionedEdits) return actions
      return actions.map((action): CodeAction => {
        const change = action.edit?.documentChanges?.[0]
        return change && 'edits' in change
          ? { ...action, edit: { changes: { [uri]: change.edits } } }
          : action
      })
    }),
  )
  connection.onShutdown(dispose)
  connection.onExit(() => {
    dispose()
    options.onExit?.()
  })

  return { dispose }
}
