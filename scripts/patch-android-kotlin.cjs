// CI step: move the Tauri-generated Android project to Kotlin 2. `tauri android init` pins the
// Kotlin Gradle plugin at 1.9.x, whose compiler can't read libraries built with Kotlin 2.1+
// (androidx.credentials 1.6, used by the Restore Credentials plugin). KGP 2.2.x is the line whose
// fully supported window covers the generated Gradle 8.14 / AGP 8.11. Idempotent.
//   node scripts/patch-android-kotlin.cjs <gen/android/build.gradle.kts>
const fs = require('fs');

const KOTLIN_VERSION = '2.2.21';

const file = process.argv[2];
let g = fs.readFileSync(file, 'utf8');

const re = /(["']org\.jetbrains\.kotlin:kotlin-gradle-plugin:)(\d+\.\d+\.\d+)(["'])/;
const m = g.match(re);
if (!m) {
  console.error('::error::kotlin-gradle-plugin classpath entry not found in', file);
  process.exit(1);
}
if (m[2] === KOTLIN_VERSION) {
  console.log(`kotlin-gradle-plugin already at ${KOTLIN_VERSION}`);
  process.exit(0);
}
g = g.replace(re, `$1${KOTLIN_VERSION}$3`);
fs.writeFileSync(file, g);
console.log(`patched kotlin-gradle-plugin ${m[2]} -> ${KOTLIN_VERSION}`);
