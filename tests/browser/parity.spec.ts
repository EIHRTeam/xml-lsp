import { expect, test } from '@playwright/test'
import {
  documentParams,
  fixtureUri,
  init,
  openParams,
  parityFixtures,
  startStdio,
} from '../protocol-support.ts'
import type { Diagnostic } from 'vscode-languageserver-types'

test('Node stdio, Browser Worker and main-thread parser produce equivalent language analysis', async ({
  page,
}) => {
  const server = startStdio()
  await page.goto('/')
  const requests = [
    {
      method: 'textDocument/completion',
      params: { ...documentParams(), position: { line: 0, character: 1 } },
    },
    {
      method: 'textDocument/hover',
      params: { ...documentParams(), position: { line: 0, character: 1 } },
    },
    { method: 'textDocument/documentSymbol', params: documentParams() },
    {
      method: 'textDocument/formatting',
      params: { ...documentParams(), options: { insertSpaces: true, tabSize: 2 } },
    },
    { method: 'textDocument/documentLink', params: documentParams() },
  ]
  try {
    const diagnostics = new Map<number, Diagnostic[]>()
    server.connection.onNotification(
      'textDocument/publishDiagnostics',
      (params: { version: number; diagnostics: Diagnostic[] }) =>
        diagnostics.set(params.version, params.diagnostics),
    )
    await server.connection.sendRequest('initialize', init)
    await server.connection.sendNotification('initialized', {})
    const documents = parityFixtures.map((text, index) => openParams(text, fixtureUri, index + 1))
    const node = []
    for (const open of documents) {
      await server.connection.sendNotification('textDocument/didOpen', open)
      await expect.poll(() => diagnostics.has(open.textDocument.version)).toBe(true)
      const responses = await Promise.all(
        requests.map(({ method, params }) => server.connection.sendRequest(method, params)),
      )
      node.push({ diagnostics: diagnostics.get(open.textDocument.version), responses })
      await server.connection.sendNotification('textDocument/didClose', documentParams())
    }

    const browser = await page.evaluate(
      async ({ init, documents, requests, fixtureUri }) => {
        const worker = new Worker('/monaco/xml-worker.js', { type: 'module' })
        let id = 0
        interface RpcMessage {
          id?: number
          method?: string
          params?: { version: number; diagnostics: unknown }
          result?: unknown
          error?: unknown
        }
        const requestsInFlight = new Map<
          number,
          { resolve: (value: unknown) => void; reject: (error: unknown) => void }
        >()
        const pending = new Map<number, (value: unknown) => void>()
        worker.addEventListener('message', ({ data }: MessageEvent<RpcMessage>) => {
          if (data.method === 'textDocument/publishDiagnostics' && data.params)
            pending.get(data.params.version)?.(data.params.diagnostics)
          if (data.id === undefined) return
          const request = requestsInFlight.get(data.id)
          requestsInFlight.delete(data.id)
          if (data.error) request?.reject(data.error)
          else request?.resolve(data.result)
        })
        const rpc = (method: string, params?: unknown) =>
          new Promise<unknown>((resolve, reject) => {
            requestsInFlight.set(++id, { resolve, reject })
            worker.postMessage({ jsonrpc: '2.0', id, method, params })
          })
        const send = (method: string, params?: unknown) =>
          worker.postMessage({ jsonrpc: '2.0', method, params })
        await rpc('initialize', init)
        send('initialized', {})
        const mainUrl = '/language-service.js'
        const main = (
          (await import(mainUrl)) as typeof import('@eihrteam/xml-language-service')
        ).createXmlLanguageService()
        const results = []
        const mainDiagnostics = []
        for (const open of documents) {
          const diagnostics = new Promise((resolve) =>
            pending.set(open.textDocument.version, resolve),
          )
          send('textDocument/didOpen', open)
          main.openDocument(open.textDocument)
          mainDiagnostics.push(main.diagnostics(fixtureUri))
          main.closeDocument(fixtureUri)
          results.push({
            diagnostics: await diagnostics,
            responses: await Promise.all(requests.map(({ method, params }) => rpc(method, params))),
          })
          send('textDocument/didClose', { textDocument: { uri: fixtureUri } })
        }
        await rpc('shutdown')
        send('exit')
        worker.terminate()
        return { results, mainDiagnostics }
      },
      { init, documents, requests, fixtureUri },
    )
    expect(browser.results).toEqual(node)
    expect(browser.mainDiagnostics).toEqual(node.map((item) => item.diagnostics))
  } finally {
    server.dispose()
  }
})
