import { create } from 'zustand'
import type { AppSettings, ChromeInfo } from '@shared/types'
import { api } from '@renderer/lib/api'

export type Page =
  | 'dashboard'
  | 'cockpit'
  | 'accounts'
  | 'security'
  | '2fa'
  | 'automation'
  | 'providers'
  | 'logs'
  | 'settings'

interface AppState {
  page: Page
  setPage: (p: Page) => void
  commandOpen: boolean
  setCommandOpen: (v: boolean) => void
  detailAccountId: string | null
  openDetail: (id: string) => void
  closeDetail: () => void
  settings: AppSettings | null
  chrome: ChromeInfo | null
  cryptoOk: boolean
  init: () => Promise<void>
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>
  refreshChrome: () => Promise<void>
  registerPrefillInboxIds: string[]
  openRegisterWithInboxes: (ids: string[]) => void
  clearRegisterPrefill: () => void
}

export const useAppStore = create<AppState>((set) => ({
  page: 'dashboard',
  setPage: (p) => set({ page: p }),
  commandOpen: false,
  setCommandOpen: (v) => set({ commandOpen: v }),
  detailAccountId: null,
  openDetail: (id) => set({ detailAccountId: id }),
  closeDetail: () => set({ detailAccountId: null }),
  settings: null,
  chrome: null,
  cryptoOk: true,
  init: async () => {
    const [settings, chrome, cryptoOk] = await Promise.all([
      api.settings.get(),
      api.system.detectChrome(),
      api.system.cryptoAvailable()
    ])
    set({ settings, chrome, cryptoOk })
  },
  saveSettings: async (patch) => {
    const settings = await api.settings.set(patch)
    set({ settings })
  },
  refreshChrome: async () => {
    set({ chrome: await api.system.detectChrome() })
  },
  registerPrefillInboxIds: [],
  openRegisterWithInboxes: (ids) => set({ page: 'accounts', registerPrefillInboxIds: ids }),
  clearRegisterPrefill: () => set({ registerPrefillInboxIds: [] })
}))
