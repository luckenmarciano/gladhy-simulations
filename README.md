# gladhy-simulations

Skenario simulasi 3D untuk modul game-based learning Gladhy (OSCT Indonesia).
Setiap skenario di-build menjadi **satu berkas HTML mandiri** (tanpa CDN, tanpa fetch, tanpa aset eksternal)
supaya berjalan di `<iframe sandbox="allow-scripts">` dengan CSP mount `/games` milik gladhy-backend.

## Struktur
- `src/core/oilspill.js` — engine-core deterministik (PRNG mulberry32, DT tetap). Dipakai klien (three.js) dan server (replay + skor resmi).
- `src/scenarios/oilspill-boom/` — skenario "Pemilihan & Penempatan Boom" (three.js).
- `src/core/aerial.js` + `src/scenarios/pengamat-udara/` — skenario "Pengamat Udara" (OPRC-IMO Level 1,
  Modul 1.1): mengenali warna tampak slick dan menghitung volumenya (workbook hlm 14). Tampilan 2D (SVG).
- `src/core/site.js` + `src/scenarios/tata-lokasi/` — skenario "Tata Lokasi Aman" (Modul 1.2): Zona Merah,
  Kuning, Hijau, APD per tugas, dan keputusan keselamatan (workbook hlm 21–25). Satu HP; mode tim menyusul.
- `src/core/leak.js` + `src/scenarios/boom-bocor/` — skenario "Kenapa Boom Bocor?" (Modul 2.2): enam kegagalan
  oil boom dan mitigasinya (workbook hlm 54–58). Penampang boom beranimasi (SVG).
- `scripts/build.mjs` — build ke `dist/` (HTML mandiri, zip untuk unggahan trainer, `dist/core/oilspill.cjs`).
- `scripts/sandbox-check*.mjs` (`-aerial`, `-site`, `-leak`) — uji di iframe sandbox + CSP asli (Playwright).
- `test/core.test.js` — tes determinisme, rubrik, dan replay.

## Perintah
```
npm install
npm test
npm run build
```

## Rilis ke gladhy-backend
1. `dist/<skenario>/index.html` → `gladhy-backend/builtin-games/_builtin/<skenario>/v<N>/index.html`
2. `dist/core/<core>.cjs` → `gladhy-backend/src/vendor/<core>-core.cjs` (`oilspill`, `aerial`, `site`, `leak`)
3. Versi build bersifat immutable (cache 365 hari): perubahan = direktori versi baru + perbarui `build_path` di `gameTemplates.js`.

## Protokol postMessage v2
`scenario_ready` → `init{attemptId, seed, lang}` → `scenario_complete{log}` → `result{final, level, parts}`.
Skor resmi dihitung server dengan memutar ulang `log` terhadap `seed` yang dibangkitkan server; skor klien hanya tampilan.
