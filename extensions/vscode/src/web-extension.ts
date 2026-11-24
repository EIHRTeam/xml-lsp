import { Uri, type ExtensionContext } from 'vscode'
import { LanguageClient } from 'vscode-languageclient/browser.js'

let client: LanguageClient | undefined
let worker: Worker | undefined

export async function activate(context: ExtensionContext): Promise<void> {
  const uri = Uri.joinPath(context.extensionUri, 'dist', 'xml-worker.js')
  worker = new Worker(uri.toString(true), { type: 'module' })
  client = new LanguageClient(
    'skland-xml',
    'SKLand Wiki XML',
    {
      documentSelector: [{ language: 'skland-xml' }],
    },
    worker,
  )
  try {
    await client.start()
  } catch (error) {
    worker.terminate()
    worker = undefined
    throw error
  }
}

export async function deactivate(): Promise<void> {
  try {
    await client?.dispose()
  } finally {
    worker?.terminate()
    client = undefined
    worker = undefined
  }
}
