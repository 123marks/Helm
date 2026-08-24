import { app, BrowserWindow, Menu, session, shell, type WebContents } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { initPaths } from './paths'
import { initDatabase, closeDatabase } from './db'
import { initCrypto } from './services/crypto'
import { reconcileOrphanTasks } from './db/repositories/tasks'
import { logger } from './services/logger'
import { registerIpc } from './ipc'
import { initUpdater, scheduleStartupCheck } from './services/updater'
import { startQuotaAutoRefresh } from './services/quotaAuto'
import { migrateLegacyUserData } from './services/dataMigration'
import { repairProfileDirs } from './db/repositories/accounts'

let mainWindow: BrowserWindow | null = null

const isDev = !!process.env['ELECTRON_RENDERER_URL']

// Runs at import time, before `app.whenReady()`: Chromium regenerates
// `Local State` (which holds the safeStorage key) as the browser process boots,
// so the pre-Helm data directory has to be adopted before that happens.
const legacyMigration = (() => {
  try {
    return migrateLegacyUserData(app.getPath('userData'))
  } catch (e) {
    console.error('[app] 旧数据目录迁移失败:', e)
    return null
  }
})()

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** A self-contained dark error page used when the app cannot render normally. */
function errorPageUrl(title: string, detail: string, canRetry: boolean): string {
  const retry = canRetry
    ? '<button onclick="location.reload()">重试加载</button>'
    : ''
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; height:100vh; display:flex; align-items:center; justify-content:center;
    background:#0b0f1a; color:#e6ecff; font-family:'Segoe UI',system-ui,sans-serif; }
  .box { max-width:760px; padding:40px; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { color:#9aa7c7; margin:0 0 20px; font-size:13px; }
  pre { background:#111726; border:1px solid #232a3d; border-radius:10px; padding:16px;
    font-size:12px; line-height:1.6; white-space:pre-wrap; word-break:break-all;
    max-height:280px; overflow:auto; color:#c8d3f0; }
  button { margin-top:18px; padding:9px 18px; border:0; border-radius:8px; cursor:pointer;
    background:#6d5efc; color:#fff; font-size:13px; }
  button:hover { background:#5a4be8; }
</style></head><body><div class="box">
  <h1>⚠ ${escapeHtml(title)}</h1>
  <p>应用未能正常加载界面。下面是诊断信息，可据此排查或反馈：</p>
  <pre>${escapeHtml(detail)}</pre>
  ${retry}
</div></body></html>`
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

function createErrorWindow(title: string, detail: string): void {
  const win = new BrowserWindow({
    width: 820,
    height: 560,
    backgroundColor: '#0b0f1a',
    title: 'Helm'
  })
  void win.loadURL(errorPageUrl(title, detail, false))
  win.show()
}

function wireDiagnostics(wc: WebContents): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  let loadRetries = 0

  // A failed main-frame load used to leave an invisible window forever.
  // Now: reveal, log, and (in dev) retry the Vite URL a few times before
  // falling back to a readable error page.
  wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 /* ERR_ABORTED: normal during navigation */) return
    logger.error('app', `界面加载失败 [${errorCode}] ${errorDescription} @ ${validatedURL || '(空)'}`)
    revealWindow()
    if (devUrl && loadRetries < 25) {
      loadRetries += 1
      setTimeout(() => void wc.loadURL(devUrl), 500)
    } else {
      void wc.loadURL(
        errorPageUrl(
          '界面加载失败',
          `错误码: ${errorCode}\n描述: ${errorDescription}\n地址: ${validatedURL}`,
          true
        )
      )
    }
  })

  wc.on('render-process-gone', (_e, details) => {
    logger.error('app', `渲染进程终止: ${details.reason} (exitCode=${details.exitCode})`)
    revealWindow()
    if (details.reason !== 'clean-exit') {
      void wc.loadURL(
        errorPageUrl('渲染进程崩溃', `原因: ${details.reason}\nexitCode: ${details.exitCode}`, true)
      )
    }
  })

  wc.on('preload-error', (_e, preloadPath, error) => {
    logger.error('app', `preload 执行出错 @ ${preloadPath}: ${error.message}`)
  })

  wc.on('unresponsive', () => logger.warn('app', '界面无响应'))

  // Surface renderer-side warnings/errors into the in-app log (skip the noisy
  // DevTools-internal messages and Chromium's dev-only security notice).
  wc.on('console-message', (_e, level, message, _line, sourceId) => {
    if (sourceId.startsWith('devtools://') || sourceId.startsWith('node:electron')) return
    if (level >= 2) logger[level === 3 ? 'error' : 'warn']('renderer', message)
  })

  // F12 / Ctrl+Shift+I toggles DevTools on demand (no auto-detached window).
  wc.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return
    const key = (input.key || '').toLowerCase()
    if (key === 'f12' || (input.control && input.shift && key === 'i')) {
      wc.toggleDevTools()
    }
  })

  // Open target=_blank / window.open links in the OS browser, not inside the app.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

let revealWindow: () => void = () => {}

function resolveIcon(): string | undefined {
  const candidates = [
    join(process.cwd(), 'build', 'icon.png'),
    join(app.getAppPath(), 'build', 'icon.png'),
    join(__dirname, '../../build/icon.png'),
    join(process.cwd(), 'src/renderer/src/assets/logo.png'),
    join(app.getAppPath(), 'src/renderer/src/assets/logo.png')
  ]
  return candidates.find((p) => existsSync(p))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0f1a',
    title: 'Helm',
    icon: resolveIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  // Guarantee the window becomes visible: prefer 'ready-to-show', but never let
  // a missed event (renderer stall / load failure) leave an invisible window.
  let shown = false
  revealWindow = (): void => {
    if (shown || !mainWindow) return
    shown = true
    mainWindow.show()
    if (isDev) mainWindow.focus()
  }
  const fallbackShow = setTimeout(revealWindow, 4000)

  mainWindow.once('ready-to-show', revealWindow)
  mainWindow.on('closed', () => {
    clearTimeout(fallbackShow)
    revealWindow = () => {}
    mainWindow = null
  })

  wireDiagnostics(mainWindow.webContents)

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Lock the renderer down with a strict CSP in production. Skipped in dev
// because Vite's HMR needs 'unsafe-eval' and a websocket connection.
function applyContentSecurityPolicy(): void {
  if (isDev) return
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'"
  ].join('; ')
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] }
    })
  })
}

async function bootstrap(): Promise<void> {
  Menu.setApplicationMenu(null)
  try {
    initPaths(app.getPath('userData'))
    initCrypto()
    await initDatabase()
    if (legacyMigration) {
      logger.info(
        'app',
        `已从旧数据目录迁移：${legacyMigration.from}${
          legacyMigration.movedProfiles ? '（浏览器配置体积较大，已移动而非复制）' : '（旧目录保留为备份）'
        }`
      )
    }
    const repaired = repairProfileDirs()
    if (repaired > 0) logger.info('app', `已修正 ${repaired} 个账号的浏览器配置路径`)
    reconcileOrphanTasks()
    registerIpc(() => mainWindow)
    initUpdater()
    applyContentSecurityPolicy()
    logger.info('app', 'Helm 已启动')
  } catch (e) {
    const err = e as Error
    console.error('[app] 初始化失败:', err)
    createErrorWindow('应用初始化失败', `${err.message}\n\n${err.stack ?? ''}`)
    return
  }
  createWindow()
  scheduleStartupCheck()
  startQuotaAutoRefresh()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

// In production, prevent a second instance from clobbering the shared DB/profiles.
// (Skipped in dev so electron-vite's hot-restart is never blocked by a stale lock.)
if (!isDev && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(bootstrap).catch((e) => {
    const err = e as Error
    console.error('[app] 启动异常:', err)
    createErrorWindow('应用启动异常', `${err.message}\n\n${err.stack ?? ''}`)
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeDatabase()
    app.quit()
  }
})

// Never die silently: log crashes so they show up in the terminal / logs.
process.on('uncaughtException', (err) => {
  console.error('[app] uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[app] unhandledRejection:', reason)
})
