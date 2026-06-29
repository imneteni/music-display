# Music Display

A small cross-platform desktop widget that shows what you're currently listening
to — from **any app or website** — and lets you control it: play/pause, next,
previous, scrub the timeline, and adjust system volume.

![widget](docs/preview.png)

## Features

- 🎵 Live now-playing display (title, artist, album art) for any media source
  (Spotify, Apple Music, YouTube Music in a browser, etc.)
- ⏯️ Play / pause, ⏭️ next, ⏮️ previous, and a draggable progress/seek bar
- 🔁 **Loop** the current song — enforced by the app (works even where the
  source ignores a system "repeat" command, e.g. YouTube Music)
- 🔊 System volume control bar
- 📐 **Size** slider (80%–160%) to scale the whole widget
- 📌 **Always on top** toggle
- 🚀 **Run on startup** toggle
- 🪟 Frameless, draggable HUD-style window that remembers its position

### Keyboard shortcuts (when the widget is focused)

| Key | Action |
| --- | --- |
| `Space` / `Enter` | Play / pause |
| `→` | Seek forward 5s |
| `←` | Seek back 5s |

## How media detection works

Media is read at the OS level, so it works regardless of which app/website is
playing:

| Platform | Mechanism |
| --- | --- |
| **macOS** | The [`media-control`](https://github.com/ungive/media-control) CLI (mediaremote-adapter), which keeps working on macOS 15.4+ / macOS 26 where Apple locked down direct MediaRemote access. |
| **Windows** | WinRT `GlobalSystemMediaTransportControlsSessionManager` (SMTC) via bundled PowerShell helper scripts. |

### macOS prerequisite

The macOS build relies on the `media-control` CLI. Install it once with Homebrew:

```bash
brew install media-control
```

## Development

```bash
npm install
npm run dev        # launch the app with hot reload
npm run typecheck  # type-check main + renderer
```

## Packaging into a real app (.dmg / .exe)

The app is packaged with [electron-builder](https://www.electron.build/). The SVG
source artwork lives at `build/icon.svg`; Electron's Dock/window APIs use the
transparent raster/native icon generated from that artwork because they cannot
load SVG directly.

### macOS (.dmg) — build on a Mac

```bash
npm run dist:mac
```

Output lands in `dist/`:

- `Music Display-<version>-arm64.dmg` — the installer (double-click, drag to Applications)
- `Music Display-<version>-arm64-mac.zip` — zipped `.app`

> **Gatekeeper:** the build is **unsigned**, so the first launch shows
> "unidentified developer". Right-click the app → **Open** → **Open**, or run
> `xattr -dr com.apple.quarantine "/Applications/Music Display.app"`. For a
> store-grade build you'd add an Apple Developer certificate (signing + notarization).
>
> **Runtime dependency:** the Mac app reads media via the `media-control` CLI, so
> the target machine needs `brew install media-control`. (To ship a fully
> self-contained `.dmg` with no Homebrew requirement, the CLI can be bundled into
> the app — ask if you want that.)

### Windows (.exe) — build on Windows

```bash
npm run dist:win
```

Produces `dist/Music Display Setup <version>.exe` (NSIS installer). Building a
Windows `.exe` must be done **on a Windows machine** (cross-building from macOS
needs Wine and is unreliable) — or use CI below.

### Build both automatically with GitHub Actions (recommended)

`.github/workflows/build.yml` builds the **.dmg and .exe** on GitHub's macOS and
Windows runners — no Windows machine needed:

1. Push this repo to GitHub.
2. **Actions** tab → **Build installers** → **Run workflow**, then download the
   installers from the run's **Artifacts**.
3. Or push a version tag to publish them to a Release:
   ```bash
   git tag v1.0.0 && git push origin v1.0.0
   ```

## Project layout

```
src/
  main/            Electron main process
    media/         Cross-platform media bridge (provider per OS)
    settings.ts    Persisted prefs + login-item registration
    index.ts       Window creation + IPC
  preload/         Secure context-bridge API
  renderer/        React UI (the widget)
resources/windows/ PowerShell SMTC helper scripts (Windows)
```
