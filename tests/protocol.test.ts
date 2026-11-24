import { describe, expect, test } from 'vitest'
import type {
  CodeAction,
  CompletionList,
  Diagnostic,
  DocumentSymbol,
  Hover,
  TextEdit,
} from 'vscode-languageserver-types'
import { CancellationTokenSource } from 'vscode-jsonrpc/node.js'
import { documentParams, fixtureUri, init, openParams, startStdio } from './protocol-support.ts'
import { invalidDocument, validDocument, wikiDocument } from './fixtures/documents.ts'

interface Publication {
  uri: string
  version?: number
  diagnostics: Diagnostic[]
}

describe('Node stdio LSP', () => {
  test('negotiates features and handles edits, debounce, related diagnostics, multiple documents, shutdown and exit', async () => {
    const session = startStdio()
    const { connection } = session
    const received: Publication[] = []
    connection.onNotification('textDocument/publishDiagnostics', (params: Publication) =>
      received.push(params),
    )
    try {
      await expect(
        connection.sendRequest('textDocument/hover', {
          ...documentParams(),
          position: { line: 0, character: 1 },
        }),
      ).rejects.toMatchObject({ code: -32002 })
      const result = await connection.sendRequest('initialize', init)
      expect(result).toMatchObject({
        capabilities: {
          positionEncoding: 'utf-16',
          textDocumentSync: { change: 2, openClose: true },
          completionProvider: { triggerCharacters: expect.arrayContaining(['<', '=']) },
          hoverProvider: true,
          linkedEditingRangeProvider: true,
          codeActionProvider: { codeActionKinds: ['quickfix'] },
        },
      })
      await connection.sendNotification('initialized', {})
      await connection.sendNotification('textDocument/didOpen', openParams(invalidDocument))
      const second = 'file:///other.xml'
      await connection.sendNotification(
        'textDocument/didOpen',
        openParams(validDocument, second, 22),
      )
      const colorOffset = invalidDocument.indexOf('unknown')
      const position = { line: 0, character: colorOffset }
      const response = await connection.sendRequest<CompletionList>('textDocument/completion', {
        ...documentParams(),
        position,
      })
      expect(response.items.map((item) => item.label)).toContain('f_red')
      const hover = await connection.sendRequest<Hover>('textDocument/hover', {
        ...documentParams(),
        position,
      })
      expect(hover.contents).toMatchObject({
        kind: 'markdown',
        value: expect.stringContaining('ColorValue'),
      })
      const contentChanges = [
        { range: { start: position, end: { line: 0, character: colorOffset + 7 } }, text: 'f_red' },
      ]
      await connection.sendNotification('textDocument/didChange', {
        textDocument: { uri: fixtureUri, version: 3 },
        contentChanges,
      })
      await connection.sendNotification('textDocument/didChange', {
        textDocument: { uri: fixtureUri, version: 2 },
        contentChanges: [{ text: '' }],
      })
      await expect
        .poll(() => received.find((item) => item.uri === second))
        .toMatchObject({ version: 22, diagnostics: [] })
      await expect
        .poll(() => received.find((item) => item.uri === fixtureUri))
        .toMatchObject({ version: 3, diagnostics: [] })
      expect(received.filter((item) => item.uri === fixtureUri)).toHaveLength(1)

      const symbols = await connection.sendRequest<DocumentSymbol[]>(
        'textDocument/documentSymbol',
        documentParams(second),
      )
      expect(symbols[0]?.children?.map((item) => item.name)).toContain('description')
      const edits = await connection.sendRequest<TextEdit[]>('textDocument/formatting', {
        ...documentParams(second),
        options: { tabSize: 2, insertSpaces: true },
      })
      expect(edits.length).toBeGreaterThan(3)
      const b = validDocument.indexOf('<b>') + 1
      expect(
        await connection.sendRequest('textDocument/linkedEditingRange', {
          ...documentParams(second),
          position: { line: 0, character: b },
        }),
      ).toMatchObject({
        ranges: [
          { start: { line: 0, character: b } },
          { start: { line: 0, character: validDocument.indexOf('</b>') + 2 } },
        ],
      })

      await connection.sendNotification('textDocument/didChange', {
        textDocument: { uri: fixtureUri, version: 4 },
        contentChanges: [{ text: wikiDocument('<b>x</i>') }],
      })
      await expect.poll(() => received.some((item) => item.version === 4)).toBe(true)
      const mismatch = received
        .find((item) => item.version === 4)
        ?.diagnostics.find((item) => item.code === 'mismatched-close-tag')
      expect(mismatch?.relatedInformation).toHaveLength(1)
      const actions = await connection.sendRequest<CodeAction[]>('textDocument/codeAction', {
        ...documentParams(),
        range: mismatch?.range,
        context: { diagnostics: [mismatch] },
      })
      expect(actions[0]?.edit?.documentChanges?.[0]).toMatchObject({
        textDocument: { uri: fixtureUri, version: 4 },
      })
      await connection.sendNotification('textDocument/didClose', documentParams())
      await expect
        .poll(() => received.filter((item) => item.uri === fixtureUri).at(-1))
        .toEqual({ uri: fixtureUri, diagnostics: [] })
      await expect(
        connection.sendRequest('textDocument/hover', { ...documentParams(), position }),
      ).resolves.toBeNull()
      await connection.sendRequest('shutdown')
      await expect(
        connection.sendRequest('textDocument/hover', { ...documentParams(), position }),
      ).rejects.toMatchObject({ code: -32600 })
      await connection.sendNotification('exit')
      expect(await session.exited).toEqual([0, null])
      expect(session.stderr()).toBe('')
    } finally {
      session.dispose()
    }
  })

  test('uses client capability fallbacks and handles cancelled requests', async () => {
    const session = startStdio()
    const { connection } = session
    try {
      const result = await connection.sendRequest('initialize', { ...init, capabilities: {} })
      expect(result).not.toHaveProperty('capabilities.codeActionProvider')
      await connection.sendNotification('initialized', {})
      await connection.sendNotification('textDocument/didOpen', openParams(validDocument))
      const params = {
        ...documentParams(),
        position: { line: 0, character: validDocument.indexOf('description') },
      }
      const hover = await connection.sendRequest<Hover>('textDocument/hover', params)
      expect(hover.contents).toMatchObject({ kind: 'plaintext' })
      const symbols = await connection.sendRequest('textDocument/documentSymbol', documentParams())
      expect(symbols).toContainEqual(
        expect.objectContaining({
          name: 'description',
          location: expect.objectContaining({ uri: fixtureUri }),
        }),
      )
      const cancellation = new CancellationTokenSource()
      const outstanding = connection.sendRequest(
        'textDocument/completion',
        params,
        cancellation.token,
      )
      cancellation.cancel()
      await expect(outstanding).rejects.toMatchObject({ code: -32800 })
      await connection.sendNotification('exit')
      expect(await session.exited).toEqual([1, null])
    } finally {
      session.dispose()
    }
  })
})
