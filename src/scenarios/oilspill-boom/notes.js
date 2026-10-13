// Teks umpan balik debrief. Murni fungsi dari hasil evaluasi, tanpa DOM.
import { PERP_LIMIT, SUPPLY, nameOf } from '../../core/oilspill.js'

export const LEVEL_LABEL = {
  KOMPETEN: 'Kompeten',
  PERLU_BIMBINGAN: 'Perlu Bimbingan',
  BELUM_KOMPETEN: 'Belum Kompeten',
}

export const PART_LABEL = {
  prediction: 'Ketepatan prediksi arah sebaran',
  strategy: 'Pemilihan strategi boom',
  placement: 'Kualitas penempatan boom',
  protection: 'Area sensitif terlindungi',
}

export function buildNotes(ev, sim) {
  const ck = `${sim.seed.curSpd.toFixed(2)} knot`
  const notes = []

  const strat = {
    'calm-encircle': `Arus ${ck} berada di bawah ambang ${PERP_LIMIT} knot. Encirclement tepat: minyak terkurung penuh di sekeliling sumber yang diam.`,
    'calm-deflect': `Arus hanya ${ck}. Deflection tidak salah, tetapi encirclement lebih unggul karena sumber tumpahan diam dan minyak bisa dikurung penuh.`,
    'fast-deflect': `Arus ${ck} melampaui ambang ${PERP_LIMIT} knot. Deflection tepat: minyak dibelokkan menyusuri boom ke titik kumpul, bukan ditekan frontal.`,
    'fast-encircle': `Arus ${ck} melampaui ambang ${PERP_LIMIT} knot. Cincin boom selalu punya sisi yang tegak lurus arus — sisi hilir itu pasti bocor. Di kondisi ini deflection yang benar.`,
  }[ev.stratCode]
  notes.push(`<b>Strategi:</b> ${strat}`)

  notes.push(
    `<b>Arah sebaran sesungguhnya:</b> ${nameOf(ev.driftDeg)} (${ev.driftDeg.toFixed(0)}°). Perkiraan Anda meleset ${ev.err.toFixed(0)}°. ` +
    (ev.err < 25
      ? 'Anda benar memperhitungkan gabungan arus dan angin.'
      : 'Arus saja tidak cukup — angin menyeret slick sekitar 3% dari kecepatannya.'),
  )

  if (ev.place.kind === 'ring') {
    notes.push('<b>Penempatan:</b> ' + (ev.place.over
      ? `Cincin ${ev.place.length} m melebihi persediaan ${SUPPLY} m — di lapangan sebagian sisi tidak akan tertutup.`
      : `Cincin ${ev.place.length} m muat dalam persediaan dan memberi ruang manuver skimmer di dalamnya.`))
  } else if (ev.place.kind === 'segments') {
    notes.push(`<b>Penempatan:</b> ${ev.place.okPct}% panjang boom (setelah melengkung) bekerja di bawah ambang ${PERP_LIMIT} knot. ` +
      `${ev.place.used} dari ${ev.place.count} segmen benar-benar menyentuh slick` +
      (ev.place.used < ev.place.count ? ' — segmen yang tidak berada di jalur sebaran adalah boom yang terbuang.' : '.'))
  }

  if (ev.leaks > 0) {
    notes.push(`<b>Entrainment:</b> ${ev.leaks} gumpalan minyak lolos di bawah skirt. ` + (sim.strategy === 'encircle'
      ? 'Kebocoran terpusat di sisi hilir cincin — bagian yang tegak lurus arus.'
      : 'Boom lentur melengkung didorong arus; bagian lengkung yang menghadap arus secara frontal paling dulu bocor. Sudut bentang yang lebih landai mengurangi lengkungan frontal ini.'))
  } else if (ev.T.contained > 0) {
    notes.push(`<b>Entrainment:</b> tidak ada kebocoran di bawah skirt — seluruh boom bekerja di bawah ambang ${PERP_LIMIT} knot.`)
  }
  if (sim.strategy === 'deflect') {
    notes.push(`<b>Pemulihan:</b> ${ev.recovered} gumpalan minyak berhasil dibelokkan sampai ke kapal kerja di titik kumpul.`)
  }
  if (ev.pAsh > 0.05) {
    notes.push(`<b>Dampak lingkungan:</b> ${Math.round(ev.pAsh * 100)}% tumpahan mencapai mangrove — kawasan paling sulit dipulihkan.`)
  }
  return notes
}
