import { contextBridge, ipcRenderer } from 'electron'

/** Shape of a now-playing snapshot as seen by the renderer. */
export interface NowPlaying {
  hasMedia: boolean
  isPlaying: boolean
  title: string
  artist: string
  album: string
  artwork: string | null
  duration: number
  elapsedTime: number
  timestamp: number
  appName: string
}

export interface AppSettings {
  alwaysOnTop: boolean
  runOnStartup: boolean
  scale: number
}

export type MediaControl = 'play' | 'pause' | 'toggle' | 'next' | 'previous'

const api = {
  /** Subscribe to live now-playing updates. Returns an unsubscribe function. */
  onMediaUpdate(callback: (state: NowPlaying) => void): () => void {
    const listener = (_e: unknown, state: NowPlaying): void => callback(state)
    ipcRenderer.on('media:update', listener)
    return () => ipcRenderer.removeListener('media:update', listener)
  },
  getState(): Promise<NowPlaying | null> {
    return ipcRenderer.invoke('media:getState')
  },
  control(action: MediaControl): void {
    ipcRenderer.send('media:control', action)
  },
  seek(seconds: number): void {
    ipcRenderer.send('media:seek', seconds)
  },
  setLoop(on: boolean): void {
    ipcRenderer.send('media:setLoop', on)
  },
  getVolume(): Promise<number> {
    return ipcRenderer.invoke('media:getVolume')
  },
  setVolume(value: number): void {
    ipcRenderer.send('media:setVolume', value)
  },
  getSettings(): Promise<AppSettings> {
    return ipcRenderer.invoke('settings:get')
  },
  setAlwaysOnTop(value: boolean): void {
    ipcRenderer.send('settings:setAlwaysOnTop', value)
  },
  setRunOnStartup(value: boolean): void {
    ipcRenderer.send('settings:setRunOnStartup', value)
  },
  setScale(value: number): Promise<number> {
    return ipcRenderer.invoke('settings:setScale', value)
  },
  minimize(): void {
    ipcRenderer.send('window:minimize')
  },
  close(): void {
    ipcRenderer.send('window:close')
  }
}

contextBridge.exposeInMainWorld('api', api)

export type MusicApi = typeof api
