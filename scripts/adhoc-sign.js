// electron-builder `afterPack` hook — ad-hoc code-signs the macOS .app so it will
// launch on Apple Silicon (an unsigned arm64 app won't run at all). This produces
// an UNSIGNED-but-runnable build: users still clear the download quarantine once with
//   xattr -cr "/Applications/Cathode Terminal.app"
// but no longer have to codesign it themselves.
//
// Runs before electron-builder's own signing phase (which is disabled on CI via
// CSC_IDENTITY_AUTO_DISCOVERY=false). Skipped when a real Developer ID cert is
// configured (CSC_LINK) — then electron-builder signs for real and this would only
// clobber that signature.

const path = require('path');
const { execFileSync } = require('child_process');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK) return;   // real signing cert present — leave it to electron-builder

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  console.log(`[adhoc-sign] ad-hoc signing ${appPath} …`);
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
    console.log('[adhoc-sign] done — the app will launch on Apple Silicon after clearing quarantine.');
  } catch (e) {
    // A failed ad-hoc sign means the app won't launch, so fail loudly rather than ship it.
    console.error('[adhoc-sign] codesign failed:', e.message);
    throw e;
  }
};
