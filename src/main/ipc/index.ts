import type { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import { setLogEmitter } from '../services/logger'
import { setTaskEmitter } from '../automation/engine'
import { registerAccountsIpc } from './accounts.ipc'
import { registerTotpIpc } from './totp.ipc'
import { registerAutomationIpc } from './automation.ipc'
import { registerLogsIpc } from './logs.ipc'
import { registerSettingsIpc } from './settings.ipc'
import { registerSystemIpc } from './system.ipc'
import { registerSecurityIpc } from './security.ipc'
import { registerProvidersIpc } from './providers.ipc'
import { registerOutlookPoolIpc } from './outlookPool.ipc'
import { registerLockIpc } from './lock.ipc'
import { registerSmsIpc } from './sms.ipc'
import { registerUpdaterIpc } from './updater.ipc'
import { registerOAuthIpc } from './oauth.ipc'
import { setUpdateEmitter } from '../services/updater'

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  registerAccountsIpc()
  registerOAuthIpc()
  registerTotpIpc()
  registerAutomationIpc()
  registerLogsIpc()
  registerSettingsIpc()
  registerSystemIpc(getWindow)
  registerSecurityIpc()
  registerProvidersIpc()
  registerOutlookPoolIpc()
  registerLockIpc()
  registerSmsIpc()
  registerUpdaterIpc()

  setLogEmitter((entry) => {
    getWindow()?.webContents.send(IPC.logs.new, entry)
  })
  setTaskEmitter((task) => {
    getWindow()?.webContents.send(IPC.automation.taskUpdated, task)
  })
  setUpdateEmitter((status) => {
    getWindow()?.webContents.send(IPC.updater.changed, status)
  })
}
