import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseXml, parseXmlWithWarnings, renderXml, xmlToWikiJson } from '@eihrteam/xml'
import { createXmlLanguageService } from '@eihrteam/xml-language-service'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { compileSchema } from '../tooling/schema-compiler/compiler.ts'
import {
  invalidDialog,
  invalidDocument,
  unfinishedDocument,
  validDocument,
  wikiDocument,
} from './fixtures/documents.ts'

const uri = 'inmemory:///page.skland.xml'
function open(source: string) {
  const service = createXmlLanguageService()
  const doc = TextDocument.create(uri, 'skland-xml', 1, source)
  service.openDocument({ uri, version: 1, text: source })
  return { service, doc }
}

function diagnostics(source: string) {
  return open(source).service.diagnostics(uri)
}
function suggest(source: string, offset = source.length, snippets = false) {
  const { service, doc } = open(source)
  return service.completion(uri, doc.positionAt(offset), { snippets }).items
}
const codes = (source: string) => diagnostics(source).map((item) => item.code)

describe('schema compilation', () => {
  const file = 'reference/skland-wiki-v1.xsd'
  const xsd = readFileSync(file, 'utf8')
  test('has stable metadata and contextual local types', () => {
    const compiled = compileSchema(xsd, file)
    expect(compileSchema(xsd, file)).toEqual(compiled)
    expect(compiled.roots.map((item) => item.name)).toEqual(['sklandDocument'])
    expect(compiled.complexTypes.ChapterTable?.content?.kind).toBe('choice')
    expect(compiled.complexTypes.ComplexTable?.content?.kind).toBe('sequence')
    expect(compiled.simpleTypes.ColorValue?.values).toContain('f_red')
  })
  test('fails on unsupported constructs, attributes, unresolved references and cycles', () => {
    for (const [source, message] of [
      [xsd.replace('<xs:minLength', '<xs:maxLength'), 'unsupported construct'],
      [
        xsd.replace('name="ColorValue"', 'name="ColorValue" final="restriction"'),
        'unsupported attribute',
      ],
      [xsd.replace('type="ColorValue"', 'type="Unknown"'), 'unresolved type'],
      [
        xsd.replace(
          '</xs:schema>',
          '<xs:complexType name="Recursive"><xs:complexContent><xs:extension base="Recursive"/></xs:complexContent></xs:complexType></xs:schema>',
        ),
        'cyclic type extension',
      ],
      [
        xsd.replace('</xs:schema>', '<xs:include schemaLocation="other.xsd"/></xs:schema>'),
        'unsupported construct',
      ],
    ] as const)
      expect(() => compileSchema(source, file)).toThrow(message)
  })
})

describe('diagnostics', () => {
  test('matches the published converter on a checked-in upstream sample', () => {
    const sample = readFileSync(new URL('./fixtures/upstream-sample.xml', import.meta.url), 'utf8')
    expect(parseXmlWithWarnings(sample)[1]).toEqual([])
    expect(diagnostics(sample)).toEqual([])
    expect(diagnostics(renderXml(parseXml(sample)))).toEqual([])
    expect(xmlToWikiJson(sample).text).toContain('itemId')
  })
  test('checks attributes, lexical values, children and text in their local context', () => {
    expect(codes(invalidDocument)).toEqual(['invalid-attribute-value'])
    expect(codes(wikiDocument('<emoji extra="1"/>'))).toEqual([
      'unknown-attribute',
      'required-attribute',
    ])
    expect(codes(wikiDocument('<emoji id="　"/>'))).toContain('conversion-error')
    expect(codes(wikiDocument('<table widths="1"><tr><td><table/></td></tr></table>'))).toContain(
      'unexpected-element',
    )
    expect(codes(wikiDocument('<table widths="1"><tr>bad<td/></tr></table>'))).toContain(
      'unexpected-text',
    )
    const mixed =
      '<chapters name="G"><chapter name="C" table="true"><table><row><cell/><cell/></row><tr><td/></tr></table></chapter></chapters>'
    expect(codes(wikiDocument('', mixed))).toContain('child-order-or-occurrence')
    expect(
      codes(wikiDocument('', mixed.replace('<tr><td/></tr>', '').replace('<cell/>', ''))),
    ).toContain('missing-child')
    expect(
      codes(
        validDocument.replace(
          '<name>示例 😀</name><cover/><subTypes/>',
          '<subTypes/><cover/><name>示例 😀</name>',
        ),
      ),
    ).toEqual([])
  })
  test('reports converter-only errors without classifying exception message text', () => {
    const diagnoses = diagnostics(invalidDialog)
    expect(diagnoses[0]).toMatchObject({ source: 'skland-xml/semantic', code: 'conversion-error' })
    expect(() => parseXml(invalidDialog)).toThrow()
    expect(codes('<sklandDocument/>')).toEqual(['conversion-error'])
  })
  test('keeps historical sibling lists and supports escaped enum and XML forms', () => {
    expect(codes(wikiDocument('<ul><li>A</li><ol><li>B</li></ol></ul>'))).toEqual([])
    expect(codes(wikiDocument('<color value="f_&#114;ed"/>'))).toEqual([])
    expect(codes(wikiDocument('<table header=" row " widths="1"><tr><th/></tr></table>'))).toEqual(
      [],
    )
    expect(codes(wikiDocument('<?preview x?>\n<![CDATA[<>]]>'))).toEqual([])
  })
  test('identifies malformed XML and bounds structural and semantic work', () => {
    expect(codes('<sklandDocument/><sklandDocument/>')).toContain('multiple-roots')
    expect(codes(wikiDocument('<emoji id="x" id="y"/>'))).toContain('duplicate-attribute')
    expect(codes(wikiDocument('&fake;'))).toContain('invalid-reference')
    expect(codes(wikiDocument('&#0;'))).toContain('invalid-reference')
    expect(codes(wikiDocument('<x:emoji id="1"/>'))).toContain('invalid-namespace')
    expect(codes(wikiDocument('invalid \u0000 text'))).toContain('invalid-character')
    expect(codes('<!DOCTYPE sklandDocument>' + validDocument)).toEqual(['doctype-disabled'])
    expect(codes(wikiDocument('<b>'.repeat(130) + '</b>'.repeat(130)))).toEqual(['resource-limit'])
    expect(
      codes(wikiDocument('<table widths="1"><tr><td colspan="1000000000"/></tr></table>')),
    ).toEqual(['table-resource-limit'])
    expect(diagnostics(wikiDocument('<missing/>'.repeat(120)))).toHaveLength(100)
  })
})

describe('language intelligence', () => {
  test('completes partial tags, namespace-free roots, attributes and values', () => {
    expect(suggest('<skl').map((item) => item.label)).toEqual(['sklandDocument'])
    expect(suggest('<sklandDocument><description><').map((item) => item.label)).toContain('table')
    expect(
      suggest('<sklandDocument><description><col', undefined, true).find(
        (item) => item.label === 'color',
      )?.textEdit?.newText,
    ).toBe('color value="${1:}"')
    expect(suggest('<sklandDocument><description><color ').map((item) => item.label)).toEqual([
      'value',
    ])
    expect(
      suggest(unfinishedDocument).find((item) => item.label === 'f_red')?.textEdit?.newText,
    ).toBe('f_red"')
    expect(
      suggest('<sklandDocument><description><color value=').find((item) => item.label === 'f_red')
        ?.textEdit?.newText,
    ).toBe('"f_red"')
    expect(
      suggest('<sklandDocument><description><color value="f_red" ').map((item) => item.label),
    ).toEqual([])
    expect(suggest('<sklandDocument><description><b></').map((item) => item.label)).toContain('b')
    expect(suggest('<sklandDocument><!-- <').map((item) => item.label)).toEqual([])
  })
  test('tracks occurrences before and after the caret and contextual table forms', () => {
    const head = '<sklandDocument><metainfo><name/><cover/><'
    expect(suggest(head).map((item) => item.label)).toEqual(['subTypes'])
    const all = '<sklandDocument><metainfo><<name/><cover/><subTypes/></metainfo></sklandDocument>'
    expect(suggest(all, all.indexOf('<<') + 1)).toEqual([])
    const table = '<sklandDocument><chapters name="G"><chapter name="C"><table><'
    expect(suggest(table).map((item) => item.label)).toEqual(['row', 'tr'])
    expect(
      suggest(table.slice(0, -1) + '<row><cell/><cell/></row><').map((item) => item.label),
    ).toEqual(['row'])
    expect(suggest('<sklandDocument><description><table><').map((item) => item.label)).toEqual([
      'tr',
    ])
  })
  test('hover is cached by version, positions use UTF-16 and changes apply in order', () => {
    const source = wikiDocument('😀 e\u0301\r\n<b>bold</b>\r<c/>\n')
    const { service, doc } = open(source)
    const pos = doc.positionAt(source.indexOf('<b>') + 1)
    expect(service.hover(uri, pos)?.contents).toMatchObject({
      value: expect.stringContaining('InlineContent'),
    })
    const second = 'inmemory:///second.xml'
    service.openDocument({ uri: second, version: 4, text: validDocument })
    const range = { start: pos, end: { ...pos, character: pos.character + 1 } }
    expect(
      service.updateDocument(uri, 2, [
        { range, text: 'color' },
        { range: { start: range.end, end: range.end }, text: '' },
      ]),
    ).toBe(true)
    expect(service.hover(uri, pos)?.contents).toMatchObject({
      value: expect.stringContaining('ColorContent'),
    })
    expect(service.updateDocument(uri, 1, [{ text: '' }])).toBe(false)
    expect(service.diagnostics(second)).toEqual([])
    expect(service.closeDocument(uri)).toBe(true)
    expect(service.hover(uri, pos)).toBeNull()
    expect(service.getVersion(second)).toBe(4)
    service.dispose()
    expect(service.getVersion(second)).toBeUndefined()
  })
})

describe('edits and outline', () => {
  test('formatting preserves converter output, XML markup and mixed/CDATA whitespace', () => {
    const source =
      '<?xml version="1.0"?>\r\n' +
      wikiDocument(' A<![CDATA[  x  ]]> <!-- inline --> <b> B </b> &amp; C').replace(
        '<itemId>',
        '<!-- top --><itemId>',
      )
    const { service, doc } = open(source)
    const edits = service.formatting(uri, { tabSize: 2, insertSpaces: true })
    const formatted = TextDocument.applyEdits(doc, edits)
    expect(edits.length).toBeGreaterThan(3)
    expect(formatted).toContain('\r\n  <!-- top -->')
    expect(formatted).toContain(' A<![CDATA[  x  ]]> <!-- inline --> <b> B </b> &amp; C')
    expect(parseXml(formatted)).toEqual(parseXml(source))
    expect(open(formatted).service.formatting(uri, { tabSize: 2, insertSpaces: true })).toEqual([])
    const selection = {
      start: doc.positionAt(source.indexOf('<metainfo>')),
      end: doc.positionAt(source.indexOf('</metainfo>') + 11),
    }
    const partial = TextDocument.applyEdits(
      doc,
      service.formatting(uri, { tabSize: 4, insertSpaces: false }, selection),
    )
    expect(partial).toContain('<metainfo>\r\n\t\t<name>')
    expect(partial).toContain('</itemId><metainfo>')
    expect(
      open('<sklandDocument>').service.formatting(uri, { tabSize: 2, insertSpaces: true }),
    ).toEqual([])
  })
  test('offers versioned closing-tag fixes with related locations', () => {
    const source = wikiDocument('<b>x</notB>')
    const { service } = open(source)
    const mismatch = service.diagnostics(uri).find((item) => item.code === 'mismatched-close-tag')!
    expect(mismatch.relatedInformation).toHaveLength(1)
    expect(
      service.codeActions(uri, mismatch.range, [mismatch])[0]?.edit?.documentChanges?.[0],
    ).toMatchObject({
      textDocument: { uri, version: 1 },
      edits: [{ range: mismatch.range, newText: 'b' }],
    })
  })
  test('exposes symbols, folding, linked ranges and safe URL targets', () => {
    const source = wikiDocument(
      '\n<b>line\nspan</b>\n<a href="https://example.test/a?q=1&amp;b=2">link</a>' +
        '<a href="javascript:ignore">unsafe</a><a href="https://user:pw@example.test/">secret</a>\n',
    )
    const { service, doc } = open(source)
    expect(
      service.documentSymbols(uri)[0]?.children?.some((item) => item.name === 'description'),
    ).toBe(true)
    expect(service.foldingRanges(uri).length).toBeGreaterThan(1)
    const links = service.documentLinks(uri)
    expect(links.map((item) => item.target)).toEqual(['https://example.test/a?q=1&b=2'])
    const linked = service.linkedEditing(uri, doc.positionAt(source.indexOf('<b>') + 1))
    expect(linked?.ranges.map((range) => doc.getText(range))).toEqual(['b', 'b'])
  })
})
