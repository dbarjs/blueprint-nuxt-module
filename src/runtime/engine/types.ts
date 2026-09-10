/**
 * Blueprint document format — TypeScript view of the JSON notation.
 *
 * A Blueprint document is the "third artifact": everything an application
 * needs to run that is neither code nor transactional data. This module
 * loads one document per file under `content/` and turns it into an app.
 */

/** A calculation expression in the JSON Logic-like notation. */
export type Logic
  = | null
    | boolean
    | number
    | string
    | Logic[]
    | { [operator: string]: Logic | Logic[] | unknown }

export interface BlueprintMeta {
  title: string
  description?: string
  icon?: string
  /** Template name used as layout for every page, e.g. `component:shell`. */
  layout?: string
  /** ISO 4217 currency code used by the `format` operator (`currency`). */
  currency?: string
  /** BCP 47 locale used by number/date formatting. */
  locale?: string
  /** Nuxt UI color aliases (primary, neutral...). */
  theme?: Record<string, string>
  seo?: Record<string, string>
}

export interface BlueprintResource<T = unknown> {
  type: string
  name?: string
  description?: string
  data: T
  /** Hit policy for parameter tables (`type: "parameter-table"`). */
  hitPolicy?: 'first' | 'unique' | 'collect' | 'last'
  /** Default row for parameter tables when no row matches. */
  default?: unknown
  [key: string]: unknown
}

export interface BlueprintDefinition {
  type?: 'number' | 'string' | 'boolean' | 'array' | 'object' | 'any'
  visibility?: 'public' | 'private'
  description?: string
  logic: Logic
}

/** Closed set of actions the engine knows how to run. */
export type BlueprintAction
  = | { type: 'set', path: string, value: Logic }
    | { type: 'push', path: string, value: Logic }
    | { type: 'remove', path: string, where?: Logic, index?: Logic }
    | { type: 'update', path: string, where: Logic, set: Record<string, Logic> }
    | { type: 'increment', path: string, by?: Logic, min?: Logic, max?: Logic }
    | { type: 'reset', path?: string }
    | { type: 'navigate', to: string, params?: Record<string, Logic>, query?: Record<string, Logic> }
    | { type: 'toast', title: Logic, description?: Logic, color?: string, icon?: string }
    | { type: 'if', condition: Logic, then?: BlueprintActions, else?: BlueprintActions }
    | { type: 'validate', schema: string, path?: string, then?: BlueprintActions, else?: BlueprintActions }
    | { type: 'submit', schema?: string, path?: string, endpoint?: string, body?: Logic, result?: string, then?: BlueprintActions, catch?: BlueprintActions }
    | { type: 'action', name: string, with?: Record<string, Logic> }
    | { type: 'sequence', steps: BlueprintActions }
    | { type: 'log', value: Logic }

/** An action reference: a named action, an inline action, or a sequence. */
export type BlueprintActions = string | BlueprintAction | Array<string | BlueprintAction>

export interface NodeBase {
  /** Render only when the condition is truthy. */
  if?: Logic
  /** Repeat the node for every item of the expression result. */
  for?: { in: Logic, as?: string, index?: string, key?: string }
  key?: string | number
}

export interface ComponentNode extends NodeBase {
  type: 'component'
  /** Registered component name (`UButton`, `Stack`, `BlueprintProductCard`...). */
  as: string
  /** Static props. */
  props?: Record<string, unknown>
  /** Props computed from expressions. */
  bind?: Record<string, Logic>
  /** Default slot text (string or expression). */
  content?: Logic
  /** Default slot children. */
  children?: TemplateNode[]
  /** Named slots. */
  slots?: Record<string, TemplateNode[]>
  /**
   * Two-way binding of a state path to a prop (defaults to `modelValue`).
   * The path may interpolate loop variables: `cart.lines.{index}.quantity`.
   */
  model?: string | { path: string, prop?: string }
  /** Component events mapped to actions. */
  on?: Record<string, BlueprintActions>
}

export interface HtmlNode extends NodeBase {
  /** Escape hatch: raw HTML element. Flagged as non-portable by the validator. */
  type: 'html'
  as: string
  props?: Record<string, unknown>
  bind?: Record<string, Logic>
  content?: Logic
  children?: TemplateNode[]
  on?: Record<string, BlueprintActions>
}

export interface TextNode extends NodeBase {
  type: 'text'
  content: Logic
}

export interface IfNode extends NodeBase {
  type: 'if'
  condition: Logic
  children?: TemplateNode[]
  else?: TemplateNode[]
}

export interface ForNode extends NodeBase {
  type: 'for'
  in: Logic
  as?: string
  index?: string
  /** Expression evaluated against the item, producing a stable key. */
  key?: string
  children?: TemplateNode[]
  /** Rendered when the collection is empty. */
  empty?: TemplateNode[]
}

export interface TemplateRefNode extends NodeBase {
  /** Include another template by name. */
  type: 'template'
  name: string
  /** Extra variables exposed to the included template. */
  with?: Record<string, Logic>
}

export interface OutletNode extends NodeBase {
  /** Where the current page renders inside a layout template. */
  type: 'outlet'
}

export type TemplateNode = ComponentNode | HtmlNode | TextNode | IfNode | ForNode | TemplateRefNode | OutletNode

export interface PageTemplate {
  /** Route pattern relative to the app prefix, e.g. `/product/:id`. */
  route?: string
  title?: string
  description?: string
  /** Override the document layout for this page (`false` disables it). */
  layout?: string | false
  /** Actions run when the page is entered (route or params change). */
  enter?: BlueprintActions
  children: TemplateNode[]
}

export type BlueprintTemplate = TemplateNode[] | PageTemplate

export interface BlueprintTest {
  name: string
  /** State used for the evaluation (merged over the document's initial state). */
  state?: Record<string, unknown>
  context?: Record<string, unknown>
  /** Expected definition values, compared with deep equality. */
  expect: Record<string, unknown>
}

export interface BlueprintContent {
  meta: BlueprintMeta
  resources: Record<string, BlueprintResource>
  schemas: Record<string, JsonSchema>
  definitions?: Record<string, BlueprintDefinition>
  /** Initial mutable state (the payload under construction). */
  state?: Record<string, unknown>
  actions?: Record<string, BlueprintAction | BlueprintActions>
  templates: Record<string, BlueprintTemplate>
  tests?: BlueprintTest[]
}

export interface BlueprintDocument {
  $schema?: string
  id?: string
  /** URL prefix of the application. Defaults to the file stem. */
  name: string
  from?: { blueprintId: string, message?: string }
  content: BlueprintContent
}

/** JSON Schema subset understood by the engine validator. */
export interface JsonSchema {
  type?: string | string[]
  title?: string
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  const?: unknown
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  multipleOf?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: string
  minItems?: number
  maxItems?: number
  additionalProperties?: boolean | JsonSchema
  /** Custom: human message for any failure of this schema node. */
  message?: string
  /** Custom: conditional requirement expressed in the calc notation. */
  requiredWhen?: Logic
  /** Reference to another schema of the document (`#/schemas/<name>`). */
  $ref?: string
  [key: string]: unknown
}

/** Evaluation scope: everything an expression can read. */
export interface EvalScope {
  /** Mutable state (payload). */
  state: Record<string, unknown>
  /** Route params, query, now, app name... */
  context: Record<string, unknown>
  /** Loop and action variables. */
  vars: Record<string, unknown>
}

export interface ValidationIssue {
  path: string
  message: string
}
