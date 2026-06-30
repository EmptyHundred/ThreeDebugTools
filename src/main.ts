import * as THREE from 'three'
import vertexShader from './shaders/cube.vert'
import fragmentShader from './shaders/cube.frag'

const canvas = document.getElementById('app') as HTMLCanvasElement

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  100
)
camera.position.z = 2.5

// A ShaderMaterial cube — the subject for GLSL debugging experiments.
const uniforms = {
  uTime: { value: 0 },
}

const material = new THREE.ShaderMaterial({
  uniforms,
  vertexShader,
  fragmentShader,
})

material.name = "CubeShaderMat"

const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
mesh.name = "MeshCube"
scene.add(mesh)

const clock = new THREE.Clock()

function animate(): void {
  requestAnimationFrame(animate)
  uniforms.uTime.value = clock.getElapsedTime()
  mesh.rotation.x += 0.005
  mesh.rotation.y += 0.01
  renderer.render(scene, camera)
}
animate()

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})
