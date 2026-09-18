import { app, shell, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from 'electron'
import { join } from 'node:path'
import { readdirSync } from 'node:fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { closeDatabase, openDatabase, settingsRepo } from './db'
import { registerIpc } from './ipc'
import { applyPendingRestore, createBackup } from './services/backup'
import { initLogFile, log } from './lib/log'
import { buildAppMenu } from './menu'

let mainWindow: BrowserWindow | null = null

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0f19' : '#f7f8fa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Nothing in this app should ever navigate away from the local renderer.
  win.webContents.on('will-navigate', (event, url) => {
    const isDevServer =
      is.dev && process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)
    if (!isDevServer && !url.startsWith('file://')) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function bootstrapData(userDataPath: string): void {
  // A staged restore has to be applied before anything opens the file.
  applyPendingRestore(join(userDataPath, 'data', 'stockflow.db'))
  openDatabase(userDataPath)
}

/**
 * A snapshot once per launch, at most once a day. StockFlow has no background
 * scheduler — unlike a follow-up app there is nothing to do while it sits idle — so
 * startup is the only reliable moment to take one.
 */
function maybeBackup(userDataPath: string): void {
  const settings = settingsRepo.getAll()
  if (!settings.autoBackupEnabled) return

  const today = new Date().toISOString().slice(0, 10)
  const alreadyToday = createBackupTakenToday(userDataPath, today)
  if (alreadyToday) return
  createBackup(userDataPath, 'auto')
}

function createBackupTakenToday(userDataPath: string, today: string): boolean {
  // The filename carries the timestamp, so the check needs no extra state to persist.
  try {
    return readdirSync(join(userDataPath, 'backups')).some(
      (name) => name.startsWith(`stockflow-auto-${today}`) && name.endsWith('.db')
    )
  } catch {
    // No backups directory yet, which simply means none has been taken.
    return false
  }
}

/**
 * Everything the app does on launch, in order. Kept as one explicit function so the
 * startup sequence reads top to bottom and the bundler has an unambiguous entry point.
 */
function bootstrap(): void {
  if (!app.requestSingleInstanceLock()) {
    // Two copies writing one SQLite file is how a stock register loses entries.
    // Logging is not set up yet, so console is the only option here.
    console.log('StockFlow is already running — focusing the existing window')
    app.quit()
    return
  }

  app.on('second-instance', () => showMainWindow())

  app
    .whenReady()
    .then(() => {
      const userDataPath = app.getPath('userData')
      initLogFile(userDataPath)
      log.info('app', `StockFlow ${app.getVersion()} starting (${process.platform})`)

      electronApp.setAppUserModelId('com.stockflow.desktop')
      app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

      bootstrapData(userDataPath)
      maybeBackup(userDataPath)

      nativeTheme.themeSource = settingsRepo.getAll().theme
      registerIpc({ userDataPath, broadcast })

      ipcMain.on('theme:set', (_event, theme: 'light' | 'dark' | 'system') => {
        nativeTheme.themeSource = theme
      })

      mainWindow = createWindow()
      Menu.setApplicationMenu(buildAppMenu(() => mainWindow, broadcast))

      app.on('activate', () => showMainWindow())
    })
    .catch((err) => {
      log.error('app', 'startup failed', err)
      dialog.showErrorBox('StockFlow could not start', String(err instanceof Error ? err.message : err))
      app.exit(1)
    })

  app.on('window-all-closed', () => {
    // There is no background work to keep alive, so closing the window means done —
    // except on macOS, where the dock icon staying put is the platform convention.
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    log.info('app', 'shutting down')
    closeDatabase()
  })
}

bootstrap()
