import type { MusicApi } from './index'

declare global {
  interface Window {
    api: MusicApi
  }
}

export {}
