import { JSX, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  PrevIcon,
  NextIcon,
  PlayIcon,
  PauseIcon,
  SettingsIcon,
  CloseIcon,
  VolumeIcon,
  LoopIcon,
  ResizeGripIcon
} from './components/Icons'

const MIN_SCALE = 0.8
const MAX_SCALE = 1.6
const BASE_WIDTH = 460 // matches the main-process base window width
const SEEK_STEP = 5 // seconds, for arrow-key seeking

interface NowPlaying {
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

interface AppSettings {
  alwaysOnTop: boolean
  runOnStartup: boolean
  scale: number
}

const EMPTY: NowPlaying = {
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

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function App(): JSX.Element {
  const [state, setState] = useState<NowPlaying>(EMPTY)
  const [settings, setSettings] = useState<AppSettings>({
    alwaysOnTop: true,
    runOnStartup: false,
    scale: 1.0
  })
  const [showSettings, setShowSettings] = useState(false)
  const [volume, setVolumeState] = useState(50)
  const [scale, setScaleState] = useState(1.0)
  // Loop = repeat the current track. Enforced in the main process by seeking
  // back to the start near the end (works even where system repeat is ignored).
  const [loop, setLoop] = useState(false)

  // Live elapsed position, extrapolated locally between provider updates.
  const [displayElapsed, setDisplayElapsed] = useState(0)
  const [scrubbing, setScrubbing] = useState<number | null>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  // Latest position, kept in a ref so the keyboard handler reads fresh values.
  const posRef = useRef({ elapsed: 0, duration: 0, hasMedia: false })
  // Drag-to-resize state (anchored on the scale at the moment the drag began).
  const resizeStart = useRef<{ screenX: number; scale: number } | null>(null)

  // Subscribe to media updates + load initial settings/volume/state.
  useEffect(() => {
    const unsub = window.api.onMediaUpdate((s) => setState(s ?? EMPTY))
    window.api.getState().then((s) => s && setState(s))
    window.api.getSettings().then((s) => {
      setSettings(s)
      setScaleState(s.scale)
    })
    window.api.getVolume().then(setVolumeState)
    return unsub
  }, [])

  // Tick the displayed progress ~4x/sec while playing.
  useEffect(() => {
    const compute = (): number => {
      const base = state.elapsedTime
      const extra = state.isPlaying ? (Date.now() - state.timestamp) / 1000 : 0
      const value = base + extra
      if (state.duration > 0) return Math.min(value, state.duration)
      return Math.max(0, value)
    }
    setDisplayElapsed(compute())
    if (!state.isPlaying) return
    const id = setInterval(() => setDisplayElapsed(compute()), 250)
    return () => clearInterval(id)
  }, [state])

  const elapsed = scrubbing ?? displayElapsed
  const duration = state.duration || 0
  const progress = duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : 0
  const remaining = Math.max(0, duration - elapsed)
  posRef.current = { elapsed, duration, hasMedia: state.hasMedia }

  const seekRelative = useCallback((delta: number): void => {
    const { elapsed: cur, duration: dur, hasMedia } = posRef.current
    if (!hasMedia || dur <= 0) return
    const next = Math.min(Math.max(0, cur + delta), dur)
    window.api.seek(next)
    setState((prev) => ({ ...prev, elapsedTime: next, timestamp: Date.now() }))
  }, [])

  // Keyboard shortcuts: Space/Enter = play-pause, Left/Right = seek ±5s.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const onSlider = (e.target as HTMLElement).tagName === 'INPUT'
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault()
        window.api.control('toggle')
        return
      }
      if (onSlider) return // let arrow keys adjust a focused slider instead
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        seekRelative(SEEK_STEP)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        seekRelative(-SEEK_STEP)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [seekRelative])

  const positionFromEvent = useCallback((clientX: number): number => {
    const el = progressRef.current
    if (!el || duration <= 0) return 0
    const rect = el.getBoundingClientRect()
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return fraction * duration
  }, [duration])

  const onProgressPointerDown = (e: React.PointerEvent): void => {
    if (!state.hasMedia || duration <= 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setScrubbing(positionFromEvent(e.clientX))
  }
  const onProgressPointerMove = (e: React.PointerEvent): void => {
    if (scrubbing === null) return
    setScrubbing(positionFromEvent(e.clientX))
  }
  const onProgressPointerUp = (e: React.PointerEvent): void => {
    if (scrubbing === null) return
    const pos = positionFromEvent(e.clientX)
    window.api.seek(pos)
    // Optimistically reflect the seek until the next provider update arrives.
    setState((prev) => ({ ...prev, elapsedTime: pos, timestamp: Date.now() }))
    setScrubbing(null)
  }

  const onVolumeChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const value = Number(e.target.value)
    setVolumeState(value)
    window.api.setVolume(value)
  }

  const toggleLoop = (): void => {
    const next = !loop
    setLoop(next)
    window.api.setLoop(next)
  }

  // Resize the widget by dragging the bottom-right corner. We use screen
  // coordinates (unaffected by the page zoom) and map horizontal travel to a
  // scale change; the window stays anchored at its top-left corner.
  const onResizeDown = (e: React.PointerEvent): void => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    resizeStart.current = { screenX: e.screenX, scale }
  }
  const onResizeMove = (e: React.PointerEvent): void => {
    if (!resizeStart.current) return
    const dx = e.screenX - resizeStart.current.screenX
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, resizeStart.current.scale + dx / BASE_WIDTH))
    setScaleState(next)
    window.api.setScale(next)
  }
  const onResizeUp = (): void => {
    resizeStart.current = null
  }

  const toggleAlwaysOnTop = (): void => {
    const next = !settings.alwaysOnTop
    setSettings((s) => ({ ...s, alwaysOnTop: next }))
    window.api.setAlwaysOnTop(next)
  }
  const toggleRunOnStartup = (): void => {
    const next = !settings.runOnStartup
    setSettings((s) => ({ ...s, runOnStartup: next }))
    window.api.setRunOnStartup(next)
  }

  const disabled = !state.hasMedia

  return (
    <div className="widget">
      {!showSettings && (
        <button
          className="gear no-drag"
          title="Settings"
          onClick={() => setShowSettings(true)}
        >
          <SettingsIcon />
        </button>
      )}

      <div className="main-row">
        <div className="artwork">
          {state.artwork ? (
            <img src={state.artwork} alt="" draggable={false} />
          ) : (
            <div className="artwork-placeholder">♪</div>
          )}
        </div>

        <div className="info">
          <div className="meta">
            <Marquee className="title" text={disabled ? 'Nothing playing' : state.title} />
            <Marquee className="artist" text={disabled ? 'Open a song in any app' : state.artist} />
          </div>

          <div className="controls">
            <div className="controls-side" />
            <div className="transport">
              <button
                className="ctrl no-drag"
                disabled={disabled}
                onClick={() => window.api.control('previous')}
                title="Previous"
              >
                <PrevIcon />
              </button>
              <button
                className="ctrl play no-drag"
                disabled={disabled}
                onClick={() => window.api.control('toggle')}
                title={state.isPlaying ? 'Pause' : 'Play'}
              >
                {state.isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button
                className="ctrl no-drag"
                disabled={disabled}
                onClick={() => window.api.control('next')}
                title="Next"
              >
                <NextIcon />
              </button>
            </div>
            <div className="controls-side right">
              <button
                className={`ctrl loop no-drag ${loop ? 'active' : ''}`}
                disabled={disabled}
                onClick={toggleLoop}
                title={loop ? 'Loop current song: on' : 'Loop current song: off'}
              >
                <LoopIcon size={17} />
                {loop && <span className="loop-badge">1</span>}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="progress-row">
        <span className="time">{formatTime(elapsed)}</span>
        <div
          className="progress no-drag"
          ref={progressRef}
          onPointerDown={onProgressPointerDown}
          onPointerMove={onProgressPointerMove}
          onPointerUp={onProgressPointerUp}
        >
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
            <div className="progress-thumb" style={{ left: `${progress * 100}%` }} />
          </div>
        </div>
        <span className="time">-{formatTime(remaining)}</span>
      </div>

      <div className="volume-row">
        <span className="vol-icon">
          <VolumeIcon muted={volume === 0} />
        </span>
        <input
          className="volume no-drag"
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={onVolumeChange}
          style={{ '--vol': `${volume}%` } as React.CSSProperties}
        />
      </div>

      {showSettings && (
        <div className="settings-overlay">
          <div className="settings-header">
            <span>Settings</span>
            <button className="gear no-drag" onClick={() => setShowSettings(false)} title="Close">
              <CloseIcon />
            </button>
          </div>

          <label className="setting-row no-drag">
            <span>Always on top</span>
            <Toggle on={settings.alwaysOnTop} onClick={toggleAlwaysOnTop} />
          </label>
          <label className="setting-row no-drag">
            <span>Run on startup</span>
            <Toggle on={settings.runOnStartup} onClick={toggleRunOnStartup} />
          </label>

          <button className="quit-btn no-drag" onClick={() => window.api.close()}>
            Quit
          </button>
        </div>
      )}

      {!showSettings && (
        <div
          className="resize-handle no-drag"
          title="Drag to resize"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
        >
          <ResizeGripIcon />
        </div>
      )}
    </div>
  )
}

/**
 * Renders text that scrolls horizontally (ping-pong) only when it's too long to
 * fit its container — so long song titles / artists stay fully readable.
 */
function Marquee({ text, className }: { text: string; className: string }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLSpanElement>(null)
  const [shift, setShift] = useState(0)

  useLayoutEffect(() => {
    const measure = (): void => {
      const c = containerRef.current
      const i = innerRef.current
      if (!c || !i) return
      const overflow = i.scrollWidth - c.clientWidth
      setShift(overflow > 2 ? overflow : 0)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [text])

  const scrolling = shift > 0
  // Slower for longer text; gives time to read both ends.
  const duration = Math.max(5, shift / 22 + 4)

  return (
    <div className={`marquee ${className} ${scrolling ? 'scrolling' : ''}`} ref={containerRef}>
      <span
        ref={innerRef}
        className="marquee-inner"
        style={
          scrolling
            ? ({ '--shift': `-${shift + 6}px`, animationDuration: `${duration}s` } as React.CSSProperties)
            : undefined
        }
      >
        {text}
      </span>
    </div>
  )
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      className={`toggle ${on ? 'on' : ''}`}
      role="switch"
      aria-checked={on}
      onClick={onClick}
    >
      <span className="knob" />
    </button>
  )
}
