import { expect, type Page } from '@playwright/test'

export function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' || /content security policy/i.test(message.text()))
      errors.push(message.text())
  })
  return errors
}

export async function exerciseEditor(page: Page, editor: 'monaco' | 'ace'): Promise<void> {
  const title = editor === 'monaco' ? 'Monaco' : 'Ace'
  await expect(page).toHaveTitle('SKLand Wiki XML · ' + title)
  await expect(page.getByRole('heading', { name: 'SKLand Wiki XML ' + title })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('语言服务已连接')
  const input =
    editor === 'monaco'
      ? page.locator('.monaco-editor [role="textbox"]').first()
      : page.getByRole('main').locator('.ace_text-input')
  async function paste(text: string) {
    await input.focus()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
    await input.evaluate((element, source) => {
      const data = new DataTransfer()
      data.setData('text/plain', source)
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      )
    }, text)
  }
  await paste(
    '<sklandDocument><itemId>1</itemId><metainfo><name>X</name><cover/><subTypes/></metainfo>\n<description><color value="unknown">red</color></description>\n</sklandDocument>',
  )
  await expect(page.getByRole('status')).toHaveText('1 条诊断')
  const editorRegion = page.getByRole('main')
  const candidate = editorRegion
    .locator(editor === 'monaco' ? '.view-line span' : '.ace_text-layer span')
    .filter({ hasText: /^color$/ })
    .first()
  await candidate.hover({ timeout: 5000, force: editor === 'ace' })
  await expect(page.getByText(/ColorContent/).last()).toBeVisible()
  // Exercise the actual candidate UI while replacing a partial enum value.
  await page.keyboard.press('Escape')
  await paste(
    '<sklandDocument><itemId>1</itemId><metainfo><name>X</name><cover/><subTypes/></metainfo>\n<description><color value="f_r',
  )
  await page.keyboard.press('Control+Space')
  const suggestion =
    editor === 'monaco'
      ? page.locator('.suggest-widget').getByText('f_red', { exact: true }).first()
      : page.getByRole('menuitem', { name: 'f_red, SKLand XML' })
  await expect(suggestion).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(editorRegion).toContainText('f_red"')

  await paste(
    '<sklandDocument><itemId>1</itemId><metainfo><name>X</name><cover/><subTypes/></metainfo><description/></sklandDocument>',
  )
  await expect(page.getByRole('status')).toHaveText('语言服务已连接')
  await page.getByRole('button', { name: '格式化' }).click()
  await expect
    .poll(() =>
      editor === 'monaco'
        ? page.locator('.monaco-editor .view-line').count()
        : page.locator('.ace_text-layer .ace_line').count(),
    )
    .toBeGreaterThan(3)
}
