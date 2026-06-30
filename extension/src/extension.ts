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

  /** Empty the tree and forget the last-scanned URL. */
  const clearTree = () => {
    provider.setResult(undefined)
    lastUrl = undefined
  }

  /** Close any open headed session and reset state (also clears the tree). */
  const closeSession = async () => {
    if (!session) return
    const s = session
    session = undefined
    setSessionActive(false)
    clearTree()
    try {
      await s.browser.close()
    } catch {
      /* already gone */
    }
  }

  // If the user closes the browser window manually, drop our handle and tree.
  const trackDisconnect = (s: ScanSession) => {
    s.browser.on('disconnected', () => {
      if (session === s) {
        session = undefined
        setSessionActive(false)
        clearTree()
      }
    })
  }

  /** Open a headed session against `url`, waiting for the server to be reachable. */
  const doHeadedScan = async (url: string) => {
    await withProgress(`Opening ${url}`, async () => {
      try {
        await closeSession() // only one live window at a time
        await waitForUrl(url, 15_000)
        const { result, session: s } = await openScanSession(url, { settleMs: settleMs() })
        session = s
        trackDisconnect(s)
        setSessionActive(true)
        report(result)
      } catch (err: any) {
        clearTree()
        vscode.window.showErrorMessage(`Three Inspector scan failed: ${err?.message ?? err}`)
      }
    })
  }

  // Drive the inspector from the debug lifecycle: when a launch config carries a
  // `threeInspector` block, scan on start and close the browser on Stop — so the
  // VS Code Stop button tears down the inspector window too.
  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession((s) => {
      const cfg = (s.configuration as any).threeInspector
      if (cfg?.url && cfg.scan === 'headed') void doHeadedScan(cfg.url)
    }),
    vscode.debug.onDidTerminateDebugSession((s) => {
      const cfg = (s.configuration as any).threeInspector
      if (cfg?.url) void closeSession()
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('threeInspector.scanUrl', async (arg?: ScanArg) => {
      const url = argUrl(arg) ?? (await promptUrl('URL of the three.js page to scan'))
      if (!url) return
      const headless =
        argHeadless(arg) ??
        vscode.workspace.getConfiguration('threeInspector').get<boolean>('headless', true)
      await withProgress(`Scanning ${url}`, async () => {
        try {
          // A one-shot scan closes any kept-open headed session it might shadow.
          await closeSession()
          report(await scanUrl(url, { headless, settleMs: settleMs() }))
        } catch (err: any) {
          clearTree()
          vscode.window.showErrorMessage(`Three Inspector scan failed: ${err?.message ?? err}`)
        }
      })
    }),

    vscode.commands.registerCommand('threeInspector.scanUrlHeaded', async (arg?: ScanArg) => {
      const url =
        argUrl(arg) ?? (await promptUrl('URL of the three.js page to scan (visible browser, stays open)'))
      if (!url) return
      await doHeadedScan(url)
    }),

    vscode.commands.registerCommand('threeInspector.rescan', async () => {
      // Prefer re-reading an open headed window; otherwise re-run a one-shot scan.
      if (session) {
        await withProgress('Rescanning live page', async () => {
          try {
            report(await rescanSession(session!, { settleMs: settleMs() }))
          } catch (err: any) {
            // The live page likely went away (navigated/closed) — tear down.
            await closeSession()
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
          clearTree()
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

/**
 * Argument accepted by the scan commands when invoked programmatically (e.g.
 * from a task's command-input). Either a bare URL string, or an object with a
 * URL and optional headless override. When absent, the command prompts.
 */
type ScanArg = string | { url?: string; headless?: boolean } | undefined

function argUrl(arg: ScanArg): string | undefined {
  if (typeof arg === 'string') return arg || undefined
  return arg?.url || undefined
}

function argHeadless(arg: ScanArg): boolean | undefined {
  return typeof arg === 'object' && arg ? arg.headless : undefined
}

/** Poll `url` until it responds or the timeout elapses (server may still be booting). */
async function waitForUrl(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    try {
      await fetch(url, { method: 'GET' })
      return // any HTTP response means the server is up
    } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  throw new Error(`Timed out waiting for ${url} (${String(lastErr)})`)
}

function promptUrl(prompt: string): Thenable<string | undefined> {
  return vscode.window.showInputBox({
    prompt,
    value: lastUrl ?? 'http://localhost:4563',
    validateInput: (v) =>
      /^https?:\/\//.test(v) ? undefined : 'Must start with http:// or https://',
  })
}

export function deactivate(): void {
  // Ensure no headed browser is left running when the extension unloads.
  void session?.browser.close().catch(() => undefined)
  session = undefined
}
