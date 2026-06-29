/**
 * Shared types for the cross-platform media bridge.
 *
 * A "provider" knows how to observe and control the system's currently playing
 * media, regardless of which app or website is producing it. Each platform
 * (macOS, Windows) implements the same {@link MediaProvider} contract so the
 * rest of the app never needs to care which OS it is running on.
 */

/** A normalized snapshot of whatever is currently playing on the system. */
export interface NowPlaying {
  /** Whether anything is currently being tracked at all. */
  hasMedia: boolean
  /** True when media is actively playing (as opposed to paused). */
  isPlaying: boolean
  title: string
  artist: string
  album: string
  /** Data URL (e.g. `data:image/jpeg;base64,...`) or null when no artwork. */
  artwork: string | null
  /** Track length in seconds (0 if unknown). */
  duration: number
  /**
   * Elapsed playback position in seconds at the moment {@link timestamp} was
   * captured. The renderer extrapolates from here using `isPlaying` so the
   * progress bar advances smoothly without constant polling.
   */
  elapsedTime: number
  /** Epoch milliseconds when `elapsedTime` was sampled. */
  timestamp: number
  /** Identifier of the source app (e.g. `com.apple.Music`), when known. */
  appName: string
}

/** A media provider observes and controls system media for one platform. */
export interface MediaProvider {
  /** Begin emitting updates. `onUpdate` is called on every state change. */
  start(onUpdate: (state: NowPlaying) => void): void
  /** Stop emitting updates and release any child processes. */
  stop(): void
  play(): void
  pause(): void
  togglePlayPause(): void
  nextTrack(): void
  previousTrack(): void
  /** Seek to an absolute position in seconds. */
  seek(positionSeconds: number): void
  /** Read system output volume as 0..100. */
  getVolume(): Promise<number>
  /** Set system output volume (0..100). */
  setVolume(volume: number): void
}

/** The empty state used before any media is detected. */
export const EMPTY_NOW_PLAYING: NowPlaying = {
  hasMedia: false,
  isPlaying: false,
  title: '',
  artist: '',
  album: '',
  artwork: null,
  duration: 0,
  elapsedTime: 0,
  timestamp: Date.now(),
  appName: ''
}
