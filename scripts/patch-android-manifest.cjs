// CI step: register the localforge:// OAuth callback scheme on the
// generated Android MainActivity so Chrome Custom Tabs' redirect routes
// back to the (warm) app, and ensure launchMode=singleTask so it arrives
// via onNewIntent (which the webauth plugin captures) rather than
// spawning a fresh activity. Idempotent.
//   node scripts/patch-android-manifest.cjs <AndroidManifest.xml>
const fs = require('fs');

const file = process.argv[2];
let m = fs.readFileSync(file, 'utf8');

let patched = false;
// Match each <activity …>…</activity> block; act on the one declaring the
// MAIN/LAUNCHER intent (the activity Tauri hosts the WebView in).
m = m.replace(/(<activity\b[^>]*>)([\s\S]*?<\/activity>)/g, (full, open, rest) => {
  if (!/android\.intent\.action\.MAIN/.test(rest)) return full;
  patched = true;

  // (1) launchMode = singleTask
  let newOpen = open;
  if (/android:launchMode=/.test(newOpen)) {
    newOpen = newOpen.replace(/android:launchMode="[^"]*"/, 'android:launchMode="singleTask"');
  } else {
    newOpen = newOpen.replace(/<activity\b/, '<activity android:launchMode="singleTask"');
  }

  // (2) localforge:// intent-filter (only once)
  let newRest = rest;
  if (!/android:scheme="localforge"/.test(rest)) {
    const filter =
      '\n            <intent-filter>' +
      '\n                <action android:name="android.intent.action.VIEW" />' +
      '\n                <category android:name="android.intent.category.DEFAULT" />' +
      '\n                <category android:name="android.intent.category.BROWSABLE" />' +
      '\n                <data android:scheme="localforge" />' +
      '\n            </intent-filter>\n        ';
    newRest = rest.replace(/<\/activity>\s*$/, `${filter}</activity>`);
  }
  return newOpen + newRest;
});

if (!patched) {
  console.error('::error::could not find the MAIN/LAUNCHER <activity> in', file);
  process.exit(1);
}
fs.writeFileSync(file, m);
console.log('patched manifest: launchMode=singleTask + localforge:// scheme');
