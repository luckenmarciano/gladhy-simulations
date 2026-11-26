/**
 * Skenario "Kenapa Boom Bocor?" (boom-bocor-v1). Tampilan 2D (SVG beranimasi), tanpa three.js.
 *
 * Protokol postMessage v2 dengan halaman induk Gladhy (sama dengan skenario lain):
 *   build → induk : {type:'scenario_ready', protocol:2, scenario_key}
 *   induk → build : {type:'init', attemptId, seed, lang}
 *   build → induk : {type:'scenario_complete', protocol:2, log:[...]}
 *   induk → build : {type:'result', final, level, parts:[{key,v}], passed}
 *
 * Tanpa induk (dibuka langsung) build berjalan mandiri dengan benih acak.
 */
import { Game, FAILURES, FIXES, ROUNDS, failureOf, fixOf, fmt } from '../../core/leak.js'

const SCENARIO_KEY = 'boom-bocor-v1'
const $ = (id) => document.getElementById(id)
const NS = 'http://www.w3.org/2000/svg'

const LEVEL_LABEL = { KOMPETEN: 'Kompeten', PERLU_BIMBINGAN: 'Perlu Bimbingan', BELUM_KOMPETEN: 'Belum Kompeten' }
const PART_LABEL = { diagnosis: 'Mengenali jenis kegagalan', mitigation: 'Memilih cara mengatasi' }
const APEX = ['Tipis', 'Sedang', 'Menumpuk sampai ujung skirt']

let game = null
let embedded = false
let stage = 'dx'         // dx → fx → fb
let view = 0             // babak yang sedang tampil (game.cur sudah maju saat pembahasan tampil)
const shown = () => game.rounds[view]

/* ═════════════ PENAMPANG BOOM ═════════════ */
function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
  if (parent) parent.appendChild(n)
  return n
}
const SURF = 120         // permukaan air
const BX = 262           // posisi boom

/** Tetes minyak yang bergerak di sepanjang lintasan, berulang. */
function drops(svg, d, n = 6, dur = 3.2, rr = 4) {
  for (let k = 0; k < n; k++) {
    const c = el('circle', { r: rr - (k % 2), fill: '#1a120c', stroke: '#3b2a1c', 'stroke-width': 0.8, opacity: 0 }, svg)
    el('animateMotion', { dur: `${dur}s`, repeatCount: 'indefinite', path: d, begin: `${((k * dur) / n).toFixed(2)}s` }, c)
    el('animate', { attributeName: 'opacity', values: '0;1;1;0', keyTimes: '0;.1;.85;1', dur: `${dur}s`, repeatCount: 'indefinite', begin: `${((k * dur) / n).toFixed(2)}s` }, c)
  }
}

function drawBoom(svg, { dy = 0, tilt = 0, torn = false } = {}) {
  const g = el('g', { transform: `translate(${BX} ${SURF - 8 + dy}) rotate(${tilt})` }, svg)
  if (torn) {
    el('rect', { x: -3, y: 12, width: 6, height: 28, fill: '#e8b400' }, g)
    el('path', { d: 'M-3 40 l3 4 l3 -5', fill: 'none', stroke: '#e8b400', 'stroke-width': 1.5 }, g)
    el('rect', { x: -3, y: 62, width: 6, height: 22, fill: '#e8b400' }, g)
    el('path', { d: 'M-3 62 l3 -4 l3 5', fill: 'none', stroke: '#e8b400', 'stroke-width': 1.5 }, g)
  } else {
    el('rect', { x: -3, y: 12, width: 6, height: 72, fill: '#e8b400' }, g)
  }
  el('circle', { cx: 0, cy: 86, r: 4, fill: '#6e7681' }, g)                  // ballast
  el('circle', { cx: 0, cy: 0, r: 14, fill: '#f2c200', stroke: '#8a6d00', 'stroke-width': 1.5 }, g) // pelampung
  el('text', { x: 0, y: 4, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 800, fill: '#5a4700' }, g).textContent = 'BOOM'
}

function drawRound() {
  const svg = $('svg')
  svg.replaceChildren()
  const rd = shown()
  const c = rd.cond
  const d = el('defs', {}, svg)
  const g = el('linearGradient', { id: 'gW', x1: 0, y1: 0, x2: 0, y2: 1 }, d)
  el('stop', { offset: 0, 'stop-color': '#13608a' }, g); el('stop', { offset: 1, 'stop-color': '#062436' }, g)
  el('rect', { width: 400, height: SURF, fill: '#1d2a38' }, svg)
  // permukaan air; ombak tinggi pada splash-over
  const amp = rd.fail === 'splashover' ? 16 : 3
  const wave = () => {
    let p = `M-40 ${SURF}`
    for (let x = -40; x < 440; x += 40) p += ` q10 ${-amp} 20 0 q10 ${amp} 20 0`
    return p + ' L440 300 L-40 300Z'
  }
  const w = el('path', { d: wave(), fill: 'url(#gW)' }, svg)
  el('animateTransform', { attributeName: 'transform', type: 'translate', values: '0 0;40 0', dur: rd.fail === 'splashover' ? '1.4s' : '3s', repeatCount: 'indefinite' }, w)
  // panah arus, lebih panjang dan cepat bila arus kencang
  const fast = c.current > 0.7
  for (let k = 0; k < 4; k++) {
    const y = 160 + k * 30
    const a = el('path', { d: `M0 ${y} h${fast ? 34 : 20} m-6 -4 l6 4 l-6 4`, stroke: 'rgba(255,255,255,.35)', 'stroke-width': 2, fill: 'none' }, svg)
    el('animateTransform', { attributeName: 'transform', type: 'translate', values: `${-40 + k * 20} 0;${400 + k * 20} 0`, dur: `${fast ? (c.current > 5 ? 1.2 : 2.4) : 6}s`, repeatCount: 'indefinite', begin: `${k * 0.4}s` }, a)
  }
  el('text', { x: 390, y: 22, 'text-anchor': 'end', 'font-size': 12, 'font-weight': 700, fill: 'rgba(255,255,255,.8)' }, svg).textContent = `Arus ${fmt(c.current)} knot →`

  // lapisan minyak di hulu boom; tebal sampai ujung skirt pada drainage
  const deep = rd.fail === 'drainage' ? 200 : c.apex === 1 ? 140 : 132
  el('path', { d: `M40 ${SURF} L${BX - 14} ${SURF} L${BX - 8} ${deep} Q${BX - 60} ${SURF + 12} 40 ${SURF + 3}Z`, fill: '#1a120c', opacity: 0.95 }, svg)

  const f = rd.fail
  if (f === 'entrainment') {
    drawBoom(svg)
    drops(svg, `M${BX - 30} 134 Q${BX - 10} 175 ${BX + 4} 205 Q${BX + 30} 200 ${BX + 70} 150 T${BX + 120} ${SURF + 4}`, 7, 3, 3.5)
  } else if (f === 'drainage') {
    drawBoom(svg)
    drops(svg, `M${BX - 8} 196 Q${BX} 214 ${BX + 20} 205 Q${BX + 60} 170 ${BX + 100} ${SURF + 4}`, 6, 3.6, 5)
  } else if (f === 'splashover') {
    drawBoom(svg)
    drops(svg, `M${BX - 40} ${SURF - 2} Q${BX - 6} ${SURF - 60} ${BX + 30} ${SURF - 4} L${BX + 80} ${SURF + 2}`, 5, 2, 4.5)
  } else if (f === 'submergence') {
    drawBoom(svg, { dy: 26, tilt: -25 })
    drops(svg, `M${BX - 40} ${SURF + 3} L${BX} ${SURF + 4} L${BX + 90} ${SURF + 3}`, 7, 2.2, 4)
  } else if (f === 'planing') {
    drawBoom(svg, { dy: 2, tilt: -68 })
    drops(svg, `M${BX - 30} 128 Q${BX - 10} 150 ${BX + 30} 150 Q${BX + 70} 140 ${BX + 100} ${SURF + 4}`, 6, 3, 4)
  } else if (f === 'structural') {
    drawBoom(svg, { torn: true })
    drops(svg, `M${BX - 30} 128 Q${BX - 6} 150 ${BX + 4} 158 L${BX + 70} 160 Q${BX + 100} 140 ${BX + 110} ${SURF + 4}`, 6, 2.6, 4)
  }
}

/* ═════════════ PANEL ═════════════ */
function condHtml(rd) {
  const c = rd.cond
  const reveal = stage === 'fb'
  const hi = (bad) => (reveal && bad ? ' class="hi"' : '')
  return '<div class="report"><div class="k">Kondisi lapangan</div><div class="cond">' +
    `<span>Kecepatan arus relatif terhadap boom</span><b${hi(c.current > 0.7)}>${fmt(c.current)} knot</b>` +
    `<span>Tinggi ombak</span><b${hi(c.wave >= 1)}>${fmt(c.wave)} m</b>` +
    `<span>Minyak di apex</span><b${hi(c.apex === 2)}>${APEX[c.apex]}</b>` +
    `<span>Ballast</span><b${hi(c.ballast === 'bad')}>${c.ballast === 'ok' ? 'Sesuai standar' : 'Rantai ballast putus sebagian'}</b>` +
    `<span>Beban tarik</span><b${hi(c.load > 100)}>${c.load}% dari batas kerja</b>` +
    '</div></div>'
}

function renderPanel() {
  const rd = shown()
  const ans = game.answers[rd.i]
  let h = condHtml(rd)
  if (stage === 'dx') {
    h += '<div class="qtitle">1. Jenis kegagalan apa yang terjadi?</div><div class="chips">'
    for (const f of FAILURES) h += `<button class="chip" data-dx="${f.k}">${f.l}</button>`
    h += '</div>'
  } else if (stage === 'fx') {
    h += `<div class="qtitle">1. Jenis kegagalan: <span style="color:#79c0ff">${failureOf(ans.dx).l}</span></div>`
    h += '<div class="qtitle">2. Bagaimana mengatasinya?</div><div class="chips fixes" style="grid-template-columns:1fr">'
    for (const x of FIXES) h += `<button class="chip" data-fx="${x.k}">${x.l}</button>`
    h += '</div>'
  } else {
    const f = failureOf(rd.fail)
    const dxOk = game.dxOk(rd.i), fxOk = game.fxOk(rd.i)
    const tone = dxOk && fxOk ? 'ok' : dxOk || fxOk ? 'mid' : 'bad'
    h += `<div class="fb fb-${tone}">`
    h += `<b>${f.l} failure.</b> ${dxOk ? 'Diagnosis tepat.' : `Anda menjawab ${failureOf(ans.dx).l}.`}<br>`
    h += `Tanda: ${f.sign}<br>Penyebab: ${f.cause}.<br>`
    h += `Mitigasi: <b>${fixOf(f.fix).l}</b>. ${fxOk ? 'Pilihan Anda tepat.' : `Anda memilih “${fixOf(ans.fx).l}”.`}`
    if (f.k === 'submergence') h += '<br>Arus di atas 0,7 knot juga menimbulkan entrainment, tetapi di sini boom sendiri yang tertarik ke bawah: tanda submergence.'
    if (f.k === 'drainage') h += '<br>Arusnya pelan, jadi bukan entrainment. Masalahnya volume minyak yang ditampung terlalu banyak.'
    h += '</div>'
    h += `<button id="btnNext">${game.cur >= ROUNDS ? 'Lihat hasil' : 'Babak berikutnya'}</button>`
  }
  const p = $('panel')
  p.innerHTML = h
  p.querySelectorAll('.chip[data-dx]').forEach((b) => b.addEventListener('click', () => {
    if (game.diagnose(rd.i, b.dataset.dx).ok) { stage = 'fx'; renderPanel() }
  }))
  p.querySelectorAll('.chip[data-fx]').forEach((b) => b.addEventListener('click', () => {
    if (game.fix(rd.i, b.dataset.fx).ok) {
      stage = 'fb'
      const dot = $('dots').children[rd.i]
      if (dot) dot.className = game.dxOk(rd.i) && game.fxOk(rd.i) ? 'ok' : game.dxOk(rd.i) || game.fxOk(rd.i) ? 'mid' : 'bad'
      renderPanel()
    }
  }))
  if ($('btnNext')) $('btnNext').onclick = () => (game.cur >= ROUNDS ? finishGame() : startRound())
}

function startRound() {
  view = game.cur; stage = 'dx'
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

  let h = '<div class="eyebrow">Hasil Latihan · Kenapa Boom Bocor?</div>'
  h += `<div class="verdict v-${tone}">${LEVEL_LABEL[level] || level} · skor ${final}</div>`
  h += `<div class="hint" style="margin-bottom:12px">${official ? 'Skor resmi dari server Gladhy.' : embedded ? 'Menunggu skor resmi dari server…' : 'Skor latihan (mode mandiri).'}</div>`
  for (const p of parts) {
    h += `<div class="bar"><div class="top"><span>${PART_LABEL[p.key] || p.key}</span><b>${Math.round(p.v)}</b></div>` +
      `<div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, p.v))}%;background:${color(p.v)}"></div></div></div>`
  }
  h += '<h2 style="margin-top:14px">Kegagalan oil boom (hlm 58)</h2><table><tr><th>Kegagalan</th><th>Penyebab</th><th>Mitigasi</th></tr>'
  for (const f of FAILURES) {
    const pr = ev.perRound.find((x) => x.fail === f.k)
    const mark = pr ? (pr.dxOk && pr.fxOk ? ' ✓' : ' ✗') : ''
    h += `<tr><td>${f.l}${mark}</td><td>${f.cause}</td><td>${fixOf(f.fix).l}</td></tr>`
  }
  h += '</table>'
  h += '<ul class="notes">'
  h += '<li><b>Lihat dulu dari mana minyak lolos.</b> Lewat bawah skirt (entrainment, drainage, planing), lewat atas pelampung (splash-over, submergence), atau lewat celah (structural).</li>'
  h += '<li><b>Arus adalah musuh utama.</b> Di atas 0,7 knot relatif terhadap boom, minyak mulai lolos. Mengurangi kecepatan atau memasang boom bersudut adalah langkah pertama.</li>'
  h += '<li><b>Boom bukan tangki.</b> Minyak yang terkumpul di apex harus segera diangkat skimmer; kalau dibiarkan menumpuk, akan lolos sendiri.</li>'
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
