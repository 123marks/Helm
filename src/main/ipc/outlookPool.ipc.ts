import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { requireUnlocked } from '../services/lock'
import {
  claimOutlookAccounts,
  exportOutlookPool,
  importOutlookPool,
  keepaliveOutlookPool,
  listOutlookPool,
  outlookPoolStats,
  purgeDeadOutlookPool,
  removeOutlookPool,
  testOutlookPoolItem,
  updateOutlookPoolMeta
} from '../services/outlookPool'

export function registerOutlookPoolIpc(): void {
  ipcMain.handle(IPC.outlookPool.list, () => listOutlookPool())
  ipcMain.handle(IPC.outlookPool.stats, () => outlookPoolStats())
  ipcMain.handle(IPC.outlookPool.import, (_e, text: string) => importOutlookPool(text))
  ipcMain.handle(IPC.outlookPool.remove, (_e, ids: string[]) => removeOutlookPool(ids))
  ipcMain.handle(IPC.outlookPool.purgeDead, () => purgeDeadOutlookPool())
  ipcMain.handle(IPC.outlookPool.updateMeta, (_e, ids: string[], patch: { tags?: string[]; notes?: string }) =>
    updateOutlookPoolMeta(ids, patch)
  )
  ipcMain.handle(IPC.outlookPool.test, (_e, id: string) => testOutlookPoolItem(id))
  ipcMain.handle(IPC.outlookPool.keepalive, (_e, limit?: number) => keepaliveOutlookPool(limit))
  ipcMain.handle(IPC.outlookPool.export, (_e, ids: string[] | undefined, sixSegment: boolean) => {
    requireUnlocked()
    return exportOutlookPool(ids, sixSegment)
  })
  ipcMain.handle(IPC.outlookPool.claim, (_e, count: number) => claimOutlookAccounts(count))
}
