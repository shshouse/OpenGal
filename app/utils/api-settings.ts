const API_SETTINGS_KEY = 'opengal_api_settings'

export interface ApiSettings {
  apiUrl: string
  apiKey: string
  model: string
}

const DEFAULT_SETTINGS: ApiSettings = {
  apiUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
}

export function getApiSettings(): ApiSettings {
  if (import.meta.server) return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(API_SETTINGS_KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveApiSettings(settings: ApiSettings) {
  if (import.meta.server) return
  localStorage.setItem(API_SETTINGS_KEY, JSON.stringify(settings))
}

export function isApiConfigured(): boolean {
  const s = getApiSettings()
  return s.apiUrl.length > 0 && s.apiKey.length > 0
}
