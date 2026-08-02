import type { OpenGalAPI } from './index'

declare global {
  interface Window {
    opengal: OpenGalAPI
  }
}

export {}
