//! Mobile + desktop entrypoint. `tauri::mobile_entry_point` makes
//! this `run()` function the one the iOS/Android native shells call
//! into. The desktop `main.rs` calls the same function so we keep one
//! source of truth for the Tauri builder configuration.

mod auth;
mod iap;
mod nodes;
mod oauth;
mod orgs;
mod relay;
mod sync;
mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // CRITICAL: install rustls' process-default crypto provider before
    // anything makes an HTTPS request. reqwest (in the cloud-client) and
    // the relay WS are built with rustls' "no-provider" feature, so the
    // default provider isn't set automatically. Without this, the very
    // first cloud call (login / OAuth callback / sync) hits
    // `reqwest::Client::builder().build().expect(...)`, which returns Err
    // when no provider is installed → panic → and with panic=abort the
    // whole app crashes. Idempotent: returns Err (ignored) if a default
    // is already installed.
    let _ = rustls::crypto::ring::default_provider().install_default();

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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_iap::init())
        .plugin(tauri_plugin_webauth::init())
        .manage(std::sync::Arc::new(relay::RelayState::default()))
        .invoke_handler(tauri::generate_handler![
            ping,
            auth::cloud_me,
            auth::cloud_login,
            auth::cloud_signup,
            auth::cloud_logout,
            auth::cloud_request_password_reset,
            oauth::cloud_oauth_start,
            sync::cloud_servers_list,
            sync::cloud_server_config,
            nodes::cloud_list_machines,
            orgs::cloud_org_me,
            orgs::cloud_org_invite,
            orgs::cloud_orgs_list,
            orgs::cloud_orgs_accept_invite,
            orgs::cloud_set_active_org,
            vault::cloud_sync_key_setup,
            vault::cloud_sync_key_unlock,
            vault::cloud_sync_key_status,
            vault::cloud_unlock_org_dek,
            vault::cloud_clear_org_dek,
            vault::cloud_invalidate_local_dek,
            vault::cloud_process_grants,
            relay::cloud_relay_start,
            relay::cloud_relay_stop,
            relay::cloud_relay_send_cmd,
            iap::cloud_iap_verify_apple,
            iap::cloud_iap_verify_google,
        ])
        .setup(|app| {
            tracing::info!(version = env!("CARGO_PKG_VERSION"), "LocalForge mobile starting");

            // Wire the deep-link receiver. The iOS/Android OS hands us
            // any URL with our registered scheme (`localforge://…`),
            // which is how the OAuth callback flow gets the JWT back
            // into the app. Each URL goes through `oauth::handle_deep_link`
            // which routes by path — auth/callback today, invite
            // tomorrow, anything else logged and ignored.
            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls = event.urls();
                    tracing::info!(?urls, "deep-link received");
                    for url in urls {
                        let h = handle.clone();
                        let s = url.to_string();
                        tauri::async_runtime::spawn(async move {
                            oauth::handle_deep_link(h, s).await;
                        });
                    }
                });
            }

            let _ = app; // silence unused on non-mobile builds
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
