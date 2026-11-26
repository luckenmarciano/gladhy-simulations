import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  Game, replay, generate, ReplayError, ITEMS, TASKS, SITUATIONS, ZONES, PPE,
  itemOf, taskOf, N_ITEMS, N_TASKS, N_SITS,
} from '../src/core/site.js'

// Memainkan satu permainan. Fungsi pilihan boleh diganti untuk menyisipkan kesalahan.
function play(seed, {
  zone = (k) => itemOf(k).z[0],
  ppe = (k) => taskOf(k).req,
  act = (s) => s.correct,
} = {}) {
  const g = new Game(seed)
  g.q.items.forEach((k, i) => assert.ok(g.place(i, zone(k, i)).ok))
  assert.ok(g.lockZones().ok)
  g.q.tasks.forEach((k, i) => assert.ok(g.choosePpe(i, ppe(k, i)).ok))
  g.q.sits.forEach((s, i) => assert.ok(g.decide(i, act(s, i)).ok))
  assert.ok(g.finish().ok)
  return g
}

describe('isi sesuai workbook', () => {
  test('setiap isi lokasi punya zona yang valid', () => {
    const keys = ZONES.map((z) => z.k)
    for (const it of ITEMS) assert.ok(it.z.length && it.z.every((z) => keys.includes(z)), it.k)
  })
  test('kantin, akomodasi, pos komando di Zona Hijau; dekontaminasi di Kuning (hlm 22)', () => {
    assert.deepEqual(itemOf('canteen').z, ['green'])
    assert.deepEqual(itemOf('command').z, ['green'])
    assert.deepEqual(itemOf('tent').z, ['green'])
    assert.deepEqual(itemOf('decon').z, ['yellow'])
    assert.deepEqual(itemOf('security').z.slice().sort(), ['green', 'yellow'])
  })
  test('APD wajib hanya dari daftar APD', () => {
    const keys = new Set(PPE.map((p) => p.k))
    for (const t of TASKS) assert.ok(t.req.every((k) => keys.has(k)), t.k)
    assert.ok(taskOf('water').req.includes('lifejacket'))
    assert.ok(taskOf('fresh').req.includes('respirator'))
  })
  test('setiap situasi punya tepat tiga pilihan', () => {
    for (const s of SITUATIONS) assert.equal(s.opts.length, 3, s.k)
  })
})

describe('soal berbenih', () => {
  test('benih sama → soal sama; benih beda → soal beda', () => {
    assert.deepEqual(generate(7), generate(7))
    assert.notDeepEqual(generate(7), generate(8))
  })
  test('komposisi: 9 isi tanpa duplikat, ketiga zona terwakili, 3 tugas, 4 situasi', () => {
    const seen = new Set()
    for (let s = 1; s < 400; s++) {
      const q = generate(s)
      assert.equal(q.items.length, N_ITEMS)
      assert.equal(new Set(q.items).size, N_ITEMS)
      for (const z of ['red', 'yellow', 'green']) assert.ok(q.items.filter((k) => itemOf(k).z[0] === z).length >= 2)
      assert.equal(q.tasks.length, N_TASKS)
      assert.equal(new Set(q.tasks).size, N_TASKS)
      assert.equal(q.sits.length, N_SITS)
      for (const st of q.sits) { assert.equal(st.order[st.correct], 0); seen.add(st.correct) }
    }
    // jawaban benar tidak selalu di posisi yang sama
    assert.deepEqual([...seen].sort(), [0, 1, 2])
  })
})

describe('penilaian', () => {
  test('jawaban sempurna → 100, Kompeten', () => {
    const ev = play(11).evaluate()
    assert.equal(ev.final, 100)
    assert.equal(ev.level, 'KOMPETEN')
  })
  test('pos keamanan di Zona Kuning atau Hijau sama-sama benar', () => {
    let seed = 1
    while (!generate(seed).items.includes('security')) seed++
    for (const z of ['yellow', 'green']) {
      const ev = play(seed, { zone: (k) => (k === 'security' ? z : itemOf(k).z[0]) }).evaluate()
      assert.equal(ev.parts[0].v, 100)
    }
    const bad = play(seed, { zone: (k) => (k === 'security' ? 'red' : itemOf(k).z[0]) }).evaluate()
    assert.equal(bad.zonesOk, N_ITEMS - 1)
  })
  test('kantin di Zona Merah dihitung salah', () => {
    let seed = 1
    while (!generate(seed).items.includes('canteen')) seed++
    const ev = play(seed, { zone: (k) => (k === 'canteen' ? 'red' : itemOf(k).z[0]) }).evaluate()
    assert.equal(ev.zonesOk, N_ITEMS - 1)
  })
  test('APD dinilai per butir wajib yang terpilih', () => {
    const ev = play(5, { ppe: (k) => { const r = taskOf(k).req.slice(); r[0] = PPE.find((p) => !r.includes(p.k)).k; return r } }).evaluate()
    const exp = Math.round(new Game(5).q.tasks.reduce((a, k) => a + (taskOf(k).req.length - 1) / taskOf(k).req.length * 100, 0) / N_TASKS)
    assert.equal(ev.parts[1].v, exp)
  })
  test('semua keputusan salah → bagian keputusan 0', () => {
    const ev = play(9, { act: (s) => (s.correct + 1) % 3 }).evaluate()
    assert.equal(ev.parts[2].v, 0)
    assert.equal(ev.final, 70)
  })
  test('bobot rubrik 40/30/30', () => {
    assert.deepEqual(play(1).evaluate().parts.map((p) => p.w), [0.4, 0.3, 0.3])
  })
})

describe('urutan permainan dijaga', () => {
  test('zona tidak bisa dikunci sebelum lengkap', () => {
    const g = new Game(3)
    g.place(0, 'red')
    assert.equal(g.lockZones().ok, false)
  })
  test('APD harus tepat sebanyak yang wajib, tanpa duplikat', () => {
    const g = new Game(3)
    g.q.items.forEach((k, i) => g.place(i, 'red')); g.lockZones()
    const req = taskOf(g.q.tasks[0]).req
    assert.equal(g.choosePpe(0, req.slice(1)).ok, false)
    assert.equal(g.choosePpe(0, [...req.slice(1), req[1]]).ok, false)
    assert.equal(g.choosePpe(0, PPE.map((p) => p.k)).ok, false)
    assert.equal(g.choosePpe(1, req).ok, false)
    assert.ok(g.choosePpe(0, req).ok)
  })
  test('zona tidak bisa diubah setelah dikunci; keputusan tidak bisa sebelum APD', () => {
    const g = new Game(3)
    g.q.items.forEach((k, i) => g.place(i, 'red')); g.lockZones()
    assert.equal(g.place(0, 'green').ok, false)
    assert.equal(g.decide(0, 0).ok, false)
  })
  test('selesai ditolak sebelum semua situasi dijawab', () => {
    assert.equal(new Game(1).finish().ok, false)
  })
})

describe('replay server', () => {
  test('log klien diputar ulang → hasil identik', () => {
    const g = play(42, { act: (s, i) => (i === 1 ? (s.correct + 2) % 3 : s.correct) })
    const { evaluation } = replay(42, g.log)
    assert.deepEqual(evaluation, g.evaluate())
  })
  test('log yang tidak masuk akal ditolak', () => {
    const ok = play(2).log
    for (const bad of [
      [], [{ a: 'hack' }], [{ a: 'end' }], [null],
      ok.slice(0, -1),
      [...ok, { a: 'end' }],
      ok.filter((o) => o.a !== 'lockz'),
      ok.map((o) => (o.a === 'zone' ? { ...o, v: '__proto__' } : o)),
      ok.map((o) => (o.a === 'zone' ? { ...o, i: 99 } : o)),
      ok.map((o) => (o.a === 'ppe' ? { ...o, v: ['toString'] } : o)),
      ok.map((o) => (o.a === 'ppe' ? { ...o, v: 'gloves' } : o)),
      ok.map((o) => (o.a === 'act' ? { ...o, v: 3 } : o)),
      Array.from({ length: 81 }, () => ({ a: 'zone', i: 0, v: 'red' })),
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
