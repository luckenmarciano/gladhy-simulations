import test from 'node:test'
import assert from 'node:assert/strict'
import * as C from '../src/core/oilspill.js'

const CALM = 1   // arus 0,47 kn  (di bawah ambang 0,7)
const FAST = 8   // arus 1,02 kn  (di atas ambang)

/** Segmen deflection yang dimiringkan `ang` derajat dari arah sebaran, di hilir titik bocor. */
function deflectPlacement(seedValue, ang, dist) {
  const g = C.generateSeed(seedValue), d = C.vec(g.driftDeg)
  const ca = Math.cos(ang * Math.PI / 180), sa = Math.sin(ang * Math.PI / 180)
  const bx = d.x * ca - d.z * sa, bz = d.x * sa + d.z * ca
  const a = { x: C.LEAK.x + d.x * dist - bx * 70, z: C.LEAK.z + d.z * dist - bz * 70 }
  return [a, { x: a.x + bx * 140, z: a.z + bz * 140 }]
}

function play(seedValue, setup, { stopAt } = {}) {
  const s = new C.Sim(seedValue)
  setup(s)
  assert.ok(s.start().ok, 'start harus berhasil')
  if (stopAt) { while (s.phase === 'run' && s.steps < stopAt) s.step(); s.finish(false) }
  else while (s.phase === 'run') s.step()
  return s
}
const ringPlan = (s) => { s.setPrediction(s.seed.driftDeg); s.setStrategy('encircle'); s.placeRing(C.SHIP_C.x + 130, C.SHIP_C.z) }
const deflectPlan = (ang, dist) => (s) => {
  s.setPrediction(s.seed.driftDeg); s.setStrategy('deflect')
  const [a, b] = deflectPlacement(s.seed.seedValue, ang, dist)
  assert.ok(s.placeSegment(a, b).ok)
}

test('mulberry32: deterministik dan di rentang [0,1)', () => {
  const a = C.mulberry32(42), b = C.mulberry32(42)
  for (let i = 0; i < 1000; i++) {
    const x = a(), y = b()
    assert.equal(x, y)
    assert.ok(x >= 0 && x < 1)
  }
  assert.notEqual(C.mulberry32(1)(), C.mulberry32(2)())
})

test('generateSeed: deterministik, dan kedua rezim arus bisa muncul', () => {
  assert.deepEqual(C.generateSeed(123), C.generateSeed(123))
  let calm = 0, fast = 0
  for (let i = 1; i <= 200; i++) {
    const g = C.generateSeed(i)
    assert.ok(g.curDeg >= 155 && g.curDeg <= 205)
    assert.ok(g.windSpd >= 6 && g.windSpd <= 18)
    if (g.curSpd <= C.PERP_LIMIT) calm++; else fast++
  }
  assert.ok(calm > 60 && fast > 60, `calm=${calm} fast=${fast}`)
  assert.ok(C.generateSeed(CALM).curSpd <= C.PERP_LIMIT)
  assert.ok(C.generateSeed(FAST).curSpd > C.PERP_LIMIT)
})

test('benih sama + keputusan sama → hasil identik', () => {
  const a = play(CALM, ringPlan).evaluate()
  const b = play(CALM, ringPlan).evaluate()
  assert.deepEqual(a, b)
})

test('benih berbeda → kondisi berbeda', () => {
  assert.notDeepEqual(C.generateSeed(1), C.generateSeed(2))
})

test('fisika: arus tenang + encirclement menahan hampir semua minyak', () => {
  const ev = play(CALM, ringPlan).evaluate()
  assert.equal(ev.T.ash, 0)
  assert.ok(ev.T.contained >= 0.95 * ev.T.total, `contained=${ev.T.contained}`)
  assert.equal(ev.level, 'KOMPETEN')
  assert.equal(ev.stratCode, 'calm-encircle')
})

test('fisika: arus deras + encirclement bocor di sisi hilir dan dinilai Belum Kompeten', () => {
  const ev = play(FAST, ringPlan).evaluate()
  assert.ok(ev.leaks > 100, `leaks=${ev.leaks}`)
  assert.ok(ev.T.ash > 0.2 * ev.T.total)
  assert.equal(ev.level, 'BELUM_KOMPETEN')
  assert.equal(ev.stratCode, 'fast-encircle')
})

test('fisika: arus deras + deflection landai mengumpulkan sebagian besar minyak', () => {
  const ev = play(FAST, deflectPlan(-20, 60)).evaluate()
  assert.ok(ev.recovered >= 0.85 * ev.T.total, `recovered=${ev.recovered}`)
  assert.equal(ev.level, 'KOMPETEN')
})

test('fisika: deflection terlalu curam bocor jauh lebih banyak daripada yang landai', () => {
  const gentle = play(FAST, deflectPlan(-20, 60)).evaluate()
  const steep = play(FAST, deflectPlan(60, 60)).evaluate()
  assert.ok(steep.leaks > gentle.leaks * 10 + 50, `steep=${steep.leaks} gentle=${gentle.leaks}`)
  assert.equal(steep.level, 'BELUM_KOMPETEN')
})

test('replay: log hasil permainan menghasilkan evaluasi yang sama persis', () => {
  const s = play(FAST, deflectPlan(-20, 60))
  const { evaluation } = C.replay(FAST, s.log)
  assert.deepEqual(evaluation, s.evaluate())
})

test('replay: berhenti di tengah jalan (finish n) direproduksi', () => {
  const s = play(CALM, ringPlan, { stopAt: 900 })
  assert.equal(s.log.at(-1).a, 'finish')
  assert.equal(s.log.at(-1).n, 900)
  const { evaluation } = C.replay(CALM, s.log)
  assert.deepEqual(evaluation, s.evaluate())
  assert.equal(evaluation.steps, 900)
})

test('replay: log tanpa finish tetap dijalankan sampai selesai', () => {
  const s = play(CALM, ringPlan)
  const trimmed = s.log.filter((o) => o.a !== 'finish')
  assert.deepEqual(C.replay(CALM, trimmed).evaluation, s.evaluate())
})

test('replay: log milik benih lain memberi hasil lain (tidak bisa menukar sesi)', () => {
  const s = play(CALM, ringPlan)
  const other = C.replay(FAST, s.log).evaluation
  assert.notDeepEqual(other, s.evaluate())
})

test('replay menolak log yang tidak masuk akal', () => {
  const ok = play(CALM, ringPlan).log
  const bad = (log, msg) => assert.throws(() => C.replay(CALM, log), C.ReplayError, msg)

  bad([], 'kosong')
  bad('bukan array', 'bukan array')
  bad(Array(65).fill({ a: 'undo' }), 'terlalu banyak operasi')
  bad([{ a: 'hack' }], 'operasi tak dikenal')
  bad([{ a: 'ring', x: 1, z: 1 }], 'cincin sebelum strategi')
  bad([{ a: 'strategy', v: 'encircle' }, { a: 'ring', x: NaN, z: 0 }], 'NaN')
  bad([{ a: 'strategy', v: 'encircle' }, { a: 'ring', x: 1e9, z: 0 }], 'di luar batas')
  bad([{ a: 'predict', deg: 10 }, { a: 'strategy', v: 'encircle' }, { a: 'start' }], 'start tanpa boom')
  bad([{ a: 'strategy', v: 'encircle' }, { a: 'ring', x: 100, z: -95 }, { a: 'start' }], 'start tanpa prediksi')
  bad([...ok, { a: 'undo' }], 'operasi setelah finish')
  bad(ok.map((o) => (o.a === 'finish' ? { ...o, n: C.TOTAL_STEPS + 5 } : o)), 'n terlalu besar')
  bad(ok.filter((o) => o.a !== 'start'), 'finish sebelum start')
  bad([{ a: 'predict', deg: 10 }, { a: 'strategy', v: 'encircle' }, { a: 'ring', x: 100, z: -95 }], 'tidak pernah dijalankan')
  bad([null], 'null')
})

test('penempatan segmen: validasi panjang, jumlah, dan strategi', () => {
  const s = new C.Sim(FAST)
  assert.equal(s.placeSegment({ x: 0, z: 0 }, { x: 80, z: 0 }).error, 'phase') // strategi belum dipilih
  s.setStrategy('deflect')
  assert.equal(s.placeSegment({ x: 0, z: 0 }, { x: 10, z: 0 }).error, 'short')
  assert.equal(s.placeSegment({ x: 0, z: 0 }, { x: C.SEG_MAX + 1, z: 0 }).error, 'long')
  for (let i = 0; i < C.MAX_SEG; i++) assert.ok(s.placeSegment({ x: 0, z: i * 30 }, { x: 80, z: i * 30 }).ok)
  assert.equal(s.placeSegment({ x: 0, z: 200 }, { x: 80, z: 200 }).error, 'max')
  assert.ok(s.supplyUsed <= C.SUPPLY)
  assert.equal(s.setStrategy('encircle').ok, false) // tidak bisa ganti strategi setelah ada boom
})

test('cincin terlalu besar melebihi persediaan dan nilai penempatan turun', () => {
  const s = new C.Sim(CALM)
  s.setPrediction(s.seed.driftDeg); s.setStrategy('encircle')
  const r = s.placeRing(C.SHIP_C.x + 175, C.SHIP_C.z)
  assert.ok(r.ok && r.overSupply)
  s.start(); while (s.phase === 'run') s.step()
  const place = s.evaluate().parts.find((p) => p.key === 'placement')
  assert.ok(place.v < 100)
})

test('bobot rubrik berjumlah 1 dan prediksi sempurna bernilai 100', () => {
  const ev = play(CALM, ringPlan).evaluate()
  assert.ok(Math.abs(ev.parts.reduce((a, p) => a + p.w, 0) - 1) < 1e-9)
  assert.equal(ev.parts.find((p) => p.key === 'prediction').v, 100)
})

test('prediksi meleset 90° menurunkan skor prediksi', () => {
  const s = play(CALM, (x) => { x.setPrediction((x.seed.driftDeg + 90) % 360); x.setStrategy('encircle'); x.placeRing(C.SHIP_C.x + 130, C.SHIP_C.z) })
  assert.ok(s.evaluate().parts.find((p) => p.key === 'prediction').v < 5)
})

test('satu replay penuh selesai dalam batas waktu yang wajar (< 5 detik)', () => {
  const s = play(CALM, ringPlan)
  const t0 = Date.now()
  C.replay(CALM, s.log)
  const ms = Date.now() - t0
  assert.ok(ms < 5000, `replay ${ms} ms`)
})
