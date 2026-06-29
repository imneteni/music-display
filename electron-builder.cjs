// electron-builder configuration.
//
// macOS signing + notarization only turns on when a real Developer ID cert is
// provided via the CSC_LINK env var (set from a GitHub secret in CI). Without
// it — e.g. local builds — we skip real signing and the afterPack hook ad-hoc
// signs instead, so local builds keep working without any Apple credentials.
const signMac = !!process.env.CSC_LINK

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.musicdisplay.app',
  productName: 'Music Display',
  afterPack: './after-pack.cjs',
  directories: {
    buildResources: 'build'
  },
  files: [
    '!**/.vscode/*',
    '!src/*',
    '!electron.vite.config.{js,ts,mjs,cjs}',
    '!{.eslintignore,.eslintrc.cjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}',
    '!{.env,.env.*,.npmrc,pnpm-lock.yaml,package-lock.json}',
    '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}',
    '!after-pack.cjs',
    '!electron-builder.{yml,yaml,json,js,cjs,ts}'
  ],
  asarUnpack: ['resources/**'],
  extraResources: [
    { from: 'build/icon.svg', to: 'icon.svg' },
    { from: 'build/icon.png', to: 'icon.png' },
    { from: 'resources/windows', to: 'windows', filter: ['**/*'] }
  ],
  mac: {
    category: 'public.app-category.music',
    target: ['dmg', 'zip'],
    extendInfo: {
      // Set to true to hide from the Dock and behave like a pure HUD widget.
      LSUIElement: false
    },
    gatekeeperAssess: false,
    // Notarized, hardened-runtime build when a Developer ID cert is available;
    // otherwise skip signing so the afterPack hook can ad-hoc sign locally.
    hardenedRuntime: signMac,
    ...(signMac ? { notarize: true } : { identity: null })
  },
  win: {
    target: ['nsis']
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true
  }
}
