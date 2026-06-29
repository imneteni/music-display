import { spawn, ChildProcessWithoutNullStreams, execFile } from 'child_process'
import { existsSync } from 'fs'
import { EMPTY_NOW_PLAYING, MediaProvider, NowPlaying } from './types'

/**
 * macOS media provider.
 *
 * Built on top of the `media-control` CLI (https://github.com/ungive/media-control),
 * which uses the mediaremote-adapter technique to keep working on macOS 15.4+
 * (including macOS 26), where Apple locked down direct MediaRemote access.
 *
 * - Live updates come from `media-control stream` (newline-delimited JSON).
 * - Playback is controlled with one-shot `media-control <command>` calls.
 * - System output volume is read/written via `osascript` (AppleScript).
 */

// Common install locations. GUI-launched apps inherit a minimal PATH that
// usually excludes Homebrew, so we resolve an absolute path up front.
const CANDIDATE_PATHS = [
  '/opt/homebrew/bin/media-control', // Apple Silicon Homebrew
  '/usr/local/bin/media-control', // Intel Homebrew
  '/usr/bin/media-control'
]

function resolveMediaControl(): string {
  for (const p of CANDIDATE_PATHS) {
    if (existsSync(p)) return p
  }
  return 'media-control' // fall back to PATH lookup
}

// Ensure child processes can find Homebrew + system binaries regardless of how
// the Electron app was launched.
const SPAWN_ENV = {
  ...process.env,
  PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ''}`
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

export class MacMediaProvider implements MediaProvider {
  private bin = resolveMediaControl()
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  /** Running merged state, since the stream sends partial diffs. */
  private current: RawPayload = {}
  private onUpdate: ((state: NowPlaying) => void) | null = null

  start(onUpdate: (state: NowPlaying) => void): void {
    this.onUpdate = onUpdate
    this.spawnStream()
  }

  private spawnStream(): void {
    this.child = spawn(this.bin, ['stream'], { env: SPAWN_ENV })

    this.child.stdout.on('data', (chunk: Buffer) => this.handleChunk(chunk))

    // If the stream dies (e.g. transient error), restart it after a short delay
    // so the widget keeps tracking media for the lifetime of the app.
    this.child.on('exit', () => {
      this.child = null
      if (this.onUpdate) setTimeout(() => this.spawnStream(), 1500)
    })
    this.child.on('error', () => {
      // Binary missing or not executable; surface an empty state.
      this.onUpdate?.(EMPTY_NOW_PLAYING)
    })
  }

  private handleChunk(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8')
    let newlineIndex: number
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)
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
      // Full snapshot: replace state entirely. An empty payload means
      // "nothing is playing / media was dismissed".
      this.current = isEmpty ? {} : { ...payload }
    } else {
      // Partial diff: merge into the running state.
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
      const mime = c.artworkMimeType || 'image/jpeg'
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

  private run(args: string[]): void {
    execFile(this.bin, args, { env: SPAWN_ENV }, () => {
      /* fire and forget */
    })
  }

  play(): void {
    this.run(['play'])
  }
  pause(): void {
    this.run(['pause'])
  }
  togglePlayPause(): void {
    this.run(['toggle-play-pause'])
  }
  nextTrack(): void {
    this.run(['next-track'])
  }
  previousTrack(): void {
    this.run(['previous-track'])
  }
  seek(positionSeconds: number): void {
    this.run(['seek', String(Math.max(0, positionSeconds))])
  }

  getVolume(): Promise<number> {
    return new Promise((resolve) => {
      execFile(
        'osascript',
        ['-e', 'output volume of (get volume settings)'],
        { env: SPAWN_ENV },
        (err, stdout) => {
          if (err) return resolve(50)
          const value = parseInt(stdout.trim(), 10)
          resolve(Number.isFinite(value) ? value : 50)
        }
      )
    })
  }

  setVolume(volume: number): void {
    const clamped = Math.round(Math.max(0, Math.min(100, volume)))
    execFile('osascript', ['-e', `set volume output volume ${clamped}`], { env: SPAWN_ENV }, () => {
      /* fire and forget */
    })
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
