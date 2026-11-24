import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { cpus, totalmem } from 'node:os'
import { once } from 'node:events'
import { readFile, readdir } from 'node:fs/promises'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { chromium } from '@playwright/test'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { init, startStdio } from '../tests/protocol-support.ts'
import { validDocument, wikiDocument } from '../tests/fixtures/documents.ts'

const serviceUrl = new URL('../packages/language-service/dist/index.js', import.meta.url).href
const { createXmlLanguageService } = (await import(
  serviceUrl
)) as typeof import('@eihrteam/xml-language-service')
const rounds = Number(process.env.XML_LSP_BENCHMARK_ROUNDS ?? 10)
if (!Number.isInteger(rounds) || rounds < 1)
  throw new Error('Set XML_LSP_BENCHMARK_ROUNDS to a positive integer')
const uri = 'inmemory:///benchmark.skland.xml'
const number = (value: number) => Math.round(value * 100) / 100
const p95 = (values: number[]) =>
  number(values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!)
const mb = (bytes: number) => number(bytes / (1024 * 1024))
const measure = (run: () => unknown) => {
  const before = performance.now()
  run()
  return performance.now() - before
}

const entry =
  '<h2>Chapter</h2><quote>Text <color value="f_red">on the Wiki</color></quote>' +
  '<table widths="1,1"><tr><td><b>text</b></td><td rowspan="2">value</td></tr><tr><td>more</td></tr></table>'
const branch =
  '<chapters name="Group"><chapter name="Talk" dialog="true">' +
  '<branches><branch name="Option"><message side="me" avatar="me"><text>choice</text></message>' +
  '<message side="other" avatar="other"><text>answer<emoji id="42"/></text></message></branch></branches></chapter></chapters>'

function corpus(target: number): string {
  const wrapper = wikiDocument(entry, branch)
  target -= Buffer.byteLength(wrapper) - wrapper.length
  const block = entry.repeat(8) + 'A'.repeat(1024)
  const count = Math.floor((target - wrapper.length) / (block.length + branch.length))
  const body = block.repeat(count)
  const dialogs = branch.repeat(count)
  return wikiDocument(
    entry + body + 'z'.repeat(target - wrapper.length - body.length - dialogs.length),
    branch + dialogs,
  )
}

function measureDocument(text: string, runs: number) {
  const parse: number[] = []
  const coldDiagnostics: number[] = []
  const warmCompletion: number[] = []
  const warmHover: number[] = []
  const edits: number[] = []
  const paste: number[] = []
  let diagnosis: unknown[] = []
  let peak = process.memoryUsage.rss()
  const position = TextDocument.create(uri, 'skland-xml', 1, text).positionAt(
    text.indexOf('<color') + 2,
  )
  for (let i = 0; i < runs; i++) {
    const service = createXmlLanguageService()
    service.openDocument({ uri, version: 1, text })
    coldDiagnostics.push(
      measure(() => {
        diagnosis = service.diagnostics(uri)
      }),
    )
    peak = Math.max(peak, process.memoryUsage.rss())
    service.closeDocument(uri)
    service.openDocument({ uri, version: 1, text })
    parse.push(measure(() => service.completion(uri, position)))
    for (let turn = 0; turn < 8; turn++) {
      warmCompletion.push(measure(() => service.completion(uri, position)))
      warmHover.push(measure(() => service.hover(uri, position)))
    }
    const change = { range: { start: position, end: position }, text: 'a' }
    for (let turn = 2; turn < 5; turn++) {
      edits.push(
        measure(() => {
          service.updateDocument(uri, turn, [change])
          service.completion(uri, position)
        }),
      )
    }
    paste.push(
      measure(() => {
        service.updateDocument(uri, 6, [
          { range: { start: position, end: position }, text: 'paste'.repeat(8192) },
        ])
        service.completion(uri, position)
      }),
    )
    peak = Math.max(peak, process.memoryUsage.rss())
    service.closeDocument(uri)
    service.dispose()
  }
  globalThis.gc?.()
  return {
    bytes: Buffer.byteLength(text),
    runs,
    parseAndCompletionMs: p95(parse),
    coldDiagnosticsMs: p95(coldDiagnostics),
    warmCompletionMs: p95(warmCompletion),
    warmHoverMs: p95(warmHover),
    singleEditAndCompletionMs: p95(edits),
    pasteAndCompletionMs: p95(paste),
    diagnostics: diagnosis,
    peakSampleRssMiB: mb(peak),
    rssAfterCloseAndGcMiB: mb(process.memoryUsage.rss()),
  }
}

async function nodeStartup() {
  const times: number[] = []
  const rss: number[] = []
  for (let i = 0; i < rounds; i++) {
    const before = performance.now()
    const session = startStdio()
    try {
      await session.connection.sendRequest('initialize', init)
      times.push(performance.now() - before)
      if (session.child.pid && process.platform !== 'win32') {
        const residentKiB = Number(
          execFileSync('ps', ['-o', 'rss=', '-p', String(session.child.pid)], { encoding: 'utf8' }),
        )
        if (residentKiB > 0) rss.push(residentKiB / 1024)
      }
      await session.connection.sendRequest('shutdown')
      await session.connection.sendNotification('exit')
      await session.exited
    } finally {
      session.dispose()
    }
  }
  return { p95Ms: p95(times), idleRssP95MiB: rss.length ? p95(rss) : undefined }
}

async function browserStartup() {
  const bytes = await readFile('packages/language-server/dist/worker.js')
  const server = createServer((request, response) => {
    if (request.url === '/worker.js')
      response.writeHead(200, { 'content-type': 'text/javascript' }).end(bytes)
    else
      response
        .writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Worker cold start</title>')
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP benchmark server')
    const browser = await chromium.launch({ channel: 'chromium' })
    try {
      const page = await browser.newPage()
      await page.goto(`http://127.0.0.1:${address.port}`)
      const times = await page.evaluate(
        async ({ rounds, init }) => {
          const durations: number[] = []
          for (let i = 0; i < rounds; i++) {
            const before = performance.now()
            const worker = new Worker('/worker.js', { type: 'module' })
            try {
              const initialized = new Promise<void>((resolve, reject) => {
                worker.addEventListener('error', reject, { once: true })
                worker.addEventListener(
                  'message',
                  ({ data }) => data.id === 1 && (data.error ? reject(data.error) : resolve()),
                  { once: true },
                )
              })
              worker.postMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: init })
              await initialized
              durations.push(performance.now() - before)
            } finally {
              worker.terminate()
            }
          }
          return durations
        },
        { rounds, init },
      )
      return { chromium: browser.version(), p95Ms: p95(times) }
    } finally {
      await browser.close()
    }
  } finally {
    server.close()
  }
}

const samples = [10 * 1024, 100 * 1024, 1024 * 1024, 5 * 1024 * 1024, 20 * 1024 * 1024]
const documents = samples.map((bytes) =>
  measureDocument(corpus(bytes), bytes < 2 * 1024 * 1024 ? rounds : 1),
)
const incomplete = measureDocument(validDocument.slice(0, -12), rounds)
const multi = createXmlLanguageService()
const manyDocumentsMs = measure(() => {
  for (let i = 0; i < 50; i++) {
    const uri = `inmemory:///document-${i}.xml`
    multi.openDocument({ uri, version: 1, text: validDocument })
    multi.diagnostics(uri)
  }
  multi.dispose()
})
const artifactList = [
  'packages/language-service/dist/index.js',
  'packages/language-server/dist/node.js',
  'packages/language-server/dist/worker.js',
  'packages/monaco-client/dist/index.js',
  'packages/ace-client/dist/index.js',
  ...['monaco', 'ace'].flatMap((editor) => [`examples/dist/${editor}/main.js`]),
]
const archive = (await readdir('dist')).find((file) => file.endsWith('.vsix'))
if (archive) artifactList.push('dist/' + archive)
const sizes = await Promise.all(
  artifactList.map(async (file) => {
    const content = await readFile(file)
    return {
      file,
      raw: content.length,
      gzip: gzipSync(content).length,
      brotli: brotliCompressSync(content).length,
    }
  }),
)
process.stdout.write(
  JSON.stringify(
    {
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0]?.model,
        ramMiB: mb(totalmem()),
        rounds,
      },
      diagnosticDebounceMs: 200,
      nodeStartup: await nodeStartup(),
      browserStartup: process.argv.includes('--browser') ? await browserStartup() : undefined,
      documents,
      incomplete,
      openAnalyzeClose50DocumentsMs: number(manyDocumentsMs),
      sizes,
    },
    null,
    2,
  ) + '\n',
)
