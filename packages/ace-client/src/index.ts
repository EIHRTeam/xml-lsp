import type * as AceModule from 'ace-builds'
import type { Ace } from 'ace-builds'
import type { HoverTooltip } from 'ace-builds-internal/tooltip'
import { connectBrowserClient, type BrowserDocument } from '@eihrteam/xml-browser-client'
import {
  DiagnosticSeverity,
  type Position,
  type Range,
  type TextEdit,
} from 'vscode-languageserver-types'

const toPosition = (point: Ace.Point): Position => ({ line: point.row, character: point.column })
const collapsed = (point: Position): Range => ({ start: point, end: point })

export interface AceAttachment {
  format(selectionOnly?: boolean): Promise<void>
  dispose(): void
}

export interface AceClient {
  attachEditor(
    editor: Ace.Editor,
    uri: string | ((session: Ace.EditSession) => string),
  ): AceAttachment
  dispose(): Promise<void>
}

interface SessionBinding {
  references: number
  document: BrowserDocument
  dispose(): void
}

/** Load Ace's ext-language_tools before attaching an editor. */
export async function createAceClient(ace: typeof AceModule, worker: Worker): Promise<AceClient> {
  const client = await connectBrowserClient(worker)
  const sessions = new Map<Ace.EditSession, SessionBinding>()
  const editors = new Map<Ace.Editor, AceAttachment>()
  const fromRange = ({ start, end }: Range) =>
    new ace.Range(start.line, start.character, end.line, end.character)
  const { HoverTooltip: Tooltip } = ace.require('ace/tooltip') as {
    HoverTooltip: typeof HoverTooltip
  }
  let disposed = false

  function acquire(session: Ace.EditSession, uri: string): SessionBinding {
    const existing = sessions.get(session)
    if (existing) {
      if (existing.document.uri !== uri)
        throw new Error('This Ace session is already open with a different URI')
      existing.references++
      return existing
    }
    const source = session.getDocument()
    let eol = source.getNewLineCharacter()
    const document = client.open(uri, session.getValue(), (diagnostics) => {
      session.setAnnotations(
        diagnostics.map((item) => ({
          row: item.range.start.line,
          column: item.range.start.character,
          text: item.message,
          type:
            item.severity === DiagnosticSeverity.Warning
              ? 'warning'
              : item.severity === DiagnosticSeverity.Error || item.severity === undefined
                ? 'error'
                : 'info',
        })),
      )
    })
    function updateEol(): boolean {
      if (eol === source.getNewLineCharacter()) return false
      eol = source.getNewLineCharacter()
      document.change([{ text: session.getValue() }])
      return true
    }
    const eolChanged = () => queueMicrotask(updateEol)
    const change = (delta: Ace.Delta) => {
      if (updateEol()) return
      const start = toPosition(delta.start)
      if (delta.action === 'insert')
        document.change([{ range: collapsed(start), text: delta.lines.join(eol) }])
      else document.change([{ range: { start, end: toPosition(delta.end) }, text: '' }])
    }
    session.on('change', change)
    source.on('changeNewLineMode', eolChanged)
    const binding = {
      references: 1,
      document,
      dispose() {
        if (--binding.references > 0) return
        sessions.delete(session)
        session.off('change', change)
        source.off('changeNewLineMode', eolChanged)
        document.close()
      },
    }
    sessions.set(session, binding)
    return binding
  }

  return {
    attachEditor(editor, uriForSession) {
      if (disposed) throw new Error('The SKLand XML Ace client is closed')
      if (editors.has(editor)) throw new Error('This Ace editor is already attached')
      if (!ace.require('ace/ext/language_tools'))
        throw new Error('Load Ace ext-language_tools before attaching')
      const uri = typeof uriForSession === 'string' ? () => uriForSession : uriForSession
      const originalBasic = editor.getOption('enableBasicAutocompletion')
      const originalLive = editor.getOption('enableLiveAutocompletion')
      const originalCompleters = editor.completers
      let session = editor.getSession()
      let binding = acquire(session, uri(session))
      let isOpen = true
      let hoverRequest = 0
      let completionRequest = 0
      const tooltip = new Tooltip(editor.container)
      type Suggestion = Ace.Completion & { sklandEdit?: TextEdit; sklandRequest?: number }
      const completer: Ace.Completer = {
        id: 'skland-xml',
        triggerCharacters: ['<', '/', ' ', '=', '"', "'"],
        identifierRegexps: [/[a-zA-Z0-9_.:-]/],
        getCompletions(_editor, requestedSession, position, _prefix, callback) {
          if (!isOpen || requestedSession !== session) {
            callback(null, [])
            return
          }
          const request = ++completionRequest
          void (async () => {
            const result = await binding.document.completion(toPosition(position))
            const suggestions: Suggestion[] =
              result?.items.map((item) => ({
                caption: item.label,
                value: item.textEdit?.newText ?? item.insertText ?? item.label,
                completer,
                meta: 'SKLand XML',
                score: 1000,
                docText:
                  typeof item.documentation === 'string'
                    ? item.documentation
                    : item.documentation?.value,
                sklandEdit: item.textEdit && 'range' in item.textEdit ? item.textEdit : undefined,
                sklandRequest: request,
              })) ?? []
            callback(
              null,
              isOpen && request === completionRequest && requestedSession === session
                ? suggestions
                : [],
            )
          })()
        },
        insertMatch(_editor, completion: Suggestion) {
          if (isOpen && completion.sklandRequest === completionRequest && completion.sklandEdit) {
            const { range, newText } = completion.sklandEdit
            session.replace(fromRange(range), newText)
          }
        },
      }
      editor.setOptions({ enableBasicAutocompletion: [completer], enableLiveAutocompletion: true })
      tooltip.setDataProvider((event, target) => {
        const request = ++hoverRequest
        const position = event.getDocumentPosition()
        void (async () => {
          const hover = await binding.document.hover(toPosition(position))
          if (!isOpen || request !== hoverRequest || !hover?.range) return
          const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents]
          const label = editor.container.ownerDocument.createElement('div')
          label.style.whiteSpace = 'pre-wrap'
          label.textContent = contents
            .map((item) => (typeof item === 'string' ? item : item.value))
            .join('\n')
          tooltip.showForRange(target, fromRange(hover.range), label, event)
        })()
      })
      tooltip.addToEditor(editor)
      const invalidateCompletion = () => {
        completionRequest++
      }
      const onSession = ({ session: next }: { session: Ace.EditSession }) => {
        hoverRequest++
        completionRequest++
        tooltip.hide(undefined)
        session.off('change', invalidateCompletion)
        binding.dispose()
        session = next
        binding = acquire(session, uri(session))
        session.on('change', invalidateCompletion)
      }
      session.on('change', invalidateCompletion)
      editor.on('changeSession', onSession)
      const attachment: AceAttachment = {
        async format(selectionOnly = false) {
          const active = session
          const selection = editor.getSelectionRange()
          const range = selectionOnly
            ? { start: toPosition(selection.start), end: toPosition(selection.end) }
            : undefined
          const edits = await binding.document.formatting(
            { tabSize: session.getTabSize(), insertSpaces: session.getUseSoftTabs() },
            range,
          )
          if (!isOpen || active !== session || !edits) return
          for (const edit of [...edits].reverse())
            session.replace(fromRange(edit.range), edit.newText)
        },
        dispose() {
          if (!editors.delete(editor)) return
          isOpen = false
          editor.off('destroy', attachment.dispose)
          editor.off('changeSession', onSession)
          session.off('change', invalidateCompletion)
          tooltip.removeFromEditor(editor)
          tooltip.destroy()
          binding.dispose()
          editor.setOptions({
            enableBasicAutocompletion: originalBasic,
            enableLiveAutocompletion: originalLive,
          })
          editor.completers = originalCompleters
        },
      }
      editor.on('destroy', attachment.dispose)
      editors.set(editor, attachment)
      return attachment
    },
    async dispose() {
      disposed = true
      for (const editor of editors.values()) editor.dispose()
      await client.dispose()
    },
  }
}
