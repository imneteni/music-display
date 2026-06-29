import { platform } from 'os'
import { MediaProvider } from './types'
import { MacMediaProvider } from './macos'
import { WindowsMediaProvider } from './windows'

export * from './types'

/** Returns the media provider implementation for the current platform. */
export function createMediaProvider(): MediaProvider {
  switch (platform()) {
    case 'darwin':
      return new MacMediaProvider()
    case 'win32':
      return new WindowsMediaProvider()
    default:
      // Linux and others aren't supported yet; return a no-op provider so the
      // UI still renders an "idle" state instead of crashing.
      return new NoopMediaProvider()
  }
}

class NoopMediaProvider implements MediaProvider {
  start(): void {}
  stop(): void {}
  play(): void {}
  pause(): void {}
  togglePlayPause(): void {}
  nextTrack(): void {}
  previousTrack(): void {}
  seek(): void {}
  async getVolume(): Promise<number> {
    return 50
  }
  setVolume(): void {}
}
