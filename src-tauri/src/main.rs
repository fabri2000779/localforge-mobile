// Prevents an additional Windows console window from popping up during
// `cargo run` on Windows release builds. Harmless on macOS / Linux.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    localforge_mobile_lib::run()
}
