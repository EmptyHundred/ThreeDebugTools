import { chromium, Browser, Page } from 'playwright'
import type { ScanResult } from './types'

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
  opts: { settleMs: number }
): Promise<{ result: ScanResult; session: ScanSession }> {
  const browser = await chromium.launch({ headless: false })
  try {
    const page = await browser.newPage()
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

  const serializeMaterial = (m: any) => ({
    name: m.name || '',
    type: m.type || 'ShaderMaterial',
    uuid: m.uuid || '',
    uniformNames: m.uniforms ? Object.keys(m.uniforms) : [],
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
