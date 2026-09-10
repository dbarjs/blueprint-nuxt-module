/**
 * Projection (ADR 0015): selection + closure + audience, in that order.
 *
 * Given a document, a selection of section entries and an audience, keep
 * the entries the audience may receive, close the selection over `refs()`,
 * and fail if the closure needs an entry the audience filter removed. Never
 * pull a private entry "to help", never drop one silently. A projection is
 * a document: same envelope, a `projection` block, evaluated by the engine
 * as any other.
 */
import type { Audience, BlueprintDocument, BlueprintEndpoint } from './types'
import { refsOfDocument, type RefSet } from './refs'
import { BlueprintError } from './errors'
import { hashDocument } from './hash'

const SECTIONS = ['resources', 'schemas', 'definitions', 'actions', 'templates', 'collections', 'endpoints'] as const
type Section = typeof SECTIONS[number]

/**
 * The audience of a section entry. `visibility: "private"` is *not* an
 * alias: the health quote and the restaurant mark helper definitions
 * private while their pages read them, so it only ever meant "not a public
 * output". Audience is explicit or `public`.
 */
export function audienceOf(entry: unknown, section?: Section): Audience {
  if (section === 'endpoints' || section === 'collections') return 'server'
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'public'
  const record = entry as { audience?: Audience }
  return record.audience || 'public'
}

/** May an entry with `audience` travel to `surface`? */
export function admits(audience: Audience, surface: Audience): boolean {
  return audience === 'public' || surface === 'public' || audience === surface
}

export interface ProjectionInput {
  /** Entry keys: `page:index`, `channel:kitchen-ticket`, `definitions.pricing`, `resources.plans`... */
  select: string[]
  audience: Audience
  profile?: string
}

export interface ProjectionResult {
  document: BlueprintDocument
  /** Entries kept, as `section.name`. */
  kept: string[]
  /** Sections the projection cut (their hash in the manifest is `partial`). */
  partial: string[]
}

function entryKey(selector: string): string {
  return selector.includes('.') ? selector : `templates.${selector}`
}

function edges(set: RefSet): string[] {
  const out: string[] = []
  for (const name of set.definitions) out.push(`definitions.${name}`)
  for (const name of set.resources) out.push(`resources.${name}`)
  for (const name of set.schemas) out.push(`schemas.${name}`)
  for (const name of set.templates) out.push(`templates.${name}`)
  for (const name of set.actions) out.push(`actions.${name}`)
  for (const name of set.collections) out.push(`collections.${name}`)
  for (const name of set.endpoints) out.push(`endpoints.${name}`)
  return out
}

/**
 * Closure of a selection for an audience: follow references, but do not
 * descend into an endpoint's handler from a client-side root — the browser
 * needs the endpoint's signature, never its body.
 */
export function closureFor(document: BlueprintDocument, roots: string[], audience: Audience, refs: Record<string, RefSet> = refsOfDocument(document)): { kept: Set<string>, dangling: Array<{ entry: string, audience: Audience, neededBy: string }> } {
  const kept = new Set<string>()
  const dangling: Array<{ entry: string, audience: Audience, neededBy: string }> = []
  const queue = roots.map(root => ({ key: entryKey(root), by: 'selection' }))
  while (queue.length) {
    const { key, by } = queue.shift()!
    if (kept.has(key)) continue
    const [section, ...rest] = key.split('.') as [Section, ...string[]]
    const name = rest.join('.')
    const entry = (document.content[section] as Record<string, unknown> | undefined)?.[name]
    if (entry === undefined) continue
    const entryAudience = audienceOf(entry, section)
    if (!admits(entryAudience, audience)) {
      // Endpoint and collection *names* are public: a page may call them.
      if (section === 'endpoints' || section === 'collections') {
        kept.add(key)
        continue
      }
      dangling.push({ entry: key, audience: entryAudience, neededBy: by })
      continue
    }
    kept.add(key)
    const set = refs[key]
    if (set) for (const next of edges(set)) if (!kept.has(next)) queue.push({ key: next, by: key })
  }
  return { kept, dangling }
}

/** Pure: same version, same selection, same audience → the same bytes. */
export function projectDocument(document: BlueprintDocument, input: ProjectionInput): ProjectionResult {
  const refs = refsOfDocument(document)
  const { kept, dangling } = closureFor(document, input.select, input.audience, refs)
  if (dangling.length) {
    throw new BlueprintError('PROJECTION_DANGLING', `projection for "${input.audience}" needs ${dangling.map(entry => `${entry.entry} (${entry.audience}, via ${entry.neededBy})`).join(', ')}`, { dangling })
  }
  const content: Record<string, unknown> = { meta: document.content.meta }
  const partial: string[] = []
  for (const section of SECTIONS) {
    const source = document.content[section] as Record<string, unknown> | undefined
    if (!source) continue
    const picked: Record<string, unknown> = {}
    for (const [name, entry] of Object.entries(source)) {
      const key = `${section}.${name}`
      if (!kept.has(key)) continue
      if (section === 'endpoints' && !admits('server', input.audience)) picked[name] = signatureOf(entry as BlueprintEndpoint)
      else if (section === 'collections' && !admits('server', input.audience)) picked[name] = { ...(entry as object), storage: undefined }
      else picked[name] = entry
    }
    if (Object.keys(picked).length !== Object.keys(source).length) partial.push(section)
    if (section === 'resources' || section === 'schemas' || section === 'templates' || Object.keys(picked).length) content[section] = picked
  }
  if (document.content.state !== undefined) content.state = document.content.state
  if (document.content.runtime !== undefined) content.runtime = document.content.runtime
  const projected: BlueprintDocument = {
    ...(document.spec ? { spec: document.spec } : {}),
    ...(document.id ? { id: document.id } : {}),
    name: document.name,
    ...(document.from ? { from: document.from } : {}),
    projection: { of: hashDocument(document), select: [...input.select], audience: input.audience, ...(input.profile ? { profile: input.profile } : {}) },
    content: content as unknown as BlueprintDocument['content'],
  }
  return { document: projected, kept: [...kept].sort(), partial }
}

/** What the browser needs of an endpoint: its signature, never its handler. */
function signatureOf(endpoint: BlueprintEndpoint): BlueprintEndpoint {
  const { handler: _handler, ...signature } = endpoint
  return { ...signature, handler: { type: 'fail', status: 501, message: 'endpoint handler is not part of this projection' } }
}

export interface ProjectionIssue {
  code: 'PROJECTION_DANGLING'
  where: string
  message: string
}

/**
 * The publish-time check: every page against the client audience, every
 * endpoint against the server audience, every profile against its own.
 */
export function checkProjections(document: BlueprintDocument, refs: Record<string, RefSet> = refsOfDocument(document)): ProjectionIssue[] {
  const issues: ProjectionIssue[] = []
  const check = (roots: string[], audience: Audience, where: string) => {
    const { dangling } = closureFor(document, roots, audience, refs)
    for (const entry of dangling) {
      issues.push({ code: 'PROJECTION_DANGLING', where, message: `${where} (audience ${audience}) needs ${entry.entry}, whose audience is ${entry.audience} (via ${entry.neededBy})` })
    }
  }
  for (const name of Object.keys(document.content.templates || {})) {
    if (name.startsWith('page:')) check([name], 'client', `templates.${name}`)
    if (name.startsWith('channel:')) check([name], 'print', `templates.${name}`)
  }
  if (document.content.meta?.layout) check([document.content.meta.layout], 'client', 'meta.layout')
  for (const name of Object.keys(document.content.endpoints || {})) check([`endpoints.${name}`], 'server', `endpoints.${name}`)
  for (const [name, profile] of Object.entries(document.content.profiles || {})) check(profile.select, profile.audience, `profiles.${name}`)
  return issues
}
