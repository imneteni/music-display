import Store from 'electron-store'
import { app } from 'electron'

/** Allowed range for the widget size multiplier. */
export const MIN_SCALE = 0.8
export const MAX_SCALE = 1.6

/** Persisted user preferences. */
export interface AppSettings {
  alwaysOnTop: boolean
  runOnStartup: boolean
  /** Widget size multiplier (1.0 = default). */
  scale: number
}

const store = new Store<AppSettings>({
  name: 'settings',
  defaults: {
    alwaysOnTop: true,
    runOnStartup: false,
    scale: 1.0
  }
})

export function getSettings(): AppSettings {
  return {
    alwaysOnTop: store.get('alwaysOnTop'),
    runOnStartup: store.get('runOnStartup'),
    scale: clampScale(store.get('scale'))
  }
}

export function setAlwaysOnTop(value: boolean): void {
  store.set('alwaysOnTop', value)
}

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1.0
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}

export function setScale(value: number): number {
  const clamped = clampScale(value)
  store.set('scale', clamped)
  return clamped
}

/**
 * Persist the "run on startup" preference and register/unregister the app as a
 * login item. On macOS and Windows this uses Electron's native login-item API.
 */
export function setRunOnStartup(value: boolean): void {
  store.set('runOnStartup', value)
  applyLoginItem(value)
}

/** Re-apply persisted settings to the OS on launch (keeps login item in sync). */
export function syncStartupWithOS(): void {
  // Only register when enabled; unsigned dev builds aren't permitted to touch
  // login items and would log a harmless "Operation not permitted" otherwise.
  if (store.get('runOnStartup')) applyLoginItem(true)
}

function applyLoginItem(openAtLogin: boolean): void {
  try {
    app.setLoginItemSettings({ openAtLogin, openAsHidden: true })
  } catch {
    // Best-effort: requires a signed app on macOS. No-op in unsigned dev runs.
  }
}
