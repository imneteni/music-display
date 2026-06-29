// electron-builder afterPack hook.
//
// Re-signs the macOS app with an ad-hoc signature AFTER electron-builder has
// finished modifying it (asar, extraResources, etc.). In CI we skip real code
// signing (no Apple Developer cert), which otherwise leaves the app with a
// stale/invalid signature — and a quarantined download of such an app is
// reported by Gatekeeper as "damaged". A valid ad-hoc signature instead yields
// the normal "unidentified developer" prompt (right-click → Open).
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  // When a real Developer ID cert is provided (CSC_LINK), electron-builder does
  // proper signing + notarization — don't ad-hoc sign, which would clobber it.
  if (process.env.CSC_LINK) {
    console.log('[after-pack] CSC_LINK set — leaving signing to electron-builder')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)

  console.log(`[after-pack] ad-hoc signing ${appPath}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit'
  })
}
