import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import {
  addComponentsDir,
  addImportsDir,
  addServerHandler,
  addTemplate,
  createResolver,
  defineNuxtModule,
  extendPages,
  hasNuxtModule,
  useLogger,
} from '@nuxt/kit'
import { join, resolve } from 'pathe'
import type { NuxtModule } from '@nuxt/schema'
import { formatReport, loadDocuments, prerenderRoutes, reportDocument, type LoadedDocument } from './build/documents'
import { contentConfigTemplate, cssTemplate, documentSchemaTemplate, layersOf, manifestTemplate, registryTemplate, runtimeSchemaTemplate, type ComponentInfo } from './build/artifacts'
import { RUNTIME_COMPONENT_NAMES } from './runtime/engine/registry'
import { resolveContract, storageNames, type RuntimeContract } from './runtime/engine/contract'

export interface ModuleOptions {
  /** Directory holding one Blueprint document per app (relative to rootDir). */
  dir: string
  /** URL prefix prepended to every app (`''` → `/<app>`). */
  prefix: string
  /** Opt-in prefix for app-specific components exposed to documents. */
  componentPrefix: string
  /** Validate documents at build time and fail on errors. */
  validate: boolean
  /** Run the tests carried by each document at build time. */
  tests: boolean
  /** Register the `/api/blueprint/*` routes: built-in records, the contract, and the endpoints documents write. */
  api: boolean
  /** Default storage backend for document collections (`memory`, `fs`, `sqlite`). */
  storage: 'memory' | 'fs' | 'sqlite'
  /** Directory for `fs` records and `sqlite` databases (relative to rootDir). */
  dataDir: string
  /** Options forwarded to `@nuxt/ui`. */
  ui: Record<string, unknown>
  /** Options forwarded to `@nuxt/content`. */
  content: Record<string, unknown>
}

const module: NuxtModule<ModuleOptions> = defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'blueprint-nuxt-module',
    configKey: 'blueprint',
    version: '1.0.0',
  },
  defaults: {
    dir: 'content',
    prefix: '',
    componentPrefix: 'Blueprint',
    validate: true,
    tests: true,
    api: true,
    storage: 'fs',
    dataDir: '.data/blueprint',
    ui: {},
    content: {},
  },
  // Nuxt installs dependencies (and their own dependencies: @nuxt/icon,
  // @nuxt/fonts, @nuxtjs/color-mode, @nuxtjs/mdc) right after this module.
  moduleDependencies(nuxt): Record<string, { defaults?: Record<string, unknown> }> {
    const options = (nuxt.options as unknown as { blueprint?: Partial<ModuleOptions> }).blueprint || {}
    // Node 22.5+ ships `node:sqlite`; prefer it so no native build is needed.
    const hasNodeSqlite = Boolean(globalThis.process?.getBuiltinModule?.('node:sqlite'))
    return {
      '@nuxt/ui': { defaults: options.ui || {} },
      '@nuxt/content': {
        defaults: {
          ...(options.content || {}),
          experimental: {
            ...(hasNodeSqlite ? { sqliteConnector: 'native' } : {}),
            ...((options.content?.experimental as Record<string, unknown> | undefined) || {}),
          },
        },
      },
    }
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const logger = useLogger('blueprint')
    const runtimeDir = resolver.resolve('./runtime')
    const contentDir = resolve(nuxt.options.rootDir, options.dir)
    const prefix = options.prefix.replace(/\/$/, '')

    // ---- runtime config ----------------------------------------------------
    nuxt.options.runtimeConfig.public.blueprint = {
      prefix,
      apps: [] as Array<{ name: string, title: string, description: string, icon: string }>,
    }
    nuxt.options.alias['#blueprint'] = runtimeDir
    nuxt.options.build.transpile.push(runtimeDir)

    // ---- styles: Tailwind + Nuxt UI + sources outside the app root ---------
    const css = addTemplate({
      filename: 'blueprint/main.css',
      write: true,
      // Absolute paths: the client receives this stylesheet as a virtual
      // module, where relative `@source` paths have nothing to resolve against.
      getContents: () => cssTemplate([contentDir, resolver.resolve('./runtime/components')]),
    })
    nuxt.options.css.push(css.dst)

    // ---- Nuxt Content: register the `blueprints` data collection -----------
    // Content reads `content.config` from every layer. The module contributes a
    // generated layer that exists only until every module has been set up.
    if (hasNuxtModule('@nuxt/content', nuxt)) {
      logger.warn('@nuxt/content was installed before blueprint-nuxt-module; list blueprint-nuxt-module first or add the `blueprints` collection to content.config.ts with defineBlueprintCollection().')
    }
    else {
      const layerDir = join(nuxt.options.rootDir, 'node_modules/.cache/blueprint-nuxt-module/layer')
      await mkdir(layerDir, { recursive: true })
      await writeFile(join(layerDir, 'content.config.mjs'), contentConfigTemplate(contentDir))
      const syntheticLayer = { cwd: layerDir, config: { rootDir: layerDir, srcDir: layerDir } }
      const layers = nuxt.options._layers as Array<(typeof nuxt.options._layers)[number]>
      layers.push(syntheticLayer as (typeof nuxt.options._layers)[number])
      nuxt.hook('modules:done', () => {
        const index = layers.indexOf(syntheticLayer as (typeof nuxt.options._layers)[number])
        if (index >= 0) layers.splice(index, 1)
      })
    }

    // ---- runtime pieces --------------------------------------------------------
    addImportsDir(resolver.resolve('./runtime/composables'))
    addComponentsDir({ path: resolver.resolve('./runtime/components'), pathPrefix: false, prefix: '', global: false })

    extendPages((pages) => {
      pages.unshift({
        name: 'blueprint-app',
        path: `${prefix}/:app()/:slug(.*)*`,
        file: resolver.resolve('./runtime/pages/app.vue'),
      })
      if (!prefix) {
        pages.unshift({
          name: 'blueprint-index',
          path: '/',
          file: resolver.resolve('./runtime/pages/blueprint-apps.vue'),
        })
      }
    })

    // ---- runtime: storage + endpoints ------------------------------------------
    if (!storageNames().includes(options.storage)) {
      throw new Error(`[blueprint] storage "${options.storage}" is not provided by this runtime (available: ${storageNames().join(', ')})`)
    }
    const dataDir = resolve(nuxt.options.rootDir, options.dataDir)
    // The effective contract: static capabilities plus what only this host
    // knows. Its component layers are filled in place once the registry is
    // scanned (`components:extend`). Nitro clones the runtime config when it
    // initializes, so the filled contract is handed over again right before
    // the server bundle is built: `GET /api/blueprint/contract` then serves
    // the same contract the documents were validated against.
    const contract = resolveContract(undefined, { prefix, defaultStorage: options.storage })
    nuxt.options.runtimeConfig.blueprint = { storage: options.storage, dataDir, contract }
    nuxt.hook('nitro:build:before', (nitro) => {
      const config = nitro.options.runtimeConfig as { blueprint?: Record<string, unknown> }
      config.blueprint = { ...config.blueprint, contract }
    })
    if (options.api) {
      nuxt.options.nitro.storage ||= {}
      nuxt.options.nitro.storage.blueprint ||= { driver: 'fs', base: dataDir }
      addServerHandler({ route: '/api/blueprint/contract', method: 'get', handler: resolver.resolve('./runtime/server/api/blueprint/contract.get') })
      addServerHandler({ route: '/api/blueprint/:app/records', method: 'post', handler: resolver.resolve('./runtime/server/api/blueprint/[app]/records.post') })
      addServerHandler({ route: '/api/blueprint/:app/records', method: 'get', handler: resolver.resolve('./runtime/server/api/blueprint/[app]/records.get') })
      addServerHandler({ route: '/api/blueprint/:app/records/:id', method: 'get', handler: resolver.resolve('./runtime/server/api/blueprint/[app]/records/[id].get') })
      // Endpoints written in documents: everything else under the app.
      addServerHandler({ route: '/api/blueprint/:app/**', handler: resolver.resolve('./runtime/server/api/blueprint/[app]/[...path]') })
    }

    // ---- registry + manifest + schema (generated in .nuxt/blueprint) --------
    const components: ComponentInfo[] = []
    const registryTpl = addTemplate({
      filename: 'blueprint/registry.mjs',
      write: true,
      getContents: () => registryTemplate(components),
    })
    nuxt.options.alias['#blueprint/registry'] = registryTpl.dst
    addTemplate({ filename: 'blueprint/manifest.json', write: true, getContents: () => manifestTemplate(components, '1.0.0', contract) })
    addTemplate({ filename: 'blueprint/schema.json', write: true, getContents: () => documentSchemaTemplate(contract) })
    addTemplate({ filename: 'blueprint/runtime.schema.json', write: true, getContents: () => runtimeSchemaTemplate(contract) })

    // ---- documents ---------------------------------------------------------------
    let documents: LoadedDocument[] = []
    const apps = nuxt.options.runtimeConfig.public.blueprint.apps
    const refreshApps = () => {
      // Mutate in place: the array is already referenced by the runtime config.
      apps.splice(0, apps.length, ...documents
        .filter(loaded => !loaded.parseError)
        .map(loaded => ({
          name: loaded.document.name,
          title: loaded.document.content.meta?.title || loaded.document.name,
          description: loaded.document.content.meta?.description || '',
          icon: loaded.document.content.meta?.icon || '',
        })))
    }
    documents = await loadDocuments(contentDir)
    refreshApps()

    const validateAll = async (failOnError: boolean) => {
      documents = await loadDocuments(contentDir)
      refreshApps()
      if (!options.validate) return
      let failed = false
      for (const loaded of documents) {
        const report = reportDocument(loaded, contract.client.components, options.tests, contract)
        const lines = formatReport(report)
        if (report.ok) logger.success(lines.join('\n'))
        else {
          failed = true
          logger.error(lines.join('\n'))
        }
      }
      if (documents.length === 0) logger.warn(`no Blueprint documents found in ${contentDir}`)
      if (failed && failOnError) throw new Error('[blueprint] invalid document(s); see the report above')
    }

    nuxt.hook('components:extend', async (all) => {
      components.length = 0
      for (const component of all) {
        if (component.mode === 'server' || component.pascalName.startsWith('Lazy')) continue
        const filePath = component.filePath || ''
        if (filePath.includes('/@nuxt/ui/')) components.push({ pascalName: component.pascalName, filePath, layer: 'nuxtUi' })
        else if (filePath.startsWith(runtimeDir) && RUNTIME_COMPONENT_NAMES.includes(component.pascalName)) components.push({ pascalName: component.pascalName, filePath, layer: 'runtime' })
        else if (component.pascalName.startsWith(options.componentPrefix) && !filePath.startsWith(runtimeDir)) components.push({ pascalName: component.pascalName, filePath, layer: 'app' })
      }
      const { base, nuxtUi, app } = layersOf(components)
      Object.assign(contract.client.components, { base, nuxtUi, app })
      await validateAll(!nuxt.options.dev)
    })

    if (nuxt.options.dev) {
      nuxt.hook('builder:watch', async (_event, path) => {
        const absolute = resolve(nuxt.options.srcDir, path)
        if (absolute.startsWith(contentDir)) await validateAll(false)
      })
      if (!nuxt.options.watch.includes(contentDir)) nuxt.options.watch.push(contentDir)
    }

    nuxt.hook('prerender:routes', ({ routes }) => {
      for (const route of prerenderRoutes(documents, prefix)) routes.add(route)
      if (!prefix) routes.add('/')
    })

    if (!existsSync(contentDir)) logger.warn(`Blueprint content directory not found: ${contentDir}`)
  },
})

export default module

declare module '@nuxt/schema' {
  interface PublicRuntimeConfig {
    blueprint: {
      prefix: string
      apps: Array<{ name: string, title: string, description: string, icon: string }>
    }
  }
  interface RuntimeConfig {
    blueprint: {
      storage: string
      dataDir: string
      /** Effective runtime contract, served by `GET /api/blueprint/contract`. */
      contract: RuntimeContract
    }
  }
}
