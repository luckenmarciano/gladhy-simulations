/**
 * Engine-core: simulasi tumpahan minyak + boom fleksibel, TANPA three.js dan TANPA DOM.
 *
 * Dipakai di dua tempat dengan kode yang sama persis:
 *   - klien (di dalam build three.js) untuk menjalankan simulasi yang dilihat peserta;
 *   - backend Gladhy untuk memutar ulang keputusan peserta dan menghitung skor resmi.
 *
 * Aturan agar hasilnya bisa diputar ulang:
 *   - semua keacakan datang dari PRNG berbenih (mulberry32), tidak pernah Math.random();
 *   - langkah waktu tetap (DT), tidak bergantung frame rate;
 *   - jumlah partikel tetap (MAX_OIL) di semua perangkat; kualitas visual hanya
 *     memengaruhi berapa banyak yang digambar;
 *   - tidak memakai Math.hypot / Math.exp (hasilnya boleh berbeda antar mesin JS).
 *
 * Catatan jujur: Math.sin/cos/atan2 tidak dijamin identik bit-per-bit antara V8 dan
 * JavaScriptCore. Hasil replay di server bisa berbeda sangat kecil dari yang tampil di
 * perangkat peserta. Karena itu skor RESMI selalu skor hasil replay server.
 *
 * Konvensi arah: x = timur, z = selatan. Arah (derajat) = ke mana sesuatu MENUJU.
 */

/* ───────────────────────── konstanta ───────────────────────── */
export const SHORE_Z = 210
export const SIM_TIME = 75            // detik simulasi
export const DT = 1 / 30              // langkah tetap (detik simulasi)
export const BOOM_SUBSTEPS = 2        // iterasi fisika boom per langkah (H = 1/60)
export const PERP_LIMIT = 0.7         // ambang entrainment (knot)
export const KN = 9.5                 // 1 knot -> unit/detik
export const MAX_SEG = 3
export const SEG_MAX = 150
export const SUPPLY = 600             // persediaan boom (m)
export const NODE_SP = 4.5
export const MAX_OIL = 900
export const SETTLE_ITERS = 240       // iterasi awal agar boom melengkung sebelum minyak keluar
export const TOTAL_STEPS = Math.round(SIM_TIME / DT)

const DRAG = 4
const DAMP = 0.9
const ITER = 12
const H = 1 / 60

export const SHIP_C = { x: -30, z: -95 }
// rotasi kapal -8° (dihitung sekali, ditulis literal supaya sama di semua mesin)
const COS_R = 0.9902680687415704
const SIN_R = -0.13917310096006544
export const LEAK = {
  x: SHIP_C.x + -30 * COS_R + 24 * SIN_R,
  z: SHIP_C.z - -30 * SIN_R + 24 * COS_R,
}

export const DIRS = [
  { l: 'Utara', s: 'U', d: 0 }, { l: 'Timur Laut', s: 'TL', d: 45 }, { l: 'Timur', s: 'T', d: 90 },
  { l: 'Tenggara', s: 'TG', d: 135 }, { l: 'Selatan', s: 'S', d: 180 }, { l: 'Barat Daya', s: 'BD', d: 225 },
  { l: 'Barat', s: 'B', d: 270 }, { l: 'Barat Laut', s: 'BL', d: 315 },
]

/* ───────────────────────── util ───────────────────────── */
const rad = (d) => (d * Math.PI) / 180
const hyp = (a, b) => Math.sqrt(a * a + b * b)
export const vec = (d) => ({ x: Math.sin(rad(d)), z: -Math.cos(rad(d)) })
export const angDiff = (a, b) => Math.abs((((a - b + 540) % 360) + 360) % 360 - 180)
export const nameOf = (d) => DIRS.reduce((a, b) => (angDiff(b.d, d) < angDiff(a.d, d) ? b : a)).l

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Kondisi awal dari satu bilangan benih (uint32). Server menyimpan bilangan ini. */
export function generateSeed(seedValue) {
  const r = mulberry32(seedValue)
  const curDeg = 155 + r() * 50
  const curSpd = r() < 0.5 ? 0.25 + r() * 0.42 : 0.85 + r() * 0.55
  const windDeg = curDeg - 50 + r() * 100
  const windSpd = 6 + r() * 12
  const c = vec(curDeg), w = vec(windDeg)
  const dx = c.x * curSpd + w.x * windSpd * 0.03
  const dz = c.z * curSpd + w.z * windSpd * 0.03
  const driftDeg = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360
  return { seedValue: seedValue >>> 0, curDeg, curSpd, windDeg, windSpd, driftDeg }
}

/* ───────────────────────── boom ───────────────────────── */
function makeBoom(pts, closed, fixedIdx, restScale) {
  const nodes = pts.map((p) => ({ x: p.x, z: p.z, px: p.x, pz: p.z, fixed: false }))
  const links = []
  const c = nodes.length
  const lc = closed ? c : c - 1
  for (let i = 0; i < lc; i++) {
    const j = (i + 1) % c
    links.push({ i, j, rest: hyp(nodes[j].x - nodes[i].x, nodes[j].z - nodes[i].z) * restScale, leak: 0 })
  }
  fixedIdx.forEach((i) => { nodes[i].fixed = true })
  return { nodes, links, closed, hits: 0, leaks: 0, bb: [0, 0, 0, 0], collect: null, init: pts.map((p) => ({ x: p.x, z: p.z })) }
}

function deflectBoom(a, b) {
  const chord = hyp(b.x - a.x, b.z - a.z)
  const n = Math.max(8, Math.round((chord * 1.08) / NODE_SP) + 1)
  const pts = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    pts.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })
  }
  return makeBoom(pts, false, [0, n - 1], 1.08)
}

function ringPerimeter(A) {
  const B = A * 0.62
  return Math.PI * (3 * (A + B) - Math.sqrt((3 * A + B) * (A + 3 * B)))
}

function ringBoom(A) {
  const B = A * 0.62
  const N = Math.round(ringPerimeter(A) / NODE_SP)
  const pts = []
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    pts.push({ x: SHIP_C.x + Math.cos(a) * A, z: SHIP_C.z + Math.sin(a) * B })
  }
  const anchors = []
  for (let k = 0; k < 6; k++) anchors.push(Math.round((k * N) / 6) % N)
  const b = makeBoom(pts, true, anchors, 1.0)
  b.ringA = A; b.ringB = B
  anchors.forEach((i) => {
    const q = b.nodes[i]
    q.x = q.px = SHIP_C.x + (q.x - SHIP_C.x) * 0.955
    q.z = q.pz = SHIP_C.z + (q.z - SHIP_C.z) * 0.955
  })
  return b
}

export const boomLength = (b) => b.links.reduce((s, l) => s + l.rest, 0)

function segCross(x1, z1, x2, z2, a, c) {
  const s1 = (c.x - a.x) * (z1 - a.z) - (c.z - a.z) * (x1 - a.x)
  const s2 = (c.x - a.x) * (z2 - a.z) - (c.z - a.z) * (x2 - a.x)
  if (s1 * s2 > 0) return false
  const d = (c.x - a.x) * (z2 - z1) - (c.z - a.z) * (x2 - x1)
  if (Math.abs(d) < 1e-9) return false
  const t = ((x1 - a.x) * (z2 - z1) - (z1 - a.z) * (x2 - x1)) / d
  return t >= 0 && t <= 1
}

function insideRing(b, x, z) {
  let hit = false
  const N = b.nodes
  for (let i = 0, j = N.length - 1; i < N.length; j = i++) {
    const a = N[i], c = N[j]
    if ((a.z > z) !== (c.z > z) && x < ((c.x - a.x) * (z - a.z)) / (c.z - a.z) + a.x) hit = !hit
  }
  return hit
}

const CELL = 12
const cellKey = (ix, iz) => (ix + 512) * 1024 + (iz + 512)

/** Indeks spasial ruas boom → sel, supaya partikel hanya menguji ruas di dekatnya. */
function buildGrid(b) {
  const grid = new Map()
  b.links.forEach((l, li) => {
    const a = b.nodes[l.i], c = b.nodes[l.j]
    const x0 = Math.floor((Math.min(a.x, c.x) - 2) / CELL), x1 = Math.floor((Math.max(a.x, c.x) + 2) / CELL)
    const z0 = Math.floor((Math.min(a.z, c.z) - 2) / CELL), z1 = Math.floor((Math.max(a.z, c.z) + 2) / CELL)
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = cellKey(ix, iz)
        const cell = grid.get(k)
        if (cell) cell.push(li); else grid.set(k, [li])
      }
    }
  })
  b.grid = grid
}

export class ReplayError extends Error {
  constructor(message) { super(message); this.name = 'ReplayError' }
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 5000

/* ───────────────────────── simulasi ───────────────────────── */
export class Sim {
  constructor(seedValue) {
    this.seed = generateSeed(seedValue)
    const s = this.seed
    const cv = vec(s.curDeg), wv = vec(s.windDeg)
    this.curFlow = { x: cv.x * s.curSpd * KN, z: cv.z * s.curSpd * KN }
    this.windFlow = { x: wv.x * s.windSpd * 0.03 * KN, z: wv.z * s.windSpd * 0.03 * KN }
    this.rng = mulberry32((seedValue ^ 0x9e3779b9) >>> 0)
    this.phase = 'deploy'            // deploy → run → done
    this.predicted = null
    this.strategy = null
    this.booms = []
    this.ringIdx = -1
    this.parts = []
    this.spawned = 0
    this.spawnAcc = 0
    this.leaks = 0
    this.recovered = 0
    this.steps = 0
    this.log = []                    // keputusan peserta, dikirim ke server
  }

  get t() { return this.steps * DT }
  get supplyUsed() { return Math.round(this.booms.reduce((s, b) => s + boomLength(b), 0)) }

  /* — keputusan — */
  setPrediction(deg) {
    if (this.phase !== 'deploy') return { ok: false, error: 'phase' }
    if (!finite(deg) || deg < 0 || deg > 360) return { ok: false, error: 'invalid' }
    this.predicted = deg
    this.log.push({ a: 'predict', deg })
    return { ok: true }
  }

  setStrategy(v) {
    if (this.phase !== 'deploy' || this.booms.length) return { ok: false, error: 'phase' }
    if (v !== 'encircle' && v !== 'deflect') return { ok: false, error: 'invalid' }
    this.strategy = v
    this.log.push({ a: 'strategy', v })
    return { ok: true }
  }

  /** Cincin boom: (x,z) = titik yang diketuk; menentukan lebar sumbu panjang. */
  placeRing(x, z) {
    if (this.phase !== 'deploy' || this.strategy !== 'encircle') return { ok: false, error: 'phase' }
    if (!finite(x) || !finite(z)) return { ok: false, error: 'invalid' }
    const A = Math.max(92, Math.min(175, hyp(x - SHIP_C.x, (z - SHIP_C.z) / 0.62)))
    this.booms = [ringBoom(A)]
    this.ringIdx = 0
    this.log.push({ a: 'ring', x, z })
    const len = this.supplyUsed
    return { ok: true, length: len, overSupply: len > SUPPLY }
  }

  /** Satu segmen boom (deflection) dari titik jangkar a ke b. */
  placeSegment(a, b) {
    if (this.phase !== 'deploy' || this.strategy !== 'deflect') return { ok: false, error: 'phase' }
    if (![a?.x, a?.z, b?.x, b?.z].every(finite)) return { ok: false, error: 'invalid' }
    if (this.booms.length >= MAX_SEG) return { ok: false, error: 'max' }
    const len = hyp(b.x - a.x, b.z - a.z)
    if (len < 25) return { ok: false, error: 'short' }
    if (len > SEG_MAX) return { ok: false, error: 'long' }
    const nb = deflectBoom({ x: a.x, z: a.z }, { x: b.x, z: b.z })
    if (this.supplyUsed + boomLength(nb) > SUPPLY) return { ok: false, error: 'supply' }
    this.booms.push(nb)
    this.log.push({ a: 'seg', ax: a.x, az: a.z, bx: b.x, bz: b.z })
    return { ok: true, count: this.booms.length, length: this.supplyUsed }
  }

  undo() {
    if (this.phase !== 'deploy' || !this.booms.length) return { ok: false, error: 'empty' }
    this.booms.pop()
    if (this.strategy === 'encircle') this.ringIdx = -1
    this.log.push({ a: 'undo' })
    return { ok: true }
  }

  /** Satu iterasi fisika boom untuk tampilan saat penempatan (tidak memengaruhi hasil). */
  relaxBooms() { for (const b of this.booms) this.stepBoom(b) }

  start() {
    if (this.phase !== 'deploy') return { ok: false, error: 'phase' }
    if (this.predicted == null || !this.strategy) return { ok: false, error: 'incomplete' }
    if (!this.booms.length) return { ok: false, error: 'no-boom' }
    // Boom dikembalikan ke posisi awal lalu diistirahatkan secara kanonis, agar hasil
    // tidak bergantung pada berapa lama peserta menunggu sebelum menekan Jalankan.
    for (const b of this.booms) {
      b.nodes.forEach((q, i) => { q.x = q.px = b.init[i].x; q.z = q.pz = b.init[i].z })
      if (b.closed) {
        b.nodes.forEach((q) => {
          if (q.fixed) {
            q.x = q.px = SHIP_C.x + (q.x - SHIP_C.x) * 0.955
            q.z = q.pz = SHIP_C.z + (q.z - SHIP_C.z) * 0.955
          }
        })
      }
      for (let i = 0; i < SETTLE_ITERS; i++) this.stepBoom(b)
    }
    this.phase = 'run'
    this.log.push({ a: 'start' })
    return { ok: true }
  }

  /** Maju satu langkah tetap. */
  step() {
    if (this.phase !== 'run') return
    for (let k = 0; k < BOOM_SUBSTEPS; k++) for (const b of this.booms) this.stepBoom(b)
    if (this.t < SIM_TIME * 0.5) {
      this.spawnAcc += (DT * MAX_OIL) / (SIM_TIME * 0.5)
      while (this.spawnAcc >= 1 && this.spawned < MAX_OIL) { this.spawn(); this.spawnAcc -= 1 }
    }
    this.stepOil(DT)
    this.steps++
    if (this.steps >= TOTAL_STEPS) this.finish(true)
  }

  /** Akhiri simulasi (otomatis di akhir waktu, atau peserta menekan Hentikan). */
  finish(auto = false) {
    if (this.phase !== 'run') return
    this.phase = 'done'
    this.log.push({ a: 'finish', n: this.steps, auto })
  }

  /* — fisika — */
  stepBoom(b) {
    const N = b.nodes, c = N.length
    const cf = this.curFlow, wf = this.windFlow
    for (let i = 0; i < c; i++) {
      const q = N[i]
      if (q.fixed) continue
      const pr = N[i > 0 ? i - 1 : (b.closed ? c - 1 : i)]
      const nx = N[i < c - 1 ? i + 1 : (b.closed ? 0 : i)]
      let tx = nx.x - pr.x, tz = nx.z - pr.z
      const L = hyp(tx, tz) || 1
      tx /= L; tz /= L
      const nnx = -tz, nnz = tx
      const vn = cf.x * nnx + cf.z * nnz + 0.25 * (wf.x * nnx + wf.z * nnz)
      const vx = (q.x - q.px) * DAMP, vz = (q.z - q.pz) * DAMP
      q.px = q.x; q.pz = q.z
      q.x += vx + DRAG * vn * nnx * H * H
      q.z += vz + DRAG * vn * nnz * H * H
    }
    for (let it = 0; it < ITER; it++) {
      for (const l of b.links) {
        const A = N[l.i], B = N[l.j]
        const dx = B.x - A.x, dz = B.z - A.z, d = hyp(dx, dz)
        if (d <= l.rest || d === 0 || (A.fixed && B.fixed)) continue
        const k = (d - l.rest) / d
        if (A.fixed) { B.x -= dx * k; B.z -= dz * k }
        else if (B.fixed) { A.x += dx * k; A.z += dz * k }
        else { A.x += dx * k * 0.5; A.z += dz * k * 0.5; B.x -= dx * k * 0.5; B.z -= dz * k * 0.5 }
      }
    }
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9
    for (const q of N) {
      if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x
      if (q.z < z0) z0 = q.z; if (q.z > z1) z1 = q.z
    }
    b.bb[0] = x0 - 6; b.bb[1] = x1 + 6; b.bb[2] = z0 - 6; b.bb[3] = z1 + 6
    if (!b.closed) {
      const e0 = N[0], e1 = N[c - 1]
      const dvx = this.curFlow.x + this.windFlow.x, dvz = this.curFlow.z + this.windFlow.z
      const hi = e1.x * dvx + e1.z * dvz > e0.x * dvx + e0.z * dvz
      b.collect = hi
        ? { x: e1.x, z: e1.z, ox: e1.x - e0.x, oz: e1.z - e0.z }
        : { x: e0.x, z: e0.z, ox: e0.x - e1.x, oz: e0.z - e1.z }
    }
  }

  perpKnots(tx, tz) {
    const cv = vec(this.seed.curDeg)
    const along = Math.abs(cv.x * tx + cv.z * tz)
    return this.seed.curSpd * Math.sqrt(Math.max(0, 1 - along * along))
  }

  spawn() {
    const r = this.rng
    this.parts.push({
      x: LEAK.x + (r() - 0.5) * 4, z: LEAK.z + (r() - 0.5) * 4,
      age: 0, rot: r() * 6.283, held: 0, band: r() * 7,
      ign: -1, leaked: false, state: 'float',
      sx: (r() - 0.5) * 2, sz: 0.4 + r() * 0.8,
    })
    this.spawned++
  }

  pushOutOfHull(p) {
    const dx = p.x - SHIP_C.x, dz = p.z - SHIP_C.z
    const lx = dx * COS_R - dz * SIN_R, lz = dx * SIN_R + dz * COS_R
    const e = (lx / 80) ** 2 + (lz / 21) ** 2
    if (e >= 1) return
    const k = 1.02 / Math.sqrt(e || 1e-6), nx = lx * k, nz = lz * k
    p.x = SHIP_C.x + nx * COS_R + nz * SIN_R
    p.z = SHIP_C.z - nx * SIN_R + nz * COS_R
  }

  stepOil(dt) {
    const cf = this.curFlow, wf = this.windFlow, rnd = Math.sqrt(dt) * 6.5
    const r = this.rng
    for (const b of this.booms) buildGrid(b)
    const cand = []
    for (let pi = 0; pi < this.parts.length; pi++) {
      const p = this.parts[pi]
      if (p.state !== 'float') continue
      p.age += dt
      p.held = Math.max(0, p.held - dt)
      const spread = Math.max(0, 5 - p.age) * 2.4
      let nx = p.x + (cf.x + wf.x) * dt + p.sx * spread * dt + (r() - 0.5) * rnd
      let nz = p.z + (cf.z + wf.z) * dt + p.sz * spread * dt + (r() - 0.5) * rnd

      let contact = false
      for (let bi = 0; bi < this.booms.length && !contact; bi++) {
        if (bi === p.ign) continue
        const b = this.booms[bi], bb = b.bb
        if ((nx < bb[0] && p.x < bb[0]) || (nx > bb[1] && p.x > bb[1]) ||
            (nz < bb[2] && p.z < bb[2]) || (nz > bb[3] && p.z > bb[3])) continue
        cand.length = 0
        const cx0 = Math.floor(Math.min(p.x, nx) / CELL), cx1 = Math.floor(Math.max(p.x, nx) / CELL)
        const cz0 = Math.floor(Math.min(p.z, nz) / CELL), cz1 = Math.floor(Math.max(p.z, nz) / CELL)
        for (let ix = cx0; ix <= cx1; ix++) {
          for (let iz = cz0; iz <= cz1; iz++) {
            const cell = b.grid.get(cellKey(ix, iz))
            if (cell) for (const li of cell) if (cand.indexOf(li) < 0) cand.push(li)
          }
        }
        cand.sort((u, v) => u - v)
        for (const li of cand) {
          const l = b.links[li]
          const a = b.nodes[l.i], c = b.nodes[l.j]
          if (!segCross(p.x, p.z, nx, nz, a, c)) continue
          contact = true; b.hits++
          let tx = c.x - a.x, tz = c.z - a.z
          const L = hyp(tx, tz) || 1
          tx /= L; tz /= L
          let nnx = -tz, nnz = tx
          if ((p.x - a.x) * nnx + (p.z - a.z) * nnz < 0) { nnx = -nnx; nnz = -nnz }
          const perp = this.perpKnots(tx, tz)
          const rate = perp <= PERP_LIMIT ? 0 : Math.min(3, (perp - PERP_LIMIT) * 2.2)
          // probabilitas lolos dalam satu langkah; rate*dt/(1+rate*dt) ≈ 1-exp(-rate*dt)
          const pLeak = (rate * dt) / (1 + rate * dt)
          if (rate > 0 && r() < pLeak) {
            p.ign = bi; l.leak++; b.leaks++
            if (!p.leaked) { p.leaked = true; this.leaks++ }
            nx -= nnx * 3; nz -= nnz * 3
          } else {
            const dd = (nx - p.x) * tx + (nz - p.z) * tz
            const sx = p.x + tx * dd, sz = p.z + tz * dd
            const dist = (sx - a.x) * nnx + (sz - a.z) * nnz
            const push = Math.max(0, 1.4 + p.band - dist)
            nx = sx + nnx * push; nz = sz + nnz * push
            p.held = 1.2
          }
          break
        }
      }
      p.x = nx; p.z = nz
      this.pushOutOfHull(p)

      if (this.ringIdx >= 0 && p.ign !== this.ringIdx && (this.steps + pi) % 2 === 0) {
        const rb = this.booms[this.ringIdx]
        // Pengaman cincin tertutup. Partikel yang jelas berada di tengah cincin tidak perlu
        // uji poligon yang mahal; selebihnya diuji tiap dua langkah.
        const ex0 = (p.x - SHIP_C.x) / (rb.ringA * 0.6), ez0 = (p.z - SHIP_C.z) / (rb.ringB * 0.6)
        if (ex0 * ex0 + ez0 * ez0 > 1 && !insideRing(rb, p.x, p.z)) {
          let best = 1e9, qx = 0, qz = 0
          for (const l of rb.links) {
            const a = rb.nodes[l.i], c = rb.nodes[l.j]
            const vx = c.x - a.x, vz = c.z - a.z, L2 = vx * vx + vz * vz || 1
            const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / L2))
            const ex = a.x + vx * t, ez = a.z + vz * t, d = (p.x - ex) ** 2 + (p.z - ez) ** 2
            if (d < best) { best = d; qx = ex; qz = ez }
          }
          const ix = SHIP_C.x - qx, iz = SHIP_C.z - qz, il = hyp(ix, iz) || 1
          p.x = qx + (ix / il) * (1.6 + p.band * 0.5)
          p.z = qz + (iz / il) * (1.6 + p.band * 0.5)
          p.held = 1.2
        }
      }

      if (this.strategy === 'deflect') {
        for (const b of this.booms) {
          if (b.collect && (p.x - b.collect.x) ** 2 + (p.z - b.collect.z) ** 2 < 18 * 18) {
            p.state = 'rec'; this.recovered++; break
          }
        }
        if (p.state === 'rec') continue
      }
      if (p.z > SHORE_Z) { p.state = 'ashore'; p.z = SHORE_Z + 2 + r() * 10 }
      else if (Math.abs(p.x) > 850 || p.z < -850) p.state = 'esc'
    }
  }

  tally() {
    let held = 0, inRing = 0, ash = 0, esc = 0, flt = 0
    const ring = this.ringIdx >= 0 ? this.booms[this.ringIdx] : null
    for (const p of this.parts) {
      if (p.state === 'ashore') ash++
      else if (p.state === 'esc') esc++
      else if (p.state === 'float') {
        if (ring && p.ign !== this.ringIdx && insideRing(ring, p.x, p.z)) inRing++
        else if (p.held > 0) held++
        else flt++
      }
    }
    const contained = this.recovered + held + inRing
    return { contained, ash, esc, flt, total: this.spawned || 1 }
  }

  /* — penilaian — */
  evaluate() {
    const T = this.tally()
    const pAsh = T.ash / T.total
    const calm = this.seed.curSpd <= PERP_LIMIT
    const err = angDiff(this.predicted ?? 0, this.seed.driftDeg)
    const sPred = this.predicted == null ? 0 : Math.max(0, 100 - err * 1.55)

    let sStrat, stratCode
    if (calm && this.strategy === 'encircle') { sStrat = 100; stratCode = 'calm-encircle' }
    else if (calm) { sStrat = 60; stratCode = 'calm-deflect' }
    else if (this.strategy === 'deflect') { sStrat = 100; stratCode = 'fast-deflect' }
    else { sStrat = 20; stratCode = 'fast-encircle' }

    let sPlace = 0
    const place = { kind: 'none' }
    if (this.strategy === 'encircle' && this.ringIdx >= 0) {
      const L = this.supplyUsed
      sPlace = L > SUPPLY ? Math.max(0, 100 - (L - SUPPLY) * 0.5) : 100
      Object.assign(place, { kind: 'ring', length: L, over: L > SUPPLY })
    } else if (this.booms.length) {
      let ok = 0, all = 0
      this.booms.forEach((b) => b.links.forEach((l) => {
        const a = b.nodes[l.i], c = b.nodes[l.j], L = hyp(c.x - a.x, c.z - a.z) || 1
        all += L
        if (this.perpKnots((c.x - a.x) / L, (c.z - a.z) / L) <= PERP_LIMIT) ok += L
      }))
      const used = this.booms.filter((b) => b.hits > 0).length
      sPlace = (ok / all * 100) * (0.4 + 0.6 * used / this.booms.length) * (0.6 + 0.4 * this.booms.length / MAX_SEG)
      Object.assign(place, { kind: 'segments', okPct: Math.round(ok / all * 100), used, count: this.booms.length })
    }
    const sArea = Math.max(0, 100 - pAsh * 260)

    const parts = [
      { key: 'prediction', w: 0.15, v: sPred },
      { key: 'strategy', w: 0.30, v: sStrat },
      { key: 'placement', w: 0.30, v: sPlace },
      { key: 'protection', w: 0.25, v: sArea },
    ]
    const final = parts.reduce((a, p) => a + p.v * p.w, 0)
    let level
    if (pAsh > 0.22 || sStrat <= 20 || final < 55) level = 'BELUM_KOMPETEN'
    else if (final < 75) level = 'PERLU_BIMBINGAN'
    else level = 'KOMPETEN'
    return {
      T, parts, final, level, pAsh, err, stratCode, place,
      leaks: this.leaks, recovered: this.recovered,
      driftDeg: this.seed.driftDeg, curSpd: this.seed.curSpd,
      steps: this.steps,
    }
  }
}

/* ───────────────────────── replay (dipakai server) ───────────────────────── */
/**
 * Memutar ulang keputusan peserta dari benih yang sama.
 * Melempar ReplayError bila log tidak masuk akal (urutan salah, angka di luar batas,
 * operasi tak dikenal) — server menolak log seperti itu.
 */
export function replay(seedValue, log, { maxOps = 64 } = {}) {
  if (!Array.isArray(log) || log.length === 0 || log.length > maxOps) throw new ReplayError('Log keputusan tidak valid')
  const sim = new Sim(seedValue)
  let started = false, finishedAt = null

  const need = (ok, msg) => { if (!ok) throw new ReplayError(msg) }
  for (const op of log) {
    need(op && typeof op === 'object' && typeof op.a === 'string', 'Operasi tidak dikenal')
    need(finishedAt === null, 'Ada operasi setelah finish')
    switch (op.a) {
      case 'predict': need(!started, 'Prediksi setelah mulai'); need(sim.setPrediction(op.deg).ok, 'Prediksi tidak valid'); break
      case 'strategy': need(!started, 'Strategi setelah mulai'); need(sim.setStrategy(op.v).ok, 'Strategi tidak valid'); break
      case 'ring': need(sim.placeRing(op.x, op.z).ok, 'Penempatan cincin tidak valid'); break
      case 'seg': need(sim.placeSegment({ x: op.ax, z: op.az }, { x: op.bx, z: op.bz }).ok, 'Penempatan segmen tidak valid'); break
      case 'undo': need(sim.undo().ok, 'Undo tidak valid'); break
      case 'start': need(sim.start().ok, 'Mulai tidak valid'); started = true; break
      case 'finish': {
        need(started, 'Finish sebelum start')
        need(Number.isInteger(op.n) && op.n >= 1 && op.n <= TOTAL_STEPS, 'Jumlah langkah tidak valid')
        while (sim.phase === 'run' && sim.steps < op.n) sim.step()
        need(sim.steps === op.n || sim.phase === 'done', 'Langkah tidak konsisten')
        sim.finish(false)
        finishedAt = sim.steps
        break
      }
      default: throw new ReplayError('Operasi tidak dikenal: ' + op.a.slice(0, 20))
    }
  }
  need(finishedAt !== null || started, 'Simulasi belum dijalankan')
  // Log dari simulasi yang selesai otomatis berakhir dengan finish{n: TOTAL_STEPS}.
  while (sim.phase === 'run') sim.step()
  return { sim, evaluation: sim.evaluate() }
}
