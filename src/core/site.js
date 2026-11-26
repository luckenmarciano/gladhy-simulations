/**
 * Engine-core "Tata Lokasi Aman" (OPRC-IMO Level 1, Modul 1.2): keselamatan di lokasi
 * penanggulangan tumpahan minyak.
 *
 * Tiga tahap, semuanya bersumber dari workbook Level 1:
 *   1. Zona     — menempatkan peralatan, fasilitas, dan personil ke Zona Merah, Kuning,
 *                 atau Hijau (konsep zona, hlm 22–23).
 *   2. APD      — memilih alat pelindung diri yang wajib untuk satu tugas (hlm 21, 23–24).
 *   3. Keputusan — memilih tindakan yang aman pada situasi di lapangan: bahaya ledakan
 *                 minyak ringan yang masih segar, sukarelawan, media, masyarakat, cuaca
 *                 (hlm 23–25).
 *
 * Tanpa DOM, tanpa Math.random: soal dibangkitkan dari satu benih (mulberry32), sehingga
 * backend bisa memutar ulang keputusan peserta dan menghitung skor resmi dengan kode yang
 * sama persis dengan yang berjalan di browser.
 *
 * Mode tim (satu peran per HP) menyusul. Ketiga tahap sengaja terpisah supaya nanti bisa
 * dibagi ke tiga peran: koordinator lokasi (zona), petugas K3 (APD), komandan (keputusan).
 */

export const ENGINE_VERSION = 'site-core@0.1.0'
export const MAX_OPS = 80

export const ZONES = [
  { k: 'red', l: 'Zona Merah', d: 'Peralatan, logistik, dan personil yang sedang bekerja' },
  { k: 'yellow', l: 'Zona Kuning', d: 'Dekontaminasi, pos keamanan, peralatan dan APD yang tidak dipakai' },
  { k: 'green', l: 'Zona Hijau', d: 'Kantin, akomodasi, pos keamanan, pos komando' },
]
const ZONE_KEYS = ZONES.map((z) => z.k)

/**
 * Isi lokasi (legenda diagram hlm 22). `z` = zona yang benar; Pos Keamanan tercantum di
 * Zona Kuning maupun Hijau, jadi keduanya diterima.
 */
export const ITEMS = [
  { k: 'rib_op', l: 'RIB yang sedang memasang boom', z: ['red'], code: 'RIB', why: 'Peralatan yang sedang bekerja ada di Zona Merah.' },
  { k: 'boom_on', l: 'Oil boom yang terpasang di air', z: ['red'], code: 'OB', why: 'Boom yang sedang dipakai termasuk peralatan yang bekerja: Zona Merah.' },
  { k: 'tank_on', l: 'Storage tank yang menampung minyak hasil skimmer', z: ['red'], code: 'ST', why: 'Storage tank yang sedang dipakai berada di Zona Merah.' },
  { k: 'abs_on', l: 'Absorbent yang sedang dipakai di tepi air', z: ['red'], code: 'AB', why: 'Absorbent yang sedang dipakai termasuk logistik yang bekerja: Zona Merah.' },
  { k: 'crew', l: 'Regu yang sedang mengangkat minyak', z: ['red'], code: 'P', why: 'Personil yang sedang bekerja berada di Zona Merah.' },
  { k: 'decon', l: 'Unit dekontaminasi', z: ['yellow'], code: 'DC', why: 'Area dekontaminasi ada di Zona Kuning, di antara area kerja dan area bersih.' },
  { k: 'container', l: 'Kontainer peralatan cadangan', z: ['yellow'], code: 'CT', why: 'Peralatan yang tidak sedang dipakai disimpan di Zona Kuning.' },
  { k: 'ppe_spare', l: 'APD cadangan yang belum dipakai', z: ['yellow'], code: 'APD', why: 'APD yang tidak dipakai disimpan di Zona Kuning.' },
  { k: 'abs_spare', l: 'Absorbent cadangan yang belum dipakai', z: ['yellow'], code: 'AB', why: 'Absorbent yang belum dipakai adalah logistik cadangan: Zona Kuning. Bandingkan dengan absorbent yang sedang dipakai.' },
  { k: 'boom_spare', l: 'Gulungan boom cadangan', z: ['yellow'], code: 'OB', why: 'Boom yang belum dipasang adalah peralatan yang tidak dipakai: Zona Kuning.' },
  { k: 'canteen', l: 'Kantin', z: ['green'], code: 'CA', why: 'Kantin harus di area bersih, Zona Hijau. Makan dan minum tidak boleh di dekat minyak.' },
  { k: 'tent', l: 'Tenda istirahat dan akomodasi', z: ['green'], code: 'TN', why: 'Akomodasi berada di Zona Hijau.' },
  { k: 'restroom', l: 'Toilet', z: ['green'], code: 'RS', why: 'Toilet di area bersih (Zona Hijau), seperti di diagram, setelah pekerja melewati dekontaminasi.' },
  { k: 'command', l: 'Pos komando', z: ['green'], code: 'PK', why: 'Pos komando berada di Zona Hijau, jauh dari bahaya tetapi tetap bisa memantau.' },
  { k: 'security', l: 'Pos keamanan', z: ['yellow', 'green'], code: 'PS', why: 'Pos keamanan tercantum di Zona Kuning dan Zona Hijau; keduanya benar.' },
]
const ITEM = Object.fromEntries(ITEMS.map((x) => [x.k, x]))

/** Alat pelindung diri (hlm 24). Urutan = urutan tombol di layar. */
export const PPE = [
  { k: 'helmet', l: 'Helm (pelindung kepala)' },
  { k: 'goggles', l: 'Kacamata pelindung' },
  { k: 'hearing', l: 'Pelindung pendengaran' },
  { k: 'respirator', l: 'Respirator' },
  { k: 'gloves', l: 'Sarung tangan' },
  { k: 'boots', l: 'Sepatu safety' },
  { k: 'coverall', l: 'Coverall / slicker suit' },
  { k: 'lifejacket', l: 'Life jacket' },
]
const PPE_KEYS = new Set(PPE.map((p) => p.k))

/** Tugas dan APD wajibnya. Peserta memilih tepat sebanyak `req`. */
export const TASKS = [
  { k: 'water', l: 'Memasang boom dari RIB di laut', req: ['lifejacket', 'gloves', 'coverall'],
    why: 'Bekerja di perairan wajib life jacket. Sarung tangan dan coverall melindungi kulit dari kontak dengan minyak.' },
  { k: 'fresh', l: 'Mendekati minyak ringan yang baru tumpah, uapnya masih kuat', req: ['respirator', 'goggles', 'gloves', 'coverall'],
    why: 'Uap minyak segar beracun bila terhirup (hlm 21), jadi respirator wajib. Kacamata, sarung tangan, dan coverall mencegah kontak dengan mata dan kulit.' },
  { k: 'pump', l: 'Menjalankan pompa transfer bermesin di samping storage tank', req: ['hearing', 'helmet', 'gloves', 'boots'],
    why: 'Mesin pompa bising, jadi pelindung pendengaran wajib. Helm dan sepatu safety untuk area kerja peralatan berat, sarung tangan untuk selang berminyak.' },
  { k: 'shore', l: 'Mengangkat pasir berminyak di pantai dengan sekop', req: ['gloves', 'boots', 'coverall'],
    why: 'Pekerjaan di pantai: kaki dan tangan paling banyak kena minyak, jadi sepatu safety, sarung tangan, dan coverall.' },
]
const TASK = Object.fromEntries(TASKS.map((t) => [t.k, t]))

/** Situasi lapangan. Pilihan pertama di sini selalu yang benar; urutan tampil diacak berbenih. */
export const SITUATIONS = [
  { k: 'fresh', q: 'Kapal tanker baru saja menumpahkan bensin. Tim ingin segera mendekat dengan RIB bermesin.',
    opts: ['Tahan dulu. Ukur dengan detektor gas dan mendekat dari arah datangnya angin (upwind).', 'Mendekat secepatnya dari arah mana saja supaya minyak tidak menyebar.', 'Mendekat dari arah bawah angin supaya uap tidak menghalangi pandangan.'],
    why: 'Bahaya ledakan paling besar di tahap awal, khususnya minyak ringan yang masih segar (hlm 24). Uap lebih berat dari udara dan bisa terbakar oleh percikan mesin. Selalu pakai detektor gas dan bekerja di sisi upwind (hlm 23).' },
  { k: 'volunteer', q: 'Puluhan warga datang dan ingin langsung ikut membersihkan pantai.',
    opts: ['Tidak diizinkan masuk kecuali ditunjuk pihak berwenang. Arahkan ke pos komando.', 'Izinkan, asal mereka memakai sarung tangan.', 'Izinkan di Zona Merah supaya pekerjaan lebih cepat selesai.'],
    why: 'Sukarelawan tidak boleh diizinkan kecuali ditunjuk oleh pihak yang lebih berwenang (hlm 24). Tanpa pengarahan dan APD lengkap mereka berisiko keracunan dan cedera.' },
  { k: 'media', q: 'Wartawan televisi meminta masuk ke area kerja untuk merekam.',
    opts: ['Beri pengarahan keselamatan dulu, lalu dampingi sesuai izin komando.', 'Tolak dan minta mereka meninggalkan lokasi.', 'Biarkan masuk sendiri, mereka sudah terbiasa di lapangan.'],
    why: 'Media yang memasuki area harus diberi pengarahan tindakan keselamatan (hlm 24). Menolak mentah-mentah tidak diminta; yang penting keselamatannya.' },
  { k: 'public', q: 'Banyak warga menonton dari dekat tepi pantai tempat regu bekerja.',
    opts: ['Pasang tanda peringatan dan safety line, jaga jarak masyarakat dari lokasi kerja.', 'Biarkan saja selama mereka tidak menyentuh minyak.', 'Hentikan pekerjaan sampai semua warga pulang.'],
    why: 'Masyarakat dijaga jaraknya dari lokasi kerja dengan tanda peringatan dan safety line (hlm 24).' },
  { k: 'decon', q: 'Seorang pekerja selesai dari Zona Merah dan ingin langsung ke kantin karena lapar.',
    opts: ['Lewat unit dekontaminasi di Zona Kuning dulu, lepas APD kotor, baru ke Zona Hijau.', 'Langsung ke kantin, cukup cuci tangan di sana.', 'Makan di Zona Merah supaya tidak membawa minyak ke kantin.'],
    why: 'Zona Kuning dengan area dekontaminasinya adalah pembatas antara area kerja dan area bersih (hlm 22). Minyak tidak boleh terbawa ke kantin.' },
  { k: 'pit', q: 'Regu harus memeriksa lubang penampungan minyak yang tertutup. Detektor gas belum dipakai.',
    opts: ['Jangan masuk tanpa respirator sampai pengukuran menyatakan tidak ada gas beracun atau mudah terbakar.', 'Masuk sebentar saja, kalau tidak tercium bau berarti aman.', 'Masuk dengan masker kain supaya lebih cepat.'],
    why: 'Anggap semua gas beracun sampai terverifikasi. Jangan memasuki lubang tanpa respirator kecuali hasil pengukuran menunjukkan gas benar-benar tidak ada (hlm 23).' },
  { k: 'heat', q: 'Siang hari terik, regu sudah dua jam bekerja dengan coverall di pantai.',
    opts: ['Atur istirahat bergilir di tempat teduh dan pastikan semua cukup minum.', 'Lepas coverall supaya tidak kepanasan, lanjutkan kerja.', 'Percepat kerja supaya bisa pulang lebih awal.'],
    why: 'Cuaca panas menyebabkan heat-stroke dan dehidrasi (hlm 25). APD tetap dipakai; risikonya dikendalikan dengan istirahat bergilir dan minum.' },
]

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
const take = (r, arr, n) => shuffle(r, arr).slice(0, n)

export const N_ITEMS = 9
export const N_TASKS = 3
export const N_SITS = 4

/**
 * Soal dari satu benih: 9 isi lokasi (3 merah, 3 kuning, 2 hijau, ditambah pos keamanan
 * atau satu hijau lagi), 3 tugas APD, 4 situasi dengan urutan pilihan diacak.
 */
export function generate(seedValue) {
  const r = mulberry32(seedValue)
  const by = (z) => ITEMS.filter((x) => x.z.length === 1 && x.z[0] === z).map((x) => x.k)
  const green = take(r, by('green'), 3)
  const extra = r() < 0.6 ? 'security' : green[2]
  const items = shuffle(r, [...take(r, by('red'), 3), ...take(r, by('yellow'), 3), green[0], green[1], extra])
  const tasks = take(r, TASKS.map((t) => t.k), N_TASKS)
  const sits = take(r, SITUATIONS.map((s) => s.k), N_SITS).map((k) => {
    const order = shuffle(r, [0, 1, 2])
    return { k, order, correct: order.indexOf(0) }
  })
  return { items, tasks, sits }
}

export const itemOf = (k) => ITEM[k]
export const taskOf = (k) => TASK[k]
export const situationOf = (k) => SITUATIONS.find((s) => s.k === k)

export class ReplayError extends Error {
  constructor(message) { super(message); this.name = 'ReplayError' }
}

/** Tahap permainan, berurutan. */
export const STAGES = ['zone', 'ppe', 'act', 'end', 'done']

/**
 * Keadaan satu permainan. Klien dan server sama-sama hanya memanggil method di bawah;
 * setiap pemanggilan yang sah dicatat di `log`.
 */
export class Game {
  constructor(seedValue) {
    this.seedValue = seedValue >>> 0
    this.q = generate(this.seedValue)
    this.zones = this.q.items.map(() => null)
    this.ppe = this.q.tasks.map(() => null)
    this.acts = this.q.sits.map(() => null)
    this.stage = 'zone'
    this.cur = 0          // indeks tugas (ppe) atau situasi (act) yang sedang dijawab
    this.log = []
  }

  get done() { return this.stage === 'done' }

  /** Menempatkan satu isi lokasi ke sebuah zona. Boleh diubah sampai zona dikunci. */
  place(i, v) {
    if (this.stage !== 'zone') return { ok: false }
    if (!Number.isInteger(i) || i < 0 || i >= this.zones.length || !ZONE_KEYS.includes(v)) return { ok: false }
    this.zones[i] = v
    this.log.push({ a: 'zone', i, v })
    return { ok: true }
  }

  /** Mengunci tata letak. Semua isi lokasi harus sudah punya zona. */
  lockZones() {
    if (this.stage !== 'zone') return { ok: false }
    if (this.zones.some((z) => z === null)) return { ok: false, why: 'zone' }
    this.stage = 'ppe'; this.cur = 0
    this.log.push({ a: 'lockz' })
    return { ok: true }
  }

  /** Memilih APD untuk tugas berjalan: tepat sebanyak APD wajib, tanpa duplikat. */
  choosePpe(i, v) {
    if (this.stage !== 'ppe' || i !== this.cur) return { ok: false }
    const need = TASK[this.q.tasks[i]].req.length
    if (!Array.isArray(v) || v.length !== need || new Set(v).size !== need || !v.every((k) => typeof k === 'string' && PPE_KEYS.has(k))) {
      return { ok: false, why: 'ppe', need }
    }
    this.ppe[i] = v.slice()
    this.log.push({ a: 'ppe', i, v: v.slice() })
    if (++this.cur >= this.ppe.length) { this.stage = 'act'; this.cur = 0 }
    return { ok: true }
  }

  /** Memilih tindakan untuk situasi berjalan (indeks pilihan sesuai urutan tampil). */
  decide(i, v) {
    if (this.stage !== 'act' || i !== this.cur) return { ok: false }
    if (!Number.isInteger(v) || v < 0 || v > 2) return { ok: false }
    this.acts[i] = v
    this.log.push({ a: 'act', i, v })
    if (++this.cur >= this.acts.length) this.stage = 'end'
    return { ok: true }
  }

  finish() {
    if (this.stage !== 'end') return { ok: false }
    this.stage = 'done'
    this.log.push({ a: 'end' })
    return { ok: true }
  }

  zoneOk(i) { return this.zones[i] !== null && ITEM[this.q.items[i]].z.includes(this.zones[i]) }
  ppeHits(i) { const req = TASK[this.q.tasks[i]].req; return (this.ppe[i] || []).filter((k) => req.includes(k)).length }
  actOk(i) { return this.acts[i] === this.q.sits[i].correct }

  evaluate() {
    const zOk = this.zones.filter((_, i) => this.zoneOk(i)).length
    const ppeScores = this.q.tasks.map((k, i) => (this.ppeHits(i) / TASK[k].req.length) * 100)
    const aOk = this.acts.filter((_, i) => this.actOk(i)).length
    const parts = [
      { key: 'zoning', w: 0.4, v: Math.round((zOk / this.zones.length) * 100) },
      { key: 'ppe', w: 0.3, v: Math.round(ppeScores.reduce((a, b) => a + b, 0) / ppeScores.length) },
      { key: 'decisions', w: 0.3, v: Math.round((aOk / this.acts.length) * 100) },
    ]
    const final = Math.round(parts.reduce((a, p) => a + p.v * p.w, 0))
    const level = final >= 75 ? 'KOMPETEN' : final >= 55 ? 'PERLU_BIMBINGAN' : 'BELUM_KOMPETEN'
    return { parts, final, level, zonesOk: zOk, zonesTotal: this.zones.length, actsOk: aOk, actsTotal: this.acts.length }
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
      case 'zone': need(g.place(op.i, op.v).ok, 'Penempatan zona tidak valid'); break
      case 'lockz': need(g.lockZones().ok, 'Zona dikunci sebelum lengkap'); break
      case 'ppe': need(g.choosePpe(op.i, op.v).ok, 'Pilihan APD tidak valid'); break
      case 'act': need(g.decide(op.i, op.v).ok, 'Pilihan tindakan tidak valid'); break
      case 'end': need(g.finish().ok, 'Selesai sebelum semua tahap dijawab'); break
      default: throw new ReplayError('Operasi tidak dikenal: ' + op.a.slice(0, 20))
    }
  }
  need(g.done, 'Permainan belum selesai')
  return { game: g, evaluation: g.evaluate() }
}
