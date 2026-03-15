export default defineNuxtConfig({
  compatibilityDate: '2025-05-01',
  future: {
    compatibilityVersion: 4
  },
  modules: ['@nuxt/icon'],
  icon: {
    customCollections: [
      { prefix: 'custom', dir: './app/assets/icons' },
    ],
  },
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  postcss: {
    plugins: {
      '@tailwindcss/postcss': {},
    },
  },
})
