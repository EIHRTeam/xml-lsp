import { createHash } from 'node:crypto'
import { DOMParser, type Element } from '@xmldom/xmldom'
import type {
  AttributeDeclaration,
  ComplexType,
  ElementDeclaration,
  Particle,
  SchemaModel,
  SimpleType,
} from '../../packages/language-service/src/schema-model.ts'

const namespace = 'http://www.w3.org/2001/XMLSchema'
const simpleBuiltins = new Set(['xs:string', 'xs:token'])
const namePattern = /^[A-Za-z_][\w.-]*$/
const contentKinds = ['sequence', 'choice', 'all', 'group']

function fail(node: Element, message: string): never {
  throw new Error(`XSD line ${node.lineNumber ?? '?'} <${node.tagName}>: ${message}`)
}

function attr(node: Element, key: string): string | undefined {
  const value = node.getAttribute(key)
  return value === null ? undefined : value
}

function required(node: Element, key: string): string {
  return attr(node, key) ?? fail(node, `missing ${key}`)
}

function named(node: Element): string {
  const name = required(node, 'name')
  return namePattern.test(name) ? name : fail(node, `unsupported declaration name ${name}`)
}

function integer(node: Element, key: string, fallback?: number): number {
  const value = attr(node, key)
  if (value === undefined && fallback !== undefined) return fallback
  if (!value || !/^\d+$/.test(value) || Number(value) > 1000) {
    fail(node, `unsupported ${key} value ${value}`)
  }
  return Number(value)
}

function check(node: Element, allowedAttrs: string[], allowedChildren: string[]): Element[] {
  if (node.namespaceURI !== namespace) fail(node, 'unsupported namespace')
  for (const attribute of Array.from(node.attributes)) {
    if (attribute.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue
    if (!allowedAttrs.includes(attribute.name))
      fail(node, `unsupported attribute ${attribute.name}`)
  }
  const elements: Element[] = []
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 1) {
      const element = child as Element
      if (
        element.namespaceURI !== namespace ||
        !allowedChildren.includes(element.localName ?? '')
      ) {
        fail(element, 'unsupported construct in ' + node.localName)
      }
      elements.push(element)
    } else if (
      (child.nodeType === 3 || child.nodeType === 4) &&
      child.nodeValue?.trim() &&
      node.localName !== 'documentation'
    ) {
      fail(node, 'unexpected text')
    }
  }
  return elements
}

function one(nodes: Element[], node: Element, label: string): Element | undefined {
  if (nodes.length > 1) fail(node, `multiple ${label} declarations`)
  return nodes[0]
}

function documentation(node: Element, children: Element[]): string | undefined {
  const annotation = one(
    children.filter((child) => child.localName === 'annotation'),
    node,
    'annotation',
  )
  if (!annotation) return
  return (
    check(annotation, [], ['documentation'])
      .map((child) => {
        check(child, ['xml:lang', 'source'], [])
        return child.textContent?.trim()
      })
      .filter(Boolean)
      .join('\n\n') || undefined
  )
}

function reference(node: Element, key: string): string {
  const name = required(node, key)
  const [first, second, extra] = name.split(':')
  if (
    !first ||
    !namePattern.test(first) ||
    extra !== undefined ||
    (second !== undefined && !namePattern.test(second))
  )
    fail(node, `invalid QName ${name}`)
  const uri = node.lookupNamespaceURI(second === undefined ? null : first)
  if (!uri && second === undefined) return first
  if (uri === namespace && simpleBuiltins.has(`xs:${second ?? first}`))
    return `xs:${second ?? first}`
  return fail(node, `unsupported QName ${name}`)
}

function optionalField<K extends string>(
  key: K,
  value: string | undefined,
): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>)
}

export function compileSchema(source: string, sourceName: string): SchemaModel {
  const document = new DOMParser({
    onError(level, message) {
      throw new Error(`XSD ${level}: ${message}`)
    },
  }).parseFromString(source, 'application/xml')
  if (document.doctype) throw new Error('XSD document type declarations are unsupported')
  const root = document.documentElement
  if (!root || root.localName !== 'schema') throw new Error('Expected an XSD schema element')
  const declarations = check(
    root,
    ['version'],
    ['annotation', 'element', 'simpleType', 'complexType', 'group', 'attributeGroup'],
  )
  const nodes = new Map<string, Element>()
  const simpleTypes = new Map<string, SimpleType>()
  const complexTypes = new Map<string, ComplexType>()
  const roots: ElementDeclaration[] = []
  const active = new Set<Element>()
  const groups = new Map<string, Particle>()
  let anonymous = 0

  for (const node of declarations) {
    if (node.localName === 'annotation') continue
    const kind = node.localName?.endsWith('Type') ? 'type' : node.localName
    const key = `${kind}:${named(node)}`
    if (nodes.has(key)) fail(node, `duplicate declaration ${key}`)
    nodes.set(key, node)
  }

  function lookup(kind: string, name: string, from: Element): Element {
    return nodes.get(`${kind}:${name}`) ?? fail(from, `unresolved ${kind} ${name}`)
  }

  function typeName(node: Element): string {
    const name = reference(node, 'type')
    if (!simpleBuiltins.has(name)) lookup('type', name, node)
    return name
  }

  function element(node: Element): ElementDeclaration {
    const children = check(
      node,
      ['name', 'type', 'minOccurs', 'maxOccurs'],
      ['annotation', 'simpleType', 'complexType'],
    )
    const inline = one(
      children.filter((child) => child.localName !== 'annotation'),
      node,
      'type',
    )
    if (inline && attr(node, 'type') !== undefined)
      fail(node, 'inline type and type reference are mutually exclusive')
    let type: string
    if (inline) {
      type = `#${++anonymous}`
      if (inline.localName === 'simpleType') simpleTypes.set(type, simple(inline, false))
      else complexTypes.set(type, complex(inline, false))
    } else {
      type = typeName(node)
    }
    return {
      name: named(node),
      type,
      ...optionalField('documentation', documentation(node, children)),
    }
  }

  function attribute(node: Element): AttributeDeclaration {
    const children = check(node, ['name', 'type', 'use', 'default', 'fixed'], ['annotation'])
    const use = attr(node, 'use') ?? 'optional'
    if (use !== 'required' && use !== 'optional') fail(node, `unsupported attribute use ${use}`)
    const type = typeName(node)
    if (!simpleBuiltins.has(type) && lookup('type', type, node).localName !== 'simpleType') {
      fail(node, `attribute type ${type} must be simple`)
    }
    return {
      name: named(node),
      type,
      required: use === 'required',
      ...optionalField('default', attr(node, 'default')),
      ...optionalField('fixed', attr(node, 'fixed')),
      ...optionalField('documentation', documentation(node, children)),
    }
  }

  function simple(node: Element, global: boolean): SimpleType {
    const children = check(node, global ? ['name'] : [], ['annotation', 'restriction'])
    const restriction =
      one(
        children.filter((child) => child.localName === 'restriction'),
        node,
        'restriction',
      ) ?? fail(node, 'expected a restriction')
    const facets = check(restriction, ['base'], ['enumeration', 'minLength'])
    const baseName = reference(restriction, 'base')
    if (baseName !== 'xs:string' && baseName !== 'xs:token')
      fail(restriction, `unsupported base type ${baseName}`)
    for (const facet of facets) check(facet, ['value'], [])
    const min = one(
      facets.filter((facet) => facet.localName === 'minLength'),
      restriction,
      'minLength',
    )
    const enumeration = facets.filter((facet) => facet.localName === 'enumeration')
    return {
      base: baseName === 'xs:string' ? 'string' : 'token',
      ...(enumeration.length && { values: enumeration.map((facet) => required(facet, 'value')) }),
      ...(min && { minLength: integer(min, 'value') }),
      ...optionalField('documentation', documentation(node, children)),
    }
  }

  function group(name: string, from: Element): Particle {
    const cached = groups.get(name)
    if (cached) return cached
    const declaration = lookup('group', name, from)
    if (active.has(declaration)) fail(from, `cyclic group ${name}`)
    active.add(declaration)
    const children = check(declaration, ['name'], ['annotation', 'sequence', 'choice', 'all'])
    const content =
      one(
        children.filter((child) => child.localName !== 'annotation'),
        declaration,
        'group content',
      ) ?? fail(declaration, 'missing group content')
    documentation(declaration, children)
    const resolved = particle(content)
    groups.set(name, resolved)
    active.delete(declaration)
    return resolved
  }

  function particle(node: Element): Particle {
    const kind = node.localName
    const min = integer(node, 'minOccurs', 1)
    const max = attr(node, 'maxOccurs') === 'unbounded' ? null : integer(node, 'maxOccurs', 1)
    if (max !== null && min > max) fail(node, 'minOccurs exceeds maxOccurs')
    if (kind === 'element') return { kind, min, max, element: element(node) }
    if (kind === 'group') {
      check(node, ['ref', 'minOccurs', 'maxOccurs'], [])
      return { kind: 'sequence', min, max, children: [group(reference(node, 'ref'), node)] }
    }
    if (kind !== 'sequence' && kind !== 'choice' && kind !== 'all')
      fail(node, 'unsupported particle')
    const children = check(
      node,
      ['minOccurs', 'maxOccurs'],
      kind === 'all'
        ? ['element', 'annotation']
        : [...contentKinds.filter((name) => name !== 'all'), 'element', 'annotation'],
    )
    documentation(node, children)
    const particles = children.filter((child) => child.localName !== 'annotation').map(particle)
    if (kind === 'all' && (particles.length > 10 || particles.some((child) => child.max !== 1))) {
      fail(node, 'unsupported all-group width or member occurrence')
    }
    return { kind, min, max, children: particles }
  }

  function attributes(
    children: Element[],
    stack: string[] = [],
  ): Pick<ComplexType, 'attributes' | 'anyAttribute'> {
    const result: AttributeDeclaration[] = []
    let anyAttribute = false
    for (const child of children) {
      if (child.localName === 'attribute') result.push(attribute(child))
      if (child.localName === 'anyAttribute') {
        check(child, ['processContents'], [])
        if (attr(child, 'processContents') !== 'skip')
          fail(child, 'only unconstrained skip wildcards are supported')
        anyAttribute = true
      }
      if (child.localName === 'attributeGroup') {
        check(child, ['ref'], [])
        const name = reference(child, 'ref')
        if (stack.includes(name)) fail(child, `cyclic attribute group ${name}`)
        const declaration = lookup('attributeGroup', name, child)
        const members = check(
          declaration,
          ['name'],
          ['annotation', 'attribute', 'attributeGroup', 'anyAttribute'],
        )
        documentation(declaration, members)
        const resolved = attributes(members, [...stack, name])
        result.push(...resolved.attributes)
        anyAttribute ||= resolved.anyAttribute
      }
    }
    return { attributes: result, anyAttribute }
  }

  function resolveComplex(name: string, from: Element): ComplexType {
    const cached = complexTypes.get(name)
    if (cached) return cached
    const node = lookup('type', name, from)
    if (node.localName !== 'complexType') fail(from, `expected complex type ${name}`)
    if (active.has(node)) fail(from, `cyclic type extension ${name}`)
    active.add(node)
    const result = complex(node, true)
    complexTypes.set(name, result)
    active.delete(node)
    return result
  }

  function complex(node: Element, global: boolean): ComplexType {
    const attrKinds = ['attribute', 'attributeGroup', 'anyAttribute']
    const children = check(node, global ? ['name', 'mixed'] : ['mixed'], [
      'annotation',
      ...attrKinds,
      ...contentKinds,
      'simpleContent',
      'complexContent',
    ])
    const mixedValue = attr(node, 'mixed')
    if (mixedValue !== undefined && mixedValue !== 'true' && mixedValue !== 'false')
      fail(node, 'unsupported mixed value')
    const body = one(
      children.filter((child) =>
        [...contentKinds, 'simpleContent', 'complexContent'].includes(child.localName ?? ''),
      ),
      node,
      'content',
    )
    let base: ComplexType = { mixed: false, attributes: [], anyAttribute: false }
    let members = children
    let content: Particle | undefined
    if (body?.localName === 'simpleContent' || body?.localName === 'complexContent') {
      if (children.some((child) => attrKinds.includes(child.localName ?? '')))
        fail(node, 'attributes must be inside extension')
      const extensions = check(body, [], ['extension'])
      const extension = one(extensions, body, 'extension') ?? fail(body, 'expected extension')
      members = check(
        extension,
        ['base'],
        ['annotation', ...attrKinds, ...(body.localName === 'complexContent' ? contentKinds : [])],
      )
      documentation(extension, members)
      const name = reference(extension, 'base')
      if (
        body.localName === 'simpleContent' &&
        (simpleBuiltins.has(name) || lookup('type', name, extension).localName === 'simpleType')
      ) {
        base = { ...base, text: name }
      } else {
        base = resolveComplex(name, extension)
      }
      if (body.localName === 'simpleContent' && !base.text)
        fail(extension, 'expected a simple-content base')
      if (body.localName === 'complexContent' && base.text)
        fail(extension, 'expected a complex-content base')
      const extra = one(
        members.filter((child) => contentKinds.includes(child.localName ?? '')),
        extension,
        'content',
      )
      content = extra && particle(extra)
      if (base.content && content)
        content = { kind: 'sequence', min: 1, max: 1, children: [base.content, content] }
    } else if (body) {
      content = particle(body)
    }
    content ??= base.content
    const extra = attributes(members)
    const allAttributes = [...base.attributes, ...extra.attributes]
    if (new Set(allAttributes.map((item) => item.name)).size !== allAttributes.length)
      fail(node, 'duplicate attributes')
    return {
      ...(content && { content }),
      ...optionalField('text', base.text),
      mixed: mixedValue === undefined ? base.mixed : mixedValue === 'true',
      attributes: allAttributes,
      anyAttribute: base.anyAttribute || extra.anyAttribute,
      ...optionalField('documentation', documentation(node, children) ?? base.documentation),
    }
  }

  for (const node of declarations) {
    const kind = node.localName
    if (kind === 'annotation') continue
    const name = named(node)
    if (kind === 'element') {
      if (attr(node, 'minOccurs') !== undefined || attr(node, 'maxOccurs') !== undefined)
        fail(node, 'global element occurrence')
      roots.push(element(node))
    } else if (kind === 'simpleType') simpleTypes.set(name, simple(node, true))
    else if (kind === 'complexType') resolveComplex(name, node)
    else if (kind === 'group') group(name, node)
    else if (kind === 'attributeGroup') {
      const members = check(
        node,
        ['name'],
        ['annotation', 'attribute', 'attributeGroup', 'anyAttribute'],
      )
      documentation(node, members)
      attributes(members, [name])
    }
  }
  return {
    source: sourceName,
    version: required(root, 'version'),
    hash: createHash('sha256').update(source).digest('hex'),
    ...optionalField('documentation', documentation(root, declarations)),
    roots,
    simpleTypes: Object.fromEntries(simpleTypes),
    complexTypes: Object.fromEntries(complexTypes),
  }
}
