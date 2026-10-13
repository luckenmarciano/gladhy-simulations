# gladhy-simulations

Skenario simulasi 3D untuk modul game-based learning Gladhy (OSCT Indonesia).
Setiap skenario di-build menjadi **satu berkas HTML mandiri** (tanpa CDN, tanpa fetch, tanpa aset eksternal)
supaya berjalan di `<iframe sandbox="allow-scripts">` dengan CSP mount `/games` milik gladhy-backend.

## Struktur
- `src/core/oilspill.js` — engine-core deterministik (PRNG mulberry32, DT tetap). Dipakai klien (three.js) dan server (replay + skor resmi).
- `src/scenarios/oilspill-boom/` — skenario "Pemilihan & Penempatan Boom" (three.js).
- `scripts/build.mjs` — build ke `dist/` (HTML mandiri, zip untuk unggahan trainer, `dist/core/oilspill.cjs`).
- `scripts/sandbox-check.mjs` — uji di iframe sandbox + CSP asli (Playwright).
- `test/core.test.js` — tes determinisme, rubrik, dan replay.

## Perintah
```
npm install
npm test
npm run build
```

## Rilis ke gladhy-backend
1. `dist/oilspill-boom/index.html` → `gladhy-backend/builtin-games/_builtin/oilspill-boom/v<N>/index.html`
2. `dist/core/oilspill.cjs` → `gladhy-backend/src/vendor/oilspill-core.cjs`
3. Versi build bersifat immutable (cache 365 hari): perubahan = direktori versi baru + perbarui `build_path` di `gameTemplates.js`.

## Protokol postMessage v2
`scenario_ready` → `init{attemptId, seed, lang}` → `scenario_complete{log}` → `result{final, level, parts}`.
Skor resmi dihitung server dengan memutar ulang `log` terhadap `seed` yang dibangkitkan server; skor klien hanya tampilan.
