/**
 * Skenario "Boom Fleksibel" — lapisan render dan UI (three.js).
 * Semua logika simulasi ada di ../../core/oilspill.js; berkas ini hanya menggambar
 * dan meneruskan keputusan peserta ke Sim.
 *
 * Protokol postMessage v2 dengan halaman induk Gladhy:
 *   build → induk : {type:'scenario_ready', protocol:2, scenario_key}
 *   induk → build : {type:'init', attemptId, seed, lang}
 *   build → induk : {type:'scenario_complete', protocol:2, log:[...]}
 *   induk → build : {type:'result', final, level, parts:[{key,v}], passed}
 *   build → induk : {type:'close'}
 * Tanpa induk (dibuka langsung) build berjalan mandiri dengan benih acak.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Water } from 'three/examples/jsm/objects/Water.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import * as Core from '../../core/oilspill.js'
import { makeWaterNormals } from './water-normals.js'
import { buildNotes, LEVEL_LABEL, PART_LABEL } from './notes.js'

const {
  Sim, DIRS, SHIP_C, LEAK, SHORE_Z, SIM_TIME, DT, MAX_SEG, SEG_MAX, SUPPLY, PERP_LIMIT,
  nameOf, mulberry32,
} = Core

const SCENARIO_KEY = 'oilspill-boom-v1'
const $ = (id) => document.getElementById(id)
const SMALL = Math.min(innerWidth, innerHeight) < 760
const MAX_RENDER_OIL = SMALL ? 450 : Core.MAX_OIL          // kualitas visual saja; simulasi tetap 900 partikel
const rad = (d) => (d * Math.PI) / 180

/* ═════════════ RENDERER & ADEGAN ═════════════ */
const renderer = new THREE.WebGLRenderer({ antialias: !SMALL, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio, SMALL ? 1.5 : 2))
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.6
$('app').appendChild(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 1, 9000)
camera.position.set(-40, 255, 330)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(-15, 0, 30)
controls.enableDamping = true
controls.dampingFactor = 0.07
controls.minDistance = 60
controls.maxDistance = 720
controls.maxPolarAngle = Math.PI * 0.47
controls.enablePan = false

const sky = new Sky()
sky.scale.setScalar(12000)
const sun = new THREE.Vector3()
{
  const u = sky.material.uniforms
  u.turbidity.value = 7; u.rayleigh.value = 1.5
  u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8
  sun.setFromSphericalCoords(1, rad(73), rad(150))
  u.sunPosition.value.copy(sun)
}
const pmrem = new THREE.PMREMGenerator(renderer)
const envS = new THREE.Scene(); envS.add(sky)
scene.environment = pmrem.fromScene(envS).texture
scene.add(sky)

const water = new Water(new THREE.PlaneGeometry(14000, 14000), {
  textureWidth: SMALL ? 256 : 512, textureHeight: SMALL ? 256 : 512,
  waterNormals: makeWaterNormals(256),
  sunDirection: sun.clone().normalize(), sunColor: 0xffffff,
  waterColor: 0x0a2a36, distortionScale: 3.0, fog: false,
})
water.rotation.x = -Math.PI / 2
scene.add(water)

scene.add(new THREE.HemisphereLight(0xa8cde8, 0x102030, 0.38))
const key = new THREE.DirectionalLight(0xfff2e0, 2.1)
key.position.copy(sun).multiplyScalar(500)
scene.add(key)

/* ═════════════ MATERIAL & GEOMETRI ═════════════ */
const std = (color, metalness, roughness, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra })
const M = {
  hull: std(0x171b22, 0.86, 0.44), red: std(0x8d2618, 0.5, 0.64), white: std(0xdde3e8, 0.24, 0.56),
  deck: std(0x2b323b, 0.58, 0.74), steel: std(0x4e565f, 0.9, 0.34), amber: std(0xd08812, 0.48, 0.52),
  glass: std(0x0c1a24, 1, 0.07), boom: std(0xffffff, 0.1, 0.62), cable: std(0x2a2620, 0.4, 0.7),
  buoy: std(0xc8241a, 0.3, 0.5), orange: std(0xe0661a, 0.3, 0.55),
  mang: std(0x1d4a24, 0, 0.95), sand: std(0x5c5138, 0, 0.92), scar: std(0x4a1c0c, 0.4, 0.88),
}
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m }
const cyl = (rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 20) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); return m }

function hullShape() {
  const s = new THREE.Shape(), B = 19
  s.moveTo(-64, -B); s.lineTo(38, -B)
  s.quadraticCurveTo(64, -16, 78, 0); s.quadraticCurveTo(64, 16, 38, B)
  s.lineTo(-64, B); s.quadraticCurveTo(-78, 13, -78, 0); s.quadraticCurveTo(-78, -13, -64, -B)
  return s
}
function extrude(sh, depth, mat, y) {
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 1.5, bevelSize: 1.5, bevelSegments: 2, curveSegments: 16 })
  g.rotateX(-Math.PI / 2)
  const m = new THREE.Mesh(g, mat); m.position.y = y
  return m
}

const ship = new THREE.Group()
ship.position.set(SHIP_C.x, 0, SHIP_C.z)
ship.rotation.y = rad(-8)
scene.add(ship)
ship.add(extrude(hullShape(), 24, M.hull, -8))
{
  const b = extrude(hullShape(), 8, M.red, -8.6); b.scale.set(1.009, 1, 1.009); ship.add(b)
  const d = extrude(hullShape(), 1.3, M.deck, 16); d.scale.set(0.962, 1, 0.962); ship.add(d)
}
for (let i = 0; i < 5; i++) {
  ship.add(cyl(8.2, 8.2, 4.6, M.steel, -44 + i * 22, 19.4, 0, 26))
  const dome = new THREE.Mesh(new THREE.SphereGeometry(8.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.steel)
  dome.position.set(-44 + i * 22, 21.7, 0); ship.add(dome)
}
{ const mf = cyl(1.6, 1.6, 120, M.steel, -8, 18.8, 11, 12); mf.rotation.z = Math.PI / 2; ship.add(mf) }
ship.add(box(28, 24, 32, M.white, -58, 29, 0))
ship.add(box(22, 7.5, 36, M.white, -58, 44.5, 0))
ship.add(box(22.6, 3.6, 36.6, M.glass, -58, 45.6, 0))
ship.add(cyl(5.8, 6.8, 16, M.amber, -71, 50, 0))
ship.add(cyl(5.9, 5.9, 2.6, M.hull, -71, 58.5, 0))
ship.add(cyl(0.55, 0.8, 22, M.steel, -58, 59, 0, 8))
;[-1, 1].forEach((s) => ship.add(box(132, 0.55, 0.55, M.steel, -8, 18.8, s * 17.5)))
ship.add(box(11, 8, 1.6, M.scar, -30, 3, 20.6))
ship.updateMatrixWorld(true)

const sv = new THREE.Group(); scene.add(sv)
sv.add(box(46, 12, 16, M.hull, 0, -1.5, 0)); sv.add(box(44, 0.7, 14, M.deck, 0, 5, 0))
sv.add(box(12, 9, 11, M.white, -14, 9.5, 0))
sv.position.copy(ship.localToWorld(new THREE.Vector3(-140, 0, 80))); sv.rotation.y = rad(-40)

function makeBoat() {
  const g = new THREE.Group()
  g.add(box(16, 3.4, 6, M.orange, 0, 0.4, 0))
  g.add(box(5, 4, 4.6, M.white, -3, 4, 0))
  g.add(box(5.2, 1.2, 4.8, M.glass, -3, 5.2, 0))
  const arm = cyl(0.35, 0.35, 9, M.steel, 4, 4, 0, 6); arm.rotation.z = rad(-55); g.add(arm)
  g.visible = false; scene.add(g)
  return g
}
const boats = [makeBoat(), makeBoat(), makeBoat()]

/* pantai & mangrove (dekor; acak berbenih agar tampilan konsisten) */
{
  const r = mulberry32(7)
  scene.add(box(1600, 4, 150, M.sand, 0, 0.6, SHORE_Z + 95))
  scene.add(box(1600, 2.6, 40, M.mang, 0, 1, SHORE_Z + 14))
  const im = new THREE.InstancedMesh(new THREE.SphereGeometry(7, 7, 5), M.mang, 110)
  const d = new THREE.Object3D()
  for (let i = 0; i < 110; i++) {
    d.position.set(-780 + r() * 1560, 3 + r() * 3, SHORE_Z + 2 + r() * 30)
    const s = 0.55 + r() * 0.85
    d.scale.set(s, s * 0.75, s); d.rotation.y = r() * 6.28; d.updateMatrix(); im.setMatrixAt(i, d.matrix)
  }
  scene.add(im)
}

/* slick dua lapis */
function blobTex(blobs, rMin, rMax, seed) {
  const r = mulberry32(seed)
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128)
  g.globalCompositeOperation = 'lighter'
  for (let k = 0; k < blobs; k++) {
    const cx = 64 + (r() - 0.5) * 32, cy = 64 + (r() - 0.5) * 32
    const rr = rMin + r() * (rMax - rMin)
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr)
    gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, rr, 0, 6.283); g.fill()
  }
  return new THREE.CanvasTexture(c)
}
const sheenMat = new THREE.MeshPhysicalMaterial({
  color: 0x232a30, metalness: 0.2, roughness: 0.07, iridescence: 1, iridescenceIOR: 1.3,
  iridescenceThicknessRange: [100, 520], clearcoat: 1, clearcoatRoughness: 0.05,
  alphaMap: blobTex(6, 22, 44, 11), transparent: true, opacity: 0.5, depthWrite: false,
})
const coreMat = new THREE.MeshStandardMaterial({
  color: 0xffffff, metalness: 0.35, roughness: 0.14,
  alphaMap: blobTex(7, 16, 40, 12), transparent: true, opacity: 0.95, depthWrite: false,
})
const quad = new THREE.PlaneGeometry(1, 1); quad.rotateX(-Math.PI / 2)
const sheenIM = new THREE.InstancedMesh(quad, sheenMat, MAX_RENDER_OIL)
const coreIM = new THREE.InstancedMesh(quad, coreMat, MAX_RENDER_OIL)
sheenIM.renderOrder = 1; coreIM.renderOrder = 2
;[sheenIM, coreIM].forEach((m) => { m.count = 0; m.frustumCulled = false; scene.add(m) })
const tmpC = new THREE.Color(), C_FRESH = new THREE.Color(0x050302), C_OLD = new THREE.Color(0x3a210d), C_HELD = new THREE.Color(0x080503)
for (let i = 0; i < MAX_RENDER_OIL; i++) coreIM.setColorAt(i, C_FRESH)

/* boom */
const LINK_CAP = 700
const linkGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 6); linkGeo.rotateZ(Math.PI / 2)
const floatGeo = new THREE.CylinderGeometry(1.45, 1.45, 1, 12); floatGeo.rotateZ(Math.PI / 2)
const linkIM = new THREE.InstancedMesh(linkGeo, M.cable, LINK_CAP)
const floatIM = new THREE.InstancedMesh(floatGeo, M.boom, LINK_CAP)
const buoyIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.1, 2.6, 5, 14), M.buoy, 40)
const C_Y1 = new THREE.Color(0xf2a51c), C_Y2 = new THREE.Color(0xe08a10)
for (let i = 0; i < LINK_CAP; i++) floatIM.setColorAt(i, i % 2 ? C_Y1 : C_Y2)
;[linkIM, floatIM, buoyIM].forEach((m) => { m.count = 0; m.frustumCulled = false; scene.add(m) })
const markerMesh = cyl(3.5, 3.5, 1.4, M.orange, 0, 1.2, 0, 16); markerMesh.visible = false; scene.add(markerMesh)

/* ═════════════ STATE UI ═════════════ */
let sim = null
let speed = 1, simClock = 0, accum = 0
let pending = null            // titik jangkar pertama segmen deflection
let embedded = false          // dijalankan di dalam Gladhy (ada induk)
let attemptId = null
let finished = false
const dummy = new THREE.Object3D()

const SCREENS = ['scrBrief', 'scrPredict', 'scrStrategy', 'scrDebrief']
const show = (id) => SCREENS.forEach((s) => $(s).classList.toggle('hide', s !== id))
const hideAll = () => SCREENS.forEach((s) => $(s).classList.add('hide'))
const tip = (t) => { $('tip').textContent = t }
let toastT
function toast(t) {
  const el = $('toast'); el.textContent = t; el.style.display = 'block'
  clearTimeout(toastT); toastT = setTimeout(() => { el.style.display = 'none' }, 2500)
}
function setStatus(t) { const el = $('status'); if (!t) { el.classList.add('hide'); return } el.textContent = t; el.classList.remove('hide') }

/* ═════════════ RENDER BOOM & SLICK ═════════════ */
function renderBooms() {
  let li = 0, bi = 0
  for (const b of sim.booms) {
    for (const l of b.links) {
      if (li >= LINK_CAP) break
      const a = b.nodes[l.i], c = b.nodes[l.j]
      const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2, len = Math.hypot(c.x - a.x, c.z - a.z)
      const y = 0.75 + Math.sin(simClock * 1.4 + mx * 0.06 + mz * 0.045) * 0.32
      const ang = Math.atan2(c.z - a.z, c.x - a.x)
      dummy.position.set(mx, y, mz); dummy.rotation.set(0, -ang, 0)
      dummy.scale.set(len, 1, 1); dummy.updateMatrix(); linkIM.setMatrixAt(li, dummy.matrix)
      dummy.scale.set(len * 0.64, 1, 1); dummy.updateMatrix(); floatIM.setMatrixAt(li, dummy.matrix)
      li++
    }
    for (const q of b.nodes) {
      if (!q.fixed || bi >= 40) continue
      dummy.position.set(q.x, 1.4 + Math.sin(simClock * 1.2 + q.x * 0.05) * 0.3, q.z)
      dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix()
      buoyIM.setMatrixAt(bi++, dummy.matrix)
    }
  }
  linkIM.count = floatIM.count = li; buoyIM.count = bi
  linkIM.instanceMatrix.needsUpdate = floatIM.instanceMatrix.needsUpdate = buoyIM.instanceMatrix.needsUpdate = true

  boats.forEach((bt) => { bt.visible = false })
  if (sim.strategy === 'deflect') {
    sim.booms.forEach((b, i) => {
      if (!b.collect || !boats[i]) return
      const ol = Math.hypot(b.collect.ox, b.collect.oz) || 1
      const ux = b.collect.ox / ol, uz = b.collect.oz / ol
      const bt = boats[i]; bt.visible = true
      bt.position.set(b.collect.x + ux * 13, Math.sin(simClock * 1.1 + i) * 0.25, b.collect.z + uz * 13)
      bt.rotation.y = -Math.atan2(-uz, -ux)
    })
  } else if (sim.ringIdx >= 0) {
    const rb = sim.booms[sim.ringIdx], dv = sim.curFlow
    let best = -1e9, q = rb.nodes[0]
    for (const n of rb.nodes) { const pr = n.x * dv.x + n.z * dv.z; if (pr > best) { best = pr; q = n } }
    const ox = q.x - SHIP_C.x, oz = q.z - SHIP_C.z, ol = Math.hypot(ox, oz) || 1
    boats[0].visible = true
    boats[0].position.set(q.x + (ox / ol) * 16, Math.sin(simClock * 1.1) * 0.25, q.z + (oz / ol) * 16)
    boats[0].rotation.y = -Math.atan2(oz, ox) + Math.PI / 2
  }
}

function renderOil() {
  let n = 0
  const stride = sim.parts.length > MAX_RENDER_OIL ? Math.ceil(sim.parts.length / MAX_RENDER_OIL) : 1
  for (let i = 0; i < sim.parts.length; i += stride) {
    const p = sim.parts[i]
    if (p.state === 'rec' || p.state === 'esc' || n >= MAX_RENDER_OIL) continue
    const ash = p.state === 'ashore'
    const ds = ash ? 9 : Math.min(26, 7 + p.age * 1.15) * (stride > 1 ? 1.25 : 1)
    dummy.rotation.set(0, p.rot, 0)
    dummy.position.set(p.x, ash ? 2.55 : 0.5, p.z); dummy.scale.set(ds, 1, ds); dummy.updateMatrix()
    sheenIM.setMatrixAt(n, dummy.matrix)
    const dc = p.held > 0 ? 8.5 : ash ? 6 : Math.max(3.2, 7.5 - p.age * 0.17)
    dummy.position.y = ash ? 2.7 : 0.85; dummy.scale.set(dc, 1, dc); dummy.updateMatrix()
    coreIM.setMatrixAt(n, dummy.matrix)
    if (p.held > 0) tmpC.copy(C_HELD)
    else tmpC.copy(C_FRESH).lerp(C_OLD, Math.min(1, p.age / 45))
    coreIM.setColorAt(n, tmpC)
    n++
  }
  sheenIM.count = coreIM.count = n
  sheenIM.instanceMatrix.needsUpdate = coreIM.instanceMatrix.needsUpdate = true
  if (coreIM.instanceColor) coreIM.instanceColor.needsUpdate = true
}

/* ═════════════ INTERAKSI ═════════════ */
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2()
const SEA = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const pointers = new Set(); let down = null, multi = false
renderer.domElement.addEventListener('pointerdown', (e) => {
  pointers.add(e.pointerId); if (pointers.size > 1) multi = true
  down = { x: e.clientX, y: e.clientY }
})
renderer.domElement.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId) })
renderer.domElement.addEventListener('pointerup', (e) => {
  pointers.delete(e.pointerId)
  const wasMulti = multi; if (pointers.size === 0) multi = false
  if (!down || wasMulti) return
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null
  if (moved > 9 || !sim || sim.phase !== 'deploy' || !sim.strategy) return
  ptr.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
  ray.setFromCamera(ptr, camera)
  const hit = ray.ray.intersectPlane(SEA, new THREE.Vector3())
  if (hit) onSeaTap(hit)
})

const boomLabel = () => sim.strategy === 'encircle' ? `${sim.supplyUsed} m` : `${sim.booms.length}/${MAX_SEG} · ${sim.supplyUsed} m`
function clearPending() { pending = null; markerMesh.visible = false }

function onSeaTap(p) {
  if (sim.strategy === 'encircle') {
    const r = sim.placeRing(p.x, p.z)
    if (!r.ok) return
    $('hBoom').textContent = `${r.length} m`
    tip(r.overSupply
      ? `Cincin ${r.length} m melebihi persediaan ${SUPPLY} m. Ketuk lebih dekat ke kapal.`
      : `Cincin ${r.length} m dari persediaan ${SUPPLY} m, ditambat 6 jangkar. Ketuk lagi untuk menyesuaikan, atau tekan Jalankan.`)
    return
  }
  if (!pending) {
    if (sim.booms.length >= MAX_SEG) return toast('Seluruh segmen boom sudah terpasang')
    pending = { x: p.x, z: p.z }
    markerMesh.position.set(p.x, 1.2, p.z); markerMesh.visible = true
    tip('Ketuk titik jangkar kedua untuk membentang segmen boom ini.')
    return
  }
  const r = sim.placeSegment(pending, { x: p.x, z: p.z })
  if (!r.ok) {
    const msg = { short: 'Segmen terlalu pendek', long: `Bentang maksimum ${SEG_MAX} m per segmen`, supply: `Persediaan boom ${SUPPLY} m tidak cukup`, max: 'Seluruh segmen boom sudah terpasang' }[r.error] || 'Penempatan tidak valid'
    toast(msg)
    if (r.error !== 'short') clearPending()
    return
  }
  clearPending()
  $('hBoom').textContent = boomLabel()
  tip(sim.booms.length >= MAX_SEG
    ? 'Seluruh segmen terpasang. Perhatikan lengkungnya, lalu tekan Jalankan.'
    : 'Boom melengkung mengikuti arus. Kapal kerja menandai ujung hilir — titik pengumpulan. Pasang segmen berikutnya atau Jalankan.')
}

/* kamera */
const CAMS = [
  { n: 'Perspektif', p: new THREE.Vector3(-40, 255, 330), t: new THREE.Vector3(-15, 0, 30) },
  { n: 'Atas', p: new THREE.Vector3(-10, 650, 90), t: new THREE.Vector3(-10, 0, 40) },
  { n: 'Dekat', p: new THREE.Vector3(LEAK.x + 85, 62, LEAK.z + 115), t: new THREE.Vector3(LEAK.x, 0, LEAK.z + 30) },
]
let camIdx = 0, camAnim = null
controls.addEventListener('start', () => { camAnim = null })
function cycleCam() {
  camIdx = (camIdx + 1) % CAMS.length; camAnim = CAMS[camIdx]
  $('camBtn').textContent = `Kamera: ${CAMS[camIdx].n}`
}

/* ═════════════ DEBRIEF ═════════════ */
function showDebrief(official) {
  const ev = sim.evaluate(), T = ev.T, pc = (v) => Math.round((v / T.total) * 100) + '%'
  // Skor resmi dari server menimpa hitungan lokal bila ada.
  const parts = official?.parts ? ev.parts.map((p) => ({ ...p, v: official.parts.find((o) => o.key === p.key)?.v ?? p.v })) : ev.parts
  const final = official?.final ?? ev.final
  const level = official?.level ?? ev.level
  const cls = level === 'KOMPETEN' ? 'v-ok' : level === 'PERLU_BIMBINGAN' ? 'v-mid' : 'v-bad'
  $('dVerdict').className = 'verdict ' + cls
  $('dVerdict').textContent = `${LEVEL_LABEL[level]} — skor ${Math.round(final)}/100` + (official ? '' : (embedded ? ' (menunggu skor resmi…)' : ''))
  $('dSum').innerHTML = [
    ['Tertahan/terkumpul', pc(T.contained), 'ok'], ['Ke mangrove', pc(T.ash), 'bad'],
    ['Bocor boom', ev.leaks, 'warn'], ['Masih menyebar', pc(T.flt + T.esc), '']]
    .map(([k, v, c]) => `<div class="cell"><div class="k">${k}</div><div class="v ${c}">${v}</div></div>`).join('')
  $('dBars').innerHTML = parts.map((p) => {
    const col = p.v >= 75 ? '#3fb950' : p.v >= 50 ? '#d29922' : '#f85149'
    return `<div class="bar"><div class="top"><span>${PART_LABEL[p.key]}</span><b>${Math.round(p.v)} · ${Math.round(p.w * 100)}%</b></div>
      <div class="track"><div class="fill" style="width:${Math.round(p.v)}%;background:${col}"></div></div></div>`
  }).join('')
  $('dNotes').innerHTML = buildNotes(ev, sim).map((x) => `<li>${x}</li>`).join('')
  $('btnReplay').classList.toggle('hide', embedded)
  $('btnDone').classList.toggle('hide', !embedded)
  show('scrDebrief')
}

/* ═════════════ ALUR ═════════════ */
function initScenario(seedValue) {
  sim = new Sim(seedValue)
  speed = 1; accum = 0; finished = false; clearPending()
  sheenIM.count = coreIM.count = 0
  const s = sim.seed
  $('bCur').textContent = nameOf(s.curDeg); $('bCurS').textContent = s.curSpd.toFixed(2) + ' knot'
  $('bWind').textContent = nameOf(s.windDeg); $('bWindS').textContent = s.windSpd.toFixed(0) + ' knot'
  $('pCur').textContent = `${nameOf(s.curDeg)} · ${s.curSpd.toFixed(2)} kt`
  $('pWind').textContent = `${nameOf(s.windDeg)} · ${s.windSpd.toFixed(0)} kt`
  $('sCur').textContent = `${s.curSpd.toFixed(2)} knot`
  $('compass').innerHTML = DIRS.map((d) => `<button class="dirbtn" data-d="${d.d}">${d.s}<br>
    <span style="font-size:10px;font-weight:400;opacity:.65">${d.l}</span></button>`).join('')
  $('compass').querySelectorAll('.dirbtn').forEach((b) => {
    b.onclick = () => {
      $('compass').querySelectorAll('.dirbtn').forEach((x) => x.classList.remove('sel'))
      b.classList.add('sel'); sim.setPrediction(+b.dataset.d); $('btnPredict').disabled = false
    }
  })
  document.querySelectorAll('.opt').forEach((b) => {
    b.classList.remove('sel')
    b.onclick = () => {
      document.querySelectorAll('.opt').forEach((x) => x.classList.remove('sel'))
      b.classList.add('sel'); chosenStrategy = b.dataset.s; $('btnStrategy').disabled = false
    }
  })
  chosenStrategy = null
  $('hBoom').textContent = '—'; $('hStrat').textContent = '—'
  ;['hIn', 'hLeak', 'hAsh'].forEach((i) => { $(i).textContent = '0' })
  $('hClock').textContent = 'T+00:00'
  $('btnPredict').disabled = $('btnStrategy').disabled = true
  $('btnSpeed').textContent = 'Kecepatan 1×'; $('progFill').style.width = '0%'
  ;['hud', 'dock', 'runDock', 'phase', 'camBtn', 'backBar'].forEach((i) => $(i)?.classList.add('hide'))
  show('scrBrief')
}
let chosenStrategy = null

$('btnBrief').onclick = () => show('scrPredict')
$('btnPredict').onclick = () => show('scrStrategy')
$('btnStrategy').onclick = () => {
  if (!sim.setStrategy(chosenStrategy).ok) return
  hideAll()
  ;['hud', 'dock', 'phase', 'camBtn'].forEach((i) => $(i).classList.remove('hide'))
  $('phase').textContent = 'Tahap 3 · Penempatan boom'
  if (sim.strategy === 'encircle') {
    $('hStrat').textContent = 'Encirclement'; $('btnUndo').textContent = 'Hapus cincin'
    tip('Ketuk di laut untuk menentukan lebar cincin boom di sekeliling kapal.')
  } else {
    $('hStrat').textContent = 'Deflection'; $('btnUndo').textContent = 'Hapus terakhir'
    $('hBoom').textContent = `0/${MAX_SEG}`
    tip('Ketuk dua titik jangkar untuk membentang satu segmen boom. Bentangkan menyudut terhadap arus — boom akan melengkung sendiri.')
  }
}
$('btnUndo').onclick = () => {
  if (sim.phase !== 'deploy') return
  if (pending) { clearPending(); return }
  if (!sim.undo().ok) return toast('Belum ada boom terpasang')
  $('hBoom').textContent = sim.strategy === 'encircle' ? '—' : boomLabel()
}
$('btnRun').onclick = () => {
  if (sim.phase !== 'deploy') return
  clearPending()
  const r = sim.start()
  if (!r.ok) return toast(sim.strategy === 'encircle' ? 'Tentukan cincin boom lebih dulu' : 'Pasang minimal satu segmen')
  speed = 1; accum = 0
  $('btnSpeed').textContent = 'Kecepatan 1×'; $('progFill').style.width = '0%'
  $('phase').textContent = 'Tahap 4 · Simulasi berjalan'
  $('dock').classList.add('hide'); $('runDock').classList.remove('hide')
}
$('btnSpeed').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; $('btnSpeed').textContent = `Kecepatan ${speed}×` }

function finishRun() {
  if (finished) return
  finished = true
  $('runDock').classList.add('hide')
  showDebrief(null)
  if (embedded) {
    parent.postMessage({ type: 'scenario_complete', protocol: 2, scenario_key: SCENARIO_KEY, log: sim.log }, '*')
  }
}
$('btnStop').onclick = () => { if (sim.phase === 'run') { sim.finish(false); finishRun() } }
$('btnView').onclick = () => {
  hideAll(); $('phase').textContent = 'Kondisi akhir — ketuk tombol di bawah untuk kembali'
  $('dock').classList.add('hide'); $('runDock').classList.add('hide'); $('backBar').classList.remove('hide')
}
$('btnReplay').onclick = () => initScenario((Math.random() * 4294967296) >>> 0)
$('btnDone').onclick = () => parent.postMessage({ type: 'close', protocol: 2 }, '*')
$('camBtn').onclick = cycleCam

{
  const d = document.createElement('div'); d.id = 'backBar'; d.className = 'glass hide'
  d.style.cssText = 'position:absolute;left:10px;right:10px;bottom:calc(env(safe-area-inset-bottom) + 10px);padding:12px 13px;z-index:10;max-width:370px'
  d.innerHTML = '<button id="btnBack">Kembali ke hasil</button>'
  $('app').appendChild(d)
  $('btnBack').onclick = () => { d.classList.add('hide'); show('scrDebrief') }
}

/* ═════════════ LOOP ═════════════ */
let last = performance.now()
renderer.setAnimationLoop(() => {
  if (!sim) { renderer.render(scene, camera); return }
  const now = performance.now(), raw = Math.min(0.05, (now - last) / 1000); last = now
  simClock += raw
  water.material.uniforms.time.value += raw * 0.5

  if (sim.phase === 'deploy') {
    if (sim.booms.length) { sim.relaxBooms(); sim.relaxBooms() }
  } else if (sim.phase === 'run') {
    accum += raw * speed
    let guard = 12
    while (accum >= DT && sim.phase === 'run' && guard-- > 0) { sim.step(); accum -= DT }
    if (accum > DT * 12) accum = 0
    const T = sim.tally()
    $('hIn').textContent = T.contained; $('hLeak').textContent = sim.leaks; $('hAsh').textContent = T.ash
    const tm = Math.floor(sim.t * 5)
    $('hClock').textContent = `T+${String(Math.floor(tm / 60)).padStart(2, '0')}:${String(tm % 60).padStart(2, '0')}`
    $('progFill').style.width = Math.min(100, (sim.t / SIM_TIME) * 100).toFixed(1) + '%'
    if (sim.phase === 'done') finishRun()
  }

  renderBooms(); renderOil()
  if (camAnim) {
    camera.position.lerp(camAnim.p, 0.07); controls.target.lerp(camAnim.t, 0.07)
    if (camera.position.distanceTo(camAnim.p) < 1) camAnim = null
  }
  controls.update()
  renderer.render(scene, camera)
})

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

/* ═════════════ JABAT TANGAN DENGAN GLADHY ═════════════ */
const hasParent = window.parent !== window
if (!hasParent) {
  initScenario((Math.random() * 4294967296) >>> 0)
} else {
  setStatus('Menunggu sesi dari Gladhy…')
  let standalone = false
  addEventListener('message', (e) => {
    if (e.source !== window.parent) return
    const m = e.data || {}
    if (m.type === 'init' && !embedded && Number.isInteger(m.seed)) {
      embedded = true; attemptId = m.attemptId || null
      setStatus(null)
      initScenario(m.seed >>> 0)            // init yang datang terlambat tetap menang atas mode mandiri
    } else if (m.type === 'result' && embedded && sim?.phase === 'done') {
      showDebrief({ final: m.final, level: m.level, parts: m.parts })
    }
  })
  parent.postMessage({ type: 'scenario_ready', protocol: 2, scenario_key: SCENARIO_KEY }, '*')
  // Dibuka di iframe biasa tanpa Gladhy (mis. pratinjau): jalan mandiri bila tak ada jawaban.
  setTimeout(() => {
    if (embedded || standalone) return
    standalone = true; setStatus(null)
    initScenario((Math.random() * 4294967296) >>> 0)
  }, 6000)
}
