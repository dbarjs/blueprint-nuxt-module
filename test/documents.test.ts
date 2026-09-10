import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadDocuments, reportDocument } from '../src/build/documents'
import { BASE_COMPONENT_NAMES } from '../src/runtime/engine/registry'

const contentDir = fileURLToPath(new URL('../content', import.meta.url))

/**
 * Every document under content/ must validate and pass its own tests.
 * Component names are checked against the base vocabulary only here (the
 * Nuxt UI layer is discovered at build time); documents using `U*`
 * components directly are reported but not failed.
 */
describe('content documents', async () => {
  const documents = await loadDocuments(contentDir)

  it('finds at least one document', () => {
    expect(documents.length).toBeGreaterThan(0)
  })

  for (const loaded of documents) {
    describe(loaded.stem, async () => {
      // Tree tests draw with the base vocabulary only; `U*` nodes fall back or are marked unavailable.
      const report = await reportDocument(loaded, { base: BASE_COMPONENT_NAMES, nuxtUi: [], app: [] }, true)

      it('parses', () => {
        expect(loaded.parseError).toBeUndefined()
      })

      it('validates', () => {
        const errors = report.validation.issues.filter(issue => issue.level === 'error' && issue.code !== 'UNKNOWN_COMPONENT')
        expect(errors, errors.map(issue => `${issue.code}: ${issue.message}`).join('\n')).toEqual([])
      })

      it('uses only registered vocabulary (base layer)', () => {
        const unknown = report.validation.portability.unknown.filter(name => !name.startsWith('U'))
        expect(unknown).toEqual([])
      })

      it('runs every test it carries', () => {
        expect(report.tests.length).toBe((loaded.document.content.tests || []).length)
      })

      for (const outcome of report.tests) {
        it(`${outcome.form} test: ${outcome.name}`, () => {
          const detail = outcome.error || outcome.failures.map(failure => `${failure.definition}: expected ${JSON.stringify(failure.expected)}, got ${JSON.stringify(failure.actual)}`).join('\n')
          expect(outcome.passed, detail).toBe(true)
        })
      }
    })
  }
})
