import {
  CodeActionKind,
  DiagnosticSeverity,
  SymbolKind,
  TextEdit,
  type CodeAction,
  type Diagnostic,
  type DocumentLink,
  type DocumentSymbol,
  type FoldingRange,
  type FormattingOptions,
  type Position,
  type Range,
} from 'vscode-languageserver-types'
import type { DocumentState } from './document.js'
import { decodeXml, hasText, type Issue, type Span, type XmlElement } from './parser.js'
import { chooseDeclaration, getType } from './validation.js'

export function toDiagnostic(document: DocumentState, issue: Issue): Diagnostic {
  return {
    range: document.range(issue.span),
    message: issue.message,
    code: issue.code,
    source: 'skland-xml/' + issue.source,
    severity: issue.severity ?? DiagnosticSeverity.Error,
    ...(issue.related && {
      relatedInformation: [
        {
          location: { uri: document.uri, range: document.range(issue.related.span) },
          message: issue.related.message,
        },
      ],
    }),
  }
}

function intersects(a: Span, b: Span): boolean {
  return a.from <= b.to && b.from <= a.to
}

function offsets(document: DocumentState, range: Range): Span {
  return { from: document.offset(range.start), to: document.offset(range.end) }
}

export function formatting(
  document: DocumentState,
  options: FormattingOptions,
  range?: Range,
): TextEdit[] {
  if (document.issues.some((item) => item.source !== 'semantic')) return []
  const { text } = document
  const eol = /\r\n|[\r\n]/.exec(text)?.[0] ?? '\n'
  const tabSize = Math.min(16, Math.max(1, options.tabSize || 1))
  const indentation = options.insertSpaces ? ' '.repeat(tabSize) : '\t'
  const edits: TextEdit[] = []
  const selection = range && offsets(document, range)
  function gap(from: number, to: number, depth: number): void {
    if (
      selection &&
      (from < selection.from ||
        to > selection.to ||
        (from === to && (from === selection.from || to === selection.to)))
    )
      return
    const original = text.slice(from, to)
    if (hasText(original)) return
    const desired = eol + indentation.repeat(depth)
    if (original === desired) return
    let prefix = 0
    let suffix = 0
    while (prefix < original.length && original[prefix] === desired[prefix]) prefix++
    while (
      suffix < Math.min(original.length, desired.length) - prefix &&
      original[original.length - suffix - 1] === desired[desired.length - suffix - 1]
    )
      suffix++
    // A TextEdit cannot split the two code units of CRLF across LSP positions.
    if (prefix > 0 && original.slice(prefix - 1, prefix + 1) === '\r\n') prefix--
    if (
      suffix > 0 &&
      original.slice(original.length - suffix - 1, original.length - suffix + 1) === '\r\n'
    )
      suffix--
    edits.push(
      TextEdit.replace(
        document.range({ from: from + prefix, to: to - suffix }),
        desired.slice(prefix, desired.length - suffix),
      ),
    )
  }

  function visit(element: XmlElement, depth: number): void {
    const declaration = chooseDeclaration(element)
    const type = declaration && getType(declaration.type)
    // Converter mixed content has boundary whitespace rules. Preserve the whole subtree.
    if (!type || type.mixed || type.text || element.preserveSpace || !element.close?.complete)
      return
    const tokens = [
      ...element.children.map((child) => child.span),
      ...element.content.filter((item) => item.kind !== 'Text').map((item) => item.span),
    ].sort((left, right) => left.from - right.from)
    if (tokens.length) {
      let from = element.open.to
      for (const token of tokens) {
        gap(from, token.from, depth + 1)
        from = token.to
      }
      gap(from, element.close.span.from, depth)
    }
    for (const child of element.children) visit(child, depth + 1)
  }
  for (const root of document.analysis.roots) visit(root, 0)
  return edits.sort(
    (left, right) => document.offset(left.range.start) - document.offset(right.range.start),
  )
}

export function symbols(document: DocumentState): DocumentSymbol[] {
  function visit(element: XmlElement): DocumentSymbol[] {
    if (!element.name.name) return []
    const label = element.attributes.find((attr) => attr.name.name === 'name')?.decoded
    const { name } = element.name
    return [
      {
        name: label ? `${name} · ${label}` : name,
        kind: SymbolKind.Object,
        range: document.range(element.span),
        selectionRange: document.range(element.name),
        children: element.children.flatMap(visit),
      },
    ]
  }
  return document.analysis.roots.flatMap(visit)
}

export function folding(document: DocumentState, lineOnly: boolean): FoldingRange[] {
  const result: FoldingRange[] = []
  function add(span: Span, kind?: 'comment'): void {
    const start = document.position(span.from)
    const end = document.position(span.to)
    const endLine = lineOnly && !kind ? end.line - 1 : end.line
    if (endLine <= start.line) return
    result.push({
      startLine: start.line,
      endLine,
      ...(!lineOnly && { startCharacter: start.character, endCharacter: end.character }),
      ...(kind && { kind }),
    })
  }
  for (const element of document.elements) {
    if (element.close?.complete) add({ from: element.open.to, to: element.close.span.from })
    for (const item of element.content) if (item.kind === 'Comment') add(item.span, 'comment')
  }
  return result.sort(
    (left, right) => left.startLine - right.startLine || right.endLine - left.endLine,
  )
}

export interface LinkedEditingRanges {
  ranges: Range[]
  wordPattern?: string
}

export function linkedEditing(
  document: DocumentState,
  position: Position,
): LinkedEditingRanges | null {
  const offset = document.offset(position)
  const element = document.elementAt(offset, true)
  const close = element?.close
  if (!element?.name.name || !close?.complete) return null
  if (
    intersects(element.name, { from: offset, to: offset }) ||
    intersects(close.name, { from: offset, to: offset })
  ) {
    return { ranges: [document.range(element.name), document.range(close.name)] }
  }
  return null
}

function linkTarget(value: string): string | undefined {
  // oxlint-disable-next-line eslint/no-control-regex -- Reject raw controls before parsing the URL
  if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020]/.test(value)) return
  try {
    const url = new URL(value)
    if (!url.username && !url.password) return url.href
  } catch {
    return undefined
  }
}

export function documentLinks(document: DocumentState): DocumentLink[] {
  const result: DocumentLink[] = []
  for (const element of document.elements) {
    const declaration = chooseDeclaration(element)
    if (!declaration) continue
    for (const attr of element.attributes) {
      if (!['href', 'src'].includes(attr.name.name) || !attr.closed || !attr.value) continue
      const target = linkTarget(attr.decoded ?? '')
      if (target) result.push({ target, range: document.range(attr.value) })
    }
    if (!['url', 'imgUrl', 'cover'].includes(element.name.name) || !element.close?.complete)
      continue
    const range = { from: element.open.to, to: element.close.span.from }
    const raw = document.text.slice(range.from, range.to)
    const value = raw.trim()
    const target = linkTarget(decodeXml(value))
    if (target && !/[<>]/.test(value)) {
      const start = range.from + raw.indexOf(value)
      result.push({ target, range: document.range({ from: start, to: start + value.length }) })
    }
  }
  return result
}

export function codeActions(
  document: DocumentState,
  range: Range,
  diagnostics: readonly Diagnostic[],
): CodeAction[] {
  const selected = offsets(document, range)
  const result: CodeAction[] = []
  for (const issue of document.issues) {
    if (!issue.fix || !intersects(selected, issue.span)) continue
    const actual = toDiagnostic(document, issue)
    const candidate = diagnostics.find(
      (item) =>
        item.source === actual.source &&
        item.code === actual.code &&
        offsets(document, item.range).from === issue.span.from &&
        offsets(document, item.range).to === issue.span.to,
    )
    if (!candidate) continue
    const action: CodeAction = {
      title: issue.fix.title,
      kind: CodeActionKind.QuickFix,
      diagnostics: [actual],
      edit: {
        documentChanges: [
          {
            textDocument: { uri: document.uri, version: document.version },
            edits: [TextEdit.replace(document.range(issue.fix.span), issue.fix.text)],
          },
        ],
      },
    }
    result.push(action)
  }
  return result
}
