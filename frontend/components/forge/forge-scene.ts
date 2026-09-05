/**
 * The forge in three dimensions — the scenery behind the film's four stations.
 *
 * A real-time Three.js scene, procedural end to end (no model files, no
 * textures to download): an anvil extruded from its profile, an ingot that
 * heats and glows, a hammer, a quenching trough with steam and ripples, a
 * stamping die that leaves the BIC on the metal, a cart on rails. Bloom
 * makes the hot metal bleed light. The film's GSAP timeline does not touch
 * Three directly: it tweens the plain numbers of `fx`, and the scene reads
 * them every frame. That keeps the story in one place (forge-film.tsx) and
 * the rendering in another.
 *
 * Loaded on demand, on wide screens with WebGL only; the SVG scenery stays
 * the fallback everywhere else (phones, reduced motion, no WebGL).
 */

import * as THREE from "three"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js"

/** The numbers the film's timeline drives. All 0..1 unless said otherwise. */
export interface ForgeFx {
  /** the ingot's heat: dull steel → white-orange */
  heat: number
  /** the hammer's angle around its pivot, radians (rest −0.35, wound −0.9, strike +0.32) */
  hammer: number
  /** the strike's after-glow on the anvil */
  glow: number
  /** the ingot goes down into the trough */
  quench: number
  /** steam rises off the water */
  steam: number
  /** ripples spread on the water */
  ripple: number
  /** the metal turns to steel (colour and finish) */
  steel: number
  /** the die comes down onto the ingot */
  stamp: number
  /** the flash at the moment the die lands */
  flash: number
  /** the BIC decal on the metal */
  decal: number
  /** the ingot rides the cart along the rail */
  ship: number
  /** camera keyframe, 0..3, fractional between stations */
  cam: number
}

export interface ForgeScene {
  fx: ForgeFx
  /** for the page's own checks: is the render loop running, where is the camera */
  readonly debug: Record<string, unknown>
  burst: () => void
  setPointer: (x: number, y: number) => void
  start: () => void
  stop: () => void
  resize: () => void
  dispose: () => void
}

const COAL = 0x0c0a09
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (k: number) => k * k * (3 - 2 * k)

/** Soft round particles with per-point life: alpha and size follow it. */
function particleMaterial(color: THREE.Color, sizeWorld: number, alpha: number, fov: number, height: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uSize: { value: sizeWorld },
      uAlpha: { value: alpha },
      uScale: { value: height / (2 * Math.tan((fov * Math.PI) / 360)) },
    },
    vertexShader: `
      attribute float aLife;
      attribute float aSize;
      varying float vLife;
      uniform float uSize; uniform float uScale;
      void main() {
        vLife = aLife;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * aSize * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vLife;
      uniform vec3 uColor; uniform float uAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5 || vLife <= 0.0) discard;
        float soft = smoothstep(0.5, 0.05, d);
        gl_FragColor = vec4(uColor, soft * uAlpha * clamp(vLife, 0.0, 1.0));
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
}

interface Particles {
  points: THREE.Points
  pos: Float32Array
  vel: Float32Array
  /** remaining life in seconds — the simulation's own, never the shader's */
  life: Float32Array
  max: Float32Array
  /** what the shader reads: life / max, 0..1 (its own array, on purpose) */
  norm: Float32Array
  size: Float32Array
  n: number
  alive: number
}

function makeParticles(n: number, material: THREE.ShaderMaterial): Particles {
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), life = new Float32Array(n), max = new Float32Array(n), norm = new Float32Array(n), size = new Float32Array(n)
  for (let i = 0; i < n; i++) { size[i] = 1; pos[i * 3 + 1] = -10 }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
  geo.setAttribute("aLife", new THREE.BufferAttribute(norm, 1))
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1))
  const points = new THREE.Points(geo, material)
  points.frustumCulled = false
  return { points, pos, vel, life, max, norm, size, n, alive: 0 }
}

function anvilGeometry() {
  // side profile in metres: horn to the left, heel to the right
  const s = new THREE.Shape()
  s.moveTo(-0.46, 0)
  s.lineTo(0.46, 0)
  s.lineTo(0.42, 0.13)
  s.lineTo(0.24, 0.15)
  s.lineTo(0.17, 0.42)
  s.lineTo(0.56, 0.5)
  s.lineTo(0.56, 0.63)
  s.lineTo(-0.34, 0.63)
  s.lineTo(-0.78, 0.57)
  s.lineTo(-0.36, 0.48)
  s.lineTo(-0.19, 0.42)
  s.lineTo(-0.25, 0.15)
  s.lineTo(-0.42, 0.13)
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.36, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.018, bevelSegments: 3 })
  g.translate(0, 0, -0.18)
  return g
}

function decalTexture(text: string) {
  const c = document.createElement("canvas")
  c.width = 768; c.height = 192
  const ctx = c.getContext("2d")
  if (ctx) {
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.font = "700 118px 'JetBrains Mono', ui-monospace, Menlo, monospace"
    ctx.textAlign = "center"; ctx.textBaseline = "middle"
    ctx.lineWidth = 6; ctx.strokeStyle = "rgba(0,0,0,0.55)"
    ctx.strokeText(text, c.width / 2, c.height / 2 + 4)
    ctx.fillStyle = "#ffe9c4"
    ctx.fillText(text, c.width / 2, c.height / 2)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** `fx` is the film's own object: its timelines tween it, this scene reads it. */
export function createForgeScene(canvas: HTMLCanvasElement, opts: { bloom: boolean; shadows: boolean; fx: ForgeFx }): ForgeScene {
  const fx = opts.fx

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.setClearColor(COAL, 1)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = opts.shadows
  renderer.shadowMap.type = THREE.PCFShadowMap

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(COAL)
  scene.fog = new THREE.FogExp2(COAL, 0.085)
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.28

  const FOV = 36
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)

  // ── lights ──
  scene.add(new THREE.HemisphereLight(0x4a3b30, 0x070605, 0.55))
  const key = new THREE.DirectionalLight(0xfff0dc, 1.5)
  key.position.set(-2.2, 4.2, 2.6)
  key.castShadow = opts.shadows
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.camera.left = -3.5; key.shadow.camera.right = 3.5; key.shadow.camera.top = 3.5; key.shadow.camera.bottom = -3.5
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 12
  key.shadow.bias = -0.0008
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x9fb3c8, 0.55)
  rim.position.set(3, 2.2, -3)
  scene.add(rim)
  const heatLight = new THREE.PointLight(0xff7a1a, 0, 5, 2)
  scene.add(heatLight)
  const flashLight = new THREE.PointLight(0xfff7ed, 0, 6, 2)
  scene.add(flashLight)

  // ── ground ──
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x100e0c, roughness: 0.95, metalness: 0.05 }))
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  // ── anvil ──
  const iron = new THREE.MeshStandardMaterial({ color: 0x2c2623, metalness: 0.85, roughness: 0.52 })
  const anvil = new THREE.Mesh(anvilGeometry(), iron)
  anvil.castShadow = true; anvil.receiveShadow = true
  scene.add(anvil)
  const block = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.36, 24), new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.95 }))
  block.position.set(0, -0.18, 0)
  block.castShadow = true; block.receiveShadow = true
  scene.add(block)

  // ── the ingot ──
  const ingotMat = new THREE.MeshStandardMaterial({ color: 0x3b3531, metalness: 0.88, roughness: 0.4, emissive: new THREE.Color(0xff6a00), emissiveIntensity: 0 })
  const ingot = new THREE.Mesh(new RoundedBoxGeometry(0.74, 0.13, 0.25, 3, 0.03), ingotMat)
  ingot.castShadow = true; ingot.receiveShadow = true
  scene.add(ingot)
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.155), new THREE.MeshBasicMaterial({ map: decalTexture("UBSWCHZH"), transparent: true, opacity: 0, depthWrite: false }))
  decal.rotation.x = -Math.PI / 2
  decal.position.y = 0.0665
  ingot.add(decal)
  const INGOT_ANVIL = new THREE.Vector3(-0.05, 0.63 + 0.065, 0.0)
  const INGOT_BATH = new THREE.Vector3(0.0, 0.15, 1.0)
  const INGOT_CART = new THREE.Vector3(0, 0.235, 0)

  // ── the hammer ──
  const hammer = new THREE.Group()
  hammer.position.set(0.62, 0.98, 0.02)
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.03, 0.82, 12), new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.8 }))
  handle.rotation.z = Math.PI / 2
  handle.position.x = -0.41
  handle.castShadow = true
  hammer.add(handle)
  const head = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.15, 0.17, 2, 0.02), new THREE.MeshStandardMaterial({ color: 0x35302c, metalness: 0.9, roughness: 0.45 }))
  head.position.x = -0.86
  head.castShadow = true
  hammer.add(head)
  scene.add(hammer)

  // ── the quenching trough ──
  const troughMat = new THREE.MeshStandardMaterial({ color: 0x1b1714, metalness: 0.6, roughness: 0.7 })
  const trough = new THREE.Group()
  const wall = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), troughMat)
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; trough.add(m)
  }
  wall(1.16, 0.05, 0.64, 0, 0.025, 0)
  wall(1.16, 0.28, 0.05, 0, 0.14, -0.295)
  wall(1.16, 0.28, 0.05, 0, 0.14, 0.295)
  wall(0.05, 0.28, 0.64, -0.555, 0.14, 0)
  wall(0.05, 0.28, 0.64, 0.555, 0.14, 0)
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 0.54), new THREE.MeshPhysicalMaterial({ color: 0x0a0d12, metalness: 0.55, roughness: 0.07, envMapIntensity: 1.4 }))
  water.rotation.x = -Math.PI / 2
  water.position.y = 0.2
  trough.add(water)
  trough.position.set(0, 0, 1.0)
  scene.add(trough)
  const rings: THREE.Mesh[] = []
  for (let k = 0; k < 3; k++) {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.105, 64), new THREE.MeshBasicMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }))
    r.rotation.x = -Math.PI / 2
    r.position.set(0, 0.204, 1.0)
    scene.add(r); rings.push(r)
  }

  // ── the stamping die ──
  const die = new THREE.Group()
  const dieBody = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.5, 40), new THREE.MeshStandardMaterial({ color: 0x2f2a27, metalness: 0.9, roughness: 0.38 }))
  dieBody.position.y = 0.25; dieBody.castShadow = true
  die.add(dieBody)
  const dieFace = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.05, 0.2), new THREE.MeshStandardMaterial({ color: 0x1f1b18, metalness: 0.9, roughness: 0.3 }))
  dieFace.position.y = -0.025; dieFace.castShadow = true
  die.add(dieFace)
  const DIE_UP = 1.75, DIE_DOWN = INGOT_ANVIL.y + 0.065 + 0.05
  die.position.set(INGOT_ANVIL.x, DIE_UP, INGOT_ANVIL.z)
  scene.add(die)

  // ── the rail and the cart ──
  const railMat = new THREE.MeshStandardMaterial({ color: 0x3a3430, metalness: 0.85, roughness: 0.45 })
  const RAIL_Z = 1.75
  for (const dz of [-0.13, 0.13]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 9, 10), railMat)
    r.rotation.z = Math.PI / 2
    r.position.set(0, 0.095, RAIL_Z + dz)
    r.receiveShadow = true
    scene.add(r)
  }
  const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x2a211a, roughness: 0.9 })
  for (let x = -4.4; x <= 4.4; x += 0.36) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.4), sleeperMat)
    s.position.set(x, 0.08, RAIL_Z); s.receiveShadow = true
    scene.add(s)
  }
  const cart = new THREE.Group()
  const bed = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.05, 0.34), new THREE.MeshStandardMaterial({ color: 0x2a2521, metalness: 0.7, roughness: 0.6 }))
  bed.position.y = 0.17; bed.castShadow = true
  cart.add(bed)
  const wheels: THREE.Mesh[] = []
  for (const [x, z] of [[-0.2, -0.13], [0.2, -0.13], [-0.2, 0.13], [0.2, 0.13]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 18), railMat)
    w.rotation.x = Math.PI / 2
    w.position.set(x, 0.11, z); w.castShadow = true
    cart.add(w); wheels.push(w)
  }
  cart.position.set(-0.6, 0, RAIL_Z)
  scene.add(cart)

  // ── particles ──
  const sparks = makeParticles(1200, particleMaterial(new THREE.Color(1.0, 0.58, 0.16), 0.018, 0.85, FOV, canvas.clientHeight || 800))
  scene.add(sparks.points)
  const steam = makeParticles(220, particleMaterial(new THREE.Color(0.72, 0.76, 0.8), 0.42, 0.045, FOV, canvas.clientHeight || 800))
  ;(steam.points.material as THREE.ShaderMaterial).blending = THREE.NormalBlending
  scene.add(steam.points)

  // ── post-processing ──
  const composer = opts.bloom ? new EffectComposer(renderer) : null
  const bloom = opts.bloom ? new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.65, 0.82) : null
  if (composer && bloom) {
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(bloom)
    composer.addPass(new OutputPass())
  }

  // ── camera keyframes per station: the anvil sits right of centre so the
  //    words on the left keep their room ──
  const CAM = [
    { p: new THREE.Vector3(-1.3, 1.75, 4.9), t: new THREE.Vector3(-1.35, 0.7, 0.0) },
    { p: new THREE.Vector3(-1.5, 1.6, 5.2), t: new THREE.Vector3(-1.4, 0.45, 0.8) },
    { p: new THREE.Vector3(-1.1, 1.9, 4.4), t: new THREE.Vector3(-1.3, 0.85, 0.0) },
    // audit 2026-09-05 (n° 13): further back, so the anvil is not cut by the
    // JSON card and the cart still has its rails
    { p: new THREE.Vector3(-0.2, 1.65, 6.1), t: new THREE.Vector3(0.35, 0.3, 1.5) },
  ]
  const camPos = new THREE.Vector3(), camTarget = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3()
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 }

  const tmpC = new THREE.Color()
  const STEEL = new THREE.Color(0x9ea7b1), DARK = new THREE.Color(0x3b3531), HOTC = new THREE.Color(0x7a2e0c)

  let w = 1, h = 1
  const resize = () => {
    w = canvas.clientWidth || window.innerWidth
    h = canvas.clientHeight || window.innerHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    composer?.setSize(w, h)
    bloom?.setSize(w, h)
    const scale = h / (2 * Math.tan((FOV * Math.PI) / 360))
    ;(sparks.points.material as THREE.ShaderMaterial).uniforms.uScale.value = scale
    ;(steam.points.material as THREE.ShaderMaterial).uniforms.uScale.value = scale
  }
  resize()

  const spawn = (p: Particles, count: number, at: (i: number) => [number, number, number], vel: () => [number, number, number], life: () => number, size: () => number) => {
    let spawned = 0
    for (let i = 0; i < p.n && spawned < count; i++) {
      if (p.life[i] > 0) continue
      const [x, y, z] = at(i); const [vx, vy, vz] = vel()
      p.pos[i * 3] = x; p.pos[i * 3 + 1] = y; p.pos[i * 3 + 2] = z
      p.vel[i * 3] = vx; p.vel[i * 3 + 1] = vy; p.vel[i * 3 + 2] = vz
      p.max[i] = life(); p.life[i] = p.max[i]; p.size[i] = size()
      spawned++
    }
  }
  const burst = () => {
    const o = ingot.position
    spawn(sparks, 260,
      () => [o.x + (Math.random() - 0.5) * 0.5, o.y + 0.07, o.z + (Math.random() - 0.5) * 0.2],
      () => { const a = Math.random() * Math.PI * 2, sp = 1.2 + Math.random() * 3.4, up = 1.5 + Math.random() * 3.5; return [Math.cos(a) * sp, up, Math.sin(a) * sp * 0.6] },
      () => 0.5 + Math.random() * 1.1,
      () => 0.5 + Math.random() * 1.2)
  }
  const stepParticles = (p: Particles, dt: number, gravity: number, drag: number, floor: number | null, wind: number) => {
    let alive = 0
    for (let i = 0; i < p.n; i++) {
      if (p.life[i] <= 0) continue
      p.life[i] -= dt
      if (p.life[i] <= 0) { p.life[i] = 0; p.pos[i * 3 + 1] = -10; continue }
      p.vel[i * 3 + 1] -= gravity * dt
      p.vel[i * 3] *= drag; p.vel[i * 3 + 1] *= drag; p.vel[i * 3 + 2] *= drag
      p.pos[i * 3] += (p.vel[i * 3] + wind) * dt
      p.pos[i * 3 + 1] += p.vel[i * 3 + 1] * dt
      p.pos[i * 3 + 2] += p.vel[i * 3 + 2] * dt
      if (floor !== null && p.pos[i * 3 + 1] < floor) { p.pos[i * 3 + 1] = floor; p.vel[i * 3 + 1] *= -0.32; p.vel[i * 3] *= 0.7; p.vel[i * 3 + 2] *= 0.7 }
      alive++
    }
    p.alive = alive
    const geo = p.points.geometry
    ;(geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true
    for (let i = 0; i < p.n; i++) p.norm[i] = p.max[i] > 0 && p.life[i] > 0 ? p.life[i] / p.max[i] : 0
    ;(geo.getAttribute("aLife") as THREE.BufferAttribute).needsUpdate = true
    ;(geo.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true
  }

  let wheelSpin = 0
  const update = (dt: number) => {
    // the ingot: where it is, how hot it is, what it is made of
    const q = smooth(clamp01(fx.quench)), sh = smooth(clamp01(fx.ship))
    tmpA.copy(INGOT_ANVIL).lerp(INGOT_BATH, q)
    if (sh > 0) {
      cart.position.x = -0.6 + sh * 2.5
      tmpB.set(cart.position.x, INGOT_CART.y, RAIL_Z)
      tmpA.lerp(tmpB, Math.min(1, sh * 4))
      wheelSpin += (sh - wheelSpin)
    }
    ingot.position.copy(tmpA)
    ingot.rotation.y = sh > 0 ? 0 : q * 0.15
    wheels.forEach((wh) => { wh.rotation.y = (cart.position.x + 0.6) / 0.045 })
    const heat = clamp01(fx.heat) * (1 - clamp01(fx.steel))
    ingotMat.emissiveIntensity = heat * 1.7 + clamp01(fx.flash) * 0.8
    tmpC.copy(DARK).lerp(HOTC, heat).lerp(STEEL, clamp01(fx.steel) * 0.9)
    ingotMat.color.copy(tmpC)
    ingotMat.roughness = lerp(0.4, 0.22, clamp01(fx.steel))
    ingotMat.metalness = lerp(0.88, 1.0, clamp01(fx.steel))
    heatLight.position.copy(ingot.position).y += 0.25
    heatLight.intensity = heat * 7 + clamp01(fx.glow) * 6
    ;(decal.material as THREE.MeshBasicMaterial).opacity = clamp01(fx.decal)

    // the hammer; lifted out of frame while the piece ships (n° 13): its
    // handle used to cross the top-left corner of the last station
    hammer.rotation.z = fx.hammer
    hammer.position.y = 0.98 + sh * 2.8
    hammer.visible = sh < 0.995

    // the die and its flash
    die.position.y = lerp(DIE_UP, DIE_DOWN, smooth(clamp01(fx.stamp)))
    flashLight.position.set(INGOT_ANVIL.x, DIE_DOWN + 0.1, INGOT_ANVIL.z + 0.3)
    flashLight.intensity = clamp01(fx.flash) * 40
    if (bloom) bloom.strength = 0.3 + heat * 0.45 + clamp01(fx.flash) * 1.2 + clamp01(fx.glow) * 0.4

    // ripples on the water
    rings.forEach((r, k) => {
      const s = clamp01((fx.ripple - k * 0.14) / 0.72)
      r.scale.setScalar(1 + s * 7.5)
      r.position.x = ingot.position.x
      ;(r.material as THREE.MeshBasicMaterial).opacity = s > 0 && s < 1 ? (1 - s) * 0.7 : 0
    })

    // steam while the metal is in the water
    if (fx.steam > 0.02) {
      spawn(steam, Math.random() < fx.steam * 0.9 ? 1 : 0,
        () => [ingot.position.x + (Math.random() - 0.5) * 0.7, 0.24, 1.0 + (Math.random() - 0.5) * 0.3],
        () => [(Math.random() - 0.5) * 0.25, 0.35 + Math.random() * 0.45, (Math.random() - 0.5) * 0.15],
        () => 1.2 + Math.random() * 1.2,
        () => 0.5 + Math.random() * 1.0)
    }
    stepParticles(steam, dt, -0.15, 0.995, null, 0.05)
    stepParticles(sparks, dt, 6.5, 0.985, 0.0, 0)

    // the camera: between keyframes, with a hand's worth of pointer parallax
    const c = Math.min(CAM.length - 1, Math.max(0, fx.cam))
    const i = Math.floor(c), k = smooth(c - i), j = Math.min(CAM.length - 1, i + 1)
    camPos.copy(CAM[i].p).lerp(CAM[j].p, k)
    camTarget.copy(CAM[i].t).lerp(CAM[j].t, k)
    pointer.x += (pointer.tx - pointer.x) * 0.06
    pointer.y += (pointer.ty - pointer.y) * 0.06
    camPos.x += pointer.x * 0.18; camPos.y += pointer.y * 0.12
    camera.position.copy(camPos)
    camera.lookAt(camTarget)
  }

  let raf = 0, running = false, last = 0, frames = 0, lost = false
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); lost = true; console.warn("forge: WebGL context lost") })
  canvas.addEventListener("webglcontextrestored", () => { lost = false })
  const frame = (t: number) => {
    if (!running) return
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016)
    last = t
    frames++
    update(dt)
    if (composer) composer.render()
    else renderer.render(scene, camera)
    raf = requestAnimationFrame(frame)
  }
  const start = () => { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame) }
  // One frame now, while the scene is still hidden: the shaders compile here,
  // at idle, and not on the first scrolled frame of the film (a 1.3 s freeze
  // measured on 2026-09-05 once the engine started loading at idle).
  try {
    update(0.016)
    if (composer) composer.render()
    else renderer.render(scene, camera)
  } catch { /* a lost context is handled by the listeners above */ }
  const stop = () => { running = false; cancelAnimationFrame(raf) }
  const onVis = () => { if (document.hidden) stop() }
  document.addEventListener("visibilitychange", onVis)

  return {
    fx,
    get debug() {
      const nan = (a: Float32Array) => { let n = 0; for (let i = 0; i < a.length; i++) if (Number.isNaN(a[i]) || !Number.isFinite(a[i])) n++; return n }
      return { running, lost, cam: [camera.position.x, camera.position.y, camera.position.z].map((v) => Math.round(v * 100) / 100), frames,
        sparksAlive: sparks.alive, steamAlive: steam.alive, nanSparks: nan(sparks.pos) + nan(sparks.vel), nanSteam: nan(steam.pos) + nan(steam.vel),
        ingot: [ingot.position.x, ingot.position.y, ingot.position.z].map((v) => Math.round(v * 100) / 100), heatLight: heatLight.intensity, bloom: bloom?.strength }
    },
    burst,
    setPointer: (x, y) => { pointer.tx = x; pointer.ty = y },
    start,
    stop,
    resize,
    dispose: () => {
      stop()
      document.removeEventListener("visibilitychange", onVis)
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        const mat = m.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose()
      })
      pmrem.dispose()
      composer?.dispose()
      renderer.dispose()
    },
  }
}
