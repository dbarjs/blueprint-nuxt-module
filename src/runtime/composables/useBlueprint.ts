import { computed, effectScope, markRaw, onMounted, reactive, shallowRef, watch, type ComputedRef, type Ref } from 'vue'
import { useNuxtApp, useRouter, useRuntimeConfig, useState } from '#app'
import { useToast } from '#imports'
import type { BlueprintActions, BlueprintDocument, EvalScope, Logic } from '../engine/types'
import { createEvaluator, type Evaluator } from '../engine/logic'
import { runActions, type ActionEffects, type ActionResult } from '../engine/actions'
import { evaluateTemplate, isPageTemplate, resolvePage, routeOf, type AbstractNode, type ResolvedPage } from '../engine/template'
import { deepClone, deepMerge, getPath, setPath } from '../engine/path'
import { hashDocument } from '../engine/hash'

export interface BlueprintRuntime {
  app: string
  document: BlueprintDocument
  /** Content hash of the canonical document — the version records pin. */
  version: string
  evaluator: Evaluator
  /** Reactive mutable state (the payload under construction). */
  state: Record<string, unknown>
  initialState: Record<string, unknown>
  context: Ref<Record<string, unknown>>
  page: ComputedRef<ResolvedPage | null>
  /** Public definitions evaluated against the current state. */
  definitions: ComputedRef<Record<string, unknown>>
  scope: (vars?: Record<string, unknown>) => EvalScope
  evaluate: (logic: Logic, vars?: Record<string, unknown>) => unknown
  run: (actions: BlueprintActions, vars?: Record<string, unknown>) => Promise<ActionResult>
  /** Abstract tree of the current page wrapped in its layout. */
  tree: ComputedRef<AbstractNode[]>
  /** Resolve an app-relative path (`/cart`) or page name (`page:cart`) to a router path. */
  href: (to: string, params?: Record<string, unknown>) => string
  busy: Ref<boolean>
}

interface RuntimeRegistry {
  [app: string]: BlueprintRuntime
}

const STORAGE_PREFIX = 'blueprint:state:'

/**
 * Per-app runtime: evaluator, reactive state, actions and the abstract tree
 * of the current page. Created once per document and shared by every page
 * of the app (so the cart survives navigation). State is persisted in
 * localStorage on the client.
 */
export function useBlueprint(document: BlueprintDocument): BlueprintRuntime {
  const nuxtApp = useNuxtApp()
  const registry = ((nuxtApp as unknown as { _blueprints?: RuntimeRegistry })._blueprints ||= {})
  const version = hashDocument(document)
  const existing = registry[document.name]
  if (existing && existing.version === version) return existing
  // Everything reactive lives in a detached scope: the runtime outlives the
  // page component that created it.
  const router = useRouter()
  const host: RuntimeHost = {
    // The live route, not `useRoute()`: inside a page that returns a snapshot
    // frozen for the page instance, and the runtime outlives the instance.
    route: router.currentRoute,
    router,
    config: useRuntimeConfig().public.blueprint as { prefix: string },
    toast: useToast() as RuntimeHost['toast'],
    stateRef: useState<Record<string, unknown>>(`blueprint:state:${document.name}`, () => deepClone(document.content.state || {})),
  }
  const effects = effectScope(true)
  const runtime = effects.run(() => createRuntime(document, version, host))!
  registry[document.name] = runtime
  if (import.meta.client) onMounted(() => runtime.restore())
  return runtime
}

interface RuntimeHost {
  route: ReturnType<typeof useRouter>['currentRoute']
  router: ReturnType<typeof useRouter>
  config: { prefix: string }
  toast: { add: (toast: { title: string, description?: string, color?: string, icon?: string }) => void }
  stateRef: Ref<Record<string, unknown>>
}

function createRuntime(document: BlueprintDocument, version: string, host: RuntimeHost): BlueprintRuntime & { restore: () => void } {
  const app = document.name
  const { route, router, config } = host
  const evaluator = markRaw(createEvaluator(document))
  const initialState = deepClone(document.content.state || {})
  const state = reactive(host.stateRef.value)
  const busy = shallowRef(false)

  const slugPath = computed(() => {
    const slug = route.value.params.slug
    const parts = Array.isArray(slug) ? slug : (slug ? [slug] : [])
    return '/' + parts.filter(Boolean).join('/')
  })
  const page = computed(() => route.value.params.app === app ? resolvePage(document, slugPath.value) : null)
  const context = computed(() => ({
    app,
    version,
    base: `${config.prefix}/${app}`,
    path: slugPath.value,
    params: page.value?.params || {},
    query: { ...route.value.query },
    page: page.value?.name || null,
    busy: busy.value,
  }))

  const scope = (vars: Record<string, unknown> = {}): EvalScope => ({ state, context: context.value, vars })
  const evaluate = (logic: Logic, vars?: Record<string, unknown>) => evaluator.evaluate(logic, scope(vars))
  const definitions = computed(() => evaluator.definitions(scope(), false))

  const href = (to: string, params: Record<string, unknown> = {}): string => {
    let path = to
    if (to.startsWith('page:')) {
      const template = document.content.templates[to]
      path = isPageTemplate(template) ? routeOf(to, template) : '/'
    }
    if (/^https?:\/\//.test(path)) return path
    path = path.replace(/:(\w+)/g, (_match, name: string) => encodeURIComponent(String(params[name] ?? '')))
    const base = `${config.prefix}/${app}`
    return path === '/' ? base : `${base}${path.startsWith('/') ? path : `/${path}`}`
  }

  const effects: ActionEffects = {
    navigate: async (to, params, query) => {
      await router.push({ path: href(to, params), query: query as Record<string, string> })
    },
    toast: (toast) => {
      host.toast.add({ title: toast.title, description: toast.description, color: toast.color || 'primary', icon: toast.icon })
    },
    submit: async ({ endpoint, body, schema }) => {
      const url = endpoint || `/api/blueprint/${app}/records`
      return await $fetch(url, {
        method: 'POST',
        body: { schema, data: body, createdUnder: { document: app, version } },
      })
    },
    log: value => console.log('[blueprint]', value),
    onMutate: () => persist(),
  }

  const run = async (actions: BlueprintActions, vars: Record<string, unknown> = {}) => {
    busy.value = true
    try {
      return await runActions(actions, { evaluator, state, context: context.value, initialState, effects }, vars)
    }
    finally {
      busy.value = false
    }
  }

  const tree = computed<AbstractNode[]>(() => {
    const current = page.value
    if (!current) return []
    const pageScope = scope()
    const pageTree = evaluateTemplate(evaluator, current.name, pageScope)
    const layout = current.template.layout === false ? undefined : (current.template.layout || document.content.meta.layout)
    if (!layout) return pageTree
    return evaluateTemplate(evaluator, layout, scope({ page: current.name, pageTitle: current.template.title || '' }), { outlet: pageTree })
  })

  // ---- persistence (client only) -------------------------------------------
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  const storageKey = `${STORAGE_PREFIX}${app}`
  const persist = () => {
    if (!import.meta.client) return
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ version, state }))
      }
      catch { /* storage may be unavailable */ }
    }, 150)
  }
  let restored = false
  const restore = () => {
    if (restored || !import.meta.client) return
    restored = true
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const saved = JSON.parse(raw) as { version: string, state: Record<string, unknown> }
        // A new document version starts from its own initial state; only
        // keep what the user was building if the document has not changed.
        if (saved.version === version && saved.state) deepMerge(state, saved.state)
      }
    }
    catch { /* ignore corrupted storage */ }
    watch(() => JSON.stringify(state), persist)
  }

  return {
    app,
    document,
    version,
    evaluator,
    state,
    initialState,
    context,
    page,
    definitions,
    scope,
    evaluate,
    run,
    tree,
    href,
    busy,
    restore,
  }
}

/** Convenience for Vue components that receive a state path. */
export function useBlueprintModel(runtime: BlueprintRuntime, path: string) {
  return computed({
    get: () => getPath(runtime.state, path),
    set: value => setPath(runtime.state, path, value),
  })
}
