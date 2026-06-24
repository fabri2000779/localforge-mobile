// CI helper — wire Firebase into the GENERATED Android project so FCM can
// initialise. Run AFTER `tauri android init`, BEFORE `tauri android build`:
//   node scripts/patch-android-firebase.cjs <gen/android dir> [google-services.json path]
//
// ⚠️ VERIFY-ON-DEVICE: Tauri's generated Gradle layout (file paths + whether
// it uses the plugins {} DSL or buildscript classpath) can shift between Tauri
// versions. Inspect your actual src-tauri/gen/android after `tauri android
// init` and adjust the regexes below if a block isn't matched. Idempotent.
//
// What it does:
//   1. apply `com.google.gms.google-services` in the app module
//   2. declare it (apply false) at the root so the app can apply it
//   3. copy google-services.json into the app module (from a CI secret/file)
const fs = require('fs');
const path = require('path');

const genDir = process.argv[2] || 'src-tauri/gen/android';
const servicesJson = process.argv[3];
const GS_VERSION = '4.4.2';

function patch(file, find, insert, marker) {
  if (!fs.existsSync(file)) {
    console.warn(`::warning::${file} not found — skipping (run after \`tauri android init\`)`);
    return;
  }
  let txt = fs.readFileSync(file, 'utf8');
  if (txt.includes(marker)) return; // idempotent
  if (!find.test(txt)) {
    console.warn(`::warning::could not find a plugins {} block in ${file} — patch manually`);
    return;
  }
  txt = txt.replace(find, insert);
  fs.writeFileSync(file, txt);
  console.log(`patched ${path.basename(file)}: ${marker}`);
}

patch(
  path.join(genDir, 'app', 'build.gradle.kts'),
  /plugins\s*\{/,
  'plugins {\n    id("com.google.gms.google-services")',
  'com.google.gms.google-services',
);
patch(
  path.join(genDir, 'build.gradle.kts'),
  /plugins\s*\{/,
  `plugins {\n    id("com.google.gms.google-services") version "${GS_VERSION}" apply false`,
  'com.google.gms.google-services',
);

if (servicesJson && fs.existsSync(servicesJson)) {
  fs.copyFileSync(servicesJson, path.join(genDir, 'app', 'google-services.json'));
  console.log('copied google-services.json into the app module');
} else {
  console.warn('::warning::google-services.json not provided — FCM init will fail at runtime');
}
