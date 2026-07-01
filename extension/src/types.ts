/** A serialized scene-graph node, safe to pass across the CDP boundary as JSON. */
export interface SceneNode {
  id: number
  name: string
  type: string
  children: SceneNode[]
  /** Present only when this node carries one or more ShaderMaterials. */
  shaderMaterials?: ShaderMaterialInfo[]
}

export interface UniformInfo {
  name: string
  /** Discriminator: 'number' | 'boolean' | 'vec3' | 'color' | 'texture' | ... */
  kind: string
  /** JSON-safe representation of the uniform's current value. */
  value: unknown
}

export interface ShaderMaterialInfo {
  name: string
  type: string // 'ShaderMaterial' | 'RawShaderMaterial'
  uuid: string
  uniformNames: string[]
  uniforms: UniformInfo[]
  defines: Record<string, unknown>
  vertexShader: string
  fragmentShader: string
}

export interface ScanResult {
  url: string
  /** One entry per captured root (usually a single Scene). */
  scenes: SceneNode[]
  /** Diagnostics surfaced from inside the page. */
  notes: string[]
}
