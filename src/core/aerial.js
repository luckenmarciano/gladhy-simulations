/**
 * Engine-core "Pengamat Udara" (OPRC-IMO Level 1, Modul 1.1): memperkirakan volume
 * tumpahan minyak dari pengamatan udara.
 *
 * Peserta melihat slick dari pesawat, mengenali warna tampaknya, lalu menghitung volume
 * dengan aturan di workbook Level 1 (hlm 14, sumber IPIECA):
 *
 *   volume (m³) = panjang (km) × lebar (km) × faktor warna (m³/km²)
 *
 * Tanpa DOM, tanpa Math.random: soal dibangkitkan dari satu benih (mulberry32), sehingga
 * backend bisa memutar ulang keputusan peserta dan menghitung skor resmi dengan kode yang
 * sama persis dengan yang berjalan di browser.
 */

export const ENGINE_VERSION = 'aerial-core@0.1.0'
export const ROUNDS = 5
export const MAX_OPS = 64

/** Warna tampak → ketebalan dan volume per km². Urutan = urutan tombol di layar. */
export const CLASSES = [
  { k: 'silver', l: 'Keperakan', d: 'Oil sheen tipis, berkilau keperakan', mm: '> 0,0001', f: 0.1, thick: false },
  { k: 'rainbow', l: 'Pelangi', d: 'Oil sheen dengan warna pelangi', mm: '> 0,0003', f: 0.3, thick: false },
  { k: 'dark', l: 'Hitam / coklat gelap', d: 'Minyak mentah atau bahan bakar', mm: '> 0,1', f: 100, thick: true },
  { k: 'orange', l: 'Oranye', d: 'Emulsi air dalam minyak (mousse)', mm: '> 1,0', f: 1000, thick: true },
]
const CLASS = Object.fromEntries(CLASSES.map((c) => [c.k, c]))
export const classOf = (k) => (Object.prototype.hasOwnProperty.call(CLASS, k) ? CLASS[k] : null)

// Ukuran yang "enak dihitung", seperti di latihan workbook. Lapisan tipis memang luas,
// lapisan tebal memang sempit; itu sekaligus pelajaran prioritas di babak 4–5.
const THIN_L = [1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000]
const THIN_W = [100, 200, 250, 300, 400, 500, 800]
const THICK_L = [100, 150, 200, 250, 300, 400, 500, 800]
const THICK_W = [50, 80, 100, 150, 200, 250]

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length]
// Lebar tidak pernah melebihi panjang: pasangan yang terbalik ditukar saat diundi.
const dims = (r, Ls, Ws) => { const L = pick(r, Ls), W = pick(r, Ws); return L >= W ? { L, W } : { L: W, W: L } }

/** Luas (km²) dan volume (m³) satu bagian slick. Dihitung dari meter bulat supaya pasti. */
export const areaKm2 = (z) => (z.L * z.W) / 1e6
export const zoneVolume = (z, cls = z.cls) => areaKm2(z) * classOf(cls).f

/**
 * Lima babak dari satu benih:
 *   1 — satu bagian tipis (seperti Latihan 1 workbook)
 *   2 — satu bagian tebal (seperti Latihan 2)
 *   3 — satu bagian, jenis acak
 *   4, 5 — kepala tebal + ekor tipis; peserta juga memilih bagian yang ditangani lebih dulu
 */
export function generateRounds(seedValue) {
  const r = mulberry32(seedValue)
  const thin = () => ({ cls: pick(r, ['silver', 'rainbow']), ...dims(r, THIN_L, THIN_W) })
  const thick = () => ({ cls: pick(r, ['dark', 'orange']), ...dims(r, THICK_L, THICK_W) })
  const any = () => (r() < 0.5 ? thin() : thick())
  // Babak dua bagian: kepala tebal menyimpan sebagian besar volume (≥ 5× ekor tipis),
  // seperti slick sungguhan. Ekor diundi ulang (tetap berbenih) sampai syarat itu terpenuhi.
  const headTail = () => {
    const head = thick()
    let tail = thin()
    for (let k = 0; k < 50 && zoneVolume(tail) * 5 > zoneVolume(head); k++) tail = thin()
    return [head, tail]
  }
  const rounds = [[thin()], [thick()], [any()], headTail(), headTail()]
  return rounds.map((zones, i) => {
    return {
      i,
      zones: zones.map((z, j) => ({ ...z, id: j })),
      heading: Math.floor(r() * 360),         // arah sebaran di layar (visual saja)
      truth: zones.reduce((a, z) => a + zoneVolume(z), 0),
      priority: zones.length > 1 ? zones.findIndex((z) => classOf(z.cls).thick) : null,
    }
  })
}

/* ───────────────────────── penilaian ───────────────────────── */
const log10 = (x) => Math.log(x) / Math.LN10
const TOL_FULL = 0.05   // |log10(perkiraan/benar)| ≤ 0,05 → ±12 %: nilai penuh
const TOL_ZERO = 0.30   // > 0,30 → meleset lebih dari 2×: nilai 0

/** Nilai 0–100 untuk satu perkiraan volume. */
export function volumeScore(est, truth) {
  if (!(est > 0) || !(truth > 0)) return 0
  const e = Math.abs(log10(est / truth))
  if (e <= TOL_FULL) return 100
  if (e >= TOL_ZERO) return 0
  return Math.round(100 - ((e - TOL_FULL) / (TOL_ZERO - TOL_FULL)) * 70)
}

/** Mengapa perkiraan meleset, untuk umpan balik. */
export function diagnose(round, answer) {
  const est = answer.vol
  if (volumeScore(est, round.truth) === 100) return 'ok'
  const classesOk = round.zones.every((z) => answer.cls[z.id] === z.cls)
  if (!classesOk) {
    const mine = round.zones.reduce((a, z) => a + (answer.cls[z.id] ? zoneVolume(z, answer.cls[z.id]) : 0), 0)
    if (mine > 0 && volumeScore(est, mine) === 100) return 'class'   // hitungan benar, warna salah
  }
  if (est > 0) {
    const e = log10(est / round.truth)
    for (const k of [3, 6, -3, -6]) if (Math.abs(e - k) < 0.08) return 'unit'  // m ↔ km atau m² ↔ km²
  }
  return 'calc'
}

export class ReplayError extends Error {
  constructor(message) { super(message); this.name = 'ReplayError' }
}

/**
 * Keadaan satu permainan. Klien dan server sama-sama hanya memanggil method di bawah;
 * setiap pemanggilan yang sah dicatat di `log`.
 */
export class Game {
  constructor(seedValue) {
    this.seedValue = seedValue >>> 0
    this.rounds = generateRounds(this.seedValue)
    this.answers = this.rounds.map(() => ({ cls: {}, vol: null, pri: null }))
    this.cur = 0
    this.done = false
    this.log = []
  }

  get round() { return this.rounds[this.cur] }
  needsPriority(i = this.cur) { return this.rounds[i].priority !== null }

  /** Menandai warna tampak satu bagian slick di babak berjalan. */
  classify(r, z, v) {
    if (this.done || r !== this.cur) return { ok: false }
    const round = this.rounds[r]
    if (!Number.isInteger(z) || z < 0 || z >= round.zones.length || !classOf(v)) return { ok: false }
    if (this.answers[r].vol !== null) return { ok: false }
    this.answers[r].cls[z] = v
    this.log.push({ a: 'cls', r, z, v })
    return { ok: true }
  }

  /** Mengunci perkiraan volume babak berjalan. Semua bagian harus sudah diberi warna. */
  estimate(r, v) {
    if (this.done || r !== this.cur) return { ok: false }
    const ans = this.answers[r]
    if (ans.vol !== null) return { ok: false }
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1e9) return { ok: false, why: 'vol' }
    if (this.rounds[r].zones.some((z) => !ans.cls[z.id])) return { ok: false, why: 'cls' }
    ans.vol = v
    this.log.push({ a: 'vol', r, v })
    if (!this.needsPriority(r)) this.cur++
    return { ok: true }
  }

  /** Memilih bagian slick yang ditangani lebih dulu (babak dua bagian). */
  prioritize(r, z) {
    if (this.done || r !== this.cur || !this.needsPriority(r)) return { ok: false }
    const ans = this.answers[r]
    if (ans.vol === null || ans.pri !== null) return { ok: false }
    if (!Number.isInteger(z) || z < 0 || z >= this.rounds[r].zones.length) return { ok: false }
    ans.pri = z
    this.log.push({ a: 'pri', r, z })
    this.cur++
    return { ok: true }
  }

  finish() {
    if (this.done || this.cur < ROUNDS) return { ok: false }
    this.done = true
    this.log.push({ a: 'end' })
    return { ok: true }
  }

  evaluate() {
    let zones = 0, zonesOk = 0, pri = 0, priOk = 0
    const perRound = this.rounds.map((round, i) => {
      const ans = this.answers[i]
      round.zones.forEach((z) => { zones++; if (ans.cls[z.id] === z.cls) zonesOk++ })
      if (round.priority !== null) { pri++; if (ans.pri === round.priority) priOk++ }
      const vs = ans.vol === null ? 0 : volumeScore(ans.vol, round.truth)
      return { i, truth: round.truth, est: ans.vol, score: vs, why: ans.vol === null ? 'none' : diagnose(round, ans) }
    })
    const parts = [
      { key: 'identification', w: 0.3, v: Math.round((zonesOk / zones) * 100) },
      { key: 'volume', w: 0.5, v: Math.round(perRound.reduce((a, p) => a + p.score, 0) / perRound.length) },
      { key: 'priority', w: 0.2, v: Math.round((priOk / pri) * 100) },
    ]
    const final = Math.round(parts.reduce((a, p) => a + p.v * p.w, 0))
    const level = final >= 75 ? 'KOMPETEN' : final >= 55 ? 'PERLU_BIMBINGAN' : 'BELUM_KOMPETEN'
    return { parts, final, level, perRound, zones, zonesOk, pri, priOk }
  }
}

/** Server: memutar ulang log peserta dari benih yang disimpan server. Melempar ReplayError. */
export function replay(seedValue, log) {
  if (!Array.isArray(log) || log.length === 0 || log.length > MAX_OPS) throw new ReplayError('Log keputusan tidak valid')
  const g = new Game(seedValue)
  const need = (ok, msg) => { if (!ok) throw new ReplayError(msg) }
  for (const op of log) {
    need(op && typeof op === 'object' && typeof op.a === 'string', 'Operasi tidak dikenal')
    need(!g.done, 'Ada operasi setelah selesai')
    switch (op.a) {
      case 'cls': need(g.classify(op.r, op.z, op.v).ok, 'Penandaan warna tidak valid'); break
      case 'vol': need(g.estimate(op.r, op.v).ok, 'Perkiraan volume tidak valid'); break
      case 'pri': need(g.prioritize(op.r, op.z).ok, 'Pilihan prioritas tidak valid'); break
      case 'end': need(g.finish().ok, 'Selesai sebelum semua babak dijawab'); break
      default: throw new ReplayError('Operasi tidak dikenal: ' + op.a.slice(0, 20))
    }
  }
  need(g.done, 'Permainan belum selesai')
  return { game: g, evaluation: g.evaluate() }
}

/* ───────────────────────── format angka (id-ID) ───────────────────────── */
/** Angka dengan koma desimal, tanpa nol berlebih: 0,1 · 40 · 1.500 · 0,0375 */
export function fmt(x) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '–'
  const abs = Math.abs(x)
  const dec = abs >= 100 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6
  let s = x.toFixed(dec)
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  const [int, frac] = s.split('.')
  const intDots = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return frac ? `${intDots},${frac}` : intDots
}

/** Panjang dalam meter → teks seperti di laporan pengamat ("5 km", "200 m", "1,5 km"). */
export const fmtLen = (m) => (m >= 1000 ? `${fmt(m / 1000)} km` : `${m} m`)

/**
 * Membaca angka yang diketik peserta. Menerima "0,1", "0.1", "1.500" (titik ribuan),
 * "1.500,5", "40 m3". Mengembalikan NaN bila tidak bisa dibaca.
 */
export function parseNumber(text) {
  let s = String(text ?? '').trim().toLowerCase().replace(/\s|m3|m³/g, '')
  if (!s) return NaN
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.')
  else if (s.includes(',')) s = s.replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  if (!/^\d*\.?\d+$/.test(s)) return NaN
  return Number(s)
}
