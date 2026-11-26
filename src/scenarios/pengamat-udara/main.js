/**
 * Skenario "Pengamat Udara" (pengamat-udara-v1). Tampilan 2D (SVG), tanpa three.js.
 *
 * Protokol postMessage v2 dengan halaman induk Gladhy (sama dengan oilspill-boom):
 *   build → induk : {type:'scenario_ready', protocol:2, scenario_key}
 *   induk → build : {type:'init', attemptId, seed, lang}
 *   build → induk : {type:'scenario_complete', protocol:2, log:[...]}
 *   induk → build : {type:'result', final, level, parts:[{key,v}], passed}
 *
 * Tanpa induk (dibuka langsung) build berjalan mandiri dengan benih acak.
 */
import { Game, CLASSES, classOf, ROUNDS, fmt, fmtLen, parseNumber, areaKm2, zoneVolume, mulberry32, volumeScore, diagnose } from '../../core/aerial.js'

const SCENARIO_KEY = 'pengamat-udara-v1'
const $ = (id) => document.getElementById(id)
const NS = 'http://www.w3.org/2000/svg'
const LETTER = ['A', 'B']

const LEVEL_LABEL = { KOMPETEN: 'Kompeten', PERLU_BIMBINGAN: 'Perlu Bimbingan', BELUM_KOMPETEN: 'Belum Kompeten' }
const PART_LABEL = {
  identification: 'Mengenali warna tampak',
  volume: 'Ketepatan perkiraan volume',
  priority: 'Prioritas penanganan',
}

let game = null
let embedded = false
let selZone = 0
let stage = 'cls'        // cls → vol → pri → fb (per babak)
let lastFeedback = null
let view = 0             // babak yang sedang tampil (game.cur sudah maju saat pembahasan tampil)
const shown = () => game.rounds[view]

/* ═════════════ GAMBAR ═════════════ */
// Warna slick. Dibuat menyerupai foto udara, bukan kotak warna tombol, supaya peserta
// benar-benar mencocokkan tampilan dengan deskripsi di tabel.
const PAINT = {
  silver: { fill: 'url(#gSilver)', op: 0.55, edge: 'rgba(230,236,242,.35)' },
  rainbow: { fill: 'url(#gRainbow)', op: 0.6, edge: 'rgba(255,255,255,.25)' },
  dark: { fill: 'url(#gDark)', op: 0.93, edge: 'rgba(70,45,25,.9)' },
  orange: { fill: 'url(#gOrange)', op: 0.95, edge: 'rgba(120,55,15,.9)' },
}
const SWATCH = { silver: '#b9c4cc', rainbow: 'linear-gradient(90deg,#c86bd8,#5fd3e0,#e9e36a)', dark: '#1d140e', orange: '#b0581f' }

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
  if (parent) parent.appendChild(n)
  return n
}

function defs(svg) {
  const d = el('defs', {}, svg)
  const lin = (id, stops, x2 = '1', y2 = '0', spread = 'pad') => {
    const g = el('linearGradient', { id, x1: '0', y1: '0', x2, y2, spreadMethod: spread }, d)
    stops.forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, g))
  }
  lin('gSea', [['0', '#0f557a'], ['1', '#093147']], '0', '1')
  lin('gSilver', [['0', '#aab6bf'], ['.45', '#eef3f6'], ['.55', '#c7d1d8'], ['1', '#9aa7b1']])
  lin('gRainbow', [['0', '#d46ad8'], ['.18', '#7b7cf0'], ['.36', '#56c8ef'], ['.54', '#7fe08a'], ['.72', '#f0e05a'], ['.9', '#f0985a'], ['1', '#d46ad8']], '.22', '.3', 'reflect')
  lin('gDark', [['0', '#24180f'], ['.5', '#120c08'], ['1', '#2b1c10']])
  lin('gOrange', [['0', '#c0652a'], ['.5', '#9a4716'], ['1', '#c46d2f']])
  const f = el('filter', { id: 'soft', x: '-20%', y: '-20%', width: '140%', height: '140%' }, d)
  el('feGaussianBlur', { stdDeviation: '1.6' }, f)
  const pat = el('pattern', { id: 'waves', width: '40', height: '22', patternUnits: 'userSpaceOnUse' }, d)
  el('path', { d: 'M0 11 q10 -5 20 0 t20 0', fill: 'none', stroke: 'rgba(255,255,255,.07)', 'stroke-width': '1.2' }, pat)
}

/** Garis bentuk slick: elips memanjang searah sebaran, tepinya bergelombang (acak berbenih). */
function blob(cx, cy, rx, ry, angle, r, n = 26) {
  const pts = []
  const ph = r() * 6.28
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2
    const k = 1 + 0.13 * Math.sin(3 * t + ph) + 0.08 * Math.sin(5 * t + ph * 2) + (r() - 0.5) * 0.1
    const x = Math.cos(t) * rx * k, y = Math.sin(t) * ry * k
    const ca = Math.cos(angle), sa = Math.sin(angle)
    pts.push([cx + x * ca - y * sa, cy + x * sa + y * ca])
  }
  // kurva halus lewat titik tengah antar-titik
  let d = ''
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n]
    const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    d += i === 0 ? `M${m[0].toFixed(1)} ${m[1].toFixed(1)}` : ''
    const nx = pts[(i + 1) % n], mm = [(nx[0] + pts[(i + 2) % n][0]) / 2, (nx[1] + pts[(i + 2) % n][1]) / 2]
    d += ` Q${nx[0].toFixed(1)} ${nx[1].toFixed(1)} ${mm[0].toFixed(1)} ${mm[1].toFixed(1)}`
  }
  return d + 'Z'
}

function drawRound() {
  const svg = $('svg')
  svg.replaceChildren()
  defs(svg)
  el('rect', { width: 400, height: 300, fill: 'url(#gSea)' }, svg)
  el('rect', { width: 400, height: 300, fill: 'url(#waves)' }, svg)

  const round = shown()
  const r = mulberry32((game.seedValue ^ (round.i + 1) * 2654435761) >>> 0)  // visual saja
  // Arah sebaran di layar dibatasi agar slick panjang tetap muat dalam bingkai 4:3.
  const ang = (((round.heading % 120) - 60) * Math.PI) / 180
  const dir = [Math.cos(ang), Math.sin(ang)]
  const cx = 200, cy = 150

  const zones = round.zones
  const shapes = []
  if (zones.length === 1) {
    const z = zones[0]
    const aspect = Math.min(6, Math.max(1.3, z.L / z.W))
    const rx = 150, ry = Math.max(22, rx / aspect)
    shapes.push({ z, d: blob(cx, cy, rx, ry, ang, r), lx: cx, ly: cy })
  } else {
    // kepala tebal di depan (arah sebaran), ekor tipis memanjang di belakangnya
    const [head, tail] = zones
    const total = head.L + tail.L
    const span = 310
    const hl = Math.max(70, Math.min(150, (head.L / total) * span))
    const tl = span - hl * 0.6
    const tailC = [cx - dir[0] * (hl * 0.35), cy - dir[1] * (hl * 0.35)]
    const headC = [tailC[0] + dir[0] * (tl / 2), tailC[1] + dir[1] * (tl / 2)]
    const try_ = Math.max(26, Math.min(70, (tl / 2) / Math.min(6, Math.max(1.4, tail.L / tail.W))))
    const hry = Math.max(20, Math.min(40, (hl / 2) / Math.min(4, Math.max(1.2, head.L / head.W))))
    shapes.push({ z: tail, d: blob(tailC[0], tailC[1], tl / 2, try_, ang, r), lx: tailC[0] - dir[0] * tl * 0.25, ly: tailC[1] - dir[1] * tl * 0.25 })
    shapes.push({ z: head, d: blob(headC[0], headC[1], hl / 2, hry, ang, r), lx: headC[0], ly: headC[1] })
  }
  for (const s of shapes) {
    const p = PAINT[s.z.cls]
    const g = el('g', { class: 'zoneShape', 'data-z': s.z.id, style: 'cursor:pointer' }, svg)
    el('path', { d: s.d, fill: p.fill, opacity: p.op, stroke: p.edge, 'stroke-width': 1.5, filter: 'url(#soft)' }, g)
    if (s.z.cls === 'orange') {
      // tekstur "mousse": garis-garis gelap tipis
      for (let k = 0; k < 7; k++) {
        const t = (k / 6 - 0.5) * 0.8
        el('path', { d: s.d, fill: 'none', stroke: 'rgba(90,35,8,.35)', 'stroke-width': 0.8, transform: `translate(${(t * 10).toFixed(1)} ${(t * 6).toFixed(1)})`, opacity: 0.4 }, g)
      }
    }
    g.addEventListener('click', () => { if (stage === 'cls') { selZone = s.z.id; renderPanel() } })
    s.g = g
  }
  // label huruf
  for (const s of shapes) {
    if (zones.length < 2) continue
    const g = el('g', { class: 'lbl', 'data-z': s.z.id, 'pointer-events': 'none' }, svg)
    el('circle', { cx: s.lx, cy: s.ly, r: 11, fill: '#e6edf3', stroke: '#04070c', 'stroke-width': 2 }, g)
    const t = el('text', { x: s.lx, y: s.ly + 4, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 800, fill: '#04070c' }, g)
    t.textContent = LETTER[s.z.id]
  }
  // kapal sumber tumpahan di ujung depan
  const front = [cx + dir[0] * 165, cy + dir[1] * 120]
  el('rect', { x: front[0] - 9, y: front[1] - 3, width: 18, height: 6, rx: 3, fill: '#d0d6dc', transform: `rotate(${(ang * 180) / Math.PI} ${front[0]} ${front[1]})`, opacity: 0.8 }, svg)
  highlight()
}

function highlight() {
  document.querySelectorAll('#svg .zoneShape').forEach((g) => {
    const on = shown().zones.length > 1 && Number(g.dataset.z) === selZone && stage === 'cls'
    g.querySelector('path').setAttribute('stroke', on ? '#58a6ff' : PAINT[shown().zones[Number(g.dataset.z)].cls].edge)
    g.querySelector('path').setAttribute('stroke-width', on ? 3 : 1.5)
  })
}

/* ═════════════ PANEL ═════════════ */
const zoneName = (round, z) => (round.zones.length > 1 ? `Bagian ${LETTER[z.id]}` : 'Slick')

function reportHtml(round) {
  const rows = round.zones.map((z) =>
    `<div class="row"><span>${round.zones.length > 1 ? `<span class="tag">${LETTER[z.id]}</span>` : ''}${zoneName(round, z)}</span>` +
    `<b>panjang ${fmtLen(z.L)} · lebar ${fmtLen(z.W)}</b></div>`).join('')
  return `<div class="report"><div class="k">Laporan pengamat</div>${rows}</div>`
}

function renderPanel() {
  const round = shown()
  const ans = game.answers[round.i]
  const p = $('panel')
  let h = reportHtml(round)

  if (stage === 'cls' || stage === 'vol') {
    h += `<div class="qtitle">1. Warna tampak ${round.zones.length > 1 ? 'setiap bagian' : 'slick'}</div>`
    for (const z of round.zones) {
      h += `<div class="zone"><div class="zl">${round.zones.length > 1 ? `<span class="tag">${LETTER[z.id]}</span>` : ''}${zoneName(round, z)}</div><div class="chips">`
      for (const c of CLASSES) {
        h += `<button class="chip${ans.cls[z.id] === c.k ? ' sel' : ''}" data-z="${z.id}" data-c="${c.k}"${stage !== 'cls' ? ' disabled' : ''}>${c.l}<small>${c.d}</small></button>`
      }
      h += '</div></div>'
    }
    const ready = round.zones.every((z) => ans.cls[z.id])
    h += `<div class="qtitle">2. Perkiraan volume ${round.zones.length > 1 ? 'total (A + B)' : ''}</div>`
    h += `<div class="vol"><input id="inpVol" inputmode="decimal" autocomplete="off" placeholder="mis. 0,1" ${ready ? '' : 'disabled'}><span class="unit">m³</span></div>`
    h += '<div class="hint">Volume (m³) = panjang (km) × lebar (km) × volume per km² sesuai warna. Koma atau titik desimal sama-sama boleh.</div>'
    h += '<div class="err" id="err"></div>'
    h += `<button id="btnVol" ${ready ? '' : 'disabled'}>Kunci jawaban</button>`
  } else if (stage === 'pri') {
    h += '<div class="qtitle">3. Tim boom dan skimmer hanya bisa menangani satu bagian lebih dulu. Bagian mana?</div><div class="chips" style="grid-template-columns:1fr">'
    for (const z of round.zones) {
      h += `<button class="chip" data-pri="${z.id}"><span class="tag">${LETTER[z.id]}</span>${zoneName(round, z)} · panjang ${fmtLen(z.L)} · lebar ${fmtLen(z.W)}</button>`
    }
    h += '</div>'
  } else if (stage === 'fb') {
    h += lastFeedback
    h += `<button id="btnNext">${game.cur >= ROUNDS ? 'Lihat hasil' : 'Babak berikutnya'}</button>`
  }
  p.innerHTML = h

  p.querySelectorAll('.chip[data-c]').forEach((b) => b.addEventListener('click', () => {
    const z = Number(b.dataset.z)
    if (game.classify(round.i, z, b.dataset.c).ok) {
      selZone = Math.min(round.zones.length - 1, z + (round.zones.length > 1 && z === 0 ? 1 : 0))
      const keep = $('inpVol')?.value
      renderPanel()
      if (keep && $('inpVol')) $('inpVol').value = keep
    }
  }))
  if ($('btnVol')) $('btnVol').addEventListener('click', submitVolume)
  if ($('inpVol')) $('inpVol').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitVolume() })
  p.querySelectorAll('.chip[data-pri]').forEach((b) => b.addEventListener('click', () => {
    if (game.prioritize(round.i, Number(b.dataset.pri)).ok) showFeedback(round)
  }))
  if ($('btnNext')) $('btnNext').addEventListener('click', nextRound)
  highlight()
}

function submitVolume() {
  const round = shown()
  const v = parseNumber($('inpVol').value)
  if (!(v > 0)) { $('err').textContent = 'Isi volume dengan angka lebih dari 0, misalnya 0,1 atau 40.'; return }
  const r = game.estimate(round.i, v)
  if (!r.ok) { $('err').textContent = r.why === 'cls' ? 'Tentukan warna setiap bagian lebih dulu.' : 'Angka tidak bisa dipakai.'; return }
  if (game.needsPriority(round.i)) { stage = 'pri'; renderPanel() } else showFeedback(round)
}

/* ═════════════ UMPAN BALIK PER BABAK ═════════════ */
function calcLine(z, cls = z.cls) {
  const c = classOf(cls)
  return `${fmt(z.L / 1000)} km × ${fmt(z.W / 1000)} km = ${fmt(areaKm2(z))} km² × ${fmt(c.f)} m³/km² = <b>${fmt(zoneVolume(z, cls))} m³</b>`
}

function showFeedback(round) {
  const ans = game.answers[round.i]
  const score = volumeScore(ans.vol, round.truth)
  const why = diagnose(round, ans)
  const clsOk = round.zones.every((z) => ans.cls[z.id] === z.cls)
  const priOk = round.priority === null || ans.pri === round.priority
  const tone = score === 100 && clsOk && priOk ? 'ok' : score >= 30 ? 'mid' : 'bad'
  const dot = $('dots').children[round.i]
  if (dot) dot.className = tone

  let h = `<div class="fb fb-${tone}">`
  h += `Perkiraan Anda <b>${fmt(ans.vol)} m³</b>, volume sebenarnya <b>${fmt(round.truth)} m³</b>. `
  h += {
    ok: 'Tepat.',
    class: 'Hitungan Anda benar untuk warna yang Anda pilih, tetapi warnanya keliru, jadi faktor volumenya salah.',
    unit: 'Selisihnya kelipatan 1.000 atau 1.000.000: satuan tertukar. Ubah meter ke kilometer dulu (200 m = 0,2 km), lalu luas dalam km².',
    calc: 'Hitungannya meleset. Periksa lagi luas (km²) dan faktor volumenya.',
  }[why]
  for (const z of round.zones) {
    const okc = ans.cls[z.id] === z.cls
    h += `<div class="calc">${round.zones.length > 1 ? LETTER[z.id] + ': ' : ''}${classOf(z.cls).l}${okc ? '' : ` (Anda: ${classOf(ans.cls[z.id]).l})`}<br>${calcLine(z)}</div>`
  }
  if (round.priority !== null) {
    const head = round.zones[round.priority], tail = round.zones[1 - round.priority]
    const share = (zoneVolume(head) / round.truth) * 100
    const pct = share >= 99.5 ? 'lebih dari 99%' : `${Math.round(share)}%`
    h += `<div style="margin-top:8px">${priOk ? 'Prioritas tepat.' : 'Prioritas kurang tepat.'} Bagian ${LETTER[head.id]} hanya ${fmt(areaKm2(head))} km², ` +
      `tetapi menyimpan <b>${pct}</b> volume. Bagian ${LETTER[tail.id]} luas (${fmt(areaKm2(tail))} km²) namun hanya lapisan tipis yang ` +
      'cepat menguap dan terdispersi. Boom dan skimmer diarahkan ke bagian tebal.</div>'
  }
  h += '</div>'
  lastFeedback = h
  stage = 'fb'
  renderPanel()
}

function nextRound() {
  if (game.cur >= ROUNDS) return finishGame()
  startRound()
}

function startRound() {
  view = game.cur; stage = 'cls'; selZone = 0
  $('phase').textContent = `Babak ${game.cur + 1} dari ${ROUNDS}`
  ;[...$('dots').children].forEach((d, i) => { if (i === game.cur) d.classList.add('on') })
  drawRound()
  renderPanel()
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

  let h = '<div class="eyebrow">Hasil Latihan · Pengamat Udara</div>'
  h += `<div class="verdict v-${tone}">${LEVEL_LABEL[level] || level} · skor ${final}</div>`
  h += `<div class="hint" style="margin-bottom:12px">${official ? 'Skor resmi dari server Gladhy.' : embedded ? 'Menunggu skor resmi dari server…' : 'Skor latihan (mode mandiri).'}</div>`
  for (const p of parts) {
    h += `<div class="bar"><div class="top"><span>${PART_LABEL[p.key] || p.key}</span><b>${Math.round(p.v)}</b></div>` +
      `<div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, p.v))}%;background:${color(p.v)}"></div></div></div>`
  }
  h += '<h2 style="margin-top:14px">Rangkuman per babak</h2><table><tr><th>Babak</th><th>Jawaban</th><th>Benar</th></tr>'
  ev.perRound.forEach((pr, i) => {
    h += `<tr><td>${i + 1}</td><td class="n">${fmt(pr.est)} m³</td><td class="n">${fmt(pr.truth)} m³</td></tr>`
  })
  h += '</table>'
  h += '<h2>Tabel warna, ketebalan, dan volume</h2><table><tr><th>Warna tampak</th><th>Tebal (mm)</th><th>m³/km²</th></tr>'
  for (const c of CLASSES) {
    h += `<tr><td><span class="sw" style="background:${SWATCH[c.k]}"></span>${c.l}</td><td class="n">${c.mm}</td><td class="n">${fmt(c.f)}</td></tr>`
  }
  h += '</table><div class="hint">Sumber: IPIECA, seperti di workbook OPRC-IMO Level 1 hlm 14.</div>'
  h += '<ul class="notes">'
  h += '<li><b>Satuan dulu.</b> Ubah panjang dan lebar ke kilometer sebelum mengalikan. 200 m = 0,2 km, dan 1 km² = 1.000.000 m².</li>'
  h += '<li><b>Warna menentukan segalanya.</b> Faktor oranye (1.000) adalah 10.000 kali faktor keperakan (0,1). Salah mengenali warna lebih berbahaya daripada salah ukur.</li>'
  h += '<li><b>Luas tidak sama dengan banyak.</b> Sheen bisa menutupi berkilometer persegi tetapi isinya sedikit. Bagian tebal yang sempit menyimpan hampir seluruh minyak, jadi ke sanalah boom dan skimmer diarahkan.</li>'
  h += '<li><b>Ini perkiraan kasar.</b> Di lapangan slick jarang menutup penuh; pengamat juga memperkirakan persentase tutupan, dan hasilnya dicek ulang dengan penerbangan berikutnya.</li>'
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
  $('dots').innerHTML = Array.from({ length: ROUNDS }, () => '<i></i>').join('')
  $('scrDebrief').classList.add('hide'); $('play').classList.add('hide'); $('scrBrief').classList.remove('hide')
}
function begin() {
  $('scrBrief').classList.add('hide'); $('play').classList.remove('hide')
  startRound()
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
