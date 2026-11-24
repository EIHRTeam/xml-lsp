import { DOMParser } from '@xmldom/xmldom'
import { parseXmlWithWarnings, XmlWikiConversionError } from '@eihrteam/xml'
import { DiagnosticSeverity } from 'vscode-languageserver-types'
import { ContentModel } from './content-model.js'
import {
  decodeXml,
  hasText,
  maximumIssues,
  type Issue,
  type Span,
  type XmlElement,
  type XmlTree,
} from './parser.js'
import { schema } from './schema.generated.js'
import type {
  AttributeDeclaration,
  ComplexType,
  ElementDeclaration,
  SimpleType,
} from './schema-model.js'

const models = new Map<string, ContentModel>()
const empty = new ContentModel()
const rootDeclarations = new Map(schema.roots.map((item) => [item.name, item]))
const xmlNamespace = 'http://www.w3.org/XML/1998/namespace'

export function getType(name: string): ComplexType | undefined {
  return Object.hasOwn(schema.complexTypes, name) ? schema.complexTypes[name] : undefined
}
export function getSimpleType(name: string): SimpleType {
  if (Object.hasOwn(schema.simpleTypes, name)) return schema.simpleTypes[name]!
  return { base: name === 'xs:token' ? 'token' : 'string' }
}
export function contentModel(type: string): ContentModel {
  const content = getType(type)?.content
  if (!content) return empty
  let model = models.get(type)
  if (!model) {
    model = new ContentModel(content)
    models.set(type, model)
  }
  return model
}

export function chooseDeclaration(element: XmlElement): ElementDeclaration | undefined {
  if (element.namespace || !element.name.name) return
  if (!element.parent) return rootDeclarations.get(element.name.name)
  const parent = chooseDeclaration(element.parent)
  return parent ? contentModel(parent.type).members.get(element.name.name) : undefined
}

function normalized(value: string, type: SimpleType): string {
  return type.base === 'token' ? value.replace(/[\t\n\r ]+/g, ' ').replace(/^ | $/g, '') : value
}
function checkValue(value: string, type: SimpleType): boolean {
  return (
    (type.values === undefined || type.values.includes(value)) &&
    (type.minLength === undefined || Array.from(value).length >= type.minLength)
  )
}

export function attributeValues(attr: AttributeDeclaration): string[] {
  return attr.fixed === undefined ? (getSimpleType(attr.type).values ?? []) : [attr.fixed]
}

function compareSchema(tree: XmlTree, text: string, issues: Issue[]): void {
  const push = (code: string, span: Span, message: string) => {
    if (issues.length < maximumIssues) issues.push({ source: 'schema', code, span, message })
  }
  function visit(element: XmlElement, decl: ElementDeclaration): void {
    if (issues.length >= maximumIssues) return
    const type = getType(decl.type)
    const attrDeclarations = new Map(type?.attributes.map((attr) => [attr.name, attr]))
    const seen = new Set<string>()
    for (const attr of element.attributes) {
      const name = attr.name.name
      seen.add(name)
      const decl = attrDeclarations.get(name)
      if (!decl) {
        if (
          !type?.anyAttribute &&
          name !== 'xmlns' &&
          !name.startsWith('xmlns:') &&
          name !== 'xsi:schemaLocation' &&
          name !== 'xsi:noNamespaceSchemaLocation' &&
          !(name === 'xml:space' && element.namespace !== xmlNamespace)
        ) {
          push(
            'unknown-attribute',
            attr.name,
            `Attribute “${name}” is unsupported on <${element.name.name}>.`,
          )
        }
      } else if (attr.closed && attr.decoded !== undefined) {
        const simple = getSimpleType(decl.type)
        const value = normalized(attr.decoded, simple)
        if (
          !checkValue(value, simple) ||
          (decl.fixed !== undefined && value !== normalized(decl.fixed, simple))
        ) {
          const values = attributeValues(decl)
          push(
            'invalid-attribute-value',
            attr.value ?? attr.name,
            values.length
              ? `Expected one of: ${values.map((value) => JSON.stringify(value)).join(', ')}.`
              : `Attribute “${name}” must contain text.`,
          )
        }
      }
    }
    if (element.complete)
      for (const attr of attrDeclarations.values()) {
        if (attr.required && !seen.has(attr.name))
          push('required-attribute', element.name, `Missing required attribute “${attr.name}”.`)
      }

    const model = contentModel(decl.type)
    let state = model.start
    let invalidChildren = false
    for (const child of element.children) {
      if (issues.length >= maximumIssues) break
      const name = child.name.name
      if (!name || !child.complete) {
        invalidChildren = true
        continue
      }
      const member = !child.namespace && model.members.get(name)
      if (!member) {
        push(
          'unexpected-element',
          child.name,
          `<${name}> is unsupported inside <${element.name.name}>.`,
        )
        invalidChildren = true
        continue
      }
      const next = model.advance(state, name)
      if (next.length) state = next
      else {
        if (!invalidChildren)
          push(
            'child-order-or-occurrence',
            child.name,
            `<${name}> cannot occur here inside <${element.name.name}>.`,
          )
        invalidChildren = true
      }
      visit(child, member)
    }
    if (
      !invalidChildren &&
      (element.selfClosing || element.close?.complete) &&
      !model.accepts(state)
    ) {
      const required = model
        .candidates(state)
        .map((child) => `<${child.name}>`)
        .join(', ')
      push(
        'missing-child',
        element.close?.name ?? element.name,
        `Incomplete content for <${element.name.name}>. Expected ${required}.`,
      )
    }
    const contentText = element.content.flatMap((item) => {
      const chunk = text.slice(item.span.from, item.span.to)
      switch (item.kind) {
        case 'Text':
          return [{ span: item.span, value: chunk }]
        case 'Cdata':
          return [{ span: item.span, value: chunk.slice(9, -3) }]
        case 'EntityReference':
        case 'CharacterReference':
          return [{ span: item.span, value: decodeXml(chunk) }]
        default:
          return []
      }
    })
    if (type && !type.mixed && !type.text) {
      const bad = contentText.find((item) => hasText(item.value))
      if (bad)
        push('unexpected-text', bad.span, `Text is unsupported inside <${element.name.name}>.`)
    } else if ((!type || type.text) && (element.selfClosing || element.close?.complete)) {
      const simple = getSimpleType(type?.text ?? decl.type)
      if (simple.values || simple.minLength) {
        const value = normalized(contentText.map((item) => item.value).join(''), simple)
        if (!checkValue(value, simple))
          push(
            'invalid-element-value',
            element.name,
            `Invalid value for <${element.name.name}> (${type?.text ?? decl.type}).`,
          )
      }
    }
  }

  for (const root of tree.roots) {
    const name = root.name.name
    const decl = !root.namespace && rootDeclarations.get(name)
    if (decl) visit(root, decl)
    else if (root.complete && name)
      push(
        'unexpected-root',
        root.name,
        `Expected the unqualified root <${schema.roots[0]?.name}>.`,
      )
  }
}

function tableLimit(elements: readonly XmlElement[]): Span | undefined {
  let totalCells = 0
  for (const element of elements) {
    if (!['td', 'th'].includes(element.name.name)) continue
    const count = (name: string) => {
      const raw = element.attributes.find((attribute) => attribute.name.name === name)?.decoded
      return raw ? Number.parseInt(raw, 10) : 1
    }
    const row = count('rowspan')
    const column = count('colspan')
    const start = count('col')
    if (row > 10_000 || column > 10_000 || start > 10_000) return element.name
    totalCells += (row > 0 ? row : 1) * (column > 0 ? column : 1)
    if (totalCells > 250_000) return element.name
  }
}

function strictWellFormed(text: string): boolean {
  try {
    new DOMParser({
      onError() {
        throw new Error('Malformed XML')
      },
    }).parseFromString(text, 'application/xml')
    return true
  } catch {
    return false
  }
}

export function validate(text: string, tree: XmlTree, elements: () => XmlElement[]): Issue[] {
  const issues = [...tree.issues]
  const anchor = tree.roots[0]?.name ?? { from: 0, to: 0 }
  if (tree.limited || issues.some((item) => item.code === 'doctype-disabled')) return issues
  const syntaxClean = issues.length === 0
  if (syntaxClean && !strictWellFormed(text)) {
    issues.push({
      source: 'syntax',
      code: 'strict-xml',
      span: anchor,
      message: 'The document fails strict XML parsing.',
    })
  }
  compareSchema(tree, text, issues)
  if (issues.length || !tree.roots.length) return issues
  const limit = tableLimit(elements())
  if (limit)
    return [
      {
        source: 'semantic',
        code: 'table-resource-limit',
        span: limit,
        severity: DiagnosticSeverity.Warning,
        message:
          'Skipped conversion validation because the expanded table exceeds the analysis budget.',
      },
    ]
  try {
    const [, warnings] = parseXmlWithWarnings(text)
    for (const message of warnings.slice(0, maximumIssues))
      issues.push({
        source: 'semantic',
        code: 'converter-warning',
        message,
        span: anchor,
        severity: DiagnosticSeverity.Warning,
      })
  } catch (error) {
    if (!(error instanceof XmlWikiConversionError)) throw error
    issues.push({
      source: 'semantic',
      code: 'conversion-error',
      message: error.message,
      span: anchor,
    })
  }
  return issues
}
