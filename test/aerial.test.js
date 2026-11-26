import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  Game, replay, generateRounds, volumeScore, diagnose, parseNumber, fmt, fmtLen,
  zoneVolume, classOf, ReplayError, ROUNDS, CLASSES,
} from '../src/core/aerial.js'

// Memainkan satu permainan. `mistake(round)` boleh mengubah jawaban per babak.
function play(seed, { cls = (z) => z.cls, vol = (r) => r.truth, pri = (r) => r.priority } = {}) {
  const g = new Game(seed)
  for (const r of g.rounds) {
    for (const z of r.zones) assert.ok(g.classify(r.i, z.id, cls(z, r)).ok)
    assert.ok(g.estimate(r.i, vol(r)).ok)
    if (r.priority !== null) assert.ok(g.prioritize(r.i, pri(r)).ok)
  }
  assert.ok(g.finish().ok)
  return g
}

describe('aturan workbook hlm 14', () => {
  test('Latihan 1: 5 km × 200 m keperakan = 0,1 m³', () => {
    assert.equal(zoneVolume({ L: 5000, W: 200, cls: 'silver' }), 0.1)
  })
  test('Latihan 2: 200 m × 200 m oranye = 40 m³', () => {
    assert.equal(zoneVolume({ L: 200, W: 200, cls: 'orange' }), 40)
  })
  test('faktor warna sesuai tabel IPIECA di workbook', () => {
    assert.deepEqual(CLASSES.map((c) => c.f), [0.1, 0.3, 100, 1000])
  })
})

describe('soal berbenih', () => {
  test('benih sama → soal sama; benih beda → soal beda', () => {
    assert.deepEqual(generateRounds(7), generateRounds(7))
    assert.notDeepEqual(generateRounds(7), generateRounds(8))
  })
  test('bentuk babak: 3 bagian tunggal lalu 2 babak kepala tebal + ekor tipis', () => {
    for (let s = 1; s < 300; s++) {
      const rs = generateRounds(s)
      assert.equal(rs.length, ROUNDS)
      assert.ok(!classOf(rs[0].zones[0].cls).thick)
      assert.ok(classOf(rs[1].zones[0].cls).thick)
      for (const r of rs.slice(3)) {
        assert.equal(r.zones.length, 2)
        assert.equal(r.priority, 0)
        assert.ok(classOf(r.zones[0].cls).thick && !classOf(r.zones[1].cls).thick)
        // pelajaran prioritas: bagian tipis lebih luas tetapi volumenya jauh lebih kecil
        assert.ok(zoneVolume(r.zones[0]) >= 5 * zoneVolume(r.zones[1]))
      }
      for (const r of rs) for (const z of r.zones) assert.ok(z.L >= z.W)
    }
  })
})

describe('penilaian', () => {
  test('jawaban sempurna → 100, Kompeten', () => {
    const ev = play(11).evaluate()
    assert.equal(ev.final, 100)
    assert.equal(ev.level, 'KOMPETEN')
  })

  test('toleransi volume: ±12 % penuh, meleset 2× nol', () => {
    assert.equal(volumeScore(0.1, 0.1), 100)
    assert.equal(volumeScore(0.11, 0.1), 100)
    assert.ok(volumeScore(0.15, 0.1) > 30 && volumeScore(0.15, 0.1) < 100)
    assert.equal(volumeScore(0.2, 0.1), 0)
    assert.equal(volumeScore(0, 0.1), 0)
  })

  test('salah satuan (km² dikira m²) → nol dan didiagnosis "unit"', () => {
    const g = play(3, { vol: (r) => r.truth * 1e6 })
    const ev = g.evaluate()
    assert.equal(ev.parts.find((p) => p.key === 'volume').v, 0)
    assert.ok(ev.perRound.every((p) => p.why === 'unit'))
  })

  test('warna salah tetapi hitungan konsisten → didiagnosis "class"', () => {
    const swap = { silver: 'dark', rainbow: 'orange', dark: 'silver', orange: 'rainbow' }
    const g = new Game(5)
    const r = g.rounds[0]
    const wrong = swap[r.zones[0].cls]
    g.classify(0, 0, wrong)
    g.estimate(0, zoneVolume(r.zones[0], wrong))
    assert.equal(diagnose(r, g.answers[0]), 'class')
  })

  test('menangani ekor tipis lebih dulu → nilai prioritas 0', () => {
    const ev = play(9, { pri: () => 1 }).evaluate()
    assert.equal(ev.parts.find((p) => p.key === 'priority').v, 0)
    assert.equal(ev.final, 80)
  })

  test('bobot rubrik 30/50/20', () => {
    assert.deepEqual(play(1).evaluate().parts.map((p) => p.w), [0.3, 0.5, 0.2])
  })
})

describe('urutan permainan dijaga', () => {
  test('volume ditolak sebelum semua bagian diberi warna', () => {
    const g = new Game(4)
    g.rounds[3].zones.length // babak 4 punya dua bagian
    for (let i = 0; i < 3; i++) { g.classify(i, 0, g.rounds[i].zones[0].cls); g.estimate(i, 1) }
    g.classify(3, 0, 'dark')
    assert.equal(g.estimate(3, 1).why, 'cls')
  })
  test('tidak bisa menjawab babak lain atau mengubah warna setelah volume dikunci', () => {
    const g = new Game(4)
    assert.equal(g.classify(1, 0, 'dark').ok, false)
    g.classify(0, 0, 'silver'); g.estimate(0, 1)
    assert.equal(g.classify(0, 0, 'rainbow').ok, false)
  })
  test('selesai ditolak sebelum babak 5', () => {
    assert.equal(new Game(1).finish().ok, false)
  })
})

describe('replay server', () => {
  test('log klien diputar ulang → hasil identik', () => {
    const g = play(42, { vol: (r) => r.truth * 1.3 })
    const { evaluation } = replay(42, g.log)
    assert.deepEqual(evaluation, g.evaluate())
  })
  test('log yang tidak masuk akal ditolak', () => {
    const ok = play(2).log
    for (const bad of [
      [], [{ a: 'hack' }], [{ a: 'end' }],
      ok.slice(0, -1),                                    // belum selesai
      [...ok, { a: 'end' }],                              // operasi setelah selesai
      ok.map((o) => (o.a === 'vol' ? { ...o, v: -1 } : o)),
      ok.map((o) => (o.a === 'vol' ? { ...o, v: 'NaN' } : o)),
      ok.map((o) => (o.a === 'cls' ? { ...o, v: '__proto__' } : o)),
      Array.from({ length: 65 }, () => ({ a: 'cls', r: 0, z: 0, v: 'silver' })),
    ]) {
      assert.throws(() => replay(2, bad), ReplayError)
    }
  })
  test('benih lain dengan log yang sama → skor dihitung dari soal benih server', () => {
    const g = play(100)
    let differs = false
    try { differs = replay(101, g.log).evaluation.final !== 100 } catch { differs = true }
    assert.ok(differs)
  })
})

describe('format angka id-ID', () => {
  test('fmt', () => {
    assert.equal(fmt(0.1), '0,1')
    assert.equal(fmt(40), '40')
    assert.equal(fmt(1500), '1.500')
    assert.equal(fmt(0.0375), '0,0375')
    assert.equal(fmt(2.5), '2,5')
  })
  test('fmtLen', () => {
    assert.equal(fmtLen(5000), '5 km')
    assert.equal(fmtLen(1500), '1,5 km')
    assert.equal(fmtLen(200), '200 m')
  })
  test('parseNumber menerima koma, titik, titik ribuan, dan satuan', () => {
    assert.equal(parseNumber('0,1'), 0.1)
    assert.equal(parseNumber('0.1'), 0.1)
    assert.equal(parseNumber('1.500'), 1500)
    assert.equal(parseNumber('1.500,5'), 1500.5)
    assert.equal(parseNumber(' 40 m3 '), 40)
    assert.ok(Number.isNaN(parseNumber('')))
    assert.ok(Number.isNaN(parseNumber('abc')))
    assert.ok(Number.isNaN(parseNumber('1e9')))
  })
})
