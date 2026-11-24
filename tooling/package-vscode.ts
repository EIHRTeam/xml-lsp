import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve('extensions/vscode')
const manifest = JSON.parse(await readFile(root + '/package.json', 'utf8')) as { version: string }
const output = resolve(`dist/skland-xml-${manifest.version}.vsix`)
await mkdir(resolve('dist'), { recursive: true })
const staging = await mkdtemp(join(tmpdir(), 'skland-xml-vsix-'))
try {
  await Promise.all(
    ['package.json', 'README.md', 'language-configuration.json', 'xml.tmLanguage.json', 'dist'].map(
      (file) => cp(join(root, file), join(staging, file), { recursive: true }),
    ),
  )
  await cp('LICENSE', join(staging, 'LICENSE'))
  await cp(join(root, '.vscodeignore'), join(staging, '.vscodeignore'))
  await rm(join(staging, 'dist', 'LICENSE'), { force: true })
  const cli = resolve('node_modules/@vscode/vsce/vsce')
  const result = spawnSync(
    process.execPath,
    [cli, 'package', '--no-dependencies', '--out', output],
    { cwd: staging, stdio: 'inherit' },
  )
  if (result.status !== 0) process.exitCode = result.status ?? 1
} finally {
  await rm(staging, { recursive: true, force: true })
}
