import type * as Monaco from 'monaco-editor'
import { connectBrowserClient, type BrowserDocument } from '@eihrteam/xml-browser-client'
import {
  CompletionItemKind,
  DiagnosticSeverity,
  InsertTextFormat,
  type Diagnostic,
  type DocumentSymbol,
  type Position,
  type Range,
} from 'vscode-languageserver-types'

export interface MonacoClient {
  attachModel(model: Monaco.editor.ITextModel): Monaco.IDisposable
  dispose(): Promise<void>
}

const owner = 'skland-xml'
const toPosition = (position: Monaco.IPosition): Position => ({
  line: position.lineNumber - 1,
  character: position.column - 1,
})
const toRange = (range: Monaco.IRange): Range => ({
  start: toPosition({ lineNumber: range.startLineNumber, column: range.startColumn }),
  end: toPosition({ lineNumber: range.endLineNumber, column: range.endColumn }),
})
const fromRange = ({ start, end }: Range): Monaco.IRange => ({
  startLineNumber: start.line + 1,
  startColumn: start.character + 1,
  endLineNumber: end.line + 1,
  endColumn: end.character + 1,
})
const escapeMarkdown = (text: string): string => text.replace(/[\\`*_[\]<>#]/g, '\\$&')

/** One initialized Worker session supports any number of explicitly attached Monaco models. */
export async function createMonacoClient(
  monaco: typeof Monaco,
  worker: Worker,
  languageId = owner,
): Promise<MonacoClient> {
  const client = await connectBrowserClient(worker, { snippets: true, markdown: true })
  const models = new Map<
    Monaco.editor.ITextModel,
    { document: BrowserDocument; dispose(): void; diagnostics: Diagnostic[] }
  >()
  const providers: Monaco.IDisposable[] = []
  const document = (model: Monaco.editor.ITextModel) => models.get(model)?.document
  function convertSymbol(item: DocumentSymbol): Monaco.languages.DocumentSymbol {
    return {
      name: item.name,
      detail: item.detail ?? '',
      kind: monaco.languages.SymbolKind.Object,
      range: fromRange(item.range),
      selectionRange: fromRange(item.selectionRange),
      tags: [],
      children: item.children?.map(convertSymbol),
    }
  }
  const marker = (entry: Diagnostic): Monaco.editor.IMarkerData => ({
    ...fromRange(entry.range),
    message: entry.message,
    code: entry.code?.toString(),
    source: entry.source,
    severity:
      entry.severity === DiagnosticSeverity.Warning
        ? monaco.MarkerSeverity.Warning
        : entry.severity === DiagnosticSeverity.Hint
          ? monaco.MarkerSeverity.Hint
          : entry.severity === DiagnosticSeverity.Information
            ? monaco.MarkerSeverity.Info
            : monaco.MarkerSeverity.Error,
    relatedInformation: entry.relatedInformation?.map((item) => ({
      ...fromRange(item.location.range),
      resource: monaco.Uri.parse(item.location.uri),
      message: item.message,
    })),
  })
  providers.push(
    monaco.languages.registerCompletionItemProvider(languageId, {
      triggerCharacters: ['<', '/', ' ', '=', '"', "'"],
      async provideCompletionItems(model, position, _context, token) {
        const response = await document(model)?.completion(toPosition(position), token)
        const fallback = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column,
          endColumn: position.column,
        }
        return {
          incomplete: response?.isIncomplete ?? false,
          suggestions:
            response?.items.map((item) => {
              const edit = item.textEdit
              return {
                label: item.label,
                kind:
                  item.kind === CompletionItemKind.Field
                    ? monaco.languages.CompletionItemKind.Field
                    : item.kind === CompletionItemKind.Value
                      ? monaco.languages.CompletionItemKind.Value
                      : monaco.languages.CompletionItemKind.Property,
                insertText: edit?.newText ?? item.insertText ?? item.label,
                insertTextRules:
                  item.insertTextFormat === InsertTextFormat.Snippet
                    ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                    : undefined,
                range: edit && 'range' in edit ? fromRange(edit.range) : fallback,
                documentation:
                  typeof item.documentation === 'string'
                    ? item.documentation
                    : item.documentation?.value,
              }
            }) ?? [],
        }
      },
    }),
    monaco.languages.registerHoverProvider(languageId, {
      async provideHover(model, position, token) {
        const response = await document(model)?.hover(toPosition(position), token)
        if (!response) return null
        const contents = (
          Array.isArray(response.contents) ? response.contents : [response.contents]
        ).map((item) => ({
          value:
            typeof item === 'string'
              ? escapeMarkdown(item)
              : 'kind' in item && item.kind === 'plaintext'
                ? escapeMarkdown(item.value)
                : item.value,
        }))
        return { contents, range: response.range && fromRange(response.range) }
      },
    }),
    monaco.languages.registerDocumentFormattingEditProvider(languageId, {
      async provideDocumentFormattingEdits(model, options, token) {
        return (
          await document(model)?.formatting(
            { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
            undefined,
            token,
          )
        )?.map((item) => ({ range: fromRange(item.range), text: item.newText }))
      },
    }),
    monaco.languages.registerDocumentRangeFormattingEditProvider(languageId, {
      async provideDocumentRangeFormattingEdits(model, range, options, token) {
        return (
          await document(model)?.formatting(
            { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
            toRange(range),
            token,
          )
        )?.map((item) => ({ range: fromRange(item.range), text: item.newText }))
      },
    }),
    monaco.languages.registerDocumentSymbolProvider(languageId, {
      async provideDocumentSymbols(model, token) {
        return (await document(model)?.symbols(token))?.map(convertSymbol)
      },
    }),
    monaco.languages.registerFoldingRangeProvider(languageId, {
      async provideFoldingRanges(model, _context, token) {
        return (await document(model)?.folding(token))?.map((item) => ({
          start: item.startLine + 1,
          end: item.endLine + 1,
          kind: item.kind === 'comment' ? monaco.languages.FoldingRangeKind.Comment : undefined,
        }))
      },
    }),
    monaco.languages.registerLinkedEditingRangeProvider(languageId, {
      async provideLinkedEditingRanges(model, position, token) {
        const result = await document(model)?.linkedEditing(toPosition(position), token)
        return result ? { ranges: result.ranges.map(fromRange) } : null
      },
    }),
    monaco.languages.registerLinkProvider(languageId, {
      async provideLinks(model, token) {
        const items = await document(model)?.links(token)
        return items
          ? { links: items.map((item) => ({ range: fromRange(item.range), url: item.target })) }
          : null
      },
    }),
    monaco.languages.registerCodeActionProvider(
      languageId,
      {
        async provideCodeActions(model, range, context, token) {
          const state = models.get(model)
          const actions =
            !context.only || context.only === 'quickfix'
              ? await state?.document.codeActions(toRange(range), state.diagnostics, token)
              : []
          const result = actions?.flatMap((action): Monaco.languages.CodeAction[] => {
            const change = action.edit?.documentChanges?.[0]
            if (!change || !('edits' in change) || change.textDocument.uri !== model.uri.toString())
              return []
            return [
              {
                title: action.title,
                kind: action.kind,
                diagnostics: action.diagnostics?.map(marker),
                edit: {
                  edits: change.edits.map((edit) => ({
                    resource: model.uri,
                    textEdit: { range: fromRange(edit.range), text: edit.newText },
                    versionId: model.getVersionId(),
                  })),
                },
              },
            ]
          })
          return { actions: result ?? [], dispose() {} }
        },
      },
      { providedCodeActionKinds: ['quickfix'] },
    ),
  )

  let disposed = false
  return {
    attachModel(model) {
      if (disposed) throw new Error('The SKLand XML Monaco client is closed')
      if (model.getLanguageId() !== languageId)
        throw new Error('Set the model language to ' + languageId + ' before attaching')
      if (models.has(model)) throw new Error('This Monaco model is already attached')
      const document = client.open(model.uri.toString(), model.getValue(), (diagnostics) => {
        const state = models.get(model)
        if (state) state.diagnostics = diagnostics
        if (!model.isDisposed())
          monaco.editor.setModelMarkers(model, owner, diagnostics.map(marker))
      })
      const content = model.onDidChangeContent((event) => {
        document.change(
          event.isEolChange || event.isFlush
            ? [{ text: model.getValue() }]
            : event.changes.map((change) => ({ range: toRange(change.range), text: change.text })),
        )
      })
      const detach = () => {
        if (!models.delete(model)) return
        content.dispose()
        willDispose.dispose()
        languageChange.dispose()
        document.close()
      }
      const willDispose = model.onWillDispose(detach)
      const languageChange = model.onDidChangeLanguage((event) => {
        if (event.newLanguage !== languageId) detach()
      })
      const state = { document, diagnostics: [], dispose: detach }
      models.set(model, state)
      return state
    },
    async dispose() {
      disposed = true
      for (const state of models.values()) state.dispose()
      for (const provider of providers.splice(0)) provider.dispose()
      await client.dispose()
    },
  }
}
