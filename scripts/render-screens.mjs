// Renders the mock desktops in screens/desktop.html to public/screens/<device>.webp, at each
// screen's own aspect ratio. Needs Google Chrome; drives it headless over the DevTools protocol.
//
// Usage: npm run screens [-- neo mbp14 ...]   (defaults to every device)
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public/screens')
const page = pathToFileURL(join(root, 'screens/desktop.html')).href

/** Pixel size of each screen image: the display's aspect ratio, sharp enough for the details view. */
const DEVICES = {
  neo: [1600, 1000],
  mbp14: [1600, 1040],
  mbp16: [1600, 1034],
  imac: [1920, 1080],
  iphone: [590, 1282],
}

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function open() {
  const port = 9300 + Math.floor(Math.random() * 500)
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'screens-'))}`,
      '--allow-file-access-from-files',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  let target
  for (let i = 0; i < 50 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')
    } catch {
      // Chrome is still starting.
    }
    if (!target) await sleep(200)
  }
  if (!target) throw new Error(`Couldn't start Chrome at ${CHROME} (set CHROME to its path)`)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    pending.get(d.id)?.(d)
    pending.delete(d.id)
  }
  const send = (method, params = {}) =>
    new Promise((r) => {
      pending.set(++id, r)
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { send, close: () => (ws.close(), proc.kill()) }
}

const only = process.argv.slice(2)
const devices = Object.entries(DEVICES).filter(([d]) => !only.length || only.includes(d))
mkdirSync(outDir, { recursive: true })
const chrome = await open()
await chrome.send('Page.enable')
for (const [device, [width, height]] of devices) {
  await chrome.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await chrome.send('Page.navigate', { url: `${page}?d=${device}` })
  await sleep(1500)
  const shot = await chrome.send('Page.captureScreenshot', { format: 'png' })
  const out = join(outDir, `${device}.webp`)
  const info = await sharp(Buffer.from(shot.result.data, 'base64')).webp({ quality: 86 }).toFile(out)
  console.log(`${device.padEnd(7)} ${width}×${height}  ${Math.round(info.size / 1024)} KB`)
}
chrome.close()
