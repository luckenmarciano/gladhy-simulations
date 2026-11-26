// Uji "Kenapa Boom Bocor?" di <iframe sandbox="allow-scripts"> dengan CSP mount /games asli,
// dimainkan lewat UI di ukuran HP, lalu log dari postMessage diputar ulang di engine-core.
//   node scripts/sandbox-check-leak.mjs [outDir]
//   SEED=5 WRONG=1 → sengaja salah diagnosis di babak 2 dan mitigasi di babak 4
import http from 'node:http'
import { readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import * as Core from '../src/core/leak.js'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = process.argv[2] || path.join(root, 'dist/shots-leak')
mkdirSync(out, { recursive: true })
const buildHtml = readFileSync(path.join(root, 'dist/boom-bocor/index.html'))
const SEED = Number(process.env.SEED || 1)
const WRONG = !!process.env.WRONG

const GAME_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors *"

const host = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><body style="margin:0;background:#000">
<iframe id=g src="/games/x/1/index.html" sandbox="allow-scripts" style="width:100vw;height:100vh;border:0"></iframe>
<script>
window.msgs = []
const f = document.getElementById('g')
addEventListener('message', e => {
  if (e.source !== f.contentWindow) return
  window.msgs.push(e.data)
  if (e.data.type === 'scenario_ready') f.contentWindow.postMessage({type:'init', attemptId:'t1', seed:${SEED}, lang:'id'}, '*')
  if (e.data.type === 'scenario_complete') setTimeout(() => f.contentWindow.postMessage({type:'result', final: window.official.final, level: window.official.level, parts: window.official.parts}, '*'), 300)
})
</script>`

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/games/')) {
    res.setHeader('Content-Security-Policy', GAME_CSP)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.end(buildHtml)
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(host)
})
await new Promise((r) => server.listen(0, r))
const base = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const errors = []
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`) })
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))

await page.goto(base)
const fr = page.frameLocator('#g')
await fr.locator('#btnStart').waitFor({ timeout: 15000 })
await page.screenshot({ path: path.join(out, '0-briefing.png') })
await fr.locator('#btnStart').click()

for (const rd of Core.generateRounds(SEED)) {
  const f = Core.failureOf(rd.fail)
  const dx = WRONG && rd.i === 1 ? (rd.fail === 'entrainment' ? 'drainage' : 'entrainment') : rd.fail
  const fx = WRONG && rd.i === 3 ? (f.fix === 'skimmer' ? 'slow' : 'skimmer') : f.fix
  await page.waitForTimeout(900)
  await page.screenshot({ path: path.join(out, `${rd.i + 1}-${rd.fail}.png`) })
  await fr.locator(`.chip[data-dx="${dx}"]`).click()
  await fr.locator(`.chip[data-fx="${fx}"]`).click()
  if (rd.i === 1 || rd.i === 3) await page.screenshot({ path: path.join(out, `${rd.i + 1}-pembahasan.png`), fullPage: true })
  await fr.locator('#btnNext').click()
}

const log = await page.evaluate(() => new Promise((res) => {
  const t = setInterval(() => { const m = window.msgs.find((x) => x.type === 'scenario_complete'); if (m) { clearInterval(t); res(m.log) } }, 100)
}))
const { evaluation } = Core.replay(SEED, log)
await page.evaluate((ev) => { window.official = { final: ev.final, level: ev.level, parts: ev.parts.map((p) => ({ key: p.key, v: p.v })) } }, evaluation)
await page.waitForTimeout(1200)
await page.screenshot({ path: path.join(out, '7-hasil.png'), fullPage: true })

console.log(JSON.stringify({ seed: SEED, ops: log.length, final: evaluation.final, level: evaluation.level, parts: evaluation.parts.map((p) => p.key + ':' + p.v), errors }))
await browser.close(); server.close()
