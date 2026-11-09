import Store from 'electron-store'
import { mergeUIState, type UIState, type UIStatePatch } from '@shared/uiState'
import { getPreferenceRoot } from './paths'

let store: Store<UIState> | null = null

function getStore(): Store<UIState> {
  if (!store) {
    store = new Store<UIState>({
      name: 'ui-state',
      cwd: getPreferenceRoot(),
      defaults: {},
    })
  }
  return store
}

export function getUIState(): UIState {
  return getStore().store
}

export function setUIState(patch: UIStatePatch): UIState {
  const next = mergeUIState(getUIState(), patch)
  getStore().store = next
  return next
}

export function getUIStatePath(): string {
  return getStore().path
}
