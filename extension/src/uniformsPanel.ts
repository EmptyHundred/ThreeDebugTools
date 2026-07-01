import * as vscode from 'vscode'
import type { ShaderMaterialInfo, UniformInfo } from './types'

/**
 * A webview view docked under the scene tree. Shows the uniforms (name, type,
 * current value) of whichever ShaderMaterial was last selected in the tree.
 */
export class UniformsPanel implements vscode.WebviewViewProvider {
  static readonly viewId = 'threeUniforms'

  private view: vscode.WebviewView | undefined
  /** The material to display; survives the view being hidden/disposed/not-yet-ready. */
  private current: ShaderMaterialInfo | undefined

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = { enableScripts: true }
    view.webview.html = this.html()
    // The webview posts 'ready' once its listener is attached — only then is it
    // safe to send state (avoids a postMessage race on first load).
    view.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === 'ready') this.flush()
    })
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined
    })
  }

  /** Display a material's uniforms; reveals the view if hidden. */
  show(material: ShaderMaterialInfo): void {
    this.current = material
    if (this.view) {
      this.view.show?.(true)
      this.flush()
    } else {
      // No view yet — reveal it; resolveWebviewView + 'ready' will flush state.
      void vscode.commands.executeCommand(`${UniformsPanel.viewId}.focus`)
    }
  }

  clear(): void {
    this.current = undefined
    void this.view?.webview.postMessage({ type: 'clear' })
  }

  /** uuid of the currently displayed material, for live polling. */
  get currentUuid(): string | undefined {
    return this.current?.uuid
  }

  /** Push fresh uniform values (live update) without rebuilding the header. */
  updateValues(uniforms: UniformInfo[]): void {
    if (this.current) this.current = { ...this.current, uniforms }
    void this.view?.webview.postMessage({ type: 'values', uniforms })
  }

  /** Reflect live-capture state in the panel header. */
  setLive(live: boolean): void {
    void this.view?.webview.postMessage({ type: 'live', live })
  }

  /** Push the current material (or a clear) to the live webview. */
  private flush(): void {
    if (!this.view) return
    if (this.current) void this.view.webview.postMessage({ type: 'material', material: this.current })
    else void this.view.webview.postMessage({ type: 'clear' })
  }

  private html(): string {
    return /* html */ `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); padding: 6px 8px; }
  h3 { margin: 4px 0 8px; font-size: 1em; }
  .muted { color: var(--vscode-descriptionForeground); }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 6px; vertical-align: top; border-bottom: 1px solid var(--vscode-panel-border); }
  td.name { font-weight: 600; white-space: nowrap; }
  td.kind { color: var(--vscode-descriptionForeground); white-space: nowrap; }
  td.val { font-family: var(--vscode-editor-font-family); word-break: break-word; }
  .swatch { display: inline-block; width: 11px; height: 11px; border: 1px solid var(--vscode-panel-border); margin-right: 5px; vertical-align: middle; }
</style>
</head>
<body>
  <div id="root"><p class="muted">Select a ShaderMaterial in the tree to view its uniforms.</p></div>
<script>
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  let live = false;

  // CSS-safe id from a uniform name (names are GLSL identifiers, but be safe).
  function rowId(name) { return 'u_' + name.replace(/[^a-zA-Z0-9_]/g, '_'); }

  function fmtValue(u) {
    if (u.kind === 'color') {
      const hex = (u.value && u.value.hex) || '#000000';
      return '<span class="swatch" style="background:' + hex + '"></span>' + hex;
    }
    if (u.kind === 'texture') {
      const t = u.value || {};
      return 'texture' + (t.size ? ' (' + t.size + ')' : '') + (t.name ? ' "' + t.name + '"' : '');
    }
    if (u.kind === 'number') return String(+(+u.value).toFixed(5));
    if (u.kind === 'boolean') return u.value ? 'true' : 'false';
    if (Array.isArray(u.value)) return '[' + u.value.map(n => typeof n === 'number' ? +n.toFixed(4) : n).join(', ') + ']';
    if (u.value === null) return 'null';
    return typeof u.value === 'object' ? JSON.stringify(u.value) : String(u.value);
  }

  function liveBadge() {
    return live ? ' <span style="color:var(--vscode-charts-green)">● live</span>' : '';
  }

  let header = '';
  function render(material) {
    const us = material.uniforms || [];
    header = '<h3>' + (material.name || material.type) + '</h3>'
      + '<div class="muted" id="meta">' + material.type + ' &middot; ' + us.length
      + ' uniform' + (us.length === 1 ? '' : 's') + liveBadge() + '</div>';
    if (!us.length) { root.innerHTML = header + '<p class="muted">No uniforms.</p>'; return; }
    let html = header + '<table>';
    for (const u of us) {
      html += '<tr><td class="name">' + u.name + '</td><td class="kind">' + u.kind
        + '</td><td class="val" id="' + rowId(u.name) + '">' + fmtValue(u) + '</td></tr>';
    }
    html += '</table>';
    root.innerHTML = html;
  }

  // Update only the value cells in place — smooth for high-frequency polling.
  function updateValues(us) {
    for (const u of us) {
      const cell = document.getElementById(rowId(u.name));
      if (cell) cell.innerHTML = fmtValue(u);
    }
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'material') render(msg.material);
    else if (msg.type === 'values') updateValues(msg.uniforms || []);
    else if (msg.type === 'live') { live = !!msg.live; const meta = document.getElementById('meta'); if (meta) meta.innerHTML = meta.innerHTML.replace(/ <span[^>]*>● live<\\/span>/, '') + liveBadge(); }
    else if (msg.type === 'clear') root.innerHTML = '<p class="muted">Select a ShaderMaterial in the tree to view its uniforms.</p>';
  });

  // Tell the extension the listener is attached and it's safe to send state.
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`
  }
}

/** Used by extension.ts to type the value-rendering contract. */
export type { UniformInfo }
