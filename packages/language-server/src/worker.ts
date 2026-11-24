import { startBrowserServer } from './browser.js'

startBrowserServer(self as DedicatedWorkerGlobalScope)
