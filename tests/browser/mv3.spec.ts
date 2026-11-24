import { chromium, expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { copyFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { exerciseEditor, trackErrors } from './editor-flow.ts'

const extension = resolve('examples/dist/chromium-extension')
// An unpacked manifest without a key gets its ID from the normalized absolute path.
const id = createHash('sha256')
  .update(extension)
  .digest('hex')
  .slice(0, 32)
  .replace(/./g, (digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))

const origin = 'chrome-extension://' + id
for (const editor of ['monaco', 'ace'] as const) {
  test(`MV3 ${editor} runs offline under the default CSP and releases page workers`, async ({
    browserName,
  }, info) => {
    expect(browserName).toBe('chromium')
    const profile = await mkdtemp(join(tmpdir(), 'skland-xml-mv3-'))
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
    })
    try {
      const network: string[] = []
      await context.setOffline(true)
      context.on('request', (request) => {
        if (/^https?:/.test(request.url())) network.push(request.url())
      })
      await context.addInitScript(() => {
        const create = URL.createObjectURL.bind(URL)
        URL.createObjectURL = (item: Blob | MediaSource) => {
          if (item instanceof Blob && /(?:java|ecma)script/i.test(item.type))
            throw new Error('Generated script Blob')
          return create(item)
        }
      })
      const page = await context.newPage()
      const errors = trackErrors(page)
      const loading = page.waitForEvent('worker', {
        predicate: (worker) => worker.url().endsWith('/xml-worker.js'),
      })
      await page.goto(`${origin}/${editor}/index.html`)
      await expect(page.getByRole('status')).toHaveText('语言服务已连接')
      const worker = await loading
      expect(
        await worker.evaluate(() => ({ parser: typeof DOMParser, isolated: crossOriginIsolated })),
      ).toEqual({ parser: 'undefined', isolated: false })
      expect(page.url()).toBe(`${origin}/${editor}/index.html`)
      await exerciseEditor(page, editor)
      expect(errors).toEqual([])
      expect(network).toEqual([])
      await page.screenshot({ path: info.outputPath('extension.png') })
      const closed = worker.waitForEvent('close')
      await page.close()
      await closed
    } finally {
      await context.close()
      await rm(profile, { recursive: true, force: true })
    }
  })
}

test('MV3 content scripts can host an extension-origin editor', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'skland-xml-mv3-probe-'))
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined
  try {
    const unpacked = join(directory, 'extension')
    await cp(extension, unpacked, { recursive: true })
    const manifestPath = join(unpacked, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    const matches = ['http://127.0.0.1/*']
    manifest.content_scripts = [{ matches, js: ['integration-probe.js'] }]
    manifest.web_accessible_resources = [
      { matches, resources: ['ace/index.html', 'ace/xml-worker.js'] },
    ]
    await writeFile(manifestPath, JSON.stringify(manifest))
    await copyFile(
      'tests/browser/dist/integration-probe.iife.js',
      join(unpacked, 'integration-probe.js'),
    )
    context = await chromium.launchPersistentContext(join(directory, 'profile'), {
      channel: 'chromium',
      args: ['--disable-extensions-except=' + unpacked, '--load-extension=' + unpacked],
    })
    const page = await context.newPage()
    const port = Number(process.env.XML_LSP_EXAMPLE_PORT ?? 4173)
    await page.goto(`http://127.0.0.1:${port}/`)
    await expect(page.locator('#skland-direct-worker-probe')).toHaveText('SecurityError')
    const frame = page.frameLocator('iframe[title="Extension-origin SKLand editor"]')
    await expect(frame.getByRole('status')).toHaveText('语言服务已连接')
    const frameUrl = page
      .frames()
      .find((candidate) => candidate.url().endsWith('/ace/index.html'))
      ?.url()
    expect(frameUrl).toMatch(/^chrome-extension:\/\//)
  } finally {
    await context?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
