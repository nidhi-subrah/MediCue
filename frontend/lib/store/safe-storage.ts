import type { StateStorage } from 'zustand/middleware'

const memory = new Map<string, string>()

function canUseLocalStorage() {
  try {
    const key = '__medicue_probe__'
    window.localStorage.setItem(key, '1')
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

let useLocal: boolean | null = null

function local() {
  if (useLocal === null) useLocal = typeof window !== 'undefined' && canUseLocalStorage()
  return useLocal
}

// Sandboxed iframes and private modes can throw on localStorage access; fall back to memory so the app still runs.
export const safeStorage: StateStorage = {
  getItem: (name) => {
    if (local()) {
      try {
        return window.localStorage.getItem(name)
      } catch {}
    }
    return memory.get(name) ?? null
  },
  setItem: (name, value) => {
    memory.set(name, value)
    if (local()) {
      try {
        window.localStorage.setItem(name, value)
      } catch {}
    }
  },
  removeItem: (name) => {
    memory.delete(name)
    if (local()) {
      try {
        window.localStorage.removeItem(name)
      } catch {}
    }
  },
}

export function clearSavedData() {
  memory.clear()
  try {
    Object.keys(window.localStorage)
      .filter((k) => k.toLowerCase().includes('silentsignal') || k.startsWith('ss-'))
      .forEach((k) => window.localStorage.removeItem(k))
  } catch {}
}
