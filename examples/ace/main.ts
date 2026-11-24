import type * as Ace from 'ace-builds'
import { createAceClient } from '@eihrteam/xml-ace-client'
import { sample } from '../sample.js'

declare const ace: typeof Ace

async function start(): Promise<void> {
  const status = document.querySelector<HTMLElement>('#status')!
  const worker = new Worker(new URL('./xml-worker.js', import.meta.url), {
    type: 'module',
    name: 'skland-xml',
  })
  ace.config.set('useStrictCSP', true)
  ace.config.set('loadWorkerFromBlob', false)
  const editor = ace.edit(document.querySelector<HTMLElement>('#editor')!, {
    mode: 'ace/mode/xml',
    tabSize: 2,
    fontSize: 14,
    useWorker: false,
    textInputAriaLabel: 'SKLand Wiki XML source',
  })
  editor.setValue(sample, -1)
  window.addEventListener(
    'pagehide',
    () => {
      editor.destroy()
      worker.terminate()
    },
    { once: true },
  )
  const client = await createAceClient(ace, worker)
  const attachment = client.attachEditor(editor, 'inmemory:///example.skland.xml')
  status.textContent = '语言服务已连接'
  editor.getSession().on('changeAnnotation', () => {
    const count = editor.getSession().getAnnotations().length
    status.textContent = count ? `${count} 条诊断` : '语言服务已连接'
  })
  const format = document.querySelector<HTMLButtonElement>('#format')!
  format.disabled = false
  format.addEventListener('click', () => {
    void attachment.format()
  })
  window.addEventListener(
    'pagehide',
    () => {
      void client.dispose()
    },
    { once: true },
  )
}

void start().catch(() => {
  document.querySelector('#status')!.textContent = '语言服务连接失败'
})
