import { type ExtensionContext } from 'vscode'
import { LanguageClient, TransportKind } from 'vscode-languageclient/node.js'

let client: LanguageClient | undefined

export async function activate(context: ExtensionContext): Promise<void> {
  client = new LanguageClient(
    'skland-xml',
    'SKLand Wiki XML',
    {
      module: context.asAbsolutePath('dist/xml-server.js'),
      transport: TransportKind.stdio,
    },
    {
      documentSelector: [{ language: 'skland-xml' }],
    },
  )
  await client.start()
}

export async function deactivate(): Promise<void> {
  await client?.dispose()
  client = undefined
}
