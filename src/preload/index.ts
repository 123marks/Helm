import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { Api, AutomationTask, LogEntry, QuotaSyncEvent, UpdateStatus } from '@shared/types'

const api: Api = {
  accounts: {
    list: () => ipcRenderer.invoke(IPC.accounts.list),
    get: (id) => ipcRenderer.invoke(IPC.accounts.get, id),
    create: (input) => ipcRenderer.invoke(IPC.accounts.create, input),
    update: (id, input) => ipcRenderer.invoke(IPC.accounts.update, id, input),
    remove: (id) => ipcRenderer.invoke(IPC.accounts.remove, id),
    reveal: (id) => ipcRenderer.invoke(IPC.accounts.reveal, id),
    exportAll: () => ipcRenderer.invoke(IPC.accounts.exportAll),
    exportSelected: (ids) => ipcRenderer.invoke(IPC.accounts.exportSelected, ids),
    exportEncrypted: (password) => ipcRenderer.invoke(IPC.accounts.exportEncrypted, password),
    importJson: (json, password) => ipcRenderer.invoke(IPC.accounts.importJson, json, password),
    passwordHistory: (accountId) => ipcRenderer.invoke(IPC.accounts.passwordHistory, accountId),
    revealPasswordHistory: (historyId) =>
      ipcRenderer.invoke(IPC.accounts.revealPasswordHistory, historyId),
    restorePassword: (accountId, historyId) =>
      ipcRenderer.invoke(IPC.accounts.restorePassword, accountId, historyId),
    listDeleted: () => ipcRenderer.invoke(IPC.accounts.listDeleted),
    restore: (id) => ipcRenderer.invoke(IPC.accounts.restore, id),
    purge: (id) => ipcRenderer.invoke(IPC.accounts.purge, id),
    purgeDeleted: () => ipcRenderer.invoke(IPC.accounts.purgeDeleted)
  },
  security: {
    audit: () => ipcRenderer.invoke(IPC.security.audit),
    checkBreaches: () => ipcRenderer.invoke(IPC.security.checkBreaches)
  },
  providers: {
    list: (type) => ipcRenderer.invoke(IPC.providers.list, type),
    save: (input) => ipcRenderer.invoke(IPC.providers.save, input),
    remove: (id) => ipcRenderer.invoke(IPC.providers.remove, id),
    setDefault: (id) => ipcRenderer.invoke(IPC.providers.setDefault, id),
    test: (id) => ipcRenderer.invoke(IPC.providers.test, id),
    peekMails: (providerId) => ipcRenderer.invoke(IPC.providers.peekMails, providerId),
    peekAccountInbox: (accountId) => ipcRenderer.invoke(IPC.providers.peekAccountInbox, accountId),
    useAccountAsMailbox: (accountId) => ipcRenderer.invoke(IPC.providers.useAccountAsMailbox, accountId),
    listInboxes: () => ipcRenderer.invoke(IPC.providers.listInboxes),
    peekGeneratedInbox: (id) => ipcRenderer.invoke(IPC.providers.peekGeneratedInbox, id),
    removeInbox: (id) => ipcRenderer.invoke(IPC.providers.removeInbox, id),
    removeInboxes: (ids) => ipcRenderer.invoke(IPC.providers.removeInboxes, ids),
    generateInboxes: (count) => ipcRenderer.invoke(IPC.providers.generateInboxes, count),
    updateInboxes: (ids, patch) => ipcRenderer.invoke(IPC.providers.updateInboxes, ids, patch)
  },
  outlookPool: {
    list: () => ipcRenderer.invoke(IPC.outlookPool.list),
    stats: () => ipcRenderer.invoke(IPC.outlookPool.stats),
    import: (text) => ipcRenderer.invoke(IPC.outlookPool.import, text),
    remove: (ids) => ipcRenderer.invoke(IPC.outlookPool.remove, ids),
    purgeDead: () => ipcRenderer.invoke(IPC.outlookPool.purgeDead),
    updateMeta: (ids, patch) => ipcRenderer.invoke(IPC.outlookPool.updateMeta, ids, patch),
    test: (id) => ipcRenderer.invoke(IPC.outlookPool.test, id),
    keepalive: (limit) => ipcRenderer.invoke(IPC.outlookPool.keepalive, limit),
    export: (ids, sixSegment) => ipcRenderer.invoke(IPC.outlookPool.export, ids, sixSegment),
    claim: (count) => ipcRenderer.invoke(IPC.outlookPool.claim, count)
  },
  totp: {
    get: (id) => ipcRenderer.invoke(IPC.totp.get, id),
    preview: (secret) => ipcRenderer.invoke(IPC.totp.preview, secret),
    parseUri: (uri) => ipcRenderer.invoke(IPC.totp.parseUri, uri)
  },
  automation: {
    actions: (platform) => ipcRenderer.invoke(IPC.automation.actions, platform),
    enqueue: (req) => ipcRenderer.invoke(IPC.automation.enqueue, req),
    cancel: (taskId) => ipcRenderer.invoke(IPC.automation.cancel, taskId),
    tasks: () => ipcRenderer.invoke(IPC.automation.tasks),
    delete: (taskId) => ipcRenderer.invoke(IPC.automation.delete, taskId),
    clear: () => ipcRenderer.invoke(IPC.automation.clear),
    retry: (taskId) => ipcRenderer.invoke(IPC.automation.retry, taskId),
    registerPlatforms: () => ipcRenderer.invoke(IPC.automation.registerPlatforms),
    registerBatch: (platform, count) => ipcRenderer.invoke(IPC.automation.registerBatch, platform, count),
    prepareRegister: (input) => ipcRenderer.invoke(IPC.automation.prepareRegister, input),
    confirmRegister: (platform, drafts) =>
      ipcRenderer.invoke(IPC.automation.confirmRegister, platform, drafts),
    oauthPlatforms: () => ipcRenderer.invoke(IPC.automation.oauthPlatforms),
    registerOauth: (platform, sourceAccountIds, oauthProvider) =>
      ipcRenderer.invoke(IPC.automation.registerOauth, platform, sourceAccountIds, oauthProvider),
    launchProfile: (accountId, url) => ipcRenderer.invoke(IPC.automation.launchProfile, accountId, url),
    checkProxy: (accountId) => ipcRenderer.invoke(IPC.automation.checkProxy, accountId),
    exportCookies: (accountId) => ipcRenderer.invoke(IPC.automation.exportCookies, accountId),
    importCookies: (accountId, json) => ipcRenderer.invoke(IPC.automation.importCookies, accountId, json),
    refreshQuota: (accountId) => ipcRenderer.invoke(IPC.automation.refreshQuota, accountId),
    refreshQuotas: (accountIds) => ipcRenderer.invoke(IPC.automation.refreshQuotas, accountIds),
    quotaHistory: (days) => ipcRenderer.invoke(IPC.automation.quotaHistory, days),
    revalidate: (accountIds) => ipcRenderer.invoke(IPC.automation.revalidate, accountIds),
    captureSession: (accountId) => ipcRenderer.invoke(IPC.automation.captureSession, accountId),
    applyLocal: (accountId) => ipcRenderer.invoke(IPC.automation.applyLocal, accountId),
    syncLocal: () => ipcRenderer.invoke(IPC.automation.syncLocal),
    onTaskUpdated: (cb) => {
      const listener = (_e: IpcRendererEvent, task: AutomationTask): void => cb(task)
      ipcRenderer.on(IPC.automation.taskUpdated, listener)
      return () => ipcRenderer.removeListener(IPC.automation.taskUpdated, listener)
    },
    onQuotaUpdated: (cb) => {
      const listener = (_e: IpcRendererEvent, event: QuotaSyncEvent): void => cb(event)
      ipcRenderer.on(IPC.automation.quotaUpdated, listener)
      return () => ipcRenderer.removeListener(IPC.automation.quotaUpdated, listener)
    }
  },
  oauth: {
    start: (platform) => ipcRenderer.invoke(IPC.oauth.start, platform),
    snapshot: (loginId) => ipcRenderer.invoke(IPC.oauth.snapshot, loginId),
    wait: (loginId) => ipcRenderer.invoke(IPC.oauth.wait, loginId),
    submitCallback: (loginId, url) => ipcRenderer.invoke(IPC.oauth.submitCallback, loginId, url),
    cancel: (loginId) => ipcRenderer.invoke(IPC.oauth.cancel, loginId),
    openUrl: (url) => ipcRenderer.invoke(IPC.oauth.openUrl, url)
  },
  logs: {
    query: (filter) => ipcRenderer.invoke(IPC.logs.query, filter),
    clear: () => ipcRenderer.invoke(IPC.logs.clear),
    onNew: (cb) => {
      const listener = (_e: IpcRendererEvent, entry: LogEntry): void => cb(entry)
      ipcRenderer.on(IPC.logs.new, listener)
      return () => ipcRenderer.removeListener(IPC.logs.new, listener)
    }
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settings.get),
    set: (patch) => ipcRenderer.invoke(IPC.settings.set, patch)
  },
  lock: {
    status: () => ipcRenderer.invoke(IPC.lock.status),
    set: (pin, autoLockMinutes) => ipcRenderer.invoke(IPC.lock.set, pin, autoLockMinutes),
    verify: (pin) => ipcRenderer.invoke(IPC.lock.verify, pin),
    disable: (pin) => ipcRenderer.invoke(IPC.lock.disable, pin),
    setAuto: (minutes) => ipcRenderer.invoke(IPC.lock.setAuto, minutes),
    lockNow: () => ipcRenderer.invoke(IPC.lock.lockNow)
  },
  system: {
    detectChrome: () => ipcRenderer.invoke(IPC.system.detectChrome),
    openPath: (p) => ipcRenderer.invoke(IPC.system.openPath, p),
    revealProfile: (accountId) => ipcRenderer.invoke(IPC.system.revealProfile, accountId),
    openDataDir: () => ipcRenderer.invoke(IPC.system.openDataDir),
    openLogDir: () => ipcRenderer.invoke(IPC.system.openLogDir),
    saveFile: (defaultName, content) => ipcRenderer.invoke(IPC.system.saveFile, defaultName, content),
    cryptoAvailable: () => ipcRenderer.invoke(IPC.system.cryptoAvailable)
  },
  updater: {
    status: () => ipcRenderer.invoke(IPC.updater.status),
    check: () => ipcRenderer.invoke(IPC.updater.check),
    download: () => ipcRenderer.invoke(IPC.updater.download),
    install: () => ipcRenderer.invoke(IPC.updater.install),
    onChanged: (cb) => {
      const listener = (_e: IpcRendererEvent, status: UpdateStatus): void => cb(status)
      ipcRenderer.on(IPC.updater.changed, listener)
      return () => ipcRenderer.removeListener(IPC.updater.changed, listener)
    }
  },
  sms: {
    rent: (opts) => ipcRenderer.invoke(IPC.sms.rent, opts),
    waitCode: (rentalId, timeoutMs) => ipcRenderer.invoke(IPC.sms.waitCode, rentalId, timeoutMs),
    cancel: (rentalId) => ipcRenderer.invoke(IPC.sms.cancel, rentalId),
    list: () => ipcRenderer.invoke(IPC.sms.list),
    services: (country) => ipcRenderer.invoke(IPC.sms.services, country)
  }
}

contextBridge.exposeInMainWorld('api', api)
