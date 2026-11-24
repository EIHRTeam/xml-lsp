import { TreeFragment, type Tree } from '@lezer/common'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { Range, type Position } from 'vscode-languageserver-types'
import {
  collectElements,
  parseTree,
  readTree,
  type Issue,
  type Span,
  type XmlElement,
  type XmlTree,
} from './parser.js'
import { validate } from './validation.js'

export interface XmlDocument {
  uri: string
  text: string
  version: number
}

export type TextChange = { range?: Range; text: string }

export class DocumentState {
  private readonly document: TextDocument
  private fragments: readonly TreeFragment[] = []
  private syntaxTree?: Tree
  private projection?: XmlTree
  private cachedElements?: XmlElement[]
  private cachedIssues?: Issue[]

  constructor({ uri, version, text }: XmlDocument) {
    this.document = TextDocument.create(uri, 'skland-xml', version, text)
  }

  get version(): number {
    return this.document.version
  }
  get text(): string {
    return this.document.getText()
  }
  get uri(): string {
    return this.document.uri
  }

  update(version: number, changes: readonly TextChange[]): boolean {
    if (version <= this.version) return false
    if (this.syntaxTree) this.fragments = TreeFragment.addTree(this.syntaxTree, this.fragments)
    for (const change of changes) {
      if (change.range) {
        const from = this.offset(change.range.start)
        const to = Math.max(from, this.offset(change.range.end))
        this.fragments = TreeFragment.applyChanges(this.fragments, [
          { fromA: from, toA: to, fromB: from, toB: from + change.text.length },
        ])
        TextDocument.update(this.document, [{ range: change.range, text: change.text }], version)
      } else {
        this.fragments = []
        TextDocument.update(this.document, [{ text: change.text }], version)
      }
    }
    if (!changes.length) TextDocument.update(this.document, [], version)
    this.syntaxTree = undefined
    this.projection = undefined
    this.cachedElements = undefined
    this.cachedIssues = undefined
    return true
  }

  get analysis(): XmlTree {
    if (!this.projection) {
      this.syntaxTree = parseTree(this.text, this.fragments)
      this.fragments = []
      this.projection = readTree(this.text, this.syntaxTree)
    }
    return this.projection
  }

  get elements(): XmlElement[] {
    return (this.cachedElements ??= collectElements(this.analysis.roots))
  }

  get issues(): Issue[] {
    return (this.cachedIssues ??= validate(this.text, this.analysis, () => this.elements))
  }

  offset(position: Position): number {
    return this.document.offsetAt(position)
  }

  position(offset: number): Position {
    return this.document.positionAt(offset)
  }

  range(span: Span): Range {
    return Range.create(this.position(span.from), this.position(span.to))
  }

  elementAt(offset: number, inclusiveEnd = false): XmlElement | undefined {
    let selected: XmlElement | undefined
    let candidates = this.analysis.roots
    while (candidates.length) {
      let low = 0
      let high = candidates.length - 1
      while (low <= high) {
        const middle = (low + high) >>> 1
        if (candidates[middle]!.span.from <= offset) low = middle + 1
        else high = middle - 1
      }
      const candidate = candidates[high]
      if (!candidate || (inclusiveEnd ? candidate.span.to < offset : candidate.span.to <= offset))
        break
      selected = candidate
      candidates = candidate.children
    }
    return selected
  }

  opaqueAt(offset: number): boolean {
    if (this.analysis.limited) return true
    for (
      let node = this.syntaxTree?.resolveInner(offset, -1);
      node;
      node = node.parent ?? undefined
    ) {
      if (['Comment', 'Cdata', 'ProcessingInst', 'DoctypeDecl'].includes(node.name)) {
        const end =
          node.name === 'Comment'
            ? '-->'
            : node.name === 'Cdata'
              ? ']]>'
              : node.name === 'ProcessingInst'
                ? '?>'
                : '>'
        return node.to > offset || this.text.slice(node.to - end.length, node.to) !== end
      }
    }
    return false
  }
}
