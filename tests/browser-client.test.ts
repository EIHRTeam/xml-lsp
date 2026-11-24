import { describe, expect, test, vi } from 'vitest'
import { connectBrowserClient } from '@eihrteam/xml-browser-client'

class TestWorker extends EventTarget {
  onmessage: ((event: MessageEvent) => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn(({ method, id }: { method: string; id?: number }) => {
    if (!this.respond || (method !== 'initialize' && method !== 'shutdown')) return
    setTimeout(
      () =>
        this.onmessage?.(
          new MessageEvent('message', {
            data: { jsonrpc: '2.0', id, result: null },
          }),
        ),
      0,
    )
  })

  constructor(private readonly respond = true) {
    super()
  }

  get worker(): Worker {
    return this as unknown as Worker
  }
}

describe('browser Worker lifetime', () => {
  test('releases an initializing Worker immediately on abort', async () => {
    const transport = new TestWorker(false)
    const controller = new AbortController()
    const onUnexpectedClose = vi.fn()
    const opening = connectBrowserClient(transport.worker, {
      signal: controller.signal,
      onUnexpectedClose,
    })
    controller.abort()
    await expect(opening).rejects.toThrow()
    expect(transport.terminate).toHaveBeenCalledTimes(1)
    expect(transport.onmessage).toBeNull()
    expect(onUnexpectedClose).not.toHaveBeenCalled()
  })

  test('clears diagnostics and pending results exactly once after a Worker error', async () => {
    const transport = new TestWorker()
    const onUnexpectedClose = vi.fn()
    const client = await connectBrowserClient(transport.worker, { onUnexpectedClose })
    const onDiagnostics = vi.fn()
    const document = client.open('inmemory:///page.xml', '<', onDiagnostics)
    const completion = document.completion({ line: 0, character: 1 })
    transport.dispatchEvent(new Event('error'))
    transport.dispatchEvent(new Event('error'))
    expect(await completion).toBeNull()
    expect(onDiagnostics.mock.calls).toEqual([[[]]])
    expect(onUnexpectedClose).toHaveBeenCalledTimes(1)
    await client.dispose()
    expect(transport.terminate).toHaveBeenCalledTimes(1)
  })
})
