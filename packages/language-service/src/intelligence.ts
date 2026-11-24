import {
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
  TextEdit,
  type CompletionItem,
  type CompletionList,
  type Hover,
  type Position,
} from 'vscode-languageserver-types'
import type { DocumentState } from './document.js'
import type { Span, XmlElement } from './parser.js'
import { schema } from './schema.generated.js'
import type { AttributeDeclaration, ElementDeclaration } from './schema-model.js'
import {
  attributeValues,
  chooseDeclaration,
  contentModel,
  getSimpleType,
  getType,
} from './validation.js'

export interface CompletionOptions {
  snippets?: boolean
  markdown?: boolean
}

function matches(span: Span, offset: number): boolean {
  return span.from <= offset && offset <= span.to
}

function childCandidates(
  parent: XmlElement | undefined,
  replacing: XmlElement | undefined,
  offset: number,
): ElementDeclaration[] {
  if (!parent) return schema.roots
  const decl = chooseDeclaration(parent)
  if (!decl) return []
  const model = contentModel(decl.type)
  let state = model.start
  const following: string[] = []
  for (const child of parent.children) {
    if (child === replacing || !child.name.name || child.namespace) continue
    if (child.span.from >= offset) {
      following.push(child.name.name)
      if (following.length > 128) break
    } else if (child.span.to <= offset) {
      const next = model.advance(state, child.name.name)
      if (next.length) state = next
    }
  }
  const results = model.candidates(state)
  if (following.length && following.length <= 128) {
    const compatible = results.filter((item) => {
      let next = model.advance(state, item.name)
      for (const name of following) {
        next = model.advance(next, name)
        if (!next.length) return false
      }
      return true
    })
    if (compatible.length) return compatible
    // A valid suffix already occupies these slots. An insertion that would break it is useless.
    let suffix = state
    for (const name of following) suffix = model.advance(suffix, name)
    if (suffix.length && model.accepts(suffix)) return []
  }
  return results
}

function createCompletion(
  document: DocumentState,
  span: Span,
  label: string,
  newText: string,
  kind: CompletionItemKind,
  docs?: string,
  snippet?: boolean,
): CompletionItem {
  return {
    label,
    kind,
    textEdit: TextEdit.replace(document.range(span), newText),
    ...(docs && { documentation: docs }),
    ...(snippet && { insertTextFormat: InsertTextFormat.Snippet }),
  }
}

function plainAttribute(attribute: AttributeDeclaration): string {
  return attribute.fixed ?? attribute.default ?? ''
}

function escapeValue(value: string, quote: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll(quote, quote === '"' ? '&quot;' : '&apos;')
}
const escapeSnippet = (value: string): string => value.replace(/[\\$}]/g, '\\$&')

export function completion(
  document: DocumentState,
  position: Position,
  options: CompletionOptions,
): CompletionList {
  const offset = document.offset(position)
  const { text } = document
  const items: CompletionItem[] = []
  const result: CompletionList = { isIncomplete: false, items }
  if (document.analysis.limited || document.opaqueAt(offset)) return result
  const current = document.elementAt(offset, true)
  const closingFragment = /<\/([\w.:-]*)$/.exec(text.slice(Math.max(0, offset - 256), offset))
  const close = current?.close
  if (closingFragment && !(current && offset < current.open.to) && !current?.selfClosing) {
    const from = offset - closingFragment[1]!.length
    let to = from
    while (to < text.length && /[\w.:-]/.test(text[to]!)) to++
    const between = text.slice(to, to + 256)
    const seen = new Set<string>()
    for (let element = current; element; element = element.parent) {
      const name = element.name.name
      if (!name || seen.has(name) || (element.close && element.close.span.from < from - 2)) continue
      seen.add(name)
      items.push(
        createCompletion(
          document,
          { from, to },
          name,
          name + (/^[\t\r\n ]*>/.test(between) ? '' : '>'),
          CompletionItemKind.Property,
        ),
      )
      // A closing tag with an existing matching suffix can only address this element.
      if (close?.span.from === from - 2 && close.complete) break
    }
    return result
  }

  const opening =
    current && matches(current.open, offset) && (!current.complete || offset < current.open.to)
  if (opening && current && (matches(current.name, offset) || !current.name.name)) {
    const existingAttrs = current.attributes.length > 0
    for (const decl of childCandidates(current.parent, current, current.span.from)) {
      const required =
        getType(decl.type)?.attributes.filter((attribute) => attribute.required) ?? []
      const snippet = options.snippets && !current.complete && !existingAttrs && required.length > 0
      const value = snippet
        ? decl.name +
          required
            .map(
              (attribute, i) =>
                ' ' +
                attribute.name +
                '="${' +
                (i + 1) +
                ':' +
                escapeSnippet(escapeValue(plainAttribute(attribute), '"')) +
                '}"',
            )
            .join('')
        : decl.name
      items.push(
        createCompletion(
          document,
          current.name,
          decl.name,
          value,
          CompletionItemKind.Property,
          decl.documentation,
          snippet,
        ),
      )
    }
    return result
  }

  if (opening && current) {
    const declaration = chooseDeclaration(current)
    const type = declaration && getType(declaration.type)
    if (!type) return result
    const currentAttr = current.attributes.find((attr) => matches(attr.span, offset))
    if (currentAttr?.equals !== undefined && offset >= currentAttr.equals) {
      if (currentAttr.closed && currentAttr.value && offset > currentAttr.value.to) return result
      const decl = type.attributes.find((item) => item.name === currentAttr.name.name)
      if (!decl) return result
      const span = currentAttr.value ?? { from: offset, to: offset }
      for (const value of attributeValues(decl)) {
        const quoted = escapeValue(value, currentAttr.quote ?? '"')
        const text = currentAttr.quote
          ? quoted + (currentAttr.closed ? '' : currentAttr.quote)
          : '"' + quoted + '"'
        items.push(
          createCompletion(
            document,
            span,
            value || '""',
            text,
            CompletionItemKind.Value,
            decl.documentation,
          ),
        )
      }
      return result
    }
    const span =
      currentAttr && matches(currentAttr.name, offset)
        ? currentAttr.name
        : { from: offset, to: offset }
    if (currentAttr && span !== currentAttr.name) return result
    for (const attr of type.attributes) {
      if (current.attributes.some((item) => item !== currentAttr && item.name.name === attr.name))
        continue
      const value = escapeValue(plainAttribute(attr), '"')
      const snippet = !!options.snippets && currentAttr?.equals === undefined
      const text =
        currentAttr?.equals !== undefined
          ? attr.name
          : snippet
            ? attr.name + '="${1:' + escapeSnippet(value) + '}"'
            : attr.name + '="' + value + '"'
      items.push(
        createCompletion(
          document,
          span,
          attr.name,
          text,
          CompletionItemKind.Field,
          attr.documentation,
          snippet,
        ),
      )
    }
    return result
  }

  if (current?.close && matches(current.close.span, offset)) return result
  const parent =
    current?.span.to === offset && (current.selfClosing || current.close?.complete)
      ? current.parent
      : current
  if (!parent && document.analysis.roots.some((root) => root.complete)) return result
  for (const decl of childCandidates(parent, undefined, offset)) {
    items.push(
      createCompletion(
        document,
        { from: offset, to: offset },
        decl.name,
        '<' + decl.name,
        CompletionItemKind.Property,
        decl.documentation,
      ),
    )
  }
  return result
}

export function hover(
  document: DocumentState,
  position: Position,
  options: CompletionOptions,
): Hover | null {
  const offset = document.offset(position)
  const element = document.elementAt(offset, true)
  if (!element) return null
  const declaration = chooseDeclaration(element)
  if (!declaration) return null
  const type = getType(declaration.type)
  const attr = element.attributes.find(
    (item) => matches(item.name, offset) || (item.value && matches(item.value, offset)),
  )
  const markdown = options.markdown !== false
  const code = (text: string) => (markdown ? '`' + text + '`' : text)
  const describeType = (name: string) => code(name.startsWith('#') ? 'anonymous type' : name)
  if (attr) {
    const declaration = type?.attributes.find((item) => item.name === attr.name.name)
    if (!declaration) return null
    const simple = getSimpleType(declaration.type)
    const lines = [
      code(declaration.name) +
        ' · ' +
        describeType(declaration.type) +
        (declaration.required ? ' · Required' : ''),
      declaration.documentation ?? simple.documentation,
      simple.values &&
        'Allowed values: ' + simple.values.map((item) => code(JSON.stringify(item))).join(', '),
      declaration.default !== undefined && 'Default: ' + code(JSON.stringify(declaration.default)),
      declaration.fixed !== undefined && 'Fixed: ' + code(JSON.stringify(declaration.fixed)),
      simple.minLength !== undefined && 'Minimum length: ' + simple.minLength,
    ]
    return {
      range: document.range(attr.value && matches(attr.value, offset) ? attr.value : attr.name),
      contents: {
        kind: markdown ? MarkupKind.Markdown : MarkupKind.PlainText,
        value: lines.filter(Boolean).join('\n\n'),
      },
    }
  }
  const name =
    element.close && matches(element.close.name, offset) ? element.close.name : element.name
  if (!matches(name, offset)) return null
  const children = [...contentModel(declaration.type).members.keys()]
  const required = type?.attributes.filter((item) => item.required).map((item) => item.name) ?? []
  const lines = [
    code('<' + declaration.name + '>') + ' · ' + describeType(declaration.type),
    declaration.documentation ??
      type?.documentation ??
      (!element.parent ? schema.documentation : undefined),
    required.length && 'Required attributes: ' + required.map(code).join(', '),
    children.length && 'Children: ' + children.map((child) => code('<' + child + '>')).join(', '),
    type?.mixed && 'Supports mixed text and child elements.',
    'SKLand Wiki XML schema ' + schema.version,
  ]
  return {
    range: document.range(name),
    contents: {
      kind: markdown ? MarkupKind.Markdown : MarkupKind.PlainText,
      value: lines.filter(Boolean).join('\n\n'),
    },
  }
}
