import * as monaco from 'monaco-editor/editor/editor.api.js'
import '../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css'
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js'
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js'
import 'monaco-editor/editor/contrib/snippet/browser/snippetController2.js'
import 'monaco-editor/editor/contrib/format/browser/formatActions.js'
import 'monaco-editor/editor/contrib/codeAction/browser/codeActionContributions.js'
import 'monaco-editor/editor/contrib/folding/browser/folding.js'
import 'monaco-editor/editor/contrib/linkedEditing/browser/linkedEditing.js'
import 'monaco-editor/editor/contrib/links/browser/links.js'
import { conf, language } from 'monaco-editor/languages/definitions/xml/xml.js'
import { createMonacoClient } from '@eihrteam/xml-monaco-client'
import { sample } from '../sample.js'

async function start(): Promise<void> {
  const status = document.querySelector<HTMLElement>('#status')!
  const worker = new Worker(new URL('./xml-worker.js', import.meta.url), {
    type: 'module',
    name: 'skland-xml',
  })
  const monacoEnvironment = {
    getWorker: () =>
      new Worker(new URL('./editor-worker.js', import.meta.url), {
        type: 'module',
        name: 'monaco-editor',
      }),
  }
  globalThis.MonacoEnvironment = monacoEnvironment
  monaco.languages.register({ id: 'skland-xml' })
  monaco.languages.setMonarchTokensProvider('skland-xml', language)
  monaco.languages.setLanguageConfiguration('skland-xml', conf)
  const model = monaco.editor.createModel(
    sample,
    'skland-xml',
    monaco.Uri.parse('inmemory:///example.skland.xml'),
  )
  const editor = monaco.editor.create(document.querySelector<HTMLElement>('#editor')!, {
    model,
    minimap: { enabled: false },
    automaticLayout: true,
    tabSize: 2,
    fontSize: 14,
    ariaLabel: 'SKLand Wiki XML source',
    autoClosingBrackets: 'never',
    autoClosingQuotes: 'never',
    linkedEditing: true,
    scrollBeyondLastLine: false,
  })
  window.addEventListener(
    'pagehide',
    () => {
      editor.dispose()
      model.dispose()
      worker.terminate()
    },
    { once: true },
  )
  const client = await createMonacoClient(monaco, worker)
  client.attachModel(model)
  status.textContent = '语言服务已连接'
  const markers = monaco.editor.onDidChangeMarkers((resources) => {
    if (!resources.some((resource) => resource.toString() === model.uri.toString())) return
    const count = monaco.editor.getModelMarkers({ owner: 'skland-xml', resource: model.uri }).length
    status.textContent = count ? `${count} 条诊断` : '语言服务已连接'
  })
  const format = document.querySelector<HTMLButtonElement>('#format')!
  format.disabled = false
  format.addEventListener('click', () => {
    void editor.getAction('editor.action.formatDocument')?.run()
  })
  window.addEventListener(
    'pagehide',
    () => {
      markers.dispose()
      void client.dispose()
    },
    { once: true },
  )
}

void start().catch(() => {
  document.querySelector('#status')!.textContent = '语言服务连接失败'
})
