import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { isBuiltin } from 'node:module'

const directories = [
  'language-service',
  'language-server',
  'browser-client',
  'monaco-client',
  'ace-client',
]
async function verifyPackage(name: string): Promise<void> {
  const cwd = 'packages/' + name
  const manifest = JSON.parse(await readFile(cwd + '/package.json', 'utf8')) as {
    name: string
    exports: Record<string, string | { types: string; import: string }>
    bin?: Record<string, string>
  }
  const imports: string[] = []
  for (const [entry, target] of Object.entries(manifest.exports)) {
    if (typeof target === 'string') {
      await access(cwd + '/' + target)
    } else {
      await access(cwd + '/' + target.import)
      await access(cwd + '/' + target.types)
      imports.push(manifest.name + entry.slice(1))
    }
  }
  for (const path of Object.values(manifest.bin ?? {})) {
    assert((await readFile(cwd + '/' + path, 'utf8')).startsWith('#!/usr/bin/env node\n'))
  }
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `await Promise.all(${JSON.stringify(imports)}.map(name => import(name)))`,
    ],
    { cwd, encoding: 'utf8', timeout: 2000 },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '')
}

await Promise.all(directories.map(verifyPackage))

const browserBundles = [
  ...directories.map((name) => `packages/${name}/dist/index.js`),
  ...['browser.js', 'worker.js'].map((name) => 'packages/language-server/dist/' + name),
  'extensions/vscode/dist/web-extension.cjs',
]
for (const file of browserBundles) {
  const source = await readFile(file, 'utf8')
  assert(
    !/\b(?:eval\s*\(|new\s+Function\s*\(|WebAssembly\s*(?:\.|\[))|wasm-unsafe-eval|\.wasm\b/.test(
      source,
    ),
    file + ' contains restricted browser runtime code',
  )
  for (const match of source.matchAll(
    /(?:\brequire\s*\(|\bimport\s*\(|\bfrom\s+|\bimport\s+)[`'"]([^"`']+)[`'"]/g,
  )) {
    const dependency = match[1]!
    assert(!isBuiltin(dependency) && !/^https?:/.test(dependency), file + ' imports ' + dependency)
  }
}

const packaged = JSON.parse(
  await readFile('examples/dist/chromium-extension/manifest.json', 'utf8'),
) as Record<string, unknown>
assert.equal(packaged.manifest_version, 3)
for (const field of ['content_security_policy', 'permissions', 'host_permissions', 'background'])
  assert(!Object.hasOwn(packaged, field))
assert.equal(
  await readFile('examples/dist/monaco/xml-worker.js', 'utf8'),
  await readFile('examples/dist/ace/xml-worker.js', 'utf8'),
)
const cli = spawnSync(process.execPath, ['node_modules/@eihrteam/xml/dist/cli.js', '--help'], {
  encoding: 'utf8',
  timeout: 3000,
})
assert.equal(cli.status, 0, cli.stderr)
assert.match(cli.stdout, /xml/)
process.stdout.write('Verified package exports, side effects, browser runtime and converter CLI.\n')
