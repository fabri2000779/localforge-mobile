// Generates the permission schema + links the native iOS sources.
// Three commands drive the native bar; native taps come back as the
// `select` plugin event (no command needed for that direction).
const COMMANDS: &[&str] = &["show_bar", "set_selected", "hide_bar"];

fn main() {
    // Only ios_path — there's no Android native side (the Rust layer
    // no-ops on Android, which keeps its in-webview Material bar).
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
