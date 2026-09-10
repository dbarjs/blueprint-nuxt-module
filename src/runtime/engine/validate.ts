/**
 * Document validation — runs at build time (fails the build) and in tests.
 *
 * Checks the envelope, section shapes, every static reference (`refs()`),
 * definition cycles, component names against the registry, and reports the
 * vocabulary layers the document uses (portability).
 */
import { CLIENT_ACTION_TYPES, SERVER_ACTION_TYPES, type BlueprintDocument, type BlueprintTemplate } from './types'
import { refsOfDocument, type RefSet } from './refs'
import { isPageTemplate, routeOf } from './template'
import { isPlainObject } from './path'
import { createEvaluator } from './logic'
import { HTTP_METHODS, RUNTIME_CONTRACT, storageNames, type RuntimeContract } from './contract'

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

  // ---- action placement: server actions stay in handlers, client ones out ----
  const serverTypes = new Set<string>(SERVER_ACTION_TYPES)
  const clientTypes = new Set<string>(CLIENT_ACTION_TYPES)
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
        if (clientTypes.has(type)) error('CLIENT_ACTION_IN_HANDLER', `${section} runs "${type}", which only exists in the browser`, section)
        else if (!contractServer.has(type) && !serverTypes.has(type)) error('UNKNOWN_ACTION_TYPE', `${section} runs "${type}", unknown to ${contract.runtime}`, section)
      }
      if (!types.has('respond') && !types.has('fail')) warning('NO_RESPONSE', `${section} never runs "respond"; requests will get 204`, section)
    }
    else if (section.startsWith('templates.')) {
      for (const type of types) if (serverTypes.has(type)) error('SERVER_ACTION_IN_TEMPLATE', `${section} runs "${type}", which only exists on the server`, section)
    }
  }

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
    for (const component of portability.unknown) error('UNKNOWN_COMPONENT', `component "${component}" is not registered`, 'templates')
  }
  for (const escape of escapes) warning('NON_PORTABLE', escape)

  // ---- tests: static shape only (execution lives in tests.ts) --------------
  const tests = content.tests || []
  tests.forEach((test, index) => {
    if (!isPlainObject(test) || !test.name || !isPlainObject(test.expect)) error('INVALID_TEST', `test ${index} must have "name" and "expect"`, `tests.${index}`)
    else for (const definitionName of Object.keys(test.expect)) {
      if (!content.definitions?.[definitionName]) error('UNKNOWN_DEFINITION', `test "${test.name}" expects unknown definition "${definitionName}"`, `tests.${index}`)
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

  return { name, issues, portability, pages, endpoints, refs }
}

function emptyPortability(): PortabilityReport {
  return { base: [], nuxtUi: [], app: [], unknown: [], escapes: [] }
}

export function templateSummary(template: BlueprintTemplate): string {
  return Array.isArray(template) ? `${template.length} nodes` : `${(template.children || []).length} nodes${template.route ? ` @ ${template.route}` : ''}`
}
