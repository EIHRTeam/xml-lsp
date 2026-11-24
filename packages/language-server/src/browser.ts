import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createConnection,
} from 'vscode-languageserver/browser.js'
import { registerServer, type ServerOptions, type ServerSession } from './server.js'

export function startBrowserServer(
  scope: DedicatedWorkerGlobalScope,
  options: ServerOptions = {},
): ServerSession {
  const connection = createConnection(
    new BrowserMessageReader(scope),
    new BrowserMessageWriter(scope),
  )
  const session = registerServer(connection, {
    ...options,
    onExit: () => {
      options.onExit?.()
      scope.close()
    },
  })
  connection.listen()
  return {
    dispose() {
      session.dispose()
      connection.dispose()
    },
  }
}
