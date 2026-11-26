/**
 * Skenario "Tata Lokasi Aman" (tata-lokasi-v1). Tampilan 2D (SVG), tanpa three.js.
 *
 * Protokol postMessage v2 dengan halaman induk Gladhy (sama dengan skenario lain):
 *   build → induk : {type:'scenario_ready', protocol:2, scenario_key}
 *   induk → build : {type:'init', attemptId, seed, lang}
 *   build → induk : {type:'scenario_complete', protocol:2, log:[...]}
 *   induk → build : {type:'result', final, level, parts:[{key,v}], passed}
 *
 * Tanpa induk (dibuka langsung) build berjalan mandiri dengan benih acak.
 */
import { Game, ZONES, PPE, itemOf, taskOf, situationOf } from '../../core/site.js'

const SCENARIO_KEY = 'tata-lokasi-v1'
const $ = (id) => document.getElementById(id)
const NS = 'http://www.w3.org/2000/svg'
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const LEVEL_LABEL = { KOMPETEN: 'Kompeten', PERLU_BIMBINGAN: 'Perlu Bimbingan', BELUM_KOMPETEN: 'Belum Kompeten' }
const PART_LABEL = { zoning: 'Penempatan zona', ppe: 'Pemilihan APD', decisions: 'Keputusan keselamatan' }
const ZONE = Object.fromEntries(ZONES.map((z) => [z.k, z]))
const ZONE_COLOR = { red: '#f85149', yellow: '#e3b341', green: '#3fb950' }
const PPE_LABEL = Object.fromEntries(PPE.map((p) => [p.k, p.l]))

let game = null
let embedded = false
let mode = 'zone'        // zone → zoneFb → ppe → ppeFb → act → actFb
let pick = []            // APD yang sedang dipilih untuk tugas berjalan
let fbIndex = 0          // indeks tugas/situasi yang sedang dibahas

/* ═════════════ DENAH ═════════════ */
function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
  if (parent) parent.appendChild(n)
  return n
}

// Tiga pita dari laut ke darat, seperti diagram workbook hlm 22.
const BAND = { red: [0, 140], yellow: [140, 270], green: [270, 400] }

function drawMap() {
  const svg = $('svg')
  svg.replaceChildren()
  const d = el('defs', {}, svg)
  const g = el('linearGradient', { id: 'gSea', x1: 0, y1: 0, x2: 1, y2: 0 }, d)
  el('stop', { offset: 0, 'stop-color': '#0b3a55' }, g); el('stop', { offset: 1, 'stop-color': '#12608a' }, g)
  // laut, pantai berpasir, darat berumput
  el('rect', { width: 400, height: 300, fill: '#3d5c2e' }, svg)
  el('path', { d: 'M0 0 H215 Q190 150 225 300 H0Z', fill: '#c9b27a' }, svg)
  el('path', { d: 'M0 0 H95 Q70 150 105 300 H0Z', fill: 'url(#gSea)' }, svg)
  // minyak di tepi air
  el('path', { d: 'M88 40 q14 30 -2 60 q-10 30 8 70 q12 40 -4 90 l-20 0 q-6 -60 4 -110 q8 -60 -6 -110z', fill: '#1a120c', opacity: 0.85 }, svg)
  for (const z of ZONES) {
    const [x0, x1] = BAND[z.k]
    el('rect', { x: x0, y: 0, width: x1 - x0, height: 300, fill: ZONE_COLOR[z.k], opacity: 0.13 }, svg)
    el('line', { x1: x1, y1: 0, x2: x1, y2: 300, stroke: ZONE_COLOR[z.k], 'stroke-width': 2, 'stroke-dasharray': '6 5', opacity: 0.9 }, svg)
    const t = el('text', { x: (x0 + x1) / 2, y: 20, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 800, fill: '#fff', stroke: '#000', 'stroke-width': 3, 'paint-order': 'stroke' }, svg)
    t.textContent = z.l.toUpperCase()
  }
  // isi lokasi yang sudah ditempatkan, disusun dalam kisi di pita zonanya
  const slots = { red: 0, yellow: 0, green: 0 }
  game.q.items.forEach((k, i) => {
    const z = game.zones[i]
    if (!z) return
    const n = slots[z]++
    const [x0, x1] = BAND[z]
    const cols = 2, w = (x1 - x0) / cols
    const x = x0 + w * (n % cols) + w / 2, y = 52 + Math.floor(n / cols) * 44
    const showRes = mode !== 'zone'
    const ok = game.zoneOk(i)
    const it = itemOf(k)
    const grp = el('g', {}, svg)
    el('rect', { x: x - 26, y: y - 13, width: 52, height: 26, rx: 6, fill: '#e6edf3', stroke: showRes ? (ok ? '#3fb950' : '#f85149') : '#04070c', 'stroke-width': showRes ? 3 : 1.5 }, grp)
    const t = el('text', { x, y: y + 4.5, 'text-anchor': 'middle', 'font-size': 11.5, 'font-weight': 800, fill: '#04070c', 'font-family': 'ui-monospace,monospace' }, grp)
    t.textContent = it.code
    const n2 = el('text', { x: x + 21, y: y - 6, 'text-anchor': 'middle', 'font-size': 8.5, 'font-weight': 800, fill: '#04070c' }, grp)
    n2.textContent = String(i + 1)
  })
}

/* ═════════════ PANEL ═════════════ */
function setPhase(n, label) {
  $('phase').textContent = `Tahap ${n} dari 3 · ${label}`
  ;[...$('dots').children].forEach((dot, i) => { if (i === n - 1 && !dot.className) dot.className = 'on' })
}

function render() {
  // denah hanya perlu di tahap zona; di tahap lain layar HP dipakai untuk soal
  const onMap = mode === 'zone' || mode === 'zoneFb'
  $('view').classList.toggle('hide', !onMap)
  if (onMap) drawMap()
  const p = $('panel')
  let h = ''
  if (mode === 'zone' || mode === 'zoneFb') {
    const fb = mode === 'zoneFb'
    if (fb) {
      const ev = game.evaluate()
      const tone = ev.zonesOk === ev.zonesTotal ? 'ok' : ev.zonesOk >= ev.zonesTotal * 0.6 ? 'mid' : 'bad'
      h += `<div class="fb fb-${tone}"><b>${ev.zonesOk} dari ${ev.zonesTotal}</b> tepat. Zona Merah untuk yang sedang bekerja, ` +
        'Zona Kuning untuk dekontaminasi dan yang tidak dipakai, Zona Hijau untuk area bersih dan komando.</div>'
    } else {
      h += '<div class="qtitle">Tempatkan setiap isi lokasi ke zonanya</div>'
    }
    game.q.items.forEach((k, i) => {
      const it = itemOf(k)
      const cur = game.zones[i]
      const cls = fb ? (game.zoneOk(i) ? ' ok' : ' bad') : ''
      h += `<div class="item${cls}"><div class="il"><span class="code">${it.code}</span><span>${i + 1}. ${esc(it.l)}</span></div>`
      h += '<div class="zbtn">'
      for (const z of ZONES) {
        h += `<button class="chip z-${z.k}${cur === z.k ? ' sel' : ''}" data-i="${i}" data-zone="${z.k}"${fb ? ' disabled' : ''}>${z.l.replace('Zona ', '')}</button>`
      }
      h += '</div>'
      if (fb) h += `<div class="why">${game.zoneOk(i) ? '' : `Seharusnya ${it.z.map((z) => ZONE[z].l).join(' atau ')}. `}${esc(it.why)}</div>`
      h += '</div>'
    })
    if (fb) h += '<button id="btnNext">Lanjut ke APD</button>'
    else {
      const left = game.zones.filter((z) => z === null).length
      h += `<div class="err" id="err">${left ? `${left} belum ditempatkan.` : ''}</div>`
      h += `<button id="btnLockZ"${left ? ' disabled' : ''}>Kunci tata letak</button>`
    }
  } else if (mode === 'ppe' || mode === 'ppeFb') {
    const i = mode === 'ppe' ? game.cur : fbIndex
    const t = taskOf(game.q.tasks[i])
    const need = t.req.length
    const fb = mode === 'ppeFb'
    const chosen = fb ? game.ppe[i] : pick
    h += `<div class="report"><div class="k">Tugas ${i + 1} dari ${game.q.tasks.length}</div><div class="task">${esc(t.l)}</div></div>`
    h += `<div class="qtitle">Pilih ${need} APD yang wajib dipakai</div><div class="chips">`
    for (const pp of PPE) {
      const on = chosen.includes(pp.k)
      let extra = ''
      if (fb) extra = t.req.includes(pp.k) ? (on ? ' right' : ' wrong') : on ? ' wrong' : ''
      h += `<button class="chip opt${on ? ' sel' : ''}${extra}" data-ppe="${pp.k}"${fb ? ' disabled' : ''}>${esc(pp.l)}</button>`
    }
    h += '</div>'
    if (fb) {
      const hits = game.ppeHits(i)
      const tone = hits === need ? 'ok' : hits >= need - 1 ? 'mid' : 'bad'
      h += `<div class="fb fb-${tone}"><b>${hits} dari ${need}</b> APD wajib terpilih. Yang wajib: ${t.req.map((k) => PPE_LABEL[k]).join(', ')}.<br>${esc(t.why)}</div>`
      h += `<button id="btnNext">${game.stage === 'ppe' ? 'Tugas berikutnya' : 'Lanjut ke situasi lapangan'}</button>`
    } else {
      h += `<div class="count">${pick.length} dari ${need} dipilih</div><div class="err" id="err"></div>`
      h += `<button id="btnPpe"${pick.length === need ? '' : ' disabled'}>Kunci pilihan APD</button>`
    }
  } else if (mode === 'act' || mode === 'actFb') {
    const i = mode === 'act' ? game.cur : fbIndex
    const st = game.q.sits[i]
    const s = situationOf(st.k)
    const fb = mode === 'actFb'
    h += `<div class="report"><div class="k">Situasi ${i + 1} dari ${game.q.sits.length}</div><div class="sit">${esc(s.q)}</div></div>`
    h += '<div class="qtitle">Apa tindakan Anda?</div>'
    st.order.forEach((orig, pos) => {
      let extra = ''
      if (fb) extra = pos === st.correct ? ' right' : pos === game.acts[i] ? ' wrong' : ''
      h += `<button class="chip opt${extra}" data-act="${pos}"${fb ? ' disabled' : ''}>${esc(s.opts[orig])}</button>`
    })
    if (fb) {
      const ok = game.actOk(i)
      h += `<div class="fb fb-${ok ? 'ok' : 'bad'}">${ok ? 'Tepat.' : 'Kurang tepat.'} ${esc(s.why)}</div>`
      h += `<button id="btnNext">${game.stage === 'act' ? 'Situasi berikutnya' : 'Lihat hasil'}</button>`
    }
  }
  p.innerHTML = h
  bind()
}

function bind() {
  const p = $('panel')
  p.querySelectorAll('.chip[data-zone]').forEach((b) => b.addEventListener('click', () => {
    if (game.place(Number(b.dataset.i), b.dataset.zone).ok) { const y = window.scrollY; render(); window.scrollTo(0, y) }
  }))
  if ($('btnLockZ')) $('btnLockZ').onclick = () => {
    if (game.lockZones().ok) { mode = 'zoneFb'; render(); window.scrollTo(0, 0) }
  }
  p.querySelectorAll('.chip[data-ppe]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.ppe
    const need = taskOf(game.q.tasks[game.cur]).req.length
    if (pick.includes(k)) pick = pick.filter((x) => x !== k)
    else if (pick.length < need) pick = [...pick, k]
    else { $('err').textContent = `Sudah ${need} dipilih. Ketuk salah satu untuk membatalkannya.`; return }
    const y = window.scrollY; render(); window.scrollTo(0, y)
  }))
  if ($('btnPpe')) $('btnPpe').onclick = () => {
    const i = game.cur
    if (game.choosePpe(i, pick).ok) { fbIndex = i; mode = 'ppeFb'; render() }
  }
  p.querySelectorAll('.chip[data-act]').forEach((b) => b.addEventListener('click', () => {
    const i = game.cur
    if (game.decide(i, Number(b.dataset.act)).ok) { fbIndex = i; mode = 'actFb'; render() }
  }))
  if ($('btnNext')) $('btnNext').onclick = next
}

function markDot(n, v) { const dot = $('dots').children[n]; if (dot) dot.className = v >= 100 ? 'ok' : v >= 60 ? 'mid' : 'bad' }

function next() {
  if (mode === 'zoneFb') {
    markDot(0, game.evaluate().parts[0].v)
    mode = 'ppe'; pick = []; setPhase(2, 'APD')
  } else if (mode === 'ppeFb') {
    if (game.stage === 'ppe') { mode = 'ppe'; pick = [] } else { markDot(1, game.evaluate().parts[1].v); mode = 'act'; setPhase(3, 'Situasi') }
  } else if (mode === 'actFb') {
    if (game.stage === 'act') mode = 'act'
    else { markDot(2, game.evaluate().parts[2].v); return finishGame() }
  }
  render()
  window.scrollTo(0, 0)
}

/* ═════════════ HASIL ═════════════ */
function finishGame() {
  game.finish()
  showDebrief(null)
  if (embedded) parent.postMessage({ type: 'scenario_complete', protocol: 2, scenario_key: SCENARIO_KEY, log: game.log }, '*')
}

function showDebrief(official) {
  const ev = game.evaluate()
  const parts = official?.parts?.length ? official.parts : ev.parts
  const final = official ? Math.round(official.final) : ev.final
  const level = official?.level || ev.level
  const tone = level === 'KOMPETEN' ? 'ok' : level === 'PERLU_BIMBINGAN' ? 'mid' : 'bad'
  const color = (v) => (v >= 75 ? '#3fb950' : v >= 55 ? '#d29922' : '#f85149')

  let h = '<div class="eyebrow">Hasil Latihan · Tata Lokasi Aman</div>'
  h += `<div class="verdict v-${tone}">${LEVEL_LABEL[level] || esc(level)} · skor ${final}</div>`
  h += `<div class="hint" style="margin-bottom:12px">${official ? 'Skor resmi dari server Gladhy.' : embedded ? 'Menunggu skor resmi dari server…' : 'Skor latihan (mode mandiri).'}</div>`
  for (const p of parts) {
    h += `<div class="bar"><div class="top"><span>${PART_LABEL[p.key] || esc(p.key)}</span><b>${Math.round(p.v)}</b></div>` +
      `<div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, p.v))}%;background:${color(p.v)}"></div></div></div>`
  }
  h += '<h2 style="margin-top:14px">Konsep zona (hlm 22)</h2><table><tr><th>Zona</th><th>Isinya</th></tr>'
  for (const z of ZONES) h += `<tr><td><span class="sw" style="background:${ZONE_COLOR[z.k]}"></span>${z.l}</td><td>${z.d}</td></tr>`
  h += '</table>'
  h += '<ul class="notes">'
  h += '<li><b>Minyak bergerak satu arah.</b> Orang dan alat dari Zona Merah selalu lewat dekontaminasi di Zona Kuning sebelum masuk Zona Hijau.</li>'
  h += '<li><b>Dipakai atau tidak.</b> Alat yang sama bisa beda zona: absorbent yang sedang dipakai di Merah, cadangannya di Kuning.</li>'
  h += '<li><b>Minyak segar paling berbahaya.</b> Bahaya ledakan terbesar di tahap awal, terutama minyak ringan. Detektor gas dan posisi upwind lebih dulu, baru mendekat.</li>'
  h += '<li><b>Area kerja tertutup untuk umum.</b> Sukarelawan hanya bila ditunjuk pihak berwenang, media diberi pengarahan keselamatan, masyarakat dijaga dengan safety line.</li>'
  h += '</ul>'
  h += embedded
    ? '<button id="btnDone">Selesai</button>'
    : '<div class="brow"><button id="btnAgain">Ulangi dengan soal baru</button></div>'
  $('debrief').innerHTML = h
  $('play').classList.add('hide'); $('scrBrief').classList.add('hide'); $('scrDebrief').classList.remove('hide')
  if ($('btnDone')) $('btnDone').onclick = () => parent.postMessage({ type: 'close', protocol: 2 }, '*')
  if ($('btnAgain')) $('btnAgain').onclick = () => { initScenario((Math.random() * 4294967296) >>> 0); begin() }
  window.scrollTo(0, 0)
}

/* ═════════════ MULAI ═════════════ */
function initScenario(seed) {
  game = new Game(seed)
  mode = 'zone'; pick = []
  ;[...$('dots').children].forEach((d) => { d.className = '' })
  $('scrDebrief').classList.add('hide'); $('play').classList.add('hide'); $('scrBrief').classList.remove('hide')
}
function begin() {
  $('scrBrief').classList.add('hide'); $('play').classList.remove('hide')
  setPhase(1, 'Zona')
  render()
  window.scrollTo(0, 0)
}
$('btnStart').onclick = () => { if (game) begin() }

function setStatus(t) { $('status').textContent = t || ''; $('status').classList.toggle('hide', !t) }

const hasParent = window.parent !== window
if (!hasParent) {
  initScenario((Math.random() * 4294967296) >>> 0)
} else {
  setStatus('Menunggu sesi dari Gladhy…')
  $('scrBrief').classList.add('hide')
  let standalone = false
  addEventListener('message', (e) => {
    if (e.source !== window.parent) return
    const m = e.data || {}
    if (m.type === 'init' && !embedded && Number.isInteger(m.seed)) {
      embedded = true
      setStatus(null)
      initScenario(m.seed >>> 0)
    } else if (m.type === 'result' && embedded && game?.done) {
      showDebrief({ final: m.final, level: m.level, parts: m.parts })
    }
  })
  parent.postMessage({ type: 'scenario_ready', protocol: 2, scenario_key: SCENARIO_KEY }, '*')
  setTimeout(() => {
    if (embedded || standalone) return
    standalone = true; setStatus(null)
    initScenario((Math.random() * 4294967296) >>> 0)
  }, 6000)
}
