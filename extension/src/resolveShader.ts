import * as vscode from 'vscode'

/** File extensions we treat as GLSL sources when matching. */
const SHADER_GLOB = '**/*.{glsl,vert,frag,vs,fs,vertex,fragment}'

/** Normalize a shader for comparison: unify line endings, trim trailing
 *  whitespace per line, drop leading/trailing blank lines. */
function normalize(src: string): string {
  return src
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .trim()
}

/** Lines that carry real signal — skip blanks and pure punctuation so that
 *  `}` / `{` don't inflate similarity between unrelated shaders. */
function meaningfulLines(src: string): string[] {
  return normalize(src)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && !/^[{}();,]*$/.test(l))
}

interface Candidate {
  uri: vscode.Uri
  exact: boolean
  ratio: number
  matched: number
}

/**
 * Find the workspace shader file that best matches a captured runtime shader.
 * Strategy:
 *  - exact normalized equality wins outright;
 *  - otherwise score by how many of the FILE's meaningful lines appear in the
 *    captured source (this direction tolerates `#include`s being inlined at
 *    runtime — the parent file's own lines still appear in the captured text).
 */
export async function resolveShaderFile(
  capturedSource: string,
  minRatio = 0.5
): Promise<vscode.Uri | undefined> {
  const captured = normalize(capturedSource)
  if (!captured) return undefined

  const capturedSet = new Set(
    captured.split('\n').map((l) => l.trim())
  )

  const files = await vscode.workspace.findFiles(SHADER_GLOB, '**/node_modules/**')
  const candidates: Candidate[] = []

  for (const uri of files) {
    let text: string
    try {
      text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')
    } catch {
      continue
    }
    if (normalize(text) === captured) {
      return uri // exact match — done
    }
    const fileLines = meaningfulLines(text)
    if (!fileLines.length) continue
    const matched = fileLines.filter((l) => capturedSet.has(l)).length
    const ratio = matched / fileLines.length
    candidates.push({ uri, exact: false, ratio, matched })
  }

  // Best partial match: require a minimum ratio and at least a few real lines,
  // then prefer the file that matched the most lines.
  const best = candidates
    .filter((c) => c.ratio >= minRatio && c.matched >= 3)
    .sort((a, b) => b.matched - a.matched || b.ratio - a.ratio)[0]

  return best?.uri
}
