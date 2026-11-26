// Membangun setiap skenario menjadi:
//   dist/<skenario>/index.html   satu berkas, tanpa aset eksternal (siap diunggah ke Gladhy)
//   dist/<skenario>.zip          zip dengan index.html di root
// dan engine-core versi CommonJS untuk backend Gladhy:
//   dist/core/<core>.cjs
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { zipSync, strToU8 } from 'fflate'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')

// Satu baris per skenario. `core` = engine-core yang juga dipakai server untuk replay.
const SCENARIOS = [
  { name: 'oilspill-boom', core: 'oilspill' },
  { name: 'pengamat-udara', core: 'aerial' },
]

rmSync(dist, { recursive: true, force: true })
mkdirSync(path.join(dist, 'core'), { recursive: true })

for (const s of SCENARIOS) {
  mkdirSync(path.join(dist, s.name), { recursive: true })
  // 1. klien: IIFE (skrip klasik, bukan modul) supaya jalan di iframe sandbox tanpa CORS
  const client = await build({
    entryPoints: [path.join(root, `src/scenarios/${s.name}/main.js`)],
    bundle: true, minify: true, format: 'iife', target: ['es2020', 'safari15'],
    write: false, legalComments: 'none', logLevel: 'warning',
  })
  const js = client.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
  const tpl = readFileSync(path.join(root, `src/scenarios/${s.name}/index.template.html`), 'utf8')
  const html = tpl.replace('<!--SCRIPT-->', () => `<script>${js}</script>`)
  writeFileSync(path.join(dist, s.name, 'index.html'), html)

  // 2. zip (index.html di root, sesuai syarat POST /games/:id/build)
  const zip = zipSync({ 'index.html': strToU8(html) }, { level: 9 })
  writeFileSync(path.join(dist, `${s.name}.zip`), zip)

  // 3. engine-core untuk backend
  await build({
    entryPoints: [path.join(root, `src/core/${s.core}.js`)],
    bundle: true, format: 'cjs', platform: 'node', target: 'node18',
    outfile: path.join(dist, `core/${s.core}.cjs`), logLevel: 'warning',
  })

  console.log(`${s.name}: index.html ${(html.length / 1024).toFixed(0)} KB · zip ${(zip.length / 1024).toFixed(0)} KB`)
}
