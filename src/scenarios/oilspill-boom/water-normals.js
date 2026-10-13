import * as THREE from 'three'

/**
 * Peta normal air yang dibangkitkan secara prosedural (tileable), menggantikan
 * waternormals.jpg dari CDN. Build berjalan di iframe sandbox dengan CSP yang hanya
 * mengizinkan sumber 'self'/data:, jadi tidak boleh ada aset eksternal.
 */
export function makeWaterNormals(size = 256) {
  const waves = []
  let s = 12345
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  for (let i = 0; i < 14; i++) {
    const kx = Math.floor(rnd() * 9) - 4, ky = Math.floor(rnd() * 9) - 4
    if (kx === 0 && ky === 0) continue
    const k = Math.hypot(kx, ky)
    waves.push({ kx, ky, amp: 1 / (k * 1.3), ph: rnd() * Math.PI * 2 })
  }
  const h = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0
      for (const w of waves) v += w.amp * Math.sin(((w.kx * x + w.ky * y) / size) * Math.PI * 2 + w.ph)
      h[y * size + x] = v
    }
  }
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  const img = g.createImageData(size, size)
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)]
  const strength = 4.5
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      const l = Math.sqrt(dx * dx + dy * dy + 1)
      const i = (y * size + x) * 4
      img.data[i] = ((-dx / l) * 0.5 + 0.5) * 255
      img.data[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255
      img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}
