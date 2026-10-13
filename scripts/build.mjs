// Membangun:
//   dist/oilspill-boom/index.html   satu berkas, tanpa aset eksternal (siap diunggah ke Gladhy)
//   dist/oilspill-boom.zip          zip dengan index.html di root
//   dist/core/oilspill.cjs          engine-core versi CommonJS untuk backend Gladhy
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { zipSync, strToU8 } from 'fflate'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
rmSync(dist, { recursive: true, force: true })
mkdirSync(path.join(dist, 'oilspill-boom'), { recursive: true })
mkdirSync(path.join(dist, 'core'), { recursive: true })

// 1. klien: IIFE (skrip klasik, bukan modul) supaya jalan di iframe sandbox tanpa CORS
const client = await build({
  entryPoints: [path.join(root, 'src/scenarios/oilspill-boom/main.js')],
  bundle: true, minify: true, format: 'iife', target: ['es2020', 'safari15'],
  write: false, legalComments: 'none', logLevel: 'warning',
})
const js = client.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const tpl = readFileSync(path.join(root, 'src/scenarios/oilspill-boom/index.template.html'), 'utf8')
const html = tpl.replace('<!--SCRIPT-->', () => `<script>${js}</script>`)
writeFileSync(path.join(dist, 'oilspill-boom/index.html'), html)

// 2. zip (index.html di root, sesuai syarat POST /games/:id/build)
const zip = zipSync({ 'index.html': strToU8(html) }, { level: 9 })
writeFileSync(path.join(dist, 'oilspill-boom.zip'), zip)

// 3. engine-core untuk backend
await build({
  entryPoints: [path.join(root, 'src/core/oilspill.js')],
  bundle: true, format: 'cjs', platform: 'node', target: 'node18',
  outfile: path.join(dist, 'core/oilspill.cjs'), logLevel: 'warning',
})

console.log(`index.html ${(html.length / 1024).toFixed(0)} KB · zip ${(zip.length / 1024).toFixed(0)} KB`)
