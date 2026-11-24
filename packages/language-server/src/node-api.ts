import { createConnection } from 'vscode-languageserver/node.js'
import { registerServer, type ServerOptions } from './server.js'

export function startNodeServer(options?: ServerOptions): void {
  const connection = createConnection(process.stdin, process.stdout)
  registerServer(connection, options)
  connection.listen()
}
