// CI step: move the Tauri-generated Android project to Kotlin 2. `tauri android init` pins the
// Kotlin Gradle plugin at 1.9.x, whose compiler can't read libraries built with Kotlin 2.1+
// (androidx.credentials 1.6, used by the Restore Credentials plugin). KGP 2.2.x is the line whose
// fully supported window covers the generated Gradle 8.14 / AGP 8.11. The generated app module's
// `kotlinOptions { jvmTarget }` (deprecated under Kotlin 2) is migrated to `compilerOptions` too.
// Idempotent.
//   node scripts/patch-android-kotlin.cjs <gen/android/build.gradle.kts>
const fs = require('fs');
const path = require('path');

const KOTLIN_VERSION = '2.2.21';

const rootFile = process.argv[2];
let root = fs.readFileSync(rootFile, 'utf8');

const re = /(["']org\.jetbrains\.kotlin:kotlin-gradle-plugin:)(\d+\.\d+\.\d+)(["'])/;
const m = root.match(re);
if (!m) {
  console.error('::error::kotlin-gradle-plugin classpath entry not found in', rootFile);
  process.exit(1);
}
if (m[2] === KOTLIN_VERSION) {
  console.log(`kotlin-gradle-plugin already at ${KOTLIN_VERSION}`);
} else {
  fs.writeFileSync(rootFile, root.replace(re, `$1${KOTLIN_VERSION}$3`));
  console.log(`patched kotlin-gradle-plugin ${m[2]} -> ${KOTLIN_VERSION}`);
}

// App module: kotlinOptions { jvmTarget = "X" } -> kotlin { compilerOptions { jvmTarget.set(...) } }
const appFile = path.join(path.dirname(rootFile), 'app', 'build.gradle.kts');
if (fs.existsSync(appFile)) {
  let app = fs.readFileSync(appFile, 'utf8');
  const block = /\n[ \t]*kotlinOptions\s*\{\s*\n[ \t]*jvmTarget\s*=\s*"([^"]+)"\s*\n[ \t]*\}\n/;
  const b = app.match(block);
  if (b) {
    const target = b[1] === '1.8' ? 'JVM_1_8' : `JVM_${b[1].replace('.', '_')}`;
    app = app.replace(block, '\n');
    app +=
      `\n// Kotlin 2 DSL (kotlinOptions is deprecated); patched in by scripts/patch-android-kotlin.cjs.\n` +
      `kotlin {\n    compilerOptions {\n        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.${target})\n    }\n}\n`;
    fs.writeFileSync(appFile, app);
    console.log(`migrated app module kotlinOptions(jvmTarget=${b[1]}) -> compilerOptions`);
  } else {
    console.log('app module already on compilerOptions (or no kotlinOptions block)');
  }
}
