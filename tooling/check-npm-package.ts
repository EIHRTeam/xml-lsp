import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fixtureUri, init, openParams, startStdio } from '../tests/protocol-support.ts'
import { validDocument } from '../tests/fixtures/documents.ts'

interface Manifest {
  version: string
  exports: Record<string, string | { import: string; types: string }>
  bin: Record<string, string>
}

const pkg = JSON.parse(await readFile('package.json', 'utf8')) as Manifest
const archive = resolve('dist', `eihrteam-xml-lsp-${pkg.version}.tgz`)
const windows = process.platform === 'win32'

function npm(args: string[], cwd: string): string {
  const result = spawnSync(windows ? 'npm.cmd' : 'npm', args, {
    cwd,
    encoding: 'utf8',
    shell: windows,
  })
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
  return result.stdout
}

const packet = npm(
  ['pack', '--ignore-scripts', '--pack-destination', 'dist', '--json'],
  process.cwd(),
)
const files = new Set(
  (JSON.parse(packet) as [{ files: { path: string }[] }])[0].files.map((file) => file.path),
)
for (const target of Object.values(pkg.exports)) {
  for (const file of typeof target === 'string' ? [target] : Object.values(target)) {
    assert(files.has(file.slice(2)), 'Missing npm package export ' + file)
  }
}
for (const file of [
  'LICENSE',
  'README.md',
  'dist/npm/ThirdPartyNotices.txt',
  ...Object.values(pkg.bin).map((file) => file.slice(2)),
]) {
  assert(files.has(file), 'Missing npm package file ' + file)
}
for (const file of files) {
  assert(
    /^(?:LICENSE|README.md|package.json|dist\/npm\/.+|docs\/.+)$/.test(file),
    'Unexpected package contents ' + file,
  )
}

const project = await mkdtemp(join(tmpdir(), 'skland-xml-consumer-'))
try {
  await writeFile(join(project, 'package.json'), '{"private":true,"type":"module"}')
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', archive], project)
  const probe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import assert from 'node:assert/strict'
    import {createXmlLanguageService} from '@eihrteam/xml-lsp'
    import {startNodeServer} from '@eihrteam/xml-lsp/node'
    import {startBrowserServer} from '@eihrteam/xml-lsp/browser'
    import {registerServer} from '@eihrteam/xml-lsp/server'
    import {connectBrowserClient} from '@eihrteam/xml-lsp/browser-client'
    import {createMonacoClient} from '@eihrteam/xml-lsp/monaco'
    import {createAceClient} from '@eihrteam/xml-lsp/ace'
    const service = createXmlLanguageService()
    service.openDocument(${JSON.stringify({ uri: fixtureUri, text: validDocument, version: 1 })})
    assert.deepEqual(service.diagnostics(${JSON.stringify(fixtureUri)}), [])
    assert.ok(import.meta.resolve('@eihrteam/xml-lsp/worker').endsWith('/worker.js'))
    for (const api of [startNodeServer, startBrowserServer, registerServer, connectBrowserClient, createMonacoClient, createAceClient]) {
      assert.equal(typeof api, 'function')
    }
  `,
    ],
    { cwd: project, encoding: 'utf8', timeout: 4000 },
  )
  assert.equal(probe.status, 0, probe.stderr)
  assert.equal(probe.stdout, '')

  const server = startStdio(
    join(project, 'node_modules', '@eihrteam', 'xml-lsp', pkg.bin['skland-xml-language-server']!),
  )
  try {
    assert.ok(await server.connection.sendRequest('initialize', init))
    await server.connection.sendNotification('initialized', {})
    await server.connection.sendNotification('textDocument/didOpen', openParams(validDocument))
    const result = await server.connection.sendRequest('textDocument/hover', {
      textDocument: { uri: fixtureUri },
      position: { line: 0, character: 1 },
    })
    assert.ok(result)
    await server.connection.sendRequest('shutdown')
    await server.connection.sendNotification('exit')
    assert.deepEqual(await server.exited, [0, null])
    assert.equal(server.stderr(), '')
  } finally {
    server.dispose()
  }
} finally {
  await rm(project, { recursive: true, force: true })
}
process.stdout.write(`Verified install and stdio from ${archive}\n`)
