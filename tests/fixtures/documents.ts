export function wikiDocument(description = '', chapters = ''): string {
  return (
    '<sklandDocument><itemId>42</itemId><metainfo><name>示例 😀</name><cover/><subTypes/></metainfo>' +
    '<description>' +
    description +
    '</description>' +
    chapters +
    '</sklandDocument>'
  )
}

export const validDocument = wikiDocument(
  '正文<b>内容</b><a href="https://example.test/wiki?x=1&amp;y=2">链接</a>',
)
export const invalidDocument = wikiDocument('<color value="unknown">内容</color>')
export const unfinishedDocument = '<sklandDocument><description><color value="f_r'
export const invalidDialog = wikiDocument(
  '',
  '<chapters name="G"><chapter name="D" dialog="true">' +
    '<branches><branch name="A"><message side="other" avatar="a"/><message side="me" avatar="b"/></branch></branches>' +
    '</chapter></chapters>',
)
