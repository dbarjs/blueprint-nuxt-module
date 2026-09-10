import blueprintModule from '../../../src/module'

export default defineNuxtConfig({
  modules: [blueprintModule],
  compatibilityDate: 'latest',
  blueprint: { dir: 'content' },
})
