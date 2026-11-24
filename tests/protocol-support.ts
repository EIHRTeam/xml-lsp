import { spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node.js'
import { invalidDialog, invalidDocument, validDocument } from './fixtures/documents.ts'

export const fixtureUri = 'file:///example.skland.xml'
export const languageId = 'skland-xml'
export const capabilities = {
  general: { positionEncodings: ['utf-16'] },
  textDocument: {
    completion: { completionItem: { snippetSupport: true } },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    publishDiagnostics: { versionSupport: true, relatedInformation: true },
    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
    codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix'] } } },
  },
  workspace: { workspaceEdit: { documentChanges: true } },
}
export const init = { processId: null, rootUri: null, capabilities }
export const parityFixtures = [
  validDocument,
  invalidDocument,
  invalidDialog,
  '<sklandDocument><description><color value="f_',
]

export function documentParams(uri = fixtureUri) {
  return { textDocument: { uri } }
}
export function openParams(text: string, uri = fixtureUri, version = 1) {
  return { textDocument: { uri, languageId, version, text } }
}

export function startStdio(cli = 'packages/language-server/dist/node.js') {
  const child = spawn(process.execPath, [cli, '--stdio'], {
    stdio: 'pipe',
  })
  const exited = once(child, 'exit')
  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
  )
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (data) => {
    stderr += data
  })
  connection.listen()
  return {
    child,
    connection,
    exited,
    stderr: () => stderr,
    dispose() {
      if (child.exitCode === null) child.kill()
      connection.dispose()
    },
  }
}
