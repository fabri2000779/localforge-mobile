// Generates the permission schema + links the native mobile sources.
// One command: `authenticate(url, scheme) -> { url }`.
const COMMANDS: &[&str] = &["authenticate"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
