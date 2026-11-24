import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'

const cwd = resolve('examples/dist')
const service = resolve('packages/language-service/dist/index.js')
const contentTypes = new Map([
  ['.css', 'text/css'],
  ['.html', 'text/html'],
  ['.js', 'text/javascript'],
  ['.json', 'application/json'],
  ['.ttf', 'font/ttf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
])
const port = Number(process.env.XML_LSP_EXAMPLE_PORT ?? 4173)
createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204).end()
      return
    }
    if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html')
      response.end(
        '<!doctype html><title>SKLand Wiki XML</title><a href="/monaco/">Monaco</a> · <a href="/ace/">Ace</a>',
      )
      return
    }
    const path = decodeURIComponent(url.pathname)
    const target =
      path === '/language-service.js'
        ? service
        : resolve(cwd, '.' + path + (path.endsWith('/') ? 'index.html' : ''))
    if ((target !== service && !target.startsWith(cwd + sep)) || !(await stat(target)).isFile())
      throw new Error('Not found')
    response.setHeader(
      'Content-Type',
      contentTypes.get(extname(target)) ?? 'application/octet-stream',
    )
    const stream = createReadStream(target)
    stream.on('error', () => response.destroy())
    stream.pipe(response)
  } catch {
    response.writeHead(404).end('Not found')
  }
}).listen(port, '127.0.0.1', () =>
  process.stderr.write(`SKLand Wiki XML examples at http://127.0.0.1:${port}/\n`),
)
