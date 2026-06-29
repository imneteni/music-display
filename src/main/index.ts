import { app, shell, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import Store from 'electron-store'
import { createMediaProvider, NowPlaying } from './media'
import {
  getSettings,
  setAlwaysOnTop,
  setRunOnStartup,
  setScale,
  syncStartupWithOS
} from './settings'

const isDev = !app.isPackaged

// Base widget dimensions (CSS pixels) at scale 1.0. The actual window size is
// BASE * scale, and the renderer is zoomed by the same factor so the layout
// scales crisply. The settings panel overlays the same window.
const BASE_WIDTH = 460
const BASE_HEIGHT = 232
// SVG is kept as the source artwork, but Electron's native icon APIs need
// raster/native formats at runtime.
const RUNTIME_ICON_FILES = ['icon.png', 'icon.icns'] as const

// Persisted window position so the widget reopens where the user left it.
const windowStore = new Store<{ x?: number; y?: number }>({ name: 'window' })

const mediaProvider = createMediaProvider()
let mainWindow: BrowserWindow | null = null
let lastState: NowPlaying | null = null

// Local "repeat one" enforcement. System repeat commands are ignored by most
// web players (YouTube Music, etc.), so instead we watch the position and seek
// back to the start just before the track ends — which works for any source
// where seeking works.
let loopEnabled = false
let lastLoopSeekAt = 0

function getAppIconPath(): string | undefined {
  const candidates = app.isPackaged
    ? RUNTIME_ICON_FILES.map((file) => join(process.resourcesPath, file))
    : RUNTIME_ICON_FILES.map((file) => join(app.getAppPath(), 'build', file))

  return candidates.find((path) => existsSync(path))
}

function applyDockIcon(): void {
  if (process.platform !== 'darwin') return

  const iconPath = getAppIconPath()
  if (!iconPath) return

  try {
    app.dock.setIcon(iconPath)
  } catch {
    // SVG is kept as the source asset, but Electron's Dock API only accepts
    // raster/native image formats. A bad icon should never prevent startup.
  }
}

function checkLoop(): void {
  if (!loopEnabled || !lastState || !lastState.isPlaying || lastState.duration <= 0) return
  const extrapolated = lastState.elapsedTime + (Date.now() - lastState.timestamp) / 1000
  if (extrapolated >= lastState.duration - 0.8 && Date.now() - lastLoopSeekAt > 2500) {
    lastLoopSeekAt = Date.now()
    mediaProvider.seek(0)
    // Optimistically reset so we don't re-trigger before the provider reports.
    lastState = { ...lastState, elapsedTime: 0, timestamp: Date.now() }
  }
}

function createWindow(): void {
  const settings = getSettings()
  const iconPath = getAppIconPath()
  const winWidth = Math.round(BASE_WIDTH * settings.scale)
  const winHeight = Math.round(BASE_HEIGHT * settings.scale)

  // Default to the top-right corner of the primary display, like a HUD widget.
  const { workArea } = screen.getPrimaryDisplay()
  const defaultX = workArea.x + workArea.width - winWidth - 24
  const defaultY = workArea.y + 24

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: windowStore.get('x', defaultX),
    y: windowStore.get('y', defaultY),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    hasShadow: true,
    show: false,
    alwaysOnTop: settings.alwaysOnTop,
    skipTaskbar: false,
    title: 'Music Display',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  if (settings.alwaysOnTop) {
    mainWindow.setAlwaysOnTop(true, 'floating')
  }

  // Apply the persisted size multiplier as a crisp page zoom.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.setZoomFactor(settings.scale)
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.webContents.setZoomFactor(settings.scale)
    mainWindow?.show()
  })

  // Persist position whenever the user drags the widget.
  const savePosition = (): void => {
    if (!mainWindow) return
    const [x, y] = mainWindow.getPosition()
    windowStore.set('x', x)
    windowStore.set('y', y)
  }
  mainWindow.on('moved', savePosition)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function sendState(state: NowPlaying): void {
  lastState = state
  mainWindow?.webContents.send('media:update', state)
}

function registerIpc(): void {
  // Playback controls coming from the renderer.
  ipcMain.on('media:control', (_e, action: string) => {
    switch (action) {
      case 'play':
        return mediaProvider.play()
      case 'pause':
        return mediaProvider.pause()
      case 'toggle':
        return mediaProvider.togglePlayPause()
      case 'next':
        return mediaProvider.nextTrack()
      case 'previous':
        return mediaProvider.previousTrack()
    }
  })

  ipcMain.on('media:seek', (_e, seconds: number) => mediaProvider.seek(seconds))
  ipcMain.on('media:setVolume', (_e, value: number) => mediaProvider.setVolume(value))
  ipcMain.handle('media:getVolume', () => mediaProvider.getVolume())

  // Renderer can ask for the current snapshot on mount.
  ipcMain.handle('media:getState', () => lastState)

  // Settings.
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.on('settings:setAlwaysOnTop', (_e, value: boolean) => {
    setAlwaysOnTop(value)
    if (mainWindow) {
      mainWindow.setAlwaysOnTop(value, value ? 'floating' : 'normal')
    }
  })
  ipcMain.on('settings:setRunOnStartup', (_e, value: boolean) => setRunOnStartup(value))
  ipcMain.handle('settings:setScale', (_e, value: number) => applyScale(value))

  // Loop (repeat-one) toggle, enforced locally — see checkLoop().
  ipcMain.on('media:setLoop', (_e, on: boolean) => {
    loopEnabled = on
  })

  // Window chrome (frameless window needs explicit close/minimize).
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:close', () => app.quit())
}

/**
 * Resize the widget to the given size multiplier, zoom the page to match, and
 * keep the window centered on its previous position (clamped to the display).
 * Returns the actually-applied (clamped) scale.
 */
function applyScale(value: number): number {
  const scale = setScale(value)
  if (!mainWindow) return scale

  const newW = Math.round(BASE_WIDTH * scale)
  const newH = Math.round(BASE_HEIGHT * scale)

  // Anchor the top-left corner (natural for dragging the bottom-right corner)
  // while keeping the window within the current display.
  const [x, y] = mainWindow.getPosition()
  const { workArea } = screen.getDisplayNearestPoint({ x, y })
  let newX = Math.min(x, workArea.x + workArea.width - newW)
  let newY = Math.min(y, workArea.y + workArea.height - newH)
  newX = Math.max(newX, workArea.x)
  newY = Math.max(newY, workArea.y)

  mainWindow.setBounds({ x: newX, y: newY, width: newW, height: newH })
  mainWindow.webContents.setZoomFactor(scale)
  windowStore.set('x', newX)
  windowStore.set('y', newY)
  return scale
}

app.whenReady().then(() => {
  app.setName('Music Display')
  applyDockIcon()
  syncStartupWithOS()
  registerIpc()
  createWindow()

  // Begin observing system media and forward every update to the renderer.
  mediaProvider.start(sendState)

  // Drive the local loop enforcement.
  setInterval(checkLoop, 300)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  mediaProvider.stop()
  app.quit()
})

app.on('before-quit', () => mediaProvider.stop())
