/**
 * Document validation — runs at build time (fails the build) and in tests.
 *
 * Checks the envelope (spec version), section shapes, every static
 * reference (`refs()`), definition and action cycles, component names
 * against the registry, the shape of every test form, projections per
 * audience, and computes what the document requires against what the
 * runtime provides: critical absent → error, optional absent → warning,
 * locked nodes → named (ADR 0006, 0007, 0009, 0011, 0015, 0026).
 */
import { SPEC_RANGE, SPEC_VERSION, type BlueprintDocument, type BlueprintTemplate } from './types'
import { refsOfDocument, type RefSet } from './refs'
import { isPageTemplate, routeOf } from './template'
import { isPlainObject } from './path'
import { createEvaluator } from './logic'
import { HTTP_METHODS, RUNTIME_CONTRACT, storageNames, type RuntimeContract } from './contract'
import { CAPABILITIES, capabilityOfAction, requirementsOf, satisfies, type Requirements } from './capabilities'
import { checkCompatibility } from './capabilities'
import { portabilityOf, runtimeManifestOf, type Portability } from './manifest'
import { checkProjections } from './projection'
import { testFormOf } from './test-forms'

export interface DocumentIssue {
  level: 'error' | 'warning'
  code: string
  message: string
  where?: string
}

export interface PortabilityReport {
  /** Components from the neutral base vocabulary. */
  base: string[]
  /** Auto-registered Nuxt UI components (Vue + Nuxt UI only). */
  nuxtUi: string[]
  /** App-specific components (this app only). */
  app: string[]
  /** Unknown components. */
  unknown: string[]
  /** Raw html / class escape hatches. */
  escapes: string[]
}

export interface ValidationReport {
  name: string
  issues: DocumentIssue[]
  portability: PortabilityReport
  pages: Array<{ name: string, route: string }>
  endpoints: Array<{ name: string, method: string, path: string }>
  refs: Record<string, RefSet>
  /** Derived requirements (ADR 0007). */
  requirements?: Requirements
  /** Level and status (ADR 0009, 0026). */
  portable?: Portability
  /** Verdict against the runtime validated for. */
  compatibility?: 'compatible' | 'degraded' | 'incompatible'
}

export interface ValidateDocumentOptions {
  /** Known component names by layer. */
  registry?: { base?: string[], nuxtUi?: string[], app?: string[] }
  /** Runtime contract the document is validated against (storages, actions). */
  contract?: RuntimeContract
}

export function validateDocument(document: BlueprintDocument, options: ValidateDocumentOptions = {}): ValidationReport {
  const issues: DocumentIssue[] = []
  const error = (code: string, message: string, where?: string) => issues.push({ level: 'error', code, message, where })
  const warning = (code: string, message: string, where?: string) => issues.push({ level: 'warning', code, message, where })

  const name = document.name || '(unnamed)'
  if (!isPlainObject(document)) {
    error('INVALID_DOCUMENT', 'document must be an object')
    return { name, issues, portability: emptyPortability(), pages: [], endpoints: [], refs: {} }
  }
  if (!document.name || !/^[a-z0-9][a-z0-9-]*$/.test(document.name)) {
    error('INVALID_NAME', `document name "${String(document.name)}" must be a lowercase slug (it becomes the URL prefix)`)
  }
  // ---- spec version (ADR 0006): refuse outside the range, warn when absent ----
  if (document.spec === undefined) warning('SPEC_MISSING', `document declares no "spec"; treated as "${SPEC_VERSION}" until the first tagged spec`, 'spec')
  else if (typeof document.spec !== 'string' || !/^\d+\.\d+$/.test(document.spec)) error('UNSUPPORTED_SPEC', `"spec" must be a "major.minor" string, got ${JSON.stringify(document.spec)}`, 'spec')
  else if (!satisfies(`${document.spec}.0`, SPEC_RANGE)) error('UNSUPPORTED_SPEC', `document is written for spec ${document.spec}; this engine implements ${SPEC_RANGE}`, 'spec')
  if (document.projection !== undefined && (!isPlainObject(document.projection) || !Array.isArray(document.projection.select) || !document.projection.audience)) {
    error('INVALID_DOCUMENT', '"projection" must carry "select" and "audience"', 'projection')
  }
  const content = document.content
  if (!isPlainObject(content)) {
    error('INVALID_DOCUMENT', '"content" must be an object')
    return { name, issues, portability: emptyPortability(), pages: [], endpoints: [], refs: {} }
  }
  if (!isPlainObject(content.meta) || !content.meta.title) error('INVALID_META', '"content.meta.title" is required')
  for (const section of ['resources', 'schemas', 'templates'] as const) {
    if (!isPlainObject(content[section])) error('INVALID_SECTION', `"content.${section}" must be an object`, section)
  }
  for (const section of ['definitions', 'actions', 'state'] as const) {
    if (content[section] !== undefined && !isPlainObject(content[section])) error('INVALID_SECTION', `"content.${section}" must be an object`, section)
  }
  if (content.tests !== undefined && !Array.isArray(content.tests)) error('INVALID_SECTION', '"content.tests" must be an array', 'tests')
  if (issues.some(issue => issue.level === 'error')) return { name, issues, portability: emptyPortability(), pages: [], endpoints: [], refs: {} }

  for (const [resourceName, resource] of Object.entries(content.resources)) {
    if (!isPlainObject(resource) || !('data' in resource)) error('INVALID_RESOURCE', `resource "${resourceName}" must be an object with "data"`, `resources.${resourceName}`)
    else if (resource.type === 'parameter-table') {
      if (!Array.isArray(resource.data)) error('INVALID_RESOURCE', `parameter table "${resourceName}" must have an array of rows`, `resources.${resourceName}`)
      else resource.data.forEach((row, index) => {
        if (!isPlainObject(row) || !isPlainObject(row.match)) error('INVALID_RESOURCE', `row ${index} of "${resourceName}" needs a "match" object`, `resources.${resourceName}.data.${index}`)
      })
    }
  }
  for (const [definitionName, definition] of Object.entries(content.definitions || {})) {
    if (!isPlainObject(definition) || !('logic' in definition)) error('INVALID_DEFINITION', `definition "${definitionName}" must have "logic"`, `definitions.${definitionName}`)
    else if (definition.visibility !== undefined) warning('DEPRECATED', `definition "${definitionName}" uses "visibility", which has no semantics; "audience" decides where an entry may travel (ADR 0015)`, `definitions.${definitionName}`)
  }
  for (const [profileName, profile] of Object.entries(content.profiles || {})) {
    if (!isPlainObject(profile) || !Array.isArray(profile.select) || typeof profile.audience !== 'string') error('INVALID_PROFILE', `profile "${profileName}" must have "select" (array) and "audience"`, `profiles.${profileName}`)
  }

  const pages: Array<{ name: string, route: string }> = []
  for (const [templateName, template] of Object.entries(content.templates)) {
    if (!/^(?:page|component|channel):[a-z0-9-]+$/.test(templateName)) {
      warning('TEMPLATE_NAME', `template "${templateName}" should be named "page:<slug>", "component:<slug>" or "channel:<slug>"`, `templates.${templateName}`)
    }
    if (templateName.startsWith('page:')) {
      if (!isPageTemplate(template)) error('INVALID_PAGE', `page "${templateName}" must be an object with "children" (and optionally "route")`, `templates.${templateName}`)
      else pages.push({ name: templateName, route: routeOf(templateName, template) })
    }
    else if (!Array.isArray(template) && !isPlainObject(template)) {
      error('INVALID_TEMPLATE', `template "${templateName}" must be an array of nodes`, `templates.${templateName}`)
    }
  }
  const routes = new Map<string, string>()
  for (const page of pages) {
    const existing = routes.get(page.route)
    if (existing) error('DUPLICATE_ROUTE', `route "${page.route}" is declared by both "${existing}" and "${page.name}"`, `templates.${page.name}`)
    routes.set(page.route, page.name)
  }
  if (pages.length === 0) warning('NO_PAGES', 'document declares no "page:*" template; the app has nothing to render')

  // ---- runtime sections: storage, collections, endpoints ---------------------
  const contract = options.contract || RUNTIME_CONTRACT
  const storages = storageNames(contract)
  const knownStorage = (storage: unknown, where: string) => {
    if (storage !== undefined && !storages.includes(String(storage))) {
      error('UNKNOWN_STORAGE', `storage "${String(storage)}" is not provided by ${contract.runtime} (available: ${storages.join(', ')})`, where)
    }
  }
  knownStorage(content.runtime?.storage, 'runtime.storage')
  for (const bucket of ['requires', 'optional'] as const) {
    const entries = content.runtime?.[bucket]
    if (entries === undefined) continue
    if (!isPlainObject(entries)) {
      error('INVALID_SECTION', `"runtime.${bucket}" must map capability names to version ranges`, `runtime.${bucket}`)
      continue
    }
    for (const [capabilityName, range] of Object.entries(entries)) {
      if (typeof range !== 'string') error('INVALID_SECTION', `runtime.${bucket}.${capabilityName} must be a version range string`, `runtime.${bucket}`)
      if (!CAPABILITIES[capabilityName] && !capabilityName.includes(':')) warning('UNKNOWN_CAPABILITY', `runtime.${bucket} names "${capabilityName}", which is not a standard capability (third-party names are URIs)`, `runtime.${bucket}`)
    }
  }
  for (const [collectionName, collection] of Object.entries(content.collections || {})) {
    if (!isPlainObject(collection)) {
      error('INVALID_COLLECTION', `collection "${collectionName}" must be an object`, `collections.${collectionName}`)
      continue
    }
    if (!/^[a-z][a-z0-9-]*$/.test(collectionName)) error('INVALID_COLLECTION', `collection name "${collectionName}" must be a lowercase slug`, `collections.${collectionName}`)
    knownStorage(collection.storage, `collections.${collectionName}.storage`)
  }
  const endpoints: Array<{ name: string, method: string, path: string }> = []
  const routesByEndpoint = new Map<string, string>()
  for (const [endpointName, endpoint] of Object.entries(content.endpoints || {})) {
    const where = `endpoints.${endpointName}`
    if (!isPlainObject(endpoint)) {
      error('INVALID_ENDPOINT', `endpoint "${endpointName}" must be an object`, where)
      continue
    }
    if (!/^[a-z][a-z0-9-]*$/.test(endpointName)) error('INVALID_ENDPOINT', `endpoint name "${endpointName}" must be a lowercase slug`, where)
    if (!HTTP_METHODS.includes(endpoint.method as typeof HTTP_METHODS[number])) error('INVALID_ENDPOINT', `endpoint "${endpointName}" method must be one of ${HTTP_METHODS.join(', ')}`, where)
    if (typeof endpoint.path !== 'string' || !endpoint.path.startsWith('/')) error('INVALID_ENDPOINT', `endpoint "${endpointName}" path must start with "/"`, where)
    if (endpoint.handler === undefined) error('INVALID_ENDPOINT', `endpoint "${endpointName}" needs a "handler"`, where)
    if (endpoint.input !== undefined && !isPlainObject(endpoint.input)) error('INVALID_ENDPOINT', `endpoint "${endpointName}" input must be an object`, where)
    if (endpoint.access !== undefined && (endpoint.access === null || typeof endpoint.access === 'boolean')) warning('ACCESS_CONSTANT', `endpoint "${endpointName}" has a constant access rule; omit it (open) or write a rule over context.actor`, where)
    const key = `${String(endpoint.method).toUpperCase()} ${String(endpoint.path)}`
    const existing = routesByEndpoint.get(key)
    if (existing) error('DUPLICATE_ENDPOINT', `"${key}" is declared by both "${existing}" and "${endpointName}"`, where)
    routesByEndpoint.set(key, endpointName)
    endpoints.push({ name: endpointName, method: String(endpoint.method), path: String(endpoint.path) })
  }

  // ---- references --------------------------------------------------------
  const refs = refsOfDocument(document)
  const components = new Set<string>()
  const escapes: string[] = []
  for (const [section, set] of Object.entries(refs)) {
    for (const definitionName of set.definitions) {
      if (!content.definitions?.[definitionName]) error('UNKNOWN_DEFINITION', `${section} references unknown definition "${definitionName}"`, section)
    }
    for (const resourceName of set.resources) {
      if (!content.resources[resourceName]) error('UNKNOWN_RESOURCE', `${section} references unknown resource "${resourceName}"`, section)
    }
    for (const schemaName of set.schemas) {
      if (!content.schemas[schemaName]) error('UNKNOWN_SCHEMA', `${section} references unknown schema "${schemaName}"`, section)
    }
    for (const templateName of set.templates) {
      if (!content.templates[templateName]) error('UNKNOWN_TEMPLATE', `${section} references unknown template "${templateName}"`, section)
    }
    for (const actionName of set.actions) {
      if (!content.actions?.[actionName]) error('UNKNOWN_ACTION', `${section} references unknown action "${actionName}"`, section)
    }
    for (const collectionName of set.collections) {
      if (!content.collections?.[collectionName]) error('UNKNOWN_COLLECTION', `${section} references unknown collection "${collectionName}"`, section)
    }
    for (const endpointName of set.endpoints) {
      if (!content.endpoints?.[endpointName]) error('UNKNOWN_ENDPOINT', `${section} references unknown endpoint "${endpointName}"`, section)
    }
    for (const dynamic of set.dynamic) error('DYNAMIC_REFERENCE', dynamic, section)
    for (const component of set.components) components.add(component)
    escapes.push(...set.escapes)
  }

  // ---- action placement: a property of the capability's surface (ADR 0008) ----
  const surfaceOf = (type: string) => capabilityOfAction(type)?.surface
  const serverTypes = new Set<string>(contract.actions.server)
  const clientTypes = new Set<string>(contract.actions.client)
  const contractServer = new Set<string>([...contract.actions.shared, ...contract.actions.server])
  const typesOf = (section: string, seen = new Set<string>()): Set<string> => {
    const out = new Set<string>()
    if (seen.has(section)) return out
    seen.add(section)
    const set = refs[section]
    if (!set) return out
    for (const type of set.actionTypes) out.add(type)
    for (const actionName of set.actions) for (const type of typesOf(`actions.${actionName}`, seen)) out.add(type)
    return out
  }
  for (const section of Object.keys(refs)) {
    const types = typesOf(section)
    if (section.startsWith('endpoints.')) {
      for (const type of types) {
        if (surfaceOf(type) === 'client' || clientTypes.has(type)) error('CLIENT_ACTION_IN_HANDLER', `${section} runs "${type}", whose capability (${capabilityOfAction(type)?.name || 'client'}) has no server surface here`, section)
        else if (!contractServer.has(type) && !serverTypes.has(type)) error('UNKNOWN_ACTION_TYPE', `${section} runs "${type}", unknown to ${contract.runtime}`, section)
      }
      if (!types.has('respond') && !types.has('fail')) warning('NO_RESPONSE', `${section} never runs "respond"; requests will get 204`, section)
    }
    else if (section.startsWith('templates.')) {
      for (const type of types) if (surfaceOf(type) === 'server' || serverTypes.has(type)) error('SERVER_ACTION_IN_TEMPLATE', `${section} runs "${type}", whose capability (${capabilityOfAction(type)?.name || 'server'}) has no browser surface here`, section)
    }
  }

  // ---- named action cycles (ADR 0008): same algorithm as definitions -----------
  const actionGraph = new Map<string, Set<string>>()
  for (const actionName of Object.keys(content.actions || {})) actionGraph.set(actionName, refs[`actions.${actionName}`]?.actions || new Set())
  const actionState = new Map<string, 'visiting' | 'done'>()
  const visitAction = (node: string, trail: string[]) => {
    if (actionState.get(node) === 'done') return
    if (actionState.get(node) === 'visiting') {
      error('ACTION_CYCLE', `actions call each other in a cycle: ${[...trail, node].join(' → ')}`, `actions.${node}`)
      return
    }
    actionState.set(node, 'visiting')
    for (const next of actionGraph.get(node) || []) if (actionGraph.has(next)) visitAction(next, [...trail, node])
    actionState.set(node, 'done')
  }
  for (const actionName of actionGraph.keys()) visitAction(actionName, [])

  // ---- definition cycles ---------------------------------------------------
  const graph = new Map<string, Set<string>>()
  for (const definitionName of Object.keys(content.definitions || {})) graph.set(definitionName, refs[`definitions.${definitionName}`]?.definitions || new Set())
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (node: string, trail: string[]) => {
    if (state.get(node) === 'done') return
    if (state.get(node) === 'visiting') {
      error('DEFINITION_CYCLE', `definitions form a cycle: ${[...trail, node].join(' → ')}`, `definitions.${node}`)
      return
    }
    state.set(node, 'visiting')
    for (const next of graph.get(node) || []) if (graph.has(next)) visit(next, [...trail, node])
    state.set(node, 'done')
  }
  for (const definitionName of graph.keys()) visit(definitionName, [])

  // ---- template includes cycles --------------------------------------------
  const templateGraph = new Map<string, Set<string>>()
  for (const templateName of Object.keys(content.templates)) templateGraph.set(templateName, refs[`templates.${templateName}`]?.templates || new Set())
  const templateState = new Map<string, 'visiting' | 'done'>()
  const visitTemplate = (node: string, trail: string[]) => {
    if (templateState.get(node) === 'done') return
    if (templateState.get(node) === 'visiting') {
      error('TEMPLATE_CYCLE', `templates include each other: ${[...trail, node].join(' → ')}`, `templates.${node}`)
      return
    }
    templateState.set(node, 'visiting')
    for (const next of templateGraph.get(node) || []) if (templateGraph.has(next)) visitTemplate(next, [...trail, node])
    templateState.set(node, 'done')
  }
  for (const templateName of templateGraph.keys()) visitTemplate(templateName, [])

  // ---- vocabulary layers ---------------------------------------------------
  const registry = options.registry || {}
  const base = new Set(registry.base || [])
  const nuxtUi = new Set(registry.nuxtUi || [])
  const app = new Set(registry.app || [])
  const portability: PortabilityReport = { base: [], nuxtUi: [], app: [], unknown: [], escapes }
  for (const component of [...components].sort()) {
    if (base.has(component)) portability.base.push(component)
    else if (nuxtUi.has(component)) portability.nuxtUi.push(component)
    else if (app.has(component)) portability.app.push(component)
    else portability.unknown.push(component)
  }
  if (options.registry) {
    // Unknown components with a fallback are drawable through it (ADR 0026); without one they are errors.
    const lockedNames = new Set<string>()
    for (const set of Object.values(refs)) for (const entry of set.locked) lockedNames.add(entry.component)
    for (const component of portability.unknown) {
      if (lockedNames.has(component)) error('UNKNOWN_COMPONENT', `component "${component}" is not registered and has no fallback`, 'templates')
      else warning('UNKNOWN_COMPONENT', `component "${component}" is not registered; its fallback will be drawn`, 'templates')
    }
  }
  for (const escape of escapes) warning('NON_PORTABLE', escape)

  // ---- requirements, compatibility, portability (ADR 0007, 0009, 0026) ---------
  const requirements = requirementsOf(document, refs, options.registry)
  const portable = portabilityOf(document, refs, requirements)
  for (const entry of portable.locked) warning('LOCKED', `"${entry.component}" has no fallback; the document runs only where its vocabulary exists`, entry.where)
  const runtimeManifest = runtimeManifestOf(contract)
  const compatibility = checkCompatibility({ spec: document.spec, requires: requirements.requires, optional: requirements.optional }, runtimeManifest)
  for (const missing of compatibility.missing) {
    const reason = requirements.reasons[missing.name]?.slice(0, 3).join(', ')
    error(missing.code, `${contract.runtime} ${missing.provided ? `provides ${missing.name} ${missing.provided}, outside ${missing.required}` : `does not provide ${missing.name} ${missing.required}`}${reason ? ` (needed by ${reason})` : ''}`, 'runtime')
  }
  for (const unavailable of compatibility.unavailable) warning('CAPABILITY_UNAVAILABLE', `${unavailable.name} is optional and ${contract.runtime} does not provide it; the document degrades there`, 'runtime')

  // ---- projections (ADR 0015): a public page may not lean on a server entry ----
  for (const issue of checkProjections(document, refs)) error(issue.code, issue.message, issue.where)

  // ---- tests: static shape of every form (execution lives in tests.ts) ---------
  const tests = content.tests || []
  tests.forEach((test, index) => {
    const where = `tests.${index}`
    if (!isPlainObject(test) || !test.name) {
      error('INVALID_TEST', `test ${index} must have a "name"`, where)
      return
    }
    const form = testFormOf(test)
    const record = test as Record<string, unknown>
    switch (form) {
      case 'definition':
        if (record.expect !== undefined && !isPlainObject(record.expect)) error('INVALID_TEST', `test "${test.name}": "expect" must map definitions to values`, where)
        for (const definitionName of Object.keys(isPlainObject(record.expect) ? record.expect : {})) {
          if (!content.definitions?.[definitionName]) error('UNKNOWN_DEFINITION', `test "${test.name}" expects unknown definition "${definitionName}"`, where)
        }
        break
      case 'tree': {
        const render = typeof record.render === 'string' ? record.render : isPlainObject(record.render) ? record.render.template : undefined
        if (typeof render !== 'string') error('INVALID_TEST', `test "${test.name}": "render" must be a template name or { template }`, where)
        else if (!content.templates[render]) error('UNKNOWN_TEMPLATE', `test "${test.name}" renders unknown template "${render}"`, where)
        if (record.tree === undefined && record.contains === undefined) error('INVALID_TEST', `test "${test.name}": a tree test needs "tree" or "contains"`, where)
        break
      }
      case 'scenario':
        if (typeof record.run === 'string' && !content.actions?.[record.run]) error('UNKNOWN_ACTION', `test "${test.name}" runs unknown action "${record.run}"`, where)
        if (record.stubs !== undefined && !isPlainObject(record.stubs)) error('INVALID_TEST', `test "${test.name}": "stubs" must map capabilities to stub lists`, where)
        break
      case 'endpoint': {
        const request = record.request as Record<string, unknown>
        if (!isPlainObject(request)) error('INVALID_TEST', `test "${test.name}": "request" must be an object`, where)
        else if (typeof request.endpoint === 'string' && !content.endpoints?.[request.endpoint]) error('UNKNOWN_ENDPOINT', `test "${test.name}" requests unknown endpoint "${request.endpoint}"`, where)
        else if (request.endpoint === undefined && (typeof request.method !== 'string' || typeof request.path !== 'string')) error('INVALID_TEST', `test "${test.name}": request needs "endpoint" or "method" + "path"`, where)
        break
      }
      default:
        error('INVALID_TEST', `test "${test.name}" carries none of expect, render, run or request`, where)
    }
    const after = record.after as Record<string, unknown> | undefined
    for (const definitionName of Object.keys(isPlainObject(after) && isPlainObject(after.expect) ? after.expect : {})) {
      if (!content.definitions?.[definitionName]) error('UNKNOWN_DEFINITION', `test "${test.name}" expects unknown definition "${definitionName}"`, where)
    }
  })

  // ---- smoke evaluation: every public definition against the initial state
  if (!issues.some(issue => issue.level === 'error')) {
    try {
      const evaluator = createEvaluator(document)
      evaluator.definitions({ state: JSON.parse(JSON.stringify(content.state || {})), context: { params: {}, query: {}, app: document.name }, vars: {} })
    }
    catch (caught) {
      error('EVALUATION_FAILED', `definitions fail against the initial state: ${(caught as Error).message}`, 'definitions')
    }
  }

  return { name, issues, portability, pages, endpoints, refs, requirements, portable, compatibility: compatibility.verdict }
}

function emptyPortability(): PortabilityReport {
  return { base: [], nuxtUi: [], app: [], unknown: [], escapes: [] }
}

export function templateSummary(template: BlueprintTemplate): string {
  return Array.isArray(template) ? `${template.length} nodes` : `${(template.children || []).length} nodes${template.route ? ` @ ${template.route}` : ''}`
}
