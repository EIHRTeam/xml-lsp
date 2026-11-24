import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runTests } from '@vscode/test-electron'
import { invalidDocument } from '../fixtures/documents.ts'

const profile = await mkdtemp(join(tmpdir(), 'skland-xml-vscode-'))
const file = join(profile, 'integration.skland.xml')
const macExecutable = ['Code', 'Electron']
  .map((name) => '/Applications/Visual Studio Code.app/Contents/MacOS/' + name)
  .find(existsSync)
const executable =
  process.env.XML_LSP_VSCODE_EXECUTABLE_PATH ??
  (process.platform === 'darwin' ? macExecutable : undefined)

try {
  await writeFile(file, invalidDocument)
  await runTests({
    vscodeExecutablePath: executable,
    version: executable ? undefined : 'stable',
    extensionDevelopmentPath: resolve('extensions/vscode'),
    extensionTestsPath: resolve('tests/vscode/dist/suite.cjs'),
    extensionTestsEnv: { XML_LSP_VSCODE_FIXTURE: file },
    launchArgs: [
      '--user-data-dir',
      join(profile, 'user'),
      '--extensions-dir',
      join(profile, 'extensions'),
      '--disable-extension',
      'GitHub.copilot-chat',
      '--disable-extension',
      'GitHub.copilot',
    ],
  })
} finally {
  await rm(profile, { recursive: true, force: true, maxRetries: 4 })
}
