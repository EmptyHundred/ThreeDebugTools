import * as vscode from 'vscode'
import { scanUrl, openScanSession, rescanSession, type ScanSession } from './scanner'
import { SceneTreeProvider } from './treeProvider'
import { resolveShaderFile } from './resolveShader'
import type { ScanResult, ShaderMaterialInfo } from './types'

let lastUrl: string | undefined
/** The live headed browser, kept open until the user closes it on demand. */
let session: ScanSession | undefined

/** Toggle the context key that controls visibility of the Close button. */
function setSessionActive(active: boolean): void {
  vscode.commands.executeCommand('setContext', 'threeInspector.sessionOpen', active)
}

export function activate(context: vscode.ExtensionContext): void {
  const shaderIcon = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg')
  const provider = new SceneTreeProvider(shaderIcon)
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('threeSceneTree', provider)
  )
  setSessionActive(false)

  const settleMs = () =>
    vscode.workspace.getConfiguration('threeInspector').get<number>('settleMs', 1500)

  const report = (result: ScanResult) => {
    provider.setResult(result)
    lastUrl = result.url
    const count = result.scenes.length
    vscode.window.showInformationMessage(
      count
        ? `Three Inspector: captured ${count} scene(s).`
        : `Three Inspector: no scene captured. ${result.notes.join('; ')}`
    )
  }

  const withProgress = <T>(title: string, task: () => Promise<T>) =>
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: false },
      task
    )

  /** Close any open headed session and reset state. */
  const closeSession = async () => {
    if (!session) return
    const s = session
    session = undefined
    setSessionActive(false)
    try {
      await s.browser.close()
    } catch {
      /* already gone */
    }
  }

  // If the user closes the browser window manually, drop our handle.
  const trackDisconnect = (s: ScanSession) => {
    s.browser.on('disconnected', () => {
      if (session === s) {
        session = undefined
        setSessionActive(false)
      }
    })
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('threeInspector.scanUrl', async () => {
      const url = await promptUrl('URL of the three.js page to scan')
      if (!url) return
      const headless = vscode.workspace.getConfiguration('threeInspector').get<boolean>('headless', true)
      await withProgress(`Scanning ${url}`, async () => {
        try {
          // A one-shot scan closes any kept-open headed session it might shadow.
          await closeSession()
          report(await scanUrl(url, { headless, settleMs: settleMs() }))
        } catch (err: any) {
          vscode.window.showErrorMessage(`Three Inspector scan failed: ${err?.message ?? err}`)
        }
      })
    }),

    vscode.commands.registerCommand('threeInspector.scanUrlHeaded', async () => {
      const url = await promptUrl('URL of the three.js page to scan (visible browser, stays open)')
      if (!url) return
      await withProgress(`Opening ${url}`, async () => {
        try {
          await closeSession() // only one live window at a time
          const { result, session: s } = await openScanSession(url, { settleMs: settleMs() })
          session = s
          trackDisconnect(s)
          setSessionActive(true)
          report(result)
        } catch (err: any) {
          vscode.window.showErrorMessage(`Three Inspector scan failed: ${err?.message ?? err}`)
        }
      })
    }),

    vscode.commands.registerCommand('threeInspector.rescan', async () => {
      // Prefer re-reading an open headed window; otherwise re-run a one-shot scan.
      if (session) {
        await withProgress('Rescanning live page', async () => {
          try {
            report(await rescanSession(session!, { settleMs: settleMs() }))
          } catch (err: any) {
            vscode.window.showErrorMessage(`Rescan failed: ${err?.message ?? err}`)
          }
        })
        return
      }
      if (!lastUrl) {
        vscode.window.showWarningMessage('Nothing scanned yet. Use "Scan URL" first.')
        return
      }
      const headless = vscode.workspace.getConfiguration('threeInspector').get<boolean>('headless', true)
      await withProgress(`Scanning ${lastUrl}`, async () => {
        try {
          report(await scanUrl(lastUrl!, { headless, settleMs: settleMs() }))
        } catch (err: any) {
          vscode.window.showErrorMessage(`Three Inspector scan failed: ${err?.message ?? err}`)
        }
      })
    }),

    vscode.commands.registerCommand('threeInspector.closeBrowser', async () => {
      if (!session) {
        vscode.window.showInformationMessage('No browser window is open.')
        return
      }
      await closeSession()
      vscode.window.showInformationMessage('Three Inspector: browser closed.')
    }),

    vscode.commands.registerCommand(
      'threeInspector.openShader',
      async (material: ShaderMaterialInfo, which: 'vertex' | 'fragment') => {
        const source = which === 'vertex' ? material.vertexShader : material.fragmentShader

        // Try to open the real project file whose contents match the captured
        // runtime shader; fall back to a read-only scratch doc when none matches.
        const fileUri = await resolveShaderFile(source)
        if (fileUri) {
          const doc = await vscode.workspace.openTextDocument(fileUri)
          await vscode.window.showTextDocument(doc, { preview: true })
          return
        }

        vscode.window.showWarningMessage(
          `No matching ${which} shader file found in the workspace — showing captured source.`
        )
        const doc = await vscode.workspace.openTextDocument({
          content: source || `// (empty ${which} shader)`,
          language: 'glsl',
        })
        await vscode.window.showTextDocument(doc, { preview: true })
      }
    )
  )
}

function promptUrl(prompt: string): Thenable<string | undefined> {
  return vscode.window.showInputBox({
    prompt,
    value: lastUrl ?? 'http://localhost:5173',
    validateInput: (v) =>
      /^https?:\/\//.test(v) ? undefined : 'Must start with http:// or https://',
  })
}

export function deactivate(): void {
  // Ensure no headed browser is left running when the extension unloads.
  void session?.browser.close().catch(() => undefined)
  session = undefined
}
