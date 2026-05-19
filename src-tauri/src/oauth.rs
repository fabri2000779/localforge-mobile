//! Mobile OAuth glue.
//!
//! URL building + token parsing come from
//! `localforge_cloud_client::oauth` — same code path the desktop uses,
//! so a contract change in the cloud's `/v1/auth/<provider>/start`
//! lands once.
//!
//! Flow:
//!   1. React calls `cloud_oauth_start("google" | "discord" | "github")`.
//!   2. We open `${API_ORIGIN}/v1/auth/<provider>/start?redirect_to=localforge://auth/callback`
//!      in the system browser via `tauri-plugin-opener`.
//!   3. User authenticates in their browser.
//!   4. The cloud API 302s back to `localforge://auth/callback?token=<jwt>`.
//!   5. The OS hands that URL to whatever app registered the
//!      `localforge` scheme — that's us. The deep-link plugin's
//!      `on_open_url` fires in `lib.rs::setup`.
//!   6. `handle_deep_link` parses the token, persists it, fetches /me,
//!      and emits `cloud://signed-in` with the Me payload. React's
//!      LoginScreen subscribes to that event and transitions to Home.
//!
//! Failures land on `cloud://auth-error` so the React layer can show
//! a real message instead of staring at the spinner forever.

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use localforge_cloud_client::{api_origin, oauth as shared};

// Imports only used by the cfg-gated deep-link handlers. Lifting them
// out of those functions would warn as unused on non-mobile builds.
#[cfg(any(target_os = "android", target_os = "ios"))]
use localforge_cloud_client::auth as auth_client;
#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::Emitter;

/// Same value the desktop uses. The cloud's safeRedirect allow-list
/// accepts `localforge:` regardless of host, so both clients can hit
/// the same path — whichever app is installed handles it; if both
/// are installed the OS surfaces a picker, which is the right UX.
const REDIRECT_URI: &str = "localforge://auth/callback";

#[tauri::command]
pub async fn cloud_oauth_start(app: AppHandle, provider: String) -> Result<(), String> {
    let url = shared::start_url(&api_origin(), &provider, REDIRECT_URI)
        .map_err(|e| e.to_string())?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("failed to open browser: {e}"))
}

// ---------------------------------------------------------------------------
// Deep-link receivers — mobile-only.
//
// On desktop preview builds (`npm run dev` without a phone), the OS
// can't hand us localforge:// URLs anyway — there's no scheme
// registration in a browser webview. Gating the receivers behind
// cfg keeps the desktop build warning-clean.
// ---------------------------------------------------------------------------

#[cfg(any(target_os = "android", target_os = "ios"))]
/// Called from `lib.rs::setup` for every URL the OS hands us. Routes
/// by path. Silent on anything we don't recognise so future schemes
/// (debug, in-app deep links) don't trigger an error event.
pub async fn handle_deep_link(app: AppHandle, url: String) {
    if url.starts_with("localforge://auth/callback") {
        handle_auth_callback(app, url).await;
        return;
    }
    if url.starts_with("localforge://invite") {
        handle_invite(app, url).await;
        return;
    }
    tracing::debug!(url, "deep-link ignored — no handler matches");
}

#[cfg(any(target_os = "android", target_os = "ios"))]
async fn handle_auth_callback(app: AppHandle, url: String) {
    let Some(token) = shared::parse_callback_token(&url) else {
        emit_error(&app, "no_token", "callback URL had no token");
        return;
    };

    if let Err(e) = crate::auth::save_session_token(&app, &token) {
        emit_error(&app, "token_store", &e);
        return;
    }

    match auth_client::fetch_me(&token).await {
        Ok(me) => {
            let _ = app.emit("cloud://signed-in", &me);
        }
        Err(e) => {
            // Token persisted but /me failed — we keep the token (a
            // transient network blip would otherwise force the user
            // through OAuth again). React still gets a soft signal so
            // it can refresh or surface a notice.
            tracing::warn!("oauth callback /me failed: {:?}", e);
            let _ = app.emit("cloud://signed-in-partial", &serde_json::Value::Null);
        }
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
/// `localforge://invite?token=<id>` — when the user taps an invitation
/// email link on their phone. We surface the token to React as
/// `cloud://invite-received`; the LoginScreen / HomeScreen layer
/// decides whether the user can accept (must be signed in first).
async fn handle_invite(app: AppHandle, url: String) {
    let Some(token) = shared::parse_query_param(&url, "token") else {
        emit_error(&app, "no_invite_token", "the invite URL had no token");
        return;
    };
    let _ = app.emit(
        "cloud://invite-received",
        serde_json::json!({ "token": token }),
    );
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn emit_error(app: &AppHandle, code: &str, message: &str) {
    let _ = app.emit(
        "cloud://auth-error",
        serde_json::json!({ "code": code, "message": message }),
    );
}
