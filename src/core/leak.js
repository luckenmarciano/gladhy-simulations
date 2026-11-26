/**
 * Engine-core "Kenapa Boom Bocor?" (OPRC-IMO Level 1, Modul 2.2): mengenali jenis kegagalan
 * oil boom dari tanda-tandanya di lapangan, lalu memilih cara mengatasinya.
 *
 * Sumber: tabel "Kegagalan Oil Boom" di workbook Level 1 hlm 58 (rinciannya hlm 54–57).
 * Setiap babak menampilkan satu kegagalan. Kondisi lapangan (arus, ombak, minyak di apex,
 * ballast, beban tarik) diundi berbenih; hanya kondisi yang menjadi penyebab yang di luar batas.
 *
 * Tanpa DOM, tanpa Math.random: soal dibangkitkan dari satu benih (mulberry32), sehingga
 * backend bisa memutar ulang keputusan peserta dan menghitung skor resmi dengan kode yang
 * sama persis dengan yang berjalan di browser.
 */

export const ENGINE_VERSION = 'leak-core@0.1.0'
export const MAX_OPS = 40

/** Cara mengatasi (kolom "Mitigasi" hlm 58). Urutan = urutan tombol di layar. */
export const FIXES = [
  { k: 'slow', l: 'Kurangi kecepatan' },
  { k: 'skimmer', l: 'Pasang skimmer' },
  { k: 'ballast', l: 'Gunakan oil boom dengan ballast yang sesuai standar' },
  { k: 'buoyancy', l: 'Gunakan oil boom dengan buoyancy ratio yang lebih tinggi' },
  { k: 'suitable', l: 'Gunakan oil boom yang sesuai dengan penggunaannya' },
]
const FIX_KEYS = FIXES.map((f) => f.k)

/** Enam kegagalan (hlm 54–58). Urutan = urutan tombol di layar. */
export const FAILURES = [
  { k: 'entrainment', l: 'Entrainment', cause: 'Arus terlalu cepat, lebih dari 0,7 knot', fix: 'slow',
    sign: 'Butiran minyak terlepas dari bawah lapisan dan terbawa lewat bawah skirt.' },
  { k: 'drainage', l: 'Drainage', cause: 'Terlalu banyak minyak di apex', fix: 'skimmer',
    sign: 'Minyak menumpuk tebal di apex sampai mencapai ujung skirt, lalu mengalir lewat bawahnya.' },
  { k: 'splashover', l: 'Splash-over', cause: 'Ombak terlalu tinggi', fix: 'buoyancy',
    sign: 'Ombak menghempas dan membawa minyak melewati bagian atas pelampung (freeboard).' },
  { k: 'submergence', l: 'Submergence', cause: 'Kecepatan arus lebih dari 5 knot', fix: 'slow',
    sign: 'Boom tertarik masuk ke bawah permukaan, minyak lolos lewat atasnya.' },
  { k: 'planing', l: 'Planing', cause: 'Ballast tidak bagus', fix: 'ballast',
    sign: 'Boom rebah ke samping, skirt terangkat ke permukaan, minyak lolos lewat bawahnya.' },
  { k: 'structural', l: 'Structural', cause: 'Dipaksa melebihi batasnya', fix: 'suitable',
    sign: 'Sambungan atau badan boom robek, minyak keluar lewat celahnya.' },
]
const FAIL = Object.fromEntries(FAILURES.map((f) => [f.k, f]))
export const failureOf = (k) => (Object.prototype.hasOwnProperty.call(FAIL, k) ? FAIL[k] : null)
export const fixOf = (k) => FIXES.find((f) => f.k === k) || null

export const ROUNDS = FAILURES.length

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function shuffle(r, arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)) % (i + 1); [a[i], a[j]] = [a[j], a[i]] }
  return a
}
const between = (r, lo, hi, step) => lo + Math.floor(r() * (Math.round((hi - lo) / step) + 1)) * step
const round1 = (x) => Math.round(x * 10) / 10

/**
 * Kondisi lapangan satu babak. Semua dalam batas normal kecuali penyebab kegagalannya:
 *   arus (knot), ombak (m), minyak di apex (0 tipis · 1 sedang · 2 menumpuk sampai ujung
 *   skirt), ballast ('ok' | 'bad'), beban tarik (% dari batas kerja boom).
 */
export function conditions(r, fail) {
  const c = {
    current: round1(between(r, 0.2, 0.6, 0.1)),
    wave: round1(between(r, 0.2, 0.5, 0.1)),
    apex: r() < 0.5 ? 0 : 1,
    ballast: 'ok',
    load: between(r, 40, 75, 5),
  }
  if (fail === 'entrainment') c.current = round1(between(r, 0.9, 2.0, 0.1))
  if (fail === 'drainage') c.apex = 2
  if (fail === 'splashover') c.wave = round1(between(r, 1.2, 2.0, 0.1))
  if (fail === 'submergence') { c.current = round1(between(r, 5.5, 7.0, 0.5)); c.load = between(r, 70, 90, 5) }
  if (fail === 'planing') c.ballast = 'bad'
  if (fail === 'structural') c.load = between(r, 130, 180, 10)
  return c
}

/** Enam babak dari satu benih: setiap kegagalan muncul sekali, urutannya diacak. */
export function generateRounds(seedValue) {
  const r = mulberry32(seedValue)
  return shuffle(r, FAILURES.map((f) => f.k)).map((fail, i) => ({ i, fail, cond: conditions(r, fail) }))
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
    this.answers = this.rounds.map(() => ({ dx: null, fx: null }))
    this.cur = 0
    this.done = false
    this.log = []
  }

  get round() { return this.rounds[this.cur] }

  /** Menebak jenis kegagalan babak berjalan. */
  diagnose(r, v) {
    if (this.done || r !== this.cur || this.answers[r].dx !== null || !failureOf(v)) return { ok: false }
    this.answers[r].dx = v
    this.log.push({ a: 'dx', r, v })
    return { ok: true }
  }

  /** Memilih cara mengatasi; hanya setelah diagnosis. Mengakhiri babak. */
  fix(r, v) {
    if (this.done || r !== this.cur || this.answers[r].dx === null || this.answers[r].fx !== null) return { ok: false }
    if (!FIX_KEYS.includes(v)) return { ok: false }
    this.answers[r].fx = v
    this.log.push({ a: 'fx', r, v })
    this.cur++
    return { ok: true }
  }

  finish() {
    if (this.done || this.cur < ROUNDS) return { ok: false }
    this.done = true
    this.log.push({ a: 'end' })
    return { ok: true }
  }

  dxOk(i) { return this.answers[i].dx === this.rounds[i].fail }
  fxOk(i) { return this.answers[i].fx === FAIL[this.rounds[i].fail].fix }

  evaluate() {
    const dx = this.rounds.filter((_, i) => this.dxOk(i)).length
    const fx = this.rounds.filter((_, i) => this.fxOk(i)).length
    const parts = [
      { key: 'diagnosis', w: 0.6, v: Math.round((dx / ROUNDS) * 100) },
      { key: 'mitigation', w: 0.4, v: Math.round((fx / ROUNDS) * 100) },
    ]
    const final = Math.round(parts.reduce((a, p) => a + p.v * p.w, 0))
    const level = final >= 75 ? 'KOMPETEN' : final >= 55 ? 'PERLU_BIMBINGAN' : 'BELUM_KOMPETEN'
    const perRound = this.rounds.map((rd, i) => ({ fail: rd.fail, dx: this.answers[i].dx, fx: this.answers[i].fx, dxOk: this.dxOk(i), fxOk: this.fxOk(i) }))
    return { parts, final, level, dxOk: dx, fxOk: fx, perRound }
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
      case 'dx': need(g.diagnose(op.r, op.v).ok, 'Diagnosis tidak valid'); break
      case 'fx': need(g.fix(op.r, op.v).ok, 'Pilihan mitigasi tidak valid'); break
      case 'end': need(g.finish().ok, 'Selesai sebelum semua babak dijawab'); break
      default: throw new ReplayError('Operasi tidak dikenal: ' + op.a.slice(0, 20))
    }
  }
  need(g.done, 'Permainan belum selesai')
  return { game: g, evaluation: g.evaluate() }
}

/** Angka dengan koma desimal (id-ID): 0,7 · 1,5 · 6 */
export const fmt = (x) => String(round1(x)).replace('.', ',')
