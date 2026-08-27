// Centralized IPC channel names. Both main (ipcMain.handle) and preload use these.

export const IPC = {
  accounts: {
    list: 'accounts:list',
    get: 'accounts:get',
    create: 'accounts:create',
    update: 'accounts:update',
    remove: 'accounts:remove',
    reveal: 'accounts:reveal',
    exportAll: 'accounts:exportAll',
    exportSelected: 'accounts:exportSelected',
    exportEncrypted: 'accounts:exportEncrypted',
    importJson: 'accounts:importJson',
    passwordHistory: 'accounts:password-history',
    revealPasswordHistory: 'accounts:reveal-password-history',
    restorePassword: 'accounts:restore-password',
    listDeleted: 'accounts:list-deleted',
    restore: 'accounts:restore',
    purge: 'accounts:purge',
    purgeDeleted: 'accounts:purge-deleted'
  },
  security: {
    audit: 'security:audit',
    checkBreaches: 'security:checkBreaches'
  },
  providers: {
    list: 'providers:list',
    save: 'providers:save',
    remove: 'providers:remove',
    setDefault: 'providers:setDefault',
    test: 'providers:test',
    peekMails: 'providers:peek-mails',
    peekAccountInbox: 'providers:peek-account-inbox',
    useAccountAsMailbox: 'providers:use-account-as-mailbox',
    listInboxes: 'providers:list-inboxes',
    peekGeneratedInbox: 'providers:peek-generated-inbox',
    removeInbox: 'providers:remove-inbox',
    removeInboxes: 'providers:remove-inboxes',
    generateInboxes: 'providers:generate-inboxes',
    updateInboxes: 'providers:update-inboxes'
  },
  outlookPool: {
    list: 'outlook-pool:list',
    stats: 'outlook-pool:stats',
    import: 'outlook-pool:import',
    remove: 'outlook-pool:remove',
    purgeDead: 'outlook-pool:purge-dead',
    updateMeta: 'outlook-pool:update-meta',
    test: 'outlook-pool:test',
    keepalive: 'outlook-pool:keepalive',
    export: 'outlook-pool:export',
    claim: 'outlook-pool:claim'
  },
  totp: {
    get: 'totp:get',
    preview: 'totp:preview',
    parseUri: 'totp:parseUri'
  },
  automation: {
    actions: 'automation:actions',
    enqueue: 'automation:enqueue',
    cancel: 'automation:cancel',
    tasks: 'automation:tasks',
    delete: 'automation:delete',
    clear: 'automation:clear',
    retry: 'automation:retry',
    registerBatch: 'automation:registerBatch',
    prepareRegister: 'automation:prepare-register',
    confirmRegister: 'automation:confirm-register',
    registerPlatforms: 'automation:registerPlatforms',
    oauthPlatforms: 'automation:oauth-platforms',
    registerOauth: 'automation:register-oauth',
    launchProfile: 'automation:launch-profile',
    checkProxy: 'automation:check-proxy',
    exportCookies: 'automation:export-cookies',
    importCookies: 'automation:import-cookies',
    refreshQuota: 'automation:refresh-quota',
    refreshQuotas: 'automation:refresh-quotas',
    quotaHistory: 'automation:quota-history',
    revalidate: 'automation:revalidate',
    captureSession: 'automation:capture-session',
    applyLocal: 'automation:apply-local',
    syncLocal: 'automation:sync-local',
    taskUpdated: 'automation:task-updated',
    quotaUpdated: 'automation:quota-updated'
  },
  logs: {
    query: 'logs:query',
    clear: 'logs:clear',
    new: 'logs:new'
  },
  settings: {
    get: 'settings:get',
    set: 'settings:set'
  },
  lock: {
    status: 'lock:status',
    set: 'lock:set',
    verify: 'lock:verify',
    disable: 'lock:disable',
    setAuto: 'lock:set-auto',
    lockNow: 'lock:lock-now'
  },
  system: {
    detectChrome: 'system:detect-chrome',
    openPath: 'system:open-path',
    revealProfile: 'system:reveal-profile',
    openDataDir: 'system:open-data-dir',
    openLogDir: 'system:open-log-dir',
    saveFile: 'system:save-file',
    cryptoAvailable: 'system:crypto-available'
  },
  updater: {
    status: 'updater:status',
    check: 'updater:check',
    download: 'updater:download',
    install: 'updater:install',
    changed: 'updater:changed'
  },
  oauth: {
    start: 'oauth:start',
    snapshot: 'oauth:snapshot',
    wait: 'oauth:wait',
    submitCallback: 'oauth:submit-callback',
    cancel: 'oauth:cancel',
    openUrl: 'oauth:open-url'
  },
  sms: {
    rent: 'sms:rent',
    waitCode: 'sms:wait-code',
    cancel: 'sms:cancel',
    list: 'sms:list',
    services: 'sms:services'
  }
} as const
