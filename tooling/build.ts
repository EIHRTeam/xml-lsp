import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { build, type UserConfig } from 'tsdown'
import { bundleNotices } from './licenses.ts'

const packages = [
  'language-service',
  'language-server',
  'browser-client',
  'monaco-client',
  'ace-client',
]
const extension = 'extensions/vscode'
const examples = 'examples/dist'
const server = 'packages/language-server'
const npmOutput = 'dist/npm'
const aceAssets = ['ace.js', 'ext-language_tools.js', 'mode-xml.js']
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const base: UserConfig = {
  dts: false,
  clean: false,
  minify: true,
  sourcemap: false,
  tsconfig: 'tsconfig.json',
  format: 'esm',
  target: 'es2023',
  define: { __SKLAND_XML_LSP_VERSION__: JSON.stringify(version) },
  deps: { alwaysBundle: [/.*/], onlyBundle: false },
}

await Promise.all([
  ...packages.map((name) => rm(`packages/${name}/dist`, { force: true, recursive: true })),
  ...['dist/types', npmOutput, examples, extension + '/dist'].map((directory) =>
    rm(directory, { force: true, recursive: true }),
  ),
])

async function bundle(config: UserConfig): Promise<void> {
  await build({ config: false, ...base, ...config })
}
function pack(
  name: string,
  entry: string,
  file: string,
  platform: 'browser' | 'node',
): Promise<void> {
  return bundle({
    entry: { [file]: `packages/${name}/src/${entry}.ts` },
    outDir: `packages/${name}/dist`,
    platform,
    shims: platform === 'node',
    outExtensions: () => ({ js: '.js' }),
  })
}

await Promise.all([
  ...packages
    .filter((name) => name !== 'language-server')
    .map((name) => pack(name, 'index', 'index', 'browser')),
  bundle({
    entry: { index: 'packages/language-server/src/index.ts' },
    outDir: server + '/dist',
    platform: 'browser',
    deps: {
      neverBundle: [/^vscode-jsonrpc\//],
      alwaysBundle: [/^(?!vscode-jsonrpc\/).*/],
      onlyBundle: false,
    },
  }),
  pack('language-server', 'browser', 'browser', 'browser'),
  pack('language-server', 'worker', 'worker', 'browser'),
  pack('language-server', 'node-api', 'node-api', 'node'),
  pack('language-server', 'node', 'node', 'node'),
  bundle({
    entry: { extension: extension + '/src/extension.ts' },
    outDir: extension + '/dist',
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    deps: { neverBundle: ['vscode'], alwaysBundle: [/^(?!vscode$).*/], onlyBundle: false },
  }),
  bundle({
    entry: { 'web-extension': extension + '/src/web-extension.ts' },
    outDir: extension + '/dist',
    format: 'cjs',
    platform: 'node',
    target: 'es2023',
    inputOptions: {
      resolve: {
        mainFields: ['browser', 'module', 'main'],
        aliasFields: [['browser']],
        conditionNames: ['browser', 'default'],
      },
    },
    deps: {
      neverBundle: ['vscode'],
      alwaysBundle: [/^(?!vscode$).*/],
      onlyBundle: false,
      onlyImport: ['vscode'],
    },
  }),
  bundle({
    entry: { main: 'examples/monaco/main.ts', 'editor-worker': 'examples/monaco/editor-worker.ts' },
    outDir: examples + '/monaco',
    platform: 'browser',
    target: 'chrome145',
  }),
  bundle({
    entry: { 'integration-probe': 'tests/browser/mv3-probe-fixture.ts' },
    outDir: 'tests/browser/dist',
    format: 'iife',
    platform: 'browser',
    target: 'chrome145',
    outExtensions: () => ({ js: '.js' }),
  }),
  bundle({
    entry: { suite: 'tests/vscode/suite.ts' },
    outDir: 'tests/vscode/dist',
    format: 'cjs',
    platform: 'node',
    deps: { neverBundle: ['vscode'], alwaysBundle: [/^(?!vscode$).*/], onlyBundle: false },
  }),
  bundle({
    entry: { main: 'examples/ace/main.ts' },
    outDir: examples + '/ace',
    platform: 'browser',
    target: 'chrome145',
  }),
])

const declarations = spawnSync(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'],
  { stdio: 'inherit' },
)
if (declarations.status !== 0) throw new Error('TypeScript declaration emission failed')
await Promise.all(
  packages.map((name) =>
    cp(`dist/types/packages/${name}/src`, `packages/${name}/dist`, { recursive: true }),
  ),
)
const worker = server + '/dist/worker.js'
await Promise.all([
  copyFile(server + '/dist/node.js', extension + '/dist/xml-server.js'),
  copyFile(worker, extension + '/dist/xml-worker.js'),
])

const template = await readFile('examples/index.html', 'utf8')
for (const editor of ['monaco', 'ace']) {
  const directory = examples + '/' + editor
  const assets =
    editor === 'monaco'
      ? '<link rel="stylesheet" href="./style.css">'
      : [
          '<link rel="stylesheet" href="./ace.css">',
          ...aceAssets.map((asset) => `<script defer src="./${asset}"></script>`),
        ].join('\n  ')
  if (editor === 'ace') {
    const cssRoot = 'node_modules/ace-builds/css/'
    const css = await readFile(cssRoot + 'ace.css', 'utf8')
    const dependencies = new Set(
      [...css.matchAll(/url\("\.\/([a-z0-9.-]+)"\)/g)].map((match) => match[1]!),
    )
    await Promise.all(
      ['ace.css', ...dependencies].map((file) => copyFile(cssRoot + file, directory + '/' + file)),
    )
  }
  await Promise.all([
    copyFile(worker, directory + '/xml-worker.js'),
    copyFile('examples/style.css', directory + '/layout.css'),
    writeFile(
      directory + '/index.html',
      template
        .replaceAll('%EDITOR%', editor === 'monaco' ? 'Monaco' : 'Ace')
        .replace('%ASSETS%', assets),
    ),
    ...(editor === 'ace'
      ? aceAssets.map((asset) =>
          copyFile(
            resolve('node_modules/ace-builds/src-noconflict', asset),
            directory + '/' + asset,
          ),
        )
      : [
          copyFile(
            'node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.ttf',
            directory + '/codicon.ttf',
          ),
        ]),
  ])
}
const mv3 = examples + '/chromium-extension'
await mkdir(mv3, { recursive: true })
await Promise.all([
  ...['manifest.json', 'popup.html'].map((file) =>
    copyFile('examples/chromium-extension/' + file, mv3 + '/' + file),
  ),
  ...['monaco', 'ace'].map((editor) =>
    cp(examples + '/' + editor, mv3 + '/' + editor, { recursive: true }),
  ),
])

await Promise.all([
  ...packages.map((name) => bundleNotices('packages/' + name + '/dist', ['packages/' + name])),
  bundleNotices(extension + '/dist', [extension, server]),
  bundleNotices(examples + '/monaco', [server, 'packages/monaco-client'], 'monaco-editor'),
  bundleNotices(examples + '/ace', [server, 'packages/ace-client'], 'ace-builds'),
])
await Promise.all(
  ['monaco', 'ace'].flatMap((editor) =>
    ['LICENSE', 'ThirdPartyNotices.txt'].map((file) =>
      copyFile(examples + '/' + editor + '/' + file, mv3 + '/' + editor + '/' + file),
    ),
  ),
)

await mkdir(npmOutput, { recursive: true })
await Promise.all([
  ...packages.map((name) =>
    cp('packages/' + name + '/dist', npmOutput + '/' + name, {
      recursive: true,
      filter: (file) =>
        !/(?:[/\\])(?:LICENSE|ThirdPartyNotices\.txt|node\.js|node\.d\.ts)$/.test(file),
    }),
  ),
  bundleNotices(
    npmOutput,
    packages.map((name) => 'packages/' + name),
  ),
  writeFile(
    npmOutput + '/cli.js',
    "#!/usr/bin/env node\nimport { startNodeServer } from './language-server/node-api.js'\nstartNodeServer()\n",
    { mode: 0o755 },
  ),
])
