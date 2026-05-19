//! Mobile + desktop entrypoint. `tauri::mobile_entry_point` makes
//! this `run()` function the one the iOS/Android native shells call
//! into. The desktop `main.rs` calls the same function so we keep one
//! source of truth for the Tauri builder configuration.

mod auth;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,localforge_mobile_lib=debug")),
        )
        .with_target(false)
        .init();

    // Tell the shared cloud-client which product+version to advertise
    // in the User-Agent. Mirrors what the desktop does in its main.rs.
    localforge_cloud_client::init_user_agent(format!(
        "LocalForgeMobile/{} ({} {})",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
    ));

    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            auth::cloud_me,
            auth::cloud_login,
            auth::cloud_signup,
            auth::cloud_logout,
            auth::cloud_request_password_reset,
        ])
        .setup(|app| {
            tracing::info!(version = env!("CARGO_PKG_VERSION"), "LocalForge mobile starting");

            // Deep-link bootstrap. The OAuth callback flow will route
            // through here in a follow-up commit, once the cloud's
            // /v1/auth/<provider>/start endpoint accepts ?mobile=1
            // and bounces back via a registered scheme. For now this
            // just logs whatever arrives so we can confirm the OS is
            // delivering URLs to us.
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

/// Trivial round-trip command kept around for smoke-testing the
/// Rust ↔ JS bridge from the dev console while iterating on the UI.
#[tauri::command]
fn ping() -> &'static str {
    "pong"
}
