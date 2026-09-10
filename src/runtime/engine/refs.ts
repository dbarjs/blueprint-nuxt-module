/**
 * `refs()` — static references of a document section.
 *
 * Every reference in a document is static: a declared identifier that can be
 * resolved without executing anything. A reference built at runtime (`def`
 * with a computed name) is rejected here, for the same reason tree-shaking
 * works with static `import` and not with dynamic `require`.
 */
import type { BlueprintAction, BlueprintActions, BlueprintDocument, BlueprintTemplate, Logic, TemplateNode } from './types'
import { templateNodes } from './template'
import { isPlainObject } from './path'
import { BASE_COMPONENT_NAMES } from './registry'

export interface RefSet {
  definitions: Set<string>
  resources: Set<string>
  schemas: Set<string>
  templates: Set<string>
  actions: Set<string>
  components: Set<string>
  statePaths: Set<string>
  collections: Set<string>
  endpoints: Set<string>
  /** Action types used (to check client/server placement). */
  actionTypes: Set<string>
  /** First segment of every `context` read (`now`, `params`, `busy`...). */
  contextKeys: Set<string>
  /** State paths bound two-way with `model`. */
  models: Set<string>
  /** Components used only inside `fallback` trees (base vocabulary by rule). */
  fallbackComponents: Set<string>
  /** Non-base components without any fallback: where the document is locked. */
  locked: Array<{ component: string, where: string }>
  /** `submit` steps without an endpoint: they go to the built-in records API. */
  submitsToRecords: Set<string>
  /** Raw html escape hatches and raw `class` props found. */
  escapes: string[]
  /** References that could not be resolved statically. */
  dynamic: string[]
}

export function createRefSet(): RefSet {
  return {
    definitions: new Set(),
    resources: new Set(),
    schemas: new Set(),
    templates: new Set(),
    actions: new Set(),
    components: new Set(),
    statePaths: new Set(),
    collections: new Set(),
    endpoints: new Set(),
    actionTypes: new Set(),
    contextKeys: new Set(),
    models: new Set(),
    fallbackComponents: new Set(),
    locked: [],
    submitsToRecords: new Set(),
    escapes: [],
    dynamic: [],
  }
}

const REFERENCE_OPERATORS: Record<string, keyof Pick<RefSet, 'definitions' | 'resources' | 'schemas' | 'statePaths'>> = {
  def: 'definitions',
  resource: 'resources',
  lookup: 'resources',
  schema: 'schemas',
  state: 'statePaths',
  value: 'statePaths',
}

export function refsOfLogic(logic: Logic, refs: RefSet, where: string): RefSet {
  if (logic === null || typeof logic !== 'object') return refs
  if (Array.isArray(logic)) {
    logic.forEach((item, index) => refsOfLogic(item as Logic, refs, `${where}[${index}]`))
    return refs
  }
  const [operator] = Object.keys(logic)
  if (!operator) return refs
  const args = (logic as Record<string, unknown>)[operator]
  if (operator === 'context') {
    const first = Array.isArray(args) ? args[0] : args
    if (typeof first === 'string') refs.contextKeys.add(first.split('.')[0]!)
  }
  const target = REFERENCE_OPERATORS[operator]
  if (target) {
    const first = Array.isArray(args) ? args[0] : args
    if (typeof first === 'string') refs[target].add(first)
    else refs.dynamic.push(`${where}: "${operator}" with a computed name is not a static reference`)
  }
  if (operator === 'obj' && isPlainObject(args)) {
    for (const [key, value] of Object.entries(args)) refsOfLogic(value as Logic, refs, `${where}.${key}`)
    return refs
  }
  if (operator === 'let' && Array.isArray(args) && isPlainObject(args[0])) {
    for (const [key, value] of Object.entries(args[0])) refsOfLogic(value as Logic, refs, `${where}.let.${key}`)
    refsOfLogic(args[1] as Logic, refs, `${where}.let.body`)
    return refs
  }
  const list = Array.isArray(args) ? args : [args]
  list.forEach((arg, index) => refsOfLogic(arg as Logic, refs, `${where}.${operator}[${index}]`))
  return refs
}

export function refsOfActions(actions: BlueprintActions | undefined, refs: RefSet, where: string): RefSet {
  if (!actions) return refs
  if (typeof actions === 'string') {
    refs.actions.add(actions)
    return refs
  }
  if (Array.isArray(actions)) {
    actions.forEach((action, index) => refsOfActions(action, refs, `${where}[${index}]`))
    return refs
  }
  const action = actions as BlueprintAction & Record<string, unknown>
  refs.actionTypes.add(String(action.type))
  switch (action.type) {
    case 'action':
      refs.actions.add(action.name)
      for (const [key, value] of Object.entries(action.with || {})) refsOfLogic(value, refs, `${where}.with.${key}`)
      break
    case 'set':
    case 'push':
      refs.statePaths.add(action.path)
      refsOfLogic(action.value, refs, `${where}.value`)
      break
    case 'remove':
      refs.statePaths.add(action.path)
      if (action.where !== undefined) refsOfLogic(action.where, refs, `${where}.where`)
      if (action.index !== undefined) refsOfLogic(action.index, refs, `${where}.index`)
      break
    case 'update':
      refs.statePaths.add(action.path)
      refsOfLogic(action.where, refs, `${where}.where`)
      for (const [key, value] of Object.entries(action.set || {})) refsOfLogic(value, refs, `${where}.set.${key}`)
      break
    case 'increment':
      refs.statePaths.add(action.path)
      for (const key of ['by', 'min', 'max'] as const) if (action[key] !== undefined) refsOfLogic(action[key]!, refs, `${where}.${key}`)
      break
    case 'navigate':
      if (action.to.startsWith('page:')) refs.templates.add(action.to)
      if (action.to.startsWith('endpoint:')) refs.endpoints.add(action.to.slice('endpoint:'.length))
      for (const [key, value] of Object.entries(action.params || {})) refsOfLogic(value, refs, `${where}.params.${key}`)
      for (const [key, value] of Object.entries(action.query || {})) refsOfLogic(value, refs, `${where}.query.${key}`)
      break
    case 'toast':
      refsOfLogic(action.title, refs, `${where}.title`)
      if (action.description !== undefined) refsOfLogic(action.description, refs, `${where}.description`)
      break
    case 'if':
      refsOfLogic(action.condition, refs, `${where}.condition`)
      refsOfActions(action.then, refs, `${where}.then`)
      refsOfActions(action.else, refs, `${where}.else`)
      break
    case 'validate':
      refs.schemas.add(action.schema)
      refsOfActions(action.then, refs, `${where}.then`)
      refsOfActions(action.else, refs, `${where}.else`)
      break
    case 'submit':
    case 'fetch':
      if (action.type === 'submit' && action.schema) refs.schemas.add(action.schema)
      if (action.type === 'submit' && !action.endpoint) refs.submitsToRecords.add(where)
      if (action.endpoint && !action.endpoint.startsWith('/')) refs.endpoints.add(action.endpoint)
      if (action.result) refs.statePaths.add(action.result)
      if (action.body !== undefined) refsOfLogic(action.body, refs, `${where}.body`)
      for (const [key, value] of Object.entries(action.params || {})) refsOfLogic(value, refs, `${where}.params.${key}`)
      for (const [key, value] of Object.entries(action.query || {})) refsOfLogic(value, refs, `${where}.query.${key}`)
      refsOfActions(action.then, refs, `${where}.then`)
      refsOfActions(action.catch, refs, `${where}.catch`)
      break
    case 'insert':
      refs.collections.add(action.collection)
      refsOfLogic(action.data, refs, `${where}.data`)
      if (action.result) refs.statePaths.add(action.result)
      break
    case 'find':
    case 'findOne':
    case 'count':
    case 'delete':
      refs.collections.add(action.collection)
      for (const key of ['id', 'where', 'limit', 'offset'] as const) if (action[key] !== undefined) refsOfLogic(action[key] as Logic, refs, `${where}.${key}`)
      if (action.result) refs.statePaths.add(action.result)
      break
    case 'patch':
      refs.collections.add(action.collection)
      for (const key of ['id', 'where'] as const) if (action[key] !== undefined) refsOfLogic(action[key] as Logic, refs, `${where}.${key}`)
      for (const [key, value] of Object.entries(action.set || {})) refsOfLogic(value, refs, `${where}.set.${key}`)
      if (action.result) refs.statePaths.add(action.result)
      break
    case 'respond':
      if (action.body !== undefined) refsOfLogic(action.body, refs, `${where}.body`)
      break
    case 'fail':
      if (action.message !== undefined) refsOfLogic(action.message, refs, `${where}.message`)
      if (action.issues !== undefined) refsOfLogic(action.issues, refs, `${where}.issues`)
      break
    case 'sequence':
      refsOfActions(action.steps, refs, `${where}.steps`)
      break
    case 'log':
      refsOfLogic(action.value, refs, `${where}.value`)
      break
    case 'reset':
      break
    default:
      refs.dynamic.push(`${where}: unknown action type "${String((action as { type: unknown }).type)}"`)
  }
  return refs
}

export function refsOfNodes(nodes: TemplateNode[] | undefined, refs: RefSet, where: string, inFallback = false): RefSet {
  (nodes || []).forEach((node, index) => refsOfNode(node, refs, `${where}[${index}]`, inFallback))
  return refs
}

/** Names of the base vocabulary; anything else needs a fallback to stay portable (ADR 0026). */
let baseNames: Set<string> | null = null
function isBase(component: string): boolean {
  if (!baseNames) baseNames = new Set(BASE_COMPONENT_NAMES)
  return baseNames.has(component)
}

function refsOfNode(node: TemplateNode, refs: RefSet, where: string, inFallback: boolean): void {
  if (node.if !== undefined) refsOfLogic(node.if, refs, `${where}.if`)
  if (node.for) refsOfLogic(node.for.in, refs, `${where}.for.in`)
  switch (node.type) {
    case 'text':
      refsOfLogic(node.content, refs, `${where}.content`)
      break
    case 'if':
      refsOfLogic(node.condition, refs, `${where}.condition`)
      refsOfNodes(node.children, refs, `${where}.children`, inFallback)
      refsOfNodes(node.else, refs, `${where}.else`, inFallback)
      break
    case 'for':
      refsOfLogic(node.in, refs, `${where}.in`)
      refsOfNodes(node.children, refs, `${where}.children`, inFallback)
      refsOfNodes(node.empty, refs, `${where}.empty`, inFallback)
      break
    case 'template':
      refs.templates.add(node.name)
      for (const [key, value] of Object.entries(node.with || {})) refsOfLogic(value, refs, `${where}.with.${key}`)
      break
    case 'outlet':
      break
    case 'html':
      refs.escapes.push(`${where}: raw html <${node.as}>`)
      refsOfElementLike(node, refs, where, inFallback)
      break
    case 'component':
      if (inFallback) {
        refs.fallbackComponents.add(node.as)
        if (!isBase(node.as)) refs.dynamic.push(`${where}: fallback uses "${node.as}", which is not in the base vocabulary`)
      }
      else {
        refs.components.add(node.as)
        if (!isBase(node.as) && !node.fallback) refs.locked.push({ component: node.as, where })
      }
      if (node.props && typeof node.props.class === 'string') refs.escapes.push(`${where}: raw class "${node.props.class}" on ${node.as}`)
      if ((node.as === 'UForm' || node.as === 'Form') && typeof node.props?.schema === 'string') refs.schemas.add(node.props.schema)
      if (typeof node.props?.to === 'string' && node.props.to.startsWith('endpoint:')) refs.endpoints.add(node.props.to.slice('endpoint:'.length))
      if (typeof node.props?.to === 'string' && node.props.to.startsWith('page:')) refs.templates.add(node.props.to)
      if (node.model) {
        const path = typeof node.model === 'string' ? node.model : node.model.path
        refs.statePaths.add(path)
        refs.models.add(path)
      }
      refsOfElementLike(node, refs, where, inFallback)
      for (const [slot, nodes] of Object.entries(node.slots || {})) refsOfNodes(nodes, refs, `${where}.slots.${slot}`, inFallback)
      if (node.fallback) refsOfNodes(node.fallback, refs, `${where}.fallback`, true)
      break
    default:
      refs.dynamic.push(`${where}: unknown node type "${String((node as { type: string }).type)}"`)
  }
}

function refsOfElementLike(node: { bind?: Record<string, Logic>, content?: Logic, children?: TemplateNode[], on?: Record<string, BlueprintActions> }, refs: RefSet, where: string, inFallback: boolean) {
  for (const [prop, logic] of Object.entries(node.bind || {})) refsOfLogic(logic, refs, `${where}.bind.${prop}`)
  if (node.content !== undefined) refsOfLogic(node.content, refs, `${where}.content`)
  refsOfNodes(node.children, refs, `${where}.children`, inFallback)
  for (const [event, actions] of Object.entries(node.on || {})) refsOfActions(actions, refs, `${where}.on.${event}`)
}

export function refsOfTemplate(template: BlueprintTemplate, refs: RefSet, where: string): RefSet {
  if (!Array.isArray(template)) {
    if (typeof template.layout === 'string') refs.templates.add(template.layout)
    refsOfActions(template.enter, refs, `${where}.enter`)
  }
  return refsOfNodes(templateNodes(template), refs, where)
}

/** References of the whole document, grouped by section. */
export function refsOfDocument(document: BlueprintDocument): Record<string, RefSet> {
  const out: Record<string, RefSet> = {}
  const content = document.content
  for (const [name, definition] of Object.entries(content.definitions || {})) {
    out[`definitions.${name}`] = refsOfLogic(definition.logic, createRefSet(), `definitions.${name}`)
  }
  for (const [name, action] of Object.entries(content.actions || {})) {
    out[`actions.${name}`] = refsOfActions(action, createRefSet(), `actions.${name}`)
  }
  for (const [name, template] of Object.entries(content.templates || {})) {
    out[`templates.${name}`] = refsOfTemplate(template, createRefSet(), `templates.${name}`)
  }
  for (const [name, schema] of Object.entries(content.schemas || {})) {
    const refs = createRefSet()
    walkSchema(schema as Record<string, unknown>, refs, `schemas.${name}`)
    out[`schemas.${name}`] = refs
  }
  if (content.meta?.layout) {
    out['meta'] = createRefSet()
    out['meta'].templates.add(content.meta.layout)
  }
  for (const [name, collection] of Object.entries(content.collections || {})) {
    const refs = createRefSet()
    if (collection?.schema) refs.schemas.add(collection.schema)
    out[`collections.${name}`] = refs
  }
  for (const [name, endpoint] of Object.entries(content.endpoints || {})) {
    const refs = createRefSet()
    for (const schemaName of Object.values(endpoint?.input || {})) if (typeof schemaName === 'string') refs.schemas.add(schemaName)
    if (endpoint?.access !== undefined) refsOfLogic(endpoint.access, refs, `endpoints.${name}.access`)
    refsOfActions(endpoint?.handler, refs, `endpoints.${name}.handler`)
    out[`endpoints.${name}`] = refs
  }
  return out
}

function walkSchema(schema: Record<string, unknown>, refs: RefSet, where: string) {
  if (typeof schema.$ref === 'string') {
    const match = /^#\/schemas\/([^/]+)$/.exec(schema.$ref)
    if (match) refs.schemas.add(match[1]!)
    else refs.dynamic.push(`${where}: unsupported $ref "${schema.$ref}"`)
  }
  if (schema.requiredWhen !== undefined) refsOfLogic(schema.requiredWhen as Logic, refs, `${where}.requiredWhen`)
  for (const [key, child] of Object.entries((schema.properties as Record<string, Record<string, unknown>>) || {})) walkSchema(child, refs, `${where}.${key}`)
  if (isPlainObject(schema.items)) walkSchema(schema.items, refs, `${where}.items`)
}

/**
 * Action types reachable from a handler, following named actions. Used to
 * place actions (server vs browser) and to detect pages that read live data.
 */
export function actionTypesOf(document: BlueprintDocument, actions: BlueprintActions | undefined): Set<string> {
  const out = new Set<string>()
  const seenNamed = new Set<string>()
  const visit = (current: BlueprintActions | undefined) => {
    const refs = refsOfActions(current, createRefSet(), 'actions')
    for (const type of refs.actionTypes) out.add(type)
    for (const name of refs.actions) {
      if (seenNamed.has(name)) continue
      seenNamed.add(name)
      visit(document.content.actions?.[name])
    }
  }
  visit(actions)
  return out
}

/**
 * State paths that hold live server data (`fetch`/`submit` results). The
 * browser runtime must not persist or restore them: they belong to the
 * server, not to the draft the user is building.
 */
export function livePathsOf(document: BlueprintDocument): Set<string> {
  const out = new Set<string>()
  const visitActions = (actions: BlueprintActions | undefined) => {
    if (!actions || typeof actions === 'string') return
    for (const action of Array.isArray(actions) ? actions : [actions]) {
      if (typeof action === 'string') continue
      const record = action as Record<string, unknown>
      if ((action.type === 'fetch' || action.type === 'submit') && typeof record.result === 'string') out.add(record.result)
      for (const key of ['then', 'catch', 'else', 'steps']) visitActions(record[key] as BlueprintActions | undefined)
    }
  }
  const visitNodes = (nodes: TemplateNode[] | undefined) => {
    for (const node of nodes || []) {
      const record = node as unknown as Record<string, unknown>
      for (const handler of Object.values((record.on as Record<string, BlueprintActions>) || {})) visitActions(handler)
      for (const key of ['children', 'else', 'empty', 'fallback']) visitNodes(record[key] as TemplateNode[] | undefined)
      for (const slot of Object.values((record.slots as Record<string, TemplateNode[]>) || {})) visitNodes(slot)
    }
  }
  for (const action of Object.values(document.content.actions || {})) visitActions(action)
  for (const template of Object.values(document.content.templates || {})) {
    if (!Array.isArray(template)) visitActions(template.enter)
    visitNodes(templateNodes(template))
  }
  return out
}

/** Dependency closure of a set of sections (what a page needs to run). */
export function closure(document: BlueprintDocument, roots: string[]): Set<string> {
  const all = refsOfDocument(document)
  const seen = new Set<string>()
  const queue = [...roots]
  while (queue.length) {
    const section = queue.shift()!
    if (seen.has(section)) continue
    seen.add(section)
    const refs = all[section]
    if (!refs) continue
    for (const name of refs.definitions) queue.push(`definitions.${name}`)
    for (const name of refs.resources) queue.push(`resources.${name}`)
    for (const name of refs.schemas) queue.push(`schemas.${name}`)
    for (const name of refs.templates) queue.push(`templates.${name}`)
    for (const name of refs.actions) queue.push(`actions.${name}`)
    for (const name of refs.collections) queue.push(`collections.${name}`)
    for (const name of refs.endpoints) queue.push(`endpoints.${name}`)
  }
  return seen
}
