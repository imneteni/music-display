import { spawn, ChildProcessWithoutNullStreams, execFile } from 'child_process'
import { join } from 'path'
import { app } from 'electron'
import { existsSync } from 'fs'
import { EMPTY_NOW_PLAYING, MediaProvider, NowPlaying } from './types'

/**
 * Windows media provider.
 *
 * Uses the WinRT GlobalSystemMediaTransportControlsSessionManager (SMTC) via
 * bundled PowerShell helper scripts, which exposes media from any integrated
 * app or browser. Mirrors the macOS provider's line protocol so the parsing
 * logic is identical across platforms.
 */

const PS = 'powershell.exe'
const PS_ARGS_BASE = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']

/** Resolve a bundled resource script in both dev and packaged builds. */
function resourceScript(name: string): string {
  const devPath = join(app.getAppPath(), 'resources', 'windows', name)
  if (existsSync(devPath)) return devPath
  // Packaged: see electron-builder `extraResources` mapping.
  return join(process.resourcesPath, 'windows', name)
}

interface RawPayload {
  title?: string
  artist?: string
  album?: string
  artworkData?: string
  artworkMimeType?: string
  duration?: number
  elapsedTime?: number
  playing?: boolean
  timestamp?: string
  bundleIdentifier?: string
}

export class WindowsMediaProvider implements MediaProvider {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private current: RawPayload = {}
  private onUpdate: ((state: NowPlaying) => void) | null = null

  start(onUpdate: (state: NowPlaying) => void): void {
    this.onUpdate = onUpdate
    this.spawnStream()
  }

  private spawnStream(): void {
    const script = resourceScript('nowplaying-stream.ps1')
    this.child = spawn(PS, [...PS_ARGS_BASE, script], { windowsHide: true })

    this.child.stdout.on('data', (chunk: Buffer) => this.handleChunk(chunk))
    this.child.on('exit', () => {
      this.child = null
      if (this.onUpdate) setTimeout(() => this.spawnStream(), 1500)
    })
    this.child.on('error', () => this.onUpdate?.(EMPTY_NOW_PLAYING))
  }

  private handleChunk(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8')
    let i: number
    while ((i = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, i).trim()
      this.buffer = this.buffer.slice(i + 1)
      if (line) this.handleLine(line)
    }
  }

  private handleLine(line: string): void {
    let msg: { type?: string; diff?: boolean; payload?: RawPayload }
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.type !== 'data' || !msg.payload) return

    const payload = msg.payload
    const isEmpty = Object.keys(payload).length === 0
    if (msg.diff === false) {
      this.current = isEmpty ? {} : { ...payload }
    } else {
      this.current = { ...this.current, ...payload }
    }
    this.onUpdate?.(this.normalize())
  }

  private normalize(): NowPlaying {
    const c = this.current
    const hasMedia = !!(c.title || c.artist || c.bundleIdentifier)
    if (!hasMedia) return { ...EMPTY_NOW_PLAYING, timestamp: Date.now() }

    let artwork: string | null = null
    if (c.artworkData) {
      const mime = c.artworkMimeType || 'image/png'
      artwork = `data:${mime};base64,${c.artworkData}`
    }

    return {
      hasMedia: true,
      isPlaying: !!c.playing,
      title: c.title ?? '',
      artist: c.artist ?? '',
      album: c.album ?? '',
      artwork,
      duration: c.duration ?? 0,
      elapsedTime: c.elapsedTime ?? 0,
      timestamp: c.timestamp ? Date.parse(c.timestamp) : Date.now(),
      appName: c.bundleIdentifier ?? ''
    }
  }

  private runControl(command: string, position?: number): void {
    const script = resourceScript('control.ps1')
    const args = [...PS_ARGS_BASE, script, '-Command', command]
    if (position !== undefined) args.push('-Position', String(position))
    execFile(PS, args, { windowsHide: true } as object, () => {})
  }

  play(): void {
    this.runControl('play')
  }
  pause(): void {
    this.runControl('pause')
  }
  togglePlayPause(): void {
    this.runControl('toggle')
  }
  nextTrack(): void {
    this.runControl('next')
  }
  previousTrack(): void {
    this.runControl('previous')
  }
  seek(positionSeconds: number): void {
    this.runControl('seek', Math.max(0, positionSeconds))
  }

  getVolume(): Promise<number> {
    return new Promise((resolve) => {
      const script = resourceScript('volume.ps1')
      execFile(
        PS,
        [...PS_ARGS_BASE, script, '-Action', 'get'],
        { windowsHide: true } as object,
        (err, stdout) => {
          if (err) return resolve(50)
          const value = parseInt(String(stdout).trim(), 10)
          resolve(Number.isFinite(value) ? value : 50)
        }
      )
    })
  }

  setVolume(volume: number): void {
    const script = resourceScript('volume.ps1')
    const clamped = Math.round(Math.max(0, Math.min(100, volume)))
    execFile(
      PS,
      [...PS_ARGS_BASE, script, '-Action', 'set', '-Value', String(clamped)],
      { windowsHide: true } as object,
      () => {}
    )
  }

  stop(): void {
    this.onUpdate = null
    if (this.child) {
      this.child.removeAllListeners()
      this.child.kill()
      this.child = null
    }
  }
}
