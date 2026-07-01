import * as THREE from 'three'

import backgroundVert from './shaders/background.vert'
import backgroundFrag from './shaders/background.frag'
import blobVert from './shaders/blob.vert'
import blobFrag from './shaders/blob.frag'
import knotVert from './shaders/knot.vert'
import knotFrag from './shaders/knot.frag'
import cubeVert from './shaders/cube.vert'
import cubeFrag from './shaders/cube.frag'

const canvas = document.getElementById('app') as HTMLCanvasElement

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100)
camera.position.set(0, 0, 6)

function resize(): void {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  bgMaterial.uniforms.uResolution.value.set(width, height)
}

// ---------------------------------------------------------------------------
// Background: fullscreen domain-warped FBM. Rendered first, depth-disabled so
// everything else draws on top.
// ---------------------------------------------------------------------------
const bgMaterial = new THREE.ShaderMaterial({
  name: 'BackgroundFBM',
  vertexShader: backgroundVert,
  fragmentShader: backgroundFrag,
  depthTest: false,
  depthWrite: false,
  uniforms: {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uColorA: { value: new THREE.Color(0x0a0a2a) },
    uColorB: { value: new THREE.Color(0x4a1a6a) },
    uWarp: { value: 4.0 },
  },
})
const bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMaterial)
bgMesh.name = 'Background'
bgMesh.frustumCulled = false
bgMesh.renderOrder = -1
scene.add(bgMesh)

// ---------------------------------------------------------------------------
// Blob: vertex-displaced icosahedron with iridescent fresnel shading.
// ---------------------------------------------------------------------------
const blobMaterial = new THREE.ShaderMaterial({
  name: 'IridescentBlob',
  vertexShader: blobVert,
  fragmentShader: blobFrag,
  uniforms: {
    uTime: { value: 0 },
    uDisplace: { value: 0.35 },
    uFreq: { value: 1.6 },
    uLightDir: { value: new THREE.Vector3(0.5, 0.8, 1.0).normalize() },
    uFresnelPower: { value: 3.0 },
    uIridescence: { value: 1.2 },
  },
})
const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 64), blobMaterial)
blob.name = 'Blob'
blob.position.set(-2.2, 0, 0)
scene.add(blob)

// ---------------------------------------------------------------------------
// Torus knot: animated plasma / energy shader.
// ---------------------------------------------------------------------------
const knotMaterial = new THREE.ShaderMaterial({
  name: 'PlasmaKnot',
  vertexShader: knotVert,
  fragmentShader: knotFrag,
  uniforms: {
    uTime: { value: 0 },
    uGlowColor: { value: new THREE.Color(0x00ffcc) },
    uBands: { value: 24.0 },
    uSpeed: { value: 2.0 },
  },
})
const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.9, 0.3, 220, 32), knotMaterial)
knot.name = 'Knot'
knot.position.set(2.2, 0, 0)
scene.add(knot)

// ---------------------------------------------------------------------------
// Cube: the original simple gradient shader (kept as a small reference object).
// ---------------------------------------------------------------------------
const cubeUniforms = { uTime: { value: 0 } }
const cubeMaterial = new THREE.ShaderMaterial({
  name: 'CubeShaderMat',
  vertexShader: cubeVert,
  fragmentShader: cubeFrag,
  uniforms: cubeUniforms,
})
const cube = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), cubeMaterial)
cube.name = 'MiniCube'
cube.position.set(0, -2.2, 0)
scene.add(cube)

resize()

const clock = new THREE.Clock()

function animate(): void {
  requestAnimationFrame(animate)
  const t = clock.getElapsedTime()

  bgMaterial.uniforms.uTime.value = t
  blobMaterial.uniforms.uTime.value = t
  knotMaterial.uniforms.uTime.value = t
  cubeUniforms.uTime.value = t

  blob.rotation.y = t * 0.3
  blob.rotation.x = t * 0.15
  knot.rotation.x = t * 0.4
  knot.rotation.z = t * 0.25
  cube.rotation.x = t * 0.8
  cube.rotation.y = t * 1.1

  renderer.render(scene, camera)
}
animate()

new ResizeObserver(resize).observe(canvas)
