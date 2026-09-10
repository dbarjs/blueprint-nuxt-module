/**
 * Materializer: abstract tree → Vue vnodes through the lazy registry.
 *
 * This is the whole "Vue factory": a recursive function that turns each
 * abstract node into `h(registry[name], props, slots)`. Everything that
 * needed a decision (loops, conditions, bindings) was settled during
 * evaluation; only framework wiring happens here.
 */
import { createTextVNode, defineComponent, h, type PropType, type VNode, type VNodeChild, Fragment } from 'vue'
import { resolveRegistered } from '#blueprint/registry'
import type { AbstractNode } from '../engine/template'
import type { BlueprintRuntime } from '../composables/useBlueprint'
import { getPath, setPath } from '../engine/path'
import { toStandardSchema } from '../engine/schema'

export const BlueprintTree = defineComponent({
  name: 'BlueprintTree',
  props: {
    nodes: { type: Array as PropType<AbstractNode[]>, required: true },
    runtime: { type: Object as PropType<BlueprintRuntime>, required: true },
  },
  setup(props) {
    return () => h(Fragment, renderNodes(props.nodes, props.runtime))
  },
})

export default BlueprintTree

export function renderNodes(nodes: AbstractNode[], runtime: BlueprintRuntime): VNodeChild[] {
  return nodes.map(node => renderNode(node, runtime))
}

function renderNode(node: AbstractNode, runtime: BlueprintRuntime): VNodeChild {
  if (node.kind === 'text') return createTextVNode(node.text || '')
  if (node.kind === 'unavailable') return unavailable(node)

  const props: Record<string, unknown> = { ...(node.props || {}), key: node.key }
  wireEvents(node, props, runtime)

  if (node.kind === 'html') {
    return h(node.as || 'div', props, node.children ? renderNodes(node.children, runtime) : undefined)
  }

  const component = resolveRegistered(node.as || '')
  if (!component) return missing(node)

  wireModel(node, props, runtime)
  wireSpecialProps(node, props, runtime)

  const slots: Record<string, () => VNodeChild[]> = {}
  if (node.children?.length) slots.default = () => renderNodes(node.children!, runtime)
  for (const [name, children] of Object.entries(node.slots || {})) {
    slots[name] = () => renderNodes(children, runtime)
  }
  return h(component, props, slots)
}

function wireEvents(node: AbstractNode, props: Record<string, unknown>, runtime: BlueprintRuntime) {
  for (const [event, handler] of Object.entries(node.on || {})) {
    const key = `on${event.charAt(0).toUpperCase()}${event.slice(1)}`
    props[key] = (...args: unknown[]) => {
      const payload = args[0] as { data?: unknown, preventDefault?: () => void } | undefined
      if (event === 'submit' && payload && typeof payload.preventDefault === 'function' && !('data' in payload)) payload.preventDefault()
      return runtime.run(handler.actions, {
        ...handler.vars,
        $event: payload,
        $data: payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload,
      })
    }
  }
}

function wireModel(node: AbstractNode, props: Record<string, unknown>, runtime: BlueprintRuntime) {
  if (!node.model) return
  const { path, prop } = node.model
  props[prop] = getPath(runtime.state, path)
  props[`onUpdate:${prop}`] = (value: unknown) => setPath(runtime.state, path, value)
}

/** Document-aware props: `schema` and `state` on forms resolve to engine objects. */
function wireSpecialProps(node: AbstractNode, props: Record<string, unknown>, runtime: BlueprintRuntime) {
  const name = node.as
  if (name === 'UForm' || name === 'Form') {
    if (typeof props.schema === 'string') {
      const schema = runtime.document.content.schemas[props.schema]
      props.schema = schema
        ? toStandardSchema(schema, { document: runtime.document, evaluator: runtime.evaluator, scope: runtime.scope() })
        : undefined
    }
    if (typeof props.state === 'string') {
      const path = props.state
      let target = getPath(runtime.state, path)
      if (!target || typeof target !== 'object') {
        target = {}
        setPath(runtime.state, path, target)
        target = getPath(runtime.state, path)
      }
      props.state = target
    }
  }
  // The base `Progress` speaks `value`; Nuxt UI's bar reads `modelValue`.
  // Without the mapping the bar has no value and animates as indeterminate.
  if ((name === 'Progress' || name === 'UProgress') && props.value !== undefined && props.modelValue === undefined) {
    props.modelValue = props.value
    delete props.value
  }
  // `to` is app-relative (`/cart`, `page:cart`) unless `external` is set;
  // `endpoint:<name>` links to a document endpoint (always external).
  if (typeof props.to === 'string') {
    if (props.to.startsWith('endpoint:')) {
      props.to = runtime.href(props.to)
      props.external = true
    }
    else if (props.external !== true && (props.to.startsWith('/') || props.to.startsWith('page:'))) {
      props.to = runtime.href(props.to)
    }
  }
}

/** A component with no fallback on a runtime without its vocabulary: shown, never hidden (ADR 0026). */
function unavailable(node: AbstractNode): VNode {
  return h('div', {
    key: node.key,
    class: 'rounded border border-dashed border-warning p-2 text-xs text-warning',
  }, `"${node.as}" is unavailable here (${node.capability}); the document has no fallback for it`)
}

function missing(node: AbstractNode): VNode {
  return h('div', {
    key: node.key,
    class: 'rounded border border-dashed border-error p-2 text-xs text-error',
  }, `Unknown component "${node.as}" (not registered)`)
}
