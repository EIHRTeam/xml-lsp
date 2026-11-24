import { expect, test } from '@playwright/test'
import { exerciseEditor, trackErrors } from './editor-flow.ts'

for (const editor of ['monaco', 'ace'] as const) {
  test(`${editor} exercises the browser LSP through its editor UI`, async ({ page }, info) => {
    const errors = trackErrors(page)
    await page.goto('/' + editor + '/')
    await exerciseEditor(page, editor)
    await page.screenshot({ path: info.outputPath('editor.png') })
    expect(errors).toEqual([])
  })
}
