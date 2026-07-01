import * as vscode from 'vscode'
import * as ts from 'typescript'

export interface UniformLocation {
  uri: vscode.Uri
  /** 0-based line/character of the uniform key in the uniforms object literal. */
  line: number
  character: number
  /** Length of the key identifier, for selection. */
  length: number
}

/**
 * Statically locate the declaration of `uniformName` on the ShaderMaterial named
 * `materialName` by parsing workspace JS/TS with the TypeScript compiler API.
 *
 * Strategy per file:
 *   1. Find `new (THREE.)?(Raw)?ShaderMaterial({ ... })` calls.
 *   2. From the options object literal, read `name:` (string literal) and the
 *      `uniforms:` value — either an inline object literal, or an identifier
 *      referencing a `const x = { ... }` in the same file.
 *   3. When `name` matches and the uniforms object has a `uniformName` key,
 *      return that key's exact position.
 *
 * Returns undefined if nothing matches (caller falls back to text search).
 */
export async function resolveUniformDeclaration(
  materialName: string,
  uniformName: string
): Promise<UniformLocation | undefined> {
  const files = await vscode.workspace.findFiles(
    '**/*.{ts,tsx,js,jsx,mjs,cjs}',
    '**/node_modules/**'
  )

  for (const uri of files) {
    let text: string
    try {
      text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')
    } catch {
      continue
    }
    if (!text.includes('ShaderMaterial')) continue

    const sf = ts.createSourceFile(uri.fsPath, text, ts.ScriptTarget.Latest, true)
    const hit = findInSourceFile(sf, materialName, uniformName)
    if (hit) {
      const pos = sf.getLineAndCharacterOfPosition(hit.start)
      return { uri, line: pos.line, character: pos.character, length: hit.length }
    }
  }
  return undefined
}

interface KeyHit {
  start: number
  length: number
}

function findInSourceFile(
  sf: ts.SourceFile,
  materialName: string,
  uniformName: string
): KeyHit | undefined {
  let result: KeyHit | undefined

  const visit = (node: ts.Node): void => {
    if (result) return
    if (
      ts.isNewExpression(node) &&
      isShaderMaterialCtor(node.expression) &&
      node.arguments &&
      node.arguments.length > 0 &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const options = node.arguments[0]
      const name = readStringProp(options, 'name')
      if (name === materialName) {
        const uniformsObj = resolveUniformsObject(sf, options)
        if (uniformsObj) {
          const keyHit = findKey(uniformsObj, uniformName)
          if (keyHit) {
            result = keyHit
            return
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return result
}

/** Match `ShaderMaterial`, `THREE.ShaderMaterial`, and the Raw* variants. */
function isShaderMaterialCtor(expr: ts.Expression): boolean {
  const name = ts.isPropertyAccessExpression(expr)
    ? expr.name.text
    : ts.isIdentifier(expr)
      ? expr.text
      : ''
  return name === 'ShaderMaterial' || name === 'RawShaderMaterial'
}

function readStringProp(obj: ts.ObjectLiteralExpression, key: string): string | undefined {
  for (const prop of obj.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      propName(prop.name) === key &&
      ts.isStringLiteralLike(prop.initializer)
    ) {
      return prop.initializer.text
    }
  }
  return undefined
}

/**
 * Get the object literal for the `uniforms:` property. Handles both inline
 * literals and an identifier that references a variable in the same file.
 */
function resolveUniformsObject(
  sf: ts.SourceFile,
  options: ts.ObjectLiteralExpression
): ts.ObjectLiteralExpression | undefined {
  for (const prop of options.properties) {
    // uniforms: { ... }
    if (ts.isPropertyAssignment(prop) && propName(prop.name) === 'uniforms') {
      if (ts.isObjectLiteralExpression(prop.initializer)) return prop.initializer
      if (ts.isIdentifier(prop.initializer)) {
        return findVariableObjectLiteral(sf, prop.initializer.text)
      }
    }
    // shorthand: uniforms  (=> `uniforms` variable in scope)
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === 'uniforms') {
      return findVariableObjectLiteral(sf, 'uniforms')
    }
  }
  return undefined
}

/** Find `const <name> = { ... }` object literal anywhere in the file. */
function findVariableObjectLiteral(
  sf: ts.SourceFile,
  varName: string
): ts.ObjectLiteralExpression | undefined {
  let found: ts.ObjectLiteralExpression | undefined
  const visit = (node: ts.Node): void => {
    if (found) return
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === varName &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      found = node.initializer
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/** Locate a key (`uniformName:`) inside a uniforms object literal. */
function findKey(obj: ts.ObjectLiteralExpression, uniformName: string): KeyHit | undefined {
  for (const prop of obj.properties) {
    if (
      (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) &&
      propName(prop.name) === uniformName
    ) {
      const nameNode = prop.name
      return { start: nameNode.getStart(), length: nameNode.getWidth() }
    }
  }
  return undefined
}

function propName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text
  return undefined
}
