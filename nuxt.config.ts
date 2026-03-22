export default defineNuxtConfig({
  modules: ['@nuxt/icon'],
  icon: {
    customCollections: [
      { prefix: 'custom', dir: './app/assets/icons' },
    ],
  },
  devtools: { enabled: true },
  vite: {
    optimizeDeps: {
      include: ['pdfjs-dist', 'mammoth'],
    },
  },
  css: ['~/assets/css/main.css'],
  postcss: {
    plugins: {
      '@tailwindcss/postcss': {},
    },
  },
})
