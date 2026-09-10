export default defineNuxtConfig({
  modules: ['blueprint-nuxt-module'],
  devtools: { enabled: true },
  compatibilityDate: 'latest',
  blueprint: {
    // One JSON document per application, at the repository root.
    dir: '../content',
  },
})
