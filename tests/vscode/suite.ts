import assert from 'node:assert/strict'
import * as vscode from 'vscode'

async function until<T>(probe: () => T | undefined): Promise<T> {
  for (let i = 0; i < 120; i++) {
    const value = probe()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Timed out waiting for VS Code language diagnostics')
}

export async function run(): Promise<void> {
  const path = process.env.XML_LSP_VSCODE_FIXTURE
  assert(path)
  const extension = vscode.extensions.getExtension('EIHRTeam.skland-xml')
  assert(extension)
  const plain = await vscode.workspace.openTextDocument({
    language: 'xml',
    content: '<sklandDocument/>',
  })
  assert.equal(plain.languageId, 'xml')
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path))
  assert.equal(document.languageId, 'skland-xml')
  const editor = await vscode.window.showTextDocument(document)
  await extension.activate()
  await until(() =>
    vscode.languages
      .getDiagnostics(document.uri)
      .find((item) => item.code === 'invalid-attribute-value'),
  )
  assert.equal(
    vscode.languages
      .getDiagnostics(plain.uri)
      .filter((item) => item.source?.startsWith('skland-xml')).length,
    0,
  )

  const offset = document.getText().indexOf('unknown')
  const position = document.positionAt(offset)
  const completion = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    document.uri,
    position,
  )
  assert(completion?.items.some((item) => item.label === 'f_red'))
  const hover = await vscode.commands.executeCommand<vscode.Hover[]>(
    'vscode.executeHoverProvider',
    document.uri,
    position,
  )
  assert(
    hover?.some((item) =>
      item.contents.some(
        (content) => typeof content !== 'string' && content.value.includes('ColorValue'),
      ),
    ),
  )
  const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
    'vscode.executeFormatDocumentProvider',
    document.uri,
    { tabSize: 2, insertSpaces: true },
  )
  assert.equal(edits?.length ?? 0, 0)

  const range = new vscode.Range(position, document.positionAt(offset + 'unknown'.length))
  assert(await editor.edit((builder) => builder.replace(range, 'f_red')))
  await until(() => (vscode.languages.getDiagnostics(document.uri).length === 0 ? true : undefined))
  const formatted = await vscode.commands.executeCommand<vscode.TextEdit[]>(
    'vscode.executeFormatDocumentProvider',
    document.uri,
    { tabSize: 2, insertSpaces: true },
  )
  assert(formatted && formatted.length > 3)
  const selection = new vscode.Range(
    document.positionAt(document.getText().indexOf('<metainfo>')),
    document.positionAt(document.getText().indexOf('</metainfo>') + '</metainfo>'.length),
  )
  const ranged = await vscode.commands.executeCommand<vscode.TextEdit[]>(
    'vscode.executeFormatRangeProvider',
    document.uri,
    selection,
    { tabSize: 2, insertSpaces: true },
  )
  assert(ranged?.length)
  assert(ranged.every((item) => selection.contains(item.range)))

  async function editDescription(text: string): Promise<void> {
    const source = document.getText()
    const body = new vscode.Range(
      document.positionAt(source.indexOf('<description>') + '<description>'.length),
      document.positionAt(source.indexOf('</description>')),
    )
    assert(await editor.edit((builder) => builder.replace(body, text)))
  }
  await editDescription('\n<b>\ntext\n</b>\n<a href="https://example.test/wiki">link</a>\n')
  const outline = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    'vscode.executeDocumentSymbolProvider',
    document.uri,
  )
  assert(outline?.some((item) => item.children?.some((child) => child.name === 'description')))
  const folding = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
    'vscode.executeFoldingRangeProvider',
    document.uri,
  )
  assert(folding && folding.length > 1)
  const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>(
    'vscode.executeLinkProvider',
    document.uri,
  )
  assert(links?.some((item) => item.target?.toString() === 'https://example.test/wiki'))

  await editDescription('<b>text</i>')
  const mismatch = await until(() =>
    vscode.languages
      .getDiagnostics(document.uri)
      .find((item) => item.code === 'mismatched-close-tag'),
  )
  const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
    'vscode.executeCodeActionProvider',
    document.uri,
    mismatch.range,
    vscode.CodeActionKind.QuickFix.value,
  )
  assert(actions?.some((action) => action.title === 'Change closing tag to </b>'))

  const plainMode = await vscode.languages.setTextDocumentLanguage(document, 'xml')
  assert.equal(plainMode.languageId, 'xml')
  await until(() => (vscode.languages.getDiagnostics(document.uri).length === 0 ? true : undefined))
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
  assert(
    !vscode.window.visibleTextEditors.some(
      (item) => item.document.uri.toString() === document.uri.toString(),
    ),
  )
  process.stdout.write(
    'Verified VS Code Desktop diagnostics, completion, hover, formatting, outline, folding, links, quick fixes, and closing.\n',
  )
}
