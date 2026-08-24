import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { AccountInput } from '@shared/types'
import * as repo from '../db/repositories/accounts'
import { exportEncrypted, importData } from '../services/backup'
import { requireUnlocked } from '../services/lock'
import { syncSessionAfterSave } from '../services/sessionSync'
import { scheduleQuotaSync } from '../services/quotaAuto'

export function registerAccountsIpc(): void {
  ipcMain.handle(IPC.accounts.list, () => repo.listAccounts())
  ipcMain.handle(IPC.accounts.get, (_e, id: string) => repo.getAccount(id))
  ipcMain.handle(IPC.accounts.create, async (_e, input: AccountInput) => {
    const acc = repo.createAccount(input)
    await syncSessionAfterSave(acc.id)
    // A brand new account has no quota yet; pull it in the background so the
    // card fills itself in instead of waiting for a manual refresh.
    scheduleQuotaSync(acc.id)
    return repo.getAccount(acc.id) ?? acc
  })
  ipcMain.handle(IPC.accounts.update, async (_e, id: string, patch: Partial<AccountInput>) => {
    const acc = repo.updateAccount(id, patch)
    if (patch.refreshToken !== undefined || patch.customFields !== undefined) {
      await syncSessionAfterSave(id)
      scheduleQuotaSync(id)
    }
    return repo.getAccount(id) ?? acc
  })
  ipcMain.handle(IPC.accounts.remove, (_e, id: string) => repo.softDeleteAccount(id))
  ipcMain.handle(IPC.accounts.listDeleted, () => repo.listDeletedAccounts())
  ipcMain.handle(IPC.accounts.restore, (_e, id: string) => repo.restoreAccount(id))
  ipcMain.handle(IPC.accounts.purge, (_e, id: string) => repo.deleteAccount(id))
  ipcMain.handle(IPC.accounts.purgeDeleted, () => ({ purged: repo.purgeDeletedAccounts() }))
  ipcMain.handle(IPC.accounts.reveal, (_e, id: string) => {
    requireUnlocked()
    return repo.revealSecrets(id)
  })
  ipcMain.handle(IPC.accounts.exportAll, () => {
    requireUnlocked()
    return repo.exportAll()
  })
  ipcMain.handle(IPC.accounts.exportSelected, (_e, ids: string[]) => {
    requireUnlocked()
    return repo.exportAll(ids)
  })
  ipcMain.handle(IPC.accounts.exportEncrypted, (_e, password: string) => {
    requireUnlocked()
    return exportEncrypted(password)
  })
  ipcMain.handle(IPC.accounts.importJson, (_e, json: string, password?: string) => ({
    imported: importData(json, password)
  }))
  ipcMain.handle(IPC.accounts.passwordHistory, (_e, accountId: string) =>
    repo.listPasswordHistory(accountId)
  )
  ipcMain.handle(IPC.accounts.revealPasswordHistory, (_e, historyId: number) => {
    requireUnlocked()
    return repo.revealPasswordHistory(historyId)
  })
  ipcMain.handle(IPC.accounts.restorePassword, (_e, accountId: string, historyId: number) =>
    repo.restorePassword(accountId, historyId)
  )
}
