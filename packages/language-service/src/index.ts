import type {
  CodeAction,
  CompletionList,
  Diagnostic,
  DocumentLink,
  DocumentSymbol,
  FoldingRange,
  FormattingOptions,
  Hover,
  Position,
  Range,
  TextEdit,
} from 'vscode-languageserver-types'
import { DocumentState, type TextChange, type XmlDocument } from './document.js'
import {
  codeActions,
  documentLinks,
  folding,
  formatting,
  linkedEditing,
  symbols,
  toDiagnostic,
  type LinkedEditingRanges,
} from './edits.js'
import { completion, hover, type CompletionOptions } from './intelligence.js'
import { schema } from './schema.generated.js'

export type { TextChange, XmlDocument, CompletionOptions, LinkedEditingRanges }
export const schemaInfo: Readonly<Pick<typeof schema, 'version' | 'hash' | 'source'>> =
  Object.freeze({
    version: schema.version,
    hash: schema.hash,
    source: schema.source,
  })

export interface XmlLanguageService {
  openDocument(document: XmlDocument): boolean
  updateDocument(uri: string, version: number, changes: readonly TextChange[]): boolean
  closeDocument(uri: string): boolean
  getVersion(uri: string): number | undefined
  diagnostics(uri: string): Diagnostic[]
  completion(uri: string, position: Position, options?: CompletionOptions): CompletionList
  hover(uri: string, position: Position, options?: CompletionOptions): Hover | null
  formatting(uri: string, options: FormattingOptions, range?: Range): TextEdit[]
  documentSymbols(uri: string): DocumentSymbol[]
  foldingRanges(uri: string, lineOnly?: boolean): FoldingRange[]
  linkedEditing(uri: string, position: Position): LinkedEditingRanges | null
  documentLinks(uri: string): DocumentLink[]
  codeActions(uri: string, range: Range, diagnostics: readonly Diagnostic[]): CodeAction[]
  dispose(): void
}

export function createXmlLanguageService(): XmlLanguageService {
  const documents = new Map<string, DocumentState>()
  return {
    openDocument(document) {
      if (documents.has(document.uri)) return false
      documents.set(document.uri, new DocumentState(document))
      return true
    },
    updateDocument: (uri, version, changes) =>
      documents.get(uri)?.update(version, changes) ?? false,
    closeDocument: (uri) => documents.delete(uri),
    getVersion: (uri) => documents.get(uri)?.version,
    diagnostics(uri) {
      const document = documents.get(uri)
      return document ? document.issues.map((issue) => toDiagnostic(document, issue)) : []
    },
    completion(uri, position, options = {}) {
      const document = documents.get(uri)
      return document ? completion(document, position, options) : { isIncomplete: false, items: [] }
    },
    hover(uri, position, options = {}) {
      const document = documents.get(uri)
      return document ? hover(document, position, options) : null
    },
    formatting(uri, options, range) {
      const document = documents.get(uri)
      return document ? formatting(document, options, range) : []
    },
    documentSymbols(uri) {
      const document = documents.get(uri)
      return document ? symbols(document) : []
    },
    foldingRanges(uri, lineOnly = false) {
      const document = documents.get(uri)
      return document ? folding(document, lineOnly) : []
    },
    linkedEditing(uri, position) {
      const document = documents.get(uri)
      return document ? linkedEditing(document, position) : null
    },
    documentLinks(uri) {
      const document = documents.get(uri)
      return document ? documentLinks(document) : []
    },
    codeActions(uri, range, diagnostics) {
      const document = documents.get(uri)
      return document ? codeActions(document, range, diagnostics) : []
    },
    dispose: () => documents.clear(),
  }
}
