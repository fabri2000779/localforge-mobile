//! Mobile push-token registration.
//!
//! The native layer (iOS APNs / Android FCM) acquires this device's opaque
//! push token and hands it here; we register it with the cloud so crash pushes
//! can reach this phone. User-scoped (a token belongs to a person, not an org),
//! so the session JWT is all the cloud needs. Delivery itself is
//! credential-gated server-side (lib/push.ts on the Worker).
//!
//! NOTE: the native token acquisition (registering for remote notifications +
//! catching the device token) lives in the generated iOS/Android shells and is
//! wired in a device session — this command is the bridge it calls.

use localforge_cloud_client::api::{self, ApiError};
use tauri::Manager;

fn unauth() -> ApiError {
    ApiError::Server {
        status: 401,
        code: "unauthenticated".into(),
        message: None,
    }
}

/// Where the last successfully registered push token is persisted (next to
/// `session.token`; same sandboxed-app-data trust model). JS only remembers
/// the token in a module variable, which dies with the process — so a
/// sign-out in a LATER session had nothing to revoke (audit finding).
fn push_token_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("push.token"))
}

fn persisted_push_token(app: &tauri::AppHandle) -> Option<String> {
    let raw = std::fs::read_to_string(push_token_path(app)?).ok()?;
    let t = raw.trim();
    if t.is_empty() { None } else { Some(t.to_string()) }
}

#[derive(serde::Serialize)]
struct RegisterBody<'a> {
    platform: &'a str,
    token: &'a str,
}

#[derive(serde::Serialize)]
struct UnregisterBody<'a> {
    token: &'a str,
}

/// Register this device's push token with the cloud. `platform` is "apns"
/// (iOS) or "fcm" (Android); `token` is the opaque device token the OS handed
/// the native layer. Idempotent server-side (the token is the primary key, so
/// re-registering just refreshes the owner + last-seen).
#[tauri::command]
pub async fn cloud_push_register(
    app: tauri::AppHandle,
    platform: String,
    token: String,
) -> Result<(), ApiError> {
    let session = crate::auth::load_token(&app).ok_or_else(unauth)?;
    let _: serde_json::Value = api::post(
        "/v1/push/register",
        &RegisterBody {
            platform: &platform,
            token: &token,
        },
        Some(&session),
    )
    .await?;
    // Persist so a sign-out in a LATER app session can still revoke it.
    if let Some(path) = push_token_path(&app) {
        let _ = std::fs::write(path, &token);
    }
    Ok(())
}

/// Drop this device's push token from the cloud (sign-out / opt-out). Must be
/// called while the session is still valid — i.e. BEFORE `cloud_logout`.
/// `token` is optional: when JS lost track (fresh process), we fall back to
/// the token persisted at registration. Best-effort semantics server-side:
/// deleting an unknown token is a no-op. (POST variant of the unregister
/// endpoint — the shared api layer has no DELETE-with-body.)
#[tauri::command]
pub async fn cloud_push_unregister(
    app: tauri::AppHandle,
    token: Option<String>,
) -> Result<(), ApiError> {
    let Some(token) = token.or_else(|| persisted_push_token(&app)) else {
        return Ok(()); // never registered on this device — nothing to revoke
    };
    let session = crate::auth::load_token(&app).ok_or_else(unauth)?;
    let _: serde_json::Value = api::post(
        "/v1/push/unregister",
        &UnregisterBody { token: &token },
        Some(&session),
    )
    .await?;
    if let Some(path) = push_token_path(&app) {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}
