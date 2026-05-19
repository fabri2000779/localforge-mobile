//! Mobile + desktop entrypoint. `tauri::mobile_entry_point` makes
//! this `run()` function the one the iOS/Android native shells call
//! into. The desktop `main.rs` calls the same function so we keep one
//! source of truth for the Tauri builder configuration.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,localforge_mobile_lib=debug")),
        )
        .with_target(false)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![ping])
        .setup(|app| {
            tracing::info!(version = env!("CARGO_PKG_VERSION"), "LocalForge mobile starting");

            // Deep-link bootstrap. The OAuth callback from the cloud
            // API redirects to `localforge://oauth-callback?token=…`.
            // The single-instance plugin (not yet added) plus this
            // event subscription is how we'll route those into the
            // auth flow. Stub for now.
            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().on_open_url(|event| {
                    tracing::info!(urls = ?event.urls(), "deep-link received");
                });
            }

            let _ = app; // silence unused on desktop builds without cfg above
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to launch LocalForge mobile");
}

/// Trivial round-trip command — handy during scaffold to confirm the
/// Rust ↔ JS bridge is wired before we wire the real cloud client.
#[tauri::command]
fn ping() -> &'static str {
    "pong"
}
