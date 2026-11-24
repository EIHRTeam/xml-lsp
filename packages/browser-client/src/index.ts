import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createMessageConnection,
  type CancellationToken,
} from 'vscode-jsonrpc/browser.js'
import type {
  CodeAction,
  CompletionList,
  Diagnostic,
  DocumentLink,
  DocumentSymbol,
  FoldingRange,
  FormattingOptions,
  Hover,
  Position,
  Range,
  TextEdit,
} from 'vscode-languageserver-types'

export type Change = { range?: Range; text: string }
export interface BrowserClientOptions {
  snippets?: boolean
  markdown?: boolean
  /** Abort initialization or immediately release the owned Worker. */
  signal?: AbortSignal
  /** A Worker error after successful initialization. */
  onUnexpectedClose?: () => void
}
export interface LinkedRanges {
  ranges: Range[]
  wordPattern?: string
}

export interface BrowserDocument {
  readonly uri: string
  change(changes: readonly Change[]): void
  completion(position: Position, token?: CancellationToken): Promise<CompletionList | null>
  hover(position: Position, token?: CancellationToken): Promise<Hover | null>
  formatting(
    options: FormattingOptions,
    range?: Range,
    token?: CancellationToken,
  ): Promise<TextEdit[] | null>
  symbols(token?: CancellationToken): Promise<DocumentSymbol[] | null>
  folding(token?: CancellationToken): Promise<FoldingRange[] | null>
  linkedEditing(position: Position, token?: CancellationToken): Promise<LinkedRanges | null>
  links(token?: CancellationToken): Promise<DocumentLink[] | null>
  codeActions(
    range: Range,
    diagnostics: Diagnostic[],
    token?: CancellationToken,
  ): Promise<CodeAction[] | null>
  close(): void
}

export interface BrowserClient {
  open(uri: string, text: string, diagnostics: (diagnostics: Diagnostic[]) => void): BrowserDocument
  dispose(): Promise<void>
}

interface OpenDocument {
  version: number
  diagnostics: (diagnostics: Diagnostic[]) => void
}
interface DiagnosticNotification {
  uri: string
  version?: number
  diagnostics: Diagnostic[]
}

async function within<T>(promise: Promise<T>, timeout: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), timeout)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Takes ownership of the Worker, including when initialization fails. */
export async function connectBrowserClient(
  worker: Worker,
  options: BrowserClientOptions = {},
): Promise<BrowserClient> {
  const reader = new BrowserMessageReader(worker)
  const writer = new BrowserMessageWriter(worker)
  const connection = createMessageConnection(reader, writer)
  const documents = new Map<string, OpenDocument>()
  let nextVersion = 0
  let closed = false
  let initialized = false
  let disposing: Promise<void> | undefined

  function release(): void {
    if (closed) return
    closed = true
    options.signal?.removeEventListener('abort', release)
    worker.removeEventListener('error', workerFailed)
    worker.removeEventListener('messageerror', workerFailed)
    worker.onmessage = null
    worker.terminate()
    // JSON-RPC registers its response handler after awaiting the message write.
    // Allow that microtask to finish before rejecting pending requests.
    queueMicrotask(() => connection.dispose())
    const open = [...documents.values()]
    documents.clear()
    for (const document of open) document.diagnostics([])
  }
  function workerFailed(): void {
    release()
    if (initialized && !disposing) options.onUnexpectedClose?.()
  }
  worker.addEventListener('error', workerFailed)
  worker.addEventListener('messageerror', workerFailed)
  options.signal?.addEventListener('abort', release, { once: true })
  connection.onNotification(
    'textDocument/publishDiagnostics',
    ({ uri, version, diagnostics }: DiagnosticNotification) => {
      const current = documents.get(uri)
      if (current && current.version === version) current.diagnostics(diagnostics)
    },
  )
  connection.listen()
  try {
    options.signal?.throwIfAborted()
    await within(
      connection.sendRequest('initialize', {
        processId: null,
        rootUri: null,
        capabilities: {
          general: { positionEncodings: ['utf-16'] },
          workspace: { workspaceEdit: { documentChanges: true } },
          textDocument: {
            completion: { completionItem: { snippetSupport: options.snippets ?? false } },
            hover: { contentFormat: options.markdown ? ['markdown', 'plaintext'] : ['plaintext'] },
            publishDiagnostics: { versionSupport: true, relatedInformation: true },
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            foldingRange: { lineFoldingOnly: false },
            codeAction: {
              codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix'] } },
            },
          },
        },
      }),
      5000,
      'SKLand XML Worker initialization timed out',
    )
    await connection.sendNotification('initialized', {})
    if (closed) throw new Error('The SKLand XML Worker closed during initialization')
    initialized = true
  } catch (error) {
    release()
    throw error
  }

  const notify = (method: string, params: object) => {
    void connection.sendNotification(method, params).catch(() => undefined)
  }
  return {
    open(uri, text, diagnostics) {
      if (closed || disposing) throw new Error('The SKLand XML client is closed')
      if (documents.has(uri)) throw new Error('This XML URI is already open')
      const document: OpenDocument = { version: ++nextVersion, diagnostics }
      documents.set(uri, document)
      const textDocument = { uri }
      notify('textDocument/didOpen', {
        textDocument: { uri, version: document.version, text, languageId: 'skland-xml' },
      })

      const active = () => documents.get(uri) === document && !disposing
      async function request<T>(
        method: string,
        params: object,
        token?: CancellationToken,
      ): Promise<T | null> {
        if (!active() || token?.isCancellationRequested) return null
        const version = document.version
        try {
          const data = { ...params, textDocument }
          const result = await (token
            ? connection.sendRequest<T>('textDocument/' + method, data, token)
            : connection.sendRequest<T>('textDocument/' + method, data))
          return active() && document.version === version && !token?.isCancellationRequested
            ? result
            : null
        } catch {
          return null
        }
      }
      return {
        uri,
        change(changes) {
          if (!active() || !changes.length) return
          document.version = ++nextVersion
          notify('textDocument/didChange', {
            textDocument: { uri, version: document.version },
            contentChanges: changes,
          })
        },
        completion: (position, token) => request('completion', { position }, token),
        hover: (position, token) => request('hover', { position }, token),
        formatting: (options, range, token) =>
          range
            ? request('rangeFormatting', { options, range }, token)
            : request('formatting', { options }, token),
        symbols: (token) => request('documentSymbol', {}, token),
        folding: (token) => request('foldingRange', {}, token),
        linkedEditing: (position, token) => request('linkedEditingRange', { position }, token),
        links: (token) => request('documentLink', {}, token),
        codeActions: (range, diagnostics, token) =>
          request('codeAction', { range, context: { diagnostics } }, token),
        close() {
          if (!active()) return
          documents.delete(uri)
          notify('textDocument/didClose', { textDocument })
          diagnostics([])
        },
      }
    },
    dispose() {
      return (disposing ??= (async () => {
        if (closed) return
        try {
          await within(
            connection.sendRequest('shutdown'),
            1000,
            'SKLand XML Worker shutdown timed out',
          )
          await connection.sendNotification('exit')
        } catch {
          // Terminate the owned Worker even if the connection has already failed.
        } finally {
          release()
        }
      })())
    },
  }
}
