import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  Game, replay, generateRounds, conditions, mulberry32, ReplayError, FAILURES, FIXES, failureOf, ROUNDS, fmt,
} from '../src/core/leak.js'

function play(seed, { dx = (rd) => rd.fail, fx = (rd) => failureOf(rd.fail).fix } = {}) {
  const g = new Game(seed)
  for (const rd of g.rounds) {
    assert.ok(g.diagnose(rd.i, dx(rd)).ok)
    assert.ok(g.fix(rd.i, fx(rd)).ok)
  }
  assert.ok(g.finish().ok)
  return g
}

describe('tabel kegagalan oil boom (hlm 58)', () => {
  test('enam kegagalan dan mitigasinya', () => {
    assert.deepEqual(Object.fromEntries(FAILURES.map((f) => [f.k, f.fix])), {
      entrainment: 'slow', drainage: 'skimmer', splashover: 'buoyancy',
      submergence: 'slow', planing: 'ballast', structural: 'suitable',
    })
    for (const f of FAILURES) assert.ok(FIXES.some((x) => x.k === f.fix))
  })
})

describe('kondisi lapangan', () => {
  test('hanya penyebab kegagalan yang di luar batas', () => {
    for (let s = 1; s < 300; s++) {
      for (const f of FAILURES) {
        const c = conditions(mulberry32(s), f.k)
        assert.equal(c.current > 0.7, f.k === 'entrainment' || f.k === 'submergence', `${f.k} arus ${c.current}`)
        assert.equal(c.current > 5, f.k === 'submergence')
        assert.equal(c.wave >= 1, f.k === 'splashover')
        assert.equal(c.apex === 2, f.k === 'drainage')
        assert.equal(c.ballast === 'bad', f.k === 'planing')
        assert.equal(c.load > 100, f.k === 'structural')
      }
    }
  })
  test('benih sama → soal sama; setiap kegagalan muncul sekali', () => {
    assert.deepEqual(generateRounds(7), generateRounds(7))
    assert.notDeepEqual(generateRounds(7), generateRounds(8))
    for (let s = 1; s < 100; s++) assert.equal(new Set(generateRounds(s).map((r) => r.fail)).size, ROUNDS)
  })
})

describe('penilaian', () => {
  test('jawaban sempurna → 100, Kompeten', () => {
    const ev = play(11).evaluate()
    assert.equal(ev.final, 100)
    assert.equal(ev.level, 'KOMPETEN')
  })
  test('diagnosis salah tetapi mitigasi benar dinilai terpisah', () => {
    const ev = play(4, { dx: (rd) => (rd.fail === 'drainage' ? 'entrainment' : 'drainage') }).evaluate()
    assert.equal(ev.parts[0].v, 0)
    assert.equal(ev.parts[1].v, 100)
    assert.equal(ev.final, 40)
  })
  test('entrainment dan submergence sama-sama diatasi dengan mengurangi kecepatan', () => {
    const g = play(5)
    for (const [i, rd] of g.rounds.entries()) if (['entrainment', 'submergence'].includes(rd.fail)) assert.equal(g.answers[i].fx, 'slow')
  })
  test('bobot rubrik 60/40', () => {
    assert.deepEqual(play(1).evaluate().parts.map((p) => p.w), [0.6, 0.4])
  })
})

describe('urutan permainan dijaga', () => {
  test('mitigasi tidak bisa sebelum diagnosis; diagnosis tidak bisa diubah', () => {
    const g = new Game(3)
    assert.equal(g.fix(0, 'slow').ok, false)
    assert.ok(g.diagnose(0, 'planing').ok)
    assert.equal(g.diagnose(0, 'drainage').ok, false)
    assert.equal(g.diagnose(1, 'drainage').ok, false)
  })
  test('selesai ditolak sebelum babak terakhir', () => {
    assert.equal(new Game(1).finish().ok, false)
  })
})

describe('replay server', () => {
  test('log klien diputar ulang → hasil identik', () => {
    const g = play(42, { fx: (rd) => (rd.i === 2 ? 'skimmer' : failureOf(rd.fail).fix) })
    const { evaluation } = replay(42, g.log)
    assert.deepEqual(evaluation, g.evaluate())
  })
  test('log yang tidak masuk akal ditolak', () => {
    const ok = play(2).log
    for (const bad of [
      [], [{ a: 'hack' }], [{ a: 'end' }], [null],
      ok.slice(0, -1),
      [...ok, { a: 'end' }],
      ok.filter((o) => o.a !== 'dx'),
      ok.map((o) => (o.a === 'dx' ? { ...o, v: '__proto__' } : o)),
      ok.map((o) => (o.a === 'fx' ? { ...o, v: 'toString' } : o)),
      Array.from({ length: 41 }, () => ({ a: 'dx', r: 0, v: 'planing' })),
    ]) {
      assert.throws(() => replay(2, bad), ReplayError)
    }
  })
})

test('fmt memakai koma desimal', () => {
  assert.equal(fmt(0.7), '0,7')
  assert.equal(fmt(6), '6')
})
