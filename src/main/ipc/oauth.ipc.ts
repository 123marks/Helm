import { ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc'
import type { Platform } from '@shared/types'
import {
  cancelOfficialOAuth,
  officialOAuthSnapshot,
  openAndCaptureOAuth,
  startOfficialOAuth,
  submitOfficialOAuthCallback,
  waitOfficialOAuth
} from '../services/officialOAuth'

export function registerOAuthIpc(): void {
  ipcMain.handle(IPC.oauth.start, (_e, platform: Platform) => startOfficialOAuth(platform))
  ipcMain.handle(IPC.oauth.snapshot, (_e, loginId: string) => officialOAuthSnapshot(loginId))
  ipcMain.handle(IPC.oauth.wait, (_e, loginId: string) => waitOfficialOAuth(loginId))
  ipcMain.handle(IPC.oauth.submitCallback, (_e, loginId: string, url: string) =>
    submitOfficialOAuthCallback(loginId, url)
  )
  ipcMain.handle(IPC.oauth.openCapture, (_e, loginId: string) => openAndCaptureOAuth(loginId))
  ipcMain.handle(IPC.oauth.cancel, (_e, loginId?: string) => {
    cancelOfficialOAuth(loginId)
  })
  ipcMain.handle(IPC.oauth.openUrl, async (_e, url: string) => {
    await shell.openExternal(url)
  })
}
