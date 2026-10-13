// Uji Fase 0: jalankan build di <iframe sandbox="allow-scripts"> dengan CSP yang sama seperti
// mount /games di gladhy-backend/src/app.js, lalu mainkan satu putaran lewat UI dan
// periksa protokol postMessage + replay log di engine-core.
//   node scripts/sandbox-check.mjs [outDir]
import http from 'node:http'
import { readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import * as Core from '../src/core/oilspill.js'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = process.argv[2] || path.join(root, 'dist/shots')
mkdirSync(out, { recursive: true })
const buildHtml = readFileSync(path.join(root, 'dist/oilspill-boom/index.html'))
const SEED = Number(process.env.SEED || 1)

// Persis CSP dari gladhy-backend/src/app.js (mount /games)
const GAME_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors *"

const host = `<!doctype html><meta charset=utf-8><body style="margin:0;background:#000">
<iframe id=g src="/games/x/1/index.html" sandbox="allow-scripts" allow="fullscreen" style="width:100vw;height:100vh;border:0"></iframe>
<script>
window.msgs = []
const f = document.getElementById('g')
addEventListener('message', e => {
  if (e.source !== f.contentWindow) return
  window.msgs.push(e.data)
  if (e.data.type === 'scenario_ready') f.contentWindow.postMessage({type:'init', attemptId:'t1', seed:${SEED}, lang:'id'}, '*')
})
</script>`

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/games/')) {
    res.setHeader('Content-Security-Policy', GAME_CSP)
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.end(buildHtml)
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(host)
})
await new Promise((r) => server.listen(0, r))
const base = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 900, height: 620 } })
const errors = []
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`) })
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))
page.on('requestfailed', (r) => errors.push('[requestfailed] ' + r.url()))
page.on('response', (r) => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`) })

await page.goto(base)
const frame = page.frameLocator('#g')
await frame.locator('#btnBrief').waitFor({ timeout: 20000 })
await page.screenshot({ path: path.join(out, '1-briefing.png') })

const seedInfo = Core.generateSeed(SEED)
const calm = seedInfo.curSpd <= Core.PERP_LIMIT
await frame.locator('#btnBrief').click()
await frame.locator('.dirbtn').nth(Math.round(seedInfo.driftDeg / 45) % 8).click()
await frame.locator('#btnPredict').click()
await frame.locator(`.opt[data-s=${calm ? 'encircle' : 'deflect'}]`).click()
await frame.locator('#btnStrategy').click()
await page.waitForTimeout(800)

const cx = 450, cy = 330
if (calm) {
  await page.mouse.click(cx + 150, cy - 20)
} else {
  await page.mouse.click(cx - 120, cy + 70)
  await page.mouse.click(cx + 90, cy + 40)
}
await page.waitForTimeout(1500)
await page.screenshot({ path: path.join(out, '2-penempatan.png') })

await frame.locator('#btnRun').click()
await page.waitForTimeout(500)
await frame.locator('#btnSpeed').click(); await frame.locator('#btnSpeed').click() // 4×
await page.waitForTimeout(6000)
await page.screenshot({ path: path.join(out, '3-berjalan.png') })

// Render perangkat lunak (swiftshader) lambat; hentikan lebih awal supaya uji cepat.
// Simulasi penuh sampai habis waktu diuji di test/core.test.js.
if (process.env.FULL !== '1') await frame.locator('#btnStop').click()
await page.waitForFunction(() => window.msgs.some((m) => m.type === 'scenario_complete'), null, { timeout: 300000 })
await page.waitForTimeout(800)
await page.screenshot({ path: path.join(out, '4-debrief.png') })

const msgs = await page.evaluate(() => window.msgs)
const done = msgs.find((m) => m.type === 'scenario_complete')
const { evaluation } = Core.replay(SEED, done.log)
const verdict = await frame.locator('#dVerdict').textContent()

// kirim skor resmi → build harus menampilkannya
await page.evaluate((ev) => document.getElementById('g').contentWindow.postMessage(
  { type: 'result', final: 12.3, level: 'BELUM_KOMPETEN', parts: [] }, '*'), evaluation)
await page.waitForTimeout(400)
const verdictOfficial = await frame.locator('#dVerdict').textContent()

console.log(JSON.stringify({
  messages: msgs.map((m) => m.type),
  logOps: done.log.map((o) => o.a),
  replayLevel: evaluation.level, replayFinal: Math.round(evaluation.final),
  uiVerdictLocal: verdict, uiVerdictOfficial: verdictOfficial,
  errors,
}, null, 2))
await browser.close(); server.close()
