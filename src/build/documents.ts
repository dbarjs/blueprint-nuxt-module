/**
 * Build-time document loading and validation.
 */
import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { BlueprintDocument } from '../runtime/engine/types'
import { validateDocument, type ValidationReport } from '../runtime/engine/validate'
import { runDocumentTests, type TestOutcome } from '../runtime/engine/tests'
import { routeOf, isPageTemplate } from '../runtime/engine/template'

export interface LoadedDocument {
  file: string
  stem: string
  document: BlueprintDocument
  parseError?: string
}

/** Strip `//` and `/* *\/` comments so `.json` files may carry annotations. */
export function stripJsonComments(source: string): string {
  let out = ''
  let inString = false
  let index = 0
  while (index < source.length) {
    const char = source[index]!
    const next = source[index + 1]
    if (inString) {
      out += char
      if (char === '\\') {
        out += next ?? ''
        index += 2
        continue
      }
      if (char === '"') inString = false
      index++
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      index++
      continue
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index++
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index++
      index += 2
      continue
    }
    out += char
    index++
  }
  return out
}

export async function loadDocuments(dir: string): Promise<LoadedDocument[]> {
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true })
  const out: LoadedDocument[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile()) continue
    const extension = extname(entry.name)
    if (extension !== '.json' && extension !== '.jsonc') continue
    const file = join(dir, entry.name)
    const stem = basename(entry.name, extension)
    try {
      const raw = await readFile(file, 'utf8')
      const document = JSON.parse(stripJsonComments(raw)) as BlueprintDocument
      if (!document.name) document.name = stem
      out.push({ file, stem, document })
    }
    catch (caught) {
      out.push({ file, stem, document: { name: stem, content: { meta: { title: stem }, resources: {}, schemas: {}, templates: {} } }, parseError: (caught as Error).message })
    }
  }
  return out
}

export interface DocumentReport {
  loaded: LoadedDocument
  validation: ValidationReport
  tests: TestOutcome[]
  ok: boolean
}

export function reportDocument(loaded: LoadedDocument, registry: { base: string[], nuxtUi: string[], app: string[] }, runTests: boolean): DocumentReport {
  if (loaded.parseError) {
    return {
      loaded,
      validation: { name: loaded.stem, issues: [{ level: 'error', code: 'PARSE_ERROR', message: loaded.parseError }], portability: { base: [], nuxtUi: [], app: [], unknown: [], escapes: [] }, pages: [], refs: {} },
      tests: [],
      ok: false,
    }
  }
  const validation = validateDocument(loaded.document, { registry })
  const hasErrors = validation.issues.some(issue => issue.level === 'error')
  const tests = runTests && !hasErrors ? runDocumentTests(loaded.document) : []
  return { loaded, validation, tests, ok: !hasErrors && tests.every(test => test.passed) }
}

export function formatReport(report: DocumentReport): string[] {
  const lines: string[] = []
  const { validation, tests, loaded } = report
  const errors = validation.issues.filter(issue => issue.level === 'error')
  const warnings = validation.issues.filter(issue => issue.level === 'warning')
  const status = report.ok ? 'ok' : 'FAILED'
  lines.push(`${loaded.document.name} (${basename(loaded.file)}): ${status} — ${validation.pages.length} pages, ${errors.length} errors, ${warnings.length} warnings, ${tests.filter(test => test.passed).length}/${tests.length} tests`)
  for (const issue of errors) lines.push(`  ✖ ${issue.code}${issue.where ? ` @ ${issue.where}` : ''}: ${issue.message}`)
  for (const issue of warnings) lines.push(`  ⚠ ${issue.code}${issue.where ? ` @ ${issue.where}` : ''}: ${issue.message}`)
  for (const test of tests.filter(test => !test.passed)) {
    lines.push(`  ✖ test "${test.name}" failed${test.error ? `: ${test.error}` : ''}`)
    for (const failure of test.failures) lines.push(`      ${failure.definition}: expected ${JSON.stringify(failure.expected)}, got ${JSON.stringify(failure.actual)}`)
  }
  const { portability } = validation
  const layers: string[] = []
  if (portability.base.length) layers.push(`base(${portability.base.length})`)
  if (portability.nuxtUi.length) layers.push(`nuxt-ui(${portability.nuxtUi.length})`)
  if (portability.app.length) layers.push(`app(${portability.app.length})`)
  const portable = portability.nuxtUi.length === 0 && portability.app.length === 0 && portability.escapes.length === 0
  lines.push(`  vocabulary: ${layers.join(', ') || 'none'} → ${portable ? 'portable' : 'not portable (uses solution vocabulary)'}`)
  return lines
}

/** Static routes to prerender: `/<app>` plus every page without params. */
export function prerenderRoutes(documents: LoadedDocument[], prefix = ''): string[] {
  const routes: string[] = []
  for (const { document } of documents) {
    for (const [name, template] of Object.entries(document.content.templates || {})) {
      if (!name.startsWith('page:') || !isPageTemplate(template)) continue
      const route = routeOf(name, template)
      if (route.includes(':') || route.includes('*')) continue
      routes.push(`${prefix}/${document.name}${route === '/' ? '' : route}`)
    }
  }
  return routes
}
