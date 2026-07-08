// electron-builder `afterSign` hook — notarizes the macOS build, but ONLY when
// Apple credentials are present in the environment. That keeps ad-hoc/dev builds
// (no cert, no creds) working: the build just skips notarization instead of
// failing. Once you export the three env vars on the Mac (or as CI secrets), the
// exact same `npm run dist:mac` produces a fully notarized app — no config change.
//
//   export APPLE_ID="you@example.com"
//   export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"   # appleid.apple.com app-specific password
//   export APPLE_TEAM_ID="XXXXXXXXXX"                          # 10-char Developer Team ID
//
// (Signing itself is gated separately by whether a Developer ID cert is in the
//  keychain — electron-builder auto-discovers it.)

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('[notarize] Apple credentials not set (APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID) — skipping notarization (ad-hoc build).');
    return;
  }

  const { notarize } = require('@electron/notarize');
  const appName = context.packager.appInfo.productFilename;
  console.log(`[notarize] Submitting ${appName}.app to the Apple notary service — this can take a few minutes…`);

  // Apple's notary service has hung this step for the entire CI job timeout before.
  // Cap it, and treat any failure/timeout as NON-FATAL: the app is already
  // Developer-ID signed, so shipping signed-but-not-notarized (users right-click →
  // Open once) beats a pipeline that hangs for hours. A healthy notary still fully
  // notarizes + staples. Re-run the release when Apple recovers for a clean build.
  const TIMEOUT_MIN = Number(process.env.NOTARIZE_TIMEOUT_MIN || 20);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${TIMEOUT_MIN} min`)), TIMEOUT_MIN * 60_000);
    if (timer.unref) timer.unref();
  });
  try {
    await Promise.race([
      notarize({
        appPath: `${appOutDir}/${appName}.app`,
        appleId: APPLE_ID,
        appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
        teamId: APPLE_TEAM_ID,
      }),
      timeout,
    ]);
    console.log(`[notarize] ${appName}.app notarized and stapled.`);
  } catch (err) {
    console.warn(`[notarize] ⚠️  Notarization did not complete (${err && err.message}). Shipping the SIGNED (un-notarized) build — open it via right-click → Open. Re-run the release once Apple's notary service recovers for a fully notarized build.`);
  } finally {
    clearTimeout(timer);
  }
};
