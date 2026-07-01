import * as vscode from 'vscode'
import type { ScanResult, SceneNode, ShaderMaterialInfo } from './types'

/**
 * Tree items come in three flavours:
 *  - 'node'     : an Object3D in the scene graph
 *  - 'material' : a ShaderMaterial attached to a node
 *  - 'info'     : a leaf detail (uniform name, shader source entry, note)
 */
type Entry =
  | { kind: 'node'; node: SceneNode }
  | { kind: 'material'; material: ShaderMaterialInfo }
  | { kind: 'info'; label: string; description?: string; material?: ShaderMaterialInfo; shader?: 'vertex' | 'fragment' }

export class SceneTreeProvider implements vscode.TreeDataProvider<Entry> {
  private _onDidChange = new vscode.EventEmitter<Entry | undefined | void>()
  readonly onDidChangeTreeData = this._onDidChange.event

  private result: ScanResult | undefined

  constructor(private readonly shaderIcon: vscode.Uri) {}

  setResult(result: ScanResult | undefined): void {
    this.result = result
    this._onDidChange.fire()
  }

  getResult(): ScanResult | undefined {
    return this.result
  }

  getTreeItem(entry: Entry): vscode.TreeItem {
    if (entry.kind === 'node') {
      const n = entry.node
      const hasShader = !!n.shaderMaterials?.length
      const item = new vscode.TreeItem(
        n.name || n.type,
        n.children.length || hasShader
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None
      )
      item.description = n.name ? n.type : `#${n.id}`
      item.iconPath = hasShader ? this.shaderIcon : new vscode.ThemeIcon('symbol-namespace')
      item.contextValue = 'node'
      return item
    }
    if (entry.kind === 'material') {
      const m = entry.material
      const item = new vscode.TreeItem(
        m.name || m.type,
        vscode.TreeItemCollapsibleState.Collapsed
      )
      item.description = m.type
      item.iconPath = new vscode.ThemeIcon('paintcan')
      item.contextValue = 'material'
      // Clicking the material row opens its uniforms in the side panel.
      item.command = {
        command: 'threeInspector.showUniforms',
        title: 'Show Uniforms',
        arguments: [m],
      }
      return item
    }
    // info leaf
    const item = new vscode.TreeItem(entry.label, vscode.TreeItemCollapsibleState.None)
    item.description = entry.description
    if (entry.shader && entry.material) {
      item.iconPath = new vscode.ThemeIcon('file-code')
      item.command = {
        command: 'threeInspector.openShader',
        title: 'Open Shader',
        arguments: [entry.material, entry.shader],
      }
    }
    return item
  }

  getChildren(entry?: Entry): Entry[] {
    if (!entry) {
      if (!this.result) return []
      if (!this.result.scenes.length) {
        return [{ kind: 'info', label: 'No scene captured', description: 'see notes / try increasing settleMs' }]
      }
      return this.result.scenes.map((node) => ({ kind: 'node', node }))
    }

    if (entry.kind === 'node') {
      const children: Entry[] = []
      for (const m of entry.node.shaderMaterials ?? []) {
        children.push({ kind: 'material', material: m })
      }
      for (const child of entry.node.children) {
        children.push({ kind: 'node', node: child })
      }
      return children
    }

    if (entry.kind === 'material') {
      const m = entry.material
      const out: Entry[] = []
      out.push({ kind: 'info', label: 'vertexShader', description: `${m.vertexShader.split('\n').length} lines`, material: m, shader: 'vertex' })
      out.push({ kind: 'info', label: 'fragmentShader', description: `${m.fragmentShader.split('\n').length} lines`, material: m, shader: 'fragment' })
      for (const u of m.uniformNames) {
        out.push({ kind: 'info', label: u, description: 'uniform' })
      }
      return out
    }

    return []
  }
}
