declare const chrome: { runtime: { getURL(path: string): string } }

const marker = document.createElement('output')
marker.id = 'skland-direct-worker-probe'
document.body.append(marker)

let worker: Worker | undefined
try {
  worker = new Worker(chrome.runtime.getURL('ace/xml-worker.js'), { type: 'module' })
  worker.addEventListener(
    'error',
    () => {
      marker.value = 'load-error'
      worker?.terminate()
    },
    { once: true },
  )
  worker.addEventListener(
    'message',
    ({ data }: MessageEvent<{ id: number; result?: unknown }>) => {
      if (data.id !== 1) return
      marker.value = data.result ? 'connected' : 'initialize-error'
      worker?.terminate()
    },
    { once: true },
  )
  worker.postMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { processId: null, rootUri: null, capabilities: {} },
  })
} catch (error) {
  marker.value = error instanceof DOMException ? error.name : 'constructor-error'
  worker?.terminate()
}

const iframe = document.createElement('iframe')
iframe.title = 'Extension-origin SKLand editor'
iframe.src = chrome.runtime.getURL('ace/index.html')
document.body.append(iframe)
