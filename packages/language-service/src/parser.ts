import { TreeFragment, type SyntaxNode, type Tree } from '@lezer/common'
import { parser } from '@lezer/xml'
import { DiagnosticSeverity } from 'vscode-languageserver-types'

export interface Span {
  from: number
  to: number
}
interface NamedSpan extends Span {
  name: string
}
export interface XmlAttribute {
  name: NamedSpan
  span: Span
  value?: Span
  quote?: string
  closed: boolean
  equals?: number
  decoded?: string
}

export interface Issue {
  span: Span
  source: 'syntax' | 'schema' | 'semantic'
  code: string
  message: string
  severity?: DiagnosticSeverity
  fix?: { span: Span; text: string; title: string }
  related?: { span: Span; message: string }
}

export interface XmlElement {
  name: NamedSpan
  span: Span
  open: Span
  close?: { span: Span; name: NamedSpan; complete: boolean }
  parent?: XmlElement
  attributes: XmlAttribute[]
  children: XmlElement[]
  content: { span: Span; kind: string }[]
  complete: boolean
  selfClosing: boolean
  namespace: string
  preserveSpace: boolean
}
export interface XmlTree {
  roots: XmlElement[]
  issues: Issue[]
  limited: boolean
}

export const maximumDocumentLength = 5 * 1024 * 1024
export const maximumIssues = 100
const maximumDepth = 128
const maximumNodes = 500_000
// oxlint-disable-next-line eslint/no-control-regex -- XML 1.0 character production
const xmlCharacter = /^[\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]$/u
// oxlint-disable-next-line eslint/no-control-regex -- XML 1.0 character production
const invalidCharacter = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u
export const hasText = (text: string): boolean => /[^\t\n\r ]/.test(text)
const entities = new Map([
  ['amp', '&'],
  ['apos', "'"],
  ['quot', '"'],
  ['lt', '<'],
  ['gt', '>'],
])

function entity(source: string): string | undefined {
  const name = source.slice(1, -1)
  if (name[0] !== '#') return entities.get(name)
  const code = name[1] === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return
  const value = String.fromCodePoint(code)
  return xmlCharacter.test(value) ? value : undefined
}

export function decodeXml(source: string): string {
  return source.replace(/&(?:#x[\da-fA-F]+|#\d+|[\w.:-]+);/g, (value) => entity(value) ?? value)
}

export function parseTree(text: string, previous: readonly TreeFragment[] = []): Tree | undefined {
  return text.length <= maximumDocumentLength ? parser.parse(text, previous) : undefined
}

function named(node: SyntaxNode | null, text: string, emptyAt: number): NamedSpan {
  return node
    ? { from: node.from, to: node.to, name: text.slice(node.from, node.to) }
    : { from: emptyAt, to: emptyAt, name: '' }
}

function attribute(node: SyntaxNode, text: string): XmlAttribute {
  const name = named(node.getChild('AttributeName'), text, node.from)
  const equals = node.getChild('Is')?.to
  const value = node.getChild('AttributeValue')
  const span = { from: node.from, to: node.to }
  if (!value) return { name, span, equals, closed: false }
  const first = text[value.from]
  const quote = first === '"' || first === "'" ? first : undefined
  const closed =
    !!quote &&
    value.to > value.from + 1 &&
    text[value.to - 1] === quote &&
    !value.lastChild?.type.isError
  const from = value.from + (quote ? 1 : 0)
  const to = value.to - (closed ? 1 : 0)
  const decoded = decodeXml(text.slice(from, to).replace(/\r\n|[\t\r\n]/g, ' '))
  return { name, span, equals, quote, closed, value: { from, to }, decoded }
}

function namespaceOf(element: XmlElement, prefix: string): string | undefined {
  if (prefix === 'xml') return 'http://www.w3.org/XML/1998/namespace'
  if (prefix === 'xmlns') return 'http://www.w3.org/2000/xmlns/'
  for (let owner: XmlElement | undefined = element; owner; owner = owner.parent) {
    const binding = owner.attributes.find(
      (attr) => attr.name.name === (prefix ? 'xmlns:' + prefix : 'xmlns'),
    )
    if (binding?.closed) return binding.decoded
  }
  return prefix ? undefined : ''
}

export function readTree(text: string, tree: Tree | undefined): XmlTree {
  const roots: XmlElement[] = []
  const issues: Issue[] = []
  const stack: XmlElement[] = []
  let limited = !tree
  let nodes = 0
  const push = (
    code: string,
    span: Span,
    message: string,
    extra?: Pick<Issue, 'fix' | 'related'>,
  ) => {
    if (issues.length >= maximumIssues) return
    const safeSpan = { from: span.from, to: span.to }
    if (safeSpan.to === safeSpan.from && !extra?.fix && safeSpan.to < text.length) safeSpan.to++
    issues.push({ source: 'syntax', code, span: safeSpan, message, ...extra })
  }
  if (tree)
    tree.iterate({
      enter(ref) {
        if (limited) return false
        const node = ref.node
        const { name, from, to } = node
        if (++nodes > maximumNodes || stack.length >= maximumDepth) {
          limited = true
          return false
        }
        const current = stack.at(-1)
        if (name === 'Element') {
          const open = node.firstChild
          if (!open) return false
          const end = open.lastChild
          const attributes = open.getChildren('Attribute').map((child) => attribute(child, text))
          const element: XmlElement = {
            name: named(open.getChild('TagName'), text, from + 1),
            span: { from, to },
            open: { from: open.from, to: open.to },
            parent: current,
            attributes,
            children: [],
            content: [],
            complete: end?.name === 'EndTag' || end?.name === 'SelfCloseEndTag',
            selfClosing: end?.name === 'SelfCloseEndTag',
            namespace: '',
            preserveSpace: current?.preserveSpace ?? false,
          }
          const space = attributes.find((attr) => attr.name.name === 'xml:space')?.decoded
          if (space === 'preserve' || space === 'default')
            element.preserveSpace = space === 'preserve'
          const ns = (named: NamedSpan): string => {
            const parts = named.name.split(':')
            if (parts.length === 1) return namespaceOf(element, '') ?? ''
            const uri = namespaceOf(element, parts[0]!)
            if (parts.length !== 2 || !parts[1] || !uri)
              push('invalid-namespace', named, 'Invalid or unbound XML namespace prefix.')
            return uri || '?'
          }
          element.namespace = ns(element.name)
          const seen = new Map<string, NamedSpan>()
          for (const attr of attributes) {
            const local = attr.name.name.split(':').at(-1)
            const key = attr.name.name.includes(':') ? `${ns(attr.name)}:${local}` : ':' + local
            const prior = seen.get(key)
            if (prior)
              push('duplicate-attribute', attr.name, 'Duplicate XML attribute.', {
                related: { span: prior, message: 'First occurrence.' },
              })
            else seen.set(key, attr.name)
            if (attr.value && text.slice(attr.value.from, attr.value.to).includes('<')) {
              push('invalid-attribute-value', attr.value, 'Escape “<” as &lt; in attribute values.')
            }
          }
          if (current) current.children.push(element)
          else {
            if (roots.length && element.name.name)
              push('multiple-roots', element.name, 'An XML document has one root element.')
            roots.push(element)
          }
          stack.push(element)
        } else if (name === 'CloseTag' && current) {
          current.close = {
            span: { from, to },
            name: named(node.getChild('TagName'), text, from + 2),
            complete: node.lastChild?.name === 'EndTag',
          }
        } else if (name === 'MismatchedCloseTag' && current) {
          const mismatch = named(node.getChild('TagName'), text, from + 2)
          const expected = current.name.name
          push('mismatched-close-tag', mismatch, `Expected </${expected}>.`, {
            fix: { span: mismatch, text: expected, title: `Change closing tag to </${expected}>` },
            related: { span: current.name, message: 'Opening tag.' },
          })
        } else if (name === 'MissingCloseTag' && current) {
          const expected = current.name.name
          push('missing-close-tag', { from, to }, `Missing </${expected}>.`, {
            fix: {
              span: { from, to: from },
              text: `</${expected}>`,
              title: `Insert </${expected}>`,
            },
            related: { span: current.name, message: 'Opening tag.' },
          })
        } else if (name === 'DoctypeDecl') {
          push('doctype-disabled', { from, to }, 'Document type declarations are disabled.')
          return false
        } else if (ref.type.isError) {
          if (
            node.parent?.name === 'Element' &&
            current?.complete &&
            !current.selfClosing &&
            !current.close &&
            !current.content.some((item) => item.kind === 'MismatchedCloseTag')
          ) {
            push(
              'unclosed-element',
              current.name,
              `Missing closing tag for <${current.name.name}>.`,
            )
          } else if (node.parent?.name !== 'Element') {
            const last = issues.at(-1)
            if (last?.span.from !== from || last.code !== 'invalid-xml') {
              push('invalid-xml', { from, to }, 'Incomplete or invalid XML syntax.')
            }
          }
        }
        const direct = node.parent?.name === 'Element' || node.parent?.name === 'Document'
        if (
          direct &&
          [
            'Text',
            'CharacterReference',
            'EntityReference',
            'Cdata',
            'Comment',
            'ProcessingInst',
            'MismatchedCloseTag',
          ].includes(name)
        ) {
          if (current) current.content.push({ span: { from, to }, kind: name })
          else if (
            ['Text', 'CharacterReference', 'EntityReference', 'Cdata'].includes(name) &&
            hasText(text.slice(from, to).replace(/^\uFEFF/, ''))
          ) {
            push('text-outside-root', { from, to }, 'Text must be inside the root element.')
          }
        }
        if (
          (name === 'EntityReference' || name === 'CharacterReference') &&
          entity(text.slice(from, to)) === undefined
        ) {
          push(
            'invalid-reference',
            { from, to },
            'Unknown entity or invalid XML character reference.',
          )
        }
      },
      leave(ref) {
        if (ref.name === 'Element') stack.pop()
      },
    })
  if (limited) {
    return {
      roots: [],
      limited: true,
      issues: [
        {
          source: 'syntax',
          code: 'resource-limit',
          span: { from: 0, to: 0 },
          message: 'The XML document exceeds the analysis size, nesting, or syntax-node budget.',
          severity: DiagnosticSeverity.Warning,
        },
      ],
    }
  }
  const invalid = invalidCharacter.exec(text)
  if (invalid)
    push(
      'invalid-character',
      { from: invalid.index, to: invalid.index + invalid[0].length },
      'Character is invalid in XML 1.0.',
    )
  if (!roots.length && !issues.length)
    push('missing-root', { from: text.length, to: text.length }, 'Expected a root element.')
  return { roots, issues, limited }
}

export function collectElements(roots: readonly XmlElement[]): XmlElement[] {
  const elements: XmlElement[] = []
  const pending = [...roots].reverse()
  while (pending.length) {
    const node = pending.pop()!
    elements.push(node)
    for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]!)
  }
  return elements
}
