import { chromium, devices, Browser, Page } from 'playwright'
import type { ScanResult } from './types'

/** Device descriptor used for mobile-emulation sessions. */
const MOBILE_DEVICE = 'Pixel 7'

/** A live, kept-open browser session (headed mode) the caller closes on demand. */
export interface ScanSession {
  url: string
  browser: Browser
  page: Page
}

/**
 * One-shot scan: launch Chromium, capture, and ALWAYS close the browser.
 * Used by the headless path where no live window is wanted.
 */
export async function scanUrl(
  url: string,
  opts: { headless: boolean; settleMs: number }
): Promise<ScanResult> {
  let browser: Browser | undefined
  try {
    browser = await chromium.launch({ headless: opts.headless })
    const page = await browser.newPage()
    await loadWithHook(page, url, opts.settleMs)
    return { url, ...(await page.evaluate(serializeCaptured)) }
  } finally {
    await browser?.close()
  }
}

/**
 * Launch a browser and leave it OPEN, returning both the captured scene and the
 * live session so the caller can re-scan or close it later. On any failure the
 * browser is closed before rethrowing so we never leak a window.
 */
export async function openScanSession(
  url: string,
  opts: { settleMs: number; mobile?: boolean }
): Promise<{ result: ScanResult; session: ScanSession }> {
  const device = opts.mobile ? devices[MOBILE_DEVICE] : undefined

  // Chrome refuses to make a window narrower than ~500px. If the device viewport
  // is narrower (Pixel 7 = 412), the window clamps to the minimum while the page
  // viewport stays at 412 — leaving a white gap. Fix: widen BOTH the window and
  // the emulated viewport to the same value (>= the minimum) so the page fills
  // the window with no gap. Height needs no clamp; canvas CSS fills it.
  const CHROME_MIN_WIDTH = 500
  const CHROME_HEIGHT = 140 // address bar + tab strip estimate
  let launchArgs: string[] = []
  let contextOpts: Parameters<Browser['newContext']>[0] | undefined

  if (device?.viewport) {
    const width = Math.max(device.viewport.width, CHROME_MIN_WIDTH)
    const height = device.viewport.height
    launchArgs = [`--window-size=${width},${height + CHROME_HEIGHT}`]
    // Spread the device (UA, touch, isMobile, DPR) but override the viewport
    // width so it matches the actual (clamped) window width.
    contextOpts = { ...device, viewport: { width, height } }
  }

  const browser = await chromium.launch({ headless: false, args: launchArgs })
  try {
    const context = contextOpts
      ? await browser.newContext(contextOpts)
      : await browser.newContext()
    const page = await context.newPage()
    await loadWithHook(page, url, opts.settleMs)
    const result: ScanResult = { url, ...(await page.evaluate(serializeCaptured)) }
    return { result, session: { url, browser, page } }
  } catch (err) {
    await browser.close()
    throw err
  }
}

/** Re-read the scene graph from an already-open session's page. */
export async function rescanSession(
  session: ScanSession,
  opts: { settleMs: number }
): Promise<ScanResult> {
  await session.page.waitForTimeout(opts.settleMs)
  return { url: session.url, ...(await session.page.evaluate(serializeCaptured)) }
}

/**
 * Read the CURRENT uniform values of one material (by uuid) from the open page.
 * Cheap enough to call on an interval for live updates. Returns null if the
 * material can no longer be found (e.g. scene was rebuilt).
 */
export async function pollUniforms(
  session: ScanSession,
  uuid: string
): Promise<import('./types').UniformInfo[] | null> {
  return session.page.evaluate(pollUniformsInPage, uuid)
}

/** Install the capture hook (pre-load) then navigate and let the runtime settle. */
async function loadWithHook(page: Page, url: string, settleMs: number): Promise<void> {
  // addInitScript => runs on every new document BEFORE the app's own scripts,
  // which is the critical timing requirement for the __THREE_DEVTOOLS__ hook.
  await page.addInitScript(installHook)
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
  await page.waitForTimeout(settleMs)
}

/**
 * Runs in the PAGE context. Two capture strategies:
 *  1. __THREE_DEVTOOLS__ EventTarget — devtools-aware three.js registers
 *     its renderer/scene by dispatching 'observe' events.
 *  2. Monkey-patch WebGLRenderer.prototype.render to capture (scene, camera)
 *     on first draw — a fallback when the hook path is unavailable, as long
 *     as THREE is reachable on window.
 */
function installHook(): void {
  const w = window as any
  w.__threeCaptured = { objects: new Set<any>(), notes: [] as string[] }

  // Strategy 1: devtools hook
  const hook = new EventTarget()
  ;(hook as any).dispatchEvent = EventTarget.prototype.dispatchEvent.bind(hook)
  hook.addEventListener('observe', (e: any) => {
    const detail = e.detail
    if (detail) {
      w.__threeCaptured.objects.add(detail)
      w.__threeCaptured.notes.push('captured via __THREE_DEVTOOLS__: ' + (detail.type || typeof detail))
    }
  })
  w.__THREE_DEVTOOLS__ = hook

  // Strategy 2: patch render once THREE shows up on window (best-effort).
  const tryPatchRenderer = () => {
    const THREE = w.THREE
    if (!THREE?.WebGLRenderer?.prototype || THREE.WebGLRenderer.prototype.__patched) return
    const proto = THREE.WebGLRenderer.prototype
    const orig = proto.render
    proto.render = function (scene: any, camera: any) {
      if (scene) w.__threeCaptured.objects.add(scene)
      return orig.call(this, scene, camera)
    }
    proto.__patched = true
    w.__threeCaptured.notes.push('patched WebGLRenderer.render')
  }
  tryPatchRenderer()
  const iv = setInterval(tryPatchRenderer, 200)
  setTimeout(() => clearInterval(iv), 8000)
}

/** Runs in the PAGE context. Walks captured roots and serializes them. */
function serializeCaptured(): { scenes: any[]; notes: string[] } {
  const w = window as any
  const cap = w.__threeCaptured
  if (!cap) return { scenes: [], notes: ['no capture state — hook never installed'] }

  const isShaderMaterial = (m: any) =>
    m && (m.type === 'ShaderMaterial' || m.type === 'RawShaderMaterial' || m.isShaderMaterial)

  // Turn a three.js uniform `.value` into a JSON-safe, display-friendly shape.
  const serializeUniformValue = (v: any): { kind: string; value: any } => {
    if (v === null || v === undefined) return { kind: 'null', value: null }
    const t = typeof v
    if (t === 'number' || t === 'boolean' || t === 'string') return { kind: t, value: v }
    // Texture / render target
    if (v.isTexture) {
      const img = v.image
      const w2 = img?.width ?? img?.videoWidth
      const h = img?.height ?? img?.videoHeight
      return { kind: 'texture', value: { name: v.name || '', uuid: v.uuid, size: w2 && h ? `${w2}x${h}` : undefined } }
    }
    // Color
    if (v.isColor) return { kind: 'color', value: { r: v.r, g: v.g, b: v.b, hex: '#' + v.getHexString() } }
    // Vectors / Quaternion / Euler (have toArray)
    if (typeof v.toArray === 'function') {
      const label = v.isVector2 ? 'vec2' : v.isVector3 ? 'vec3' : v.isVector4 ? 'vec4'
        : v.isQuaternion ? 'quat' : v.isMatrix3 ? 'mat3' : v.isMatrix4 ? 'mat4' : 'array'
      return { kind: label, value: v.toArray() }
    }
    if (Array.isArray(v)) {
      return { kind: 'array', value: v.map((x) => (typeof x === 'object' && x?.toArray ? x.toArray() : x)) }
    }
    // Fallback: best-effort plain object
    try {
      return { kind: 'object', value: JSON.parse(JSON.stringify(v)) }
    } catch {
      return { kind: 'unknown', value: String(v) }
    }
  }

  const serializeUniforms = (uniforms: any) => {
    if (!uniforms) return []
    return Object.keys(uniforms).map((name) => ({
      name,
      ...serializeUniformValue(uniforms[name]?.value),
    }))
  }

  const serializeMaterial = (m: any) => ({
    name: m.name || '',
    type: m.type || 'ShaderMaterial',
    uuid: m.uuid || '',
    uniformNames: m.uniforms ? Object.keys(m.uniforms) : [],
    uniforms: serializeUniforms(m.uniforms),
    defines: m.defines || {},
    vertexShader: m.vertexShader || '',
    fragmentShader: m.fragmentShader || '',
  })

  const serializeNode = (obj: any): any => {
    const node: any = {
      id: obj.id,
      name: obj.name || '',
      type: obj.type || 'Object3D',
      children: [],
    }
    const mat = obj.material
    if (mat) {
      const mats = Array.isArray(mat) ? mat : [mat]
      const shaders = mats.filter(isShaderMaterial).map(serializeMaterial)
      if (shaders.length) node.shaderMaterials = shaders
    }
    if (Array.isArray(obj.children)) {
      node.children = obj.children.map(serializeNode)
    }
    return node
  }

  // Resolve scene roots: a captured object may be a renderer (has .domElement)
  // or a scene/object directly. We want Object3D roots to traverse.
  const roots: any[] = []
  for (const o of cap.objects) {
    if (!o) continue
    if (o.isScene || o.isObject3D) roots.push(o)
    else if (o.isWebGLRenderer && o.__lastScene) roots.push(o.__lastScene)
  }

  // De-dupe by id, prefer Scenes.
  const seen = new Set<number>()
  const scenes = roots
    .filter((r) => r && !seen.has(r.id) && seen.add(r.id))
    .map(serializeNode)

  return { scenes, notes: cap.notes.slice() }
}

/**
 * Runs in the PAGE context. Finds the material with `uuid` among captured roots
 * and returns its current uniforms. Self-contained (no shared closures).
 */
function pollUniformsInPage(uuid: string): any[] | null {
  const w = window as any
  const cap = w.__threeCaptured
  if (!cap) return null

  const serializeValue = (v: any): { kind: string; value: any } => {
    if (v === null || v === undefined) return { kind: 'null', value: null }
    const t = typeof v
    if (t === 'number' || t === 'boolean' || t === 'string') return { kind: t, value: v }
    if (v.isTexture) {
      const img = v.image
      const w2 = img?.width ?? img?.videoWidth
      const h = img?.height ?? img?.videoHeight
      return { kind: 'texture', value: { name: v.name || '', uuid: v.uuid, size: w2 && h ? `${w2}x${h}` : undefined } }
    }
    if (v.isColor) return { kind: 'color', value: { r: v.r, g: v.g, b: v.b, hex: '#' + v.getHexString() } }
    if (typeof v.toArray === 'function') {
      const label = v.isVector2 ? 'vec2' : v.isVector3 ? 'vec3' : v.isVector4 ? 'vec4'
        : v.isQuaternion ? 'quat' : v.isMatrix3 ? 'mat3' : v.isMatrix4 ? 'mat4' : 'array'
      return { kind: label, value: v.toArray() }
    }
    if (Array.isArray(v)) return { kind: 'array', value: v.map((x) => (x?.toArray ? x.toArray() : x)) }
    try {
      return { kind: 'object', value: JSON.parse(JSON.stringify(v)) }
    } catch {
      return { kind: 'unknown', value: String(v) }
    }
  }

  // Find the material by uuid by walking each captured root's tree.
  let found: any = null
  const visit = (obj: any) => {
    if (found || !obj) return
    const mat = obj.material
    if (mat) {
      const mats = Array.isArray(mat) ? mat : [mat]
      for (const m of mats) if (m && m.uuid === uuid) { found = m; return }
    }
    if (Array.isArray(obj.children)) obj.children.forEach(visit)
  }
  for (const o of cap.objects) {
    const root = o?.isWebGLRenderer ? o.__lastScene : o
    visit(root)
    if (found) break
  }

  if (!found || !found.uniforms) return null
  return Object.keys(found.uniforms).map((name) => ({
    name,
    ...serializeValue(found.uniforms[name]?.value),
  }))
}
