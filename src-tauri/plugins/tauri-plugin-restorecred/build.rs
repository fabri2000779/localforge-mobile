// No JS-facing commands: the app's Rust auth module drives the native plugin directly. The builder
// still links the Kotlin sources into the Android app under the plugin name "restorecred".
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
