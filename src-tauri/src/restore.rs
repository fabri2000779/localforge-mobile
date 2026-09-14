//! Zero-Tap Sign-In (Android Restore Credentials): a WebAuthn key the phone keeps in Block Store
//! and carries to the user's next device, so the app signs in there without a tap. The cloud does
//! the passkey-style verification (`/v1/auth/restore/*`); iOS and desktop are no-ops.

use localforge_cloud_client::api::{self, ApiError};
use localforge_cloud_client::auth::{self as auth_client, Me};
use tauri::Manager;
use tauri_plugin_restorecred::{Error as RestoreError, RestoreCredExt};

/// The credential id registered from this device, so sign-out revokes exactly that key.
fn credential_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("restore.credential"))
}

fn stored_credential(app: &tauri::AppHandle) -> Option<String> {
    let raw = std::fs::read_to_string(credential_path(app)?).ok()?;
    let id = raw.trim();
    if is_base64url(id) { Some(id.to_string()) } else { None }
}

fn remember_credential(app: &tauri::AppHandle, id: &str) {
    if let Some(path) = credential_path(app) {
        let _ = std::fs::write(path, id);
    }
}

fn is_base64url(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[derive(serde::Deserialize)]
struct OptionsResp {
    options: serde_json::Value,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterResp {
    credential_id: String,
}

#[derive(serde::Deserialize)]
struct AssertResp {
    token: String,
}

fn parse_response(json: &str) -> Result<serde_json::Value, ApiError> {
    serde_json::from_str(json).map_err(|e| ApiError::Decode(format!("restore credential response: {e}")))
}

/// Register this device's restore key for the signed-in account. `false` when nothing was done:
/// signed out, already enrolled, not Android, or the device can't mint one (no Play services /
/// screen lock). A cloud that isn't configured for it answers 503 and lands in `Err`.
#[tauri::command]
pub async fn cloud_restore_enroll(app: tauri::AppHandle) -> Result<bool, ApiError> {
    let Some(token) = crate::auth::load_token(&app) else { return Ok(false) };
    if stored_credential(&app).is_some() {
        return Ok(false);
    }
    let opts: OptionsResp =
        api::post("/v1/auth/restore/register/options", &serde_json::json!({}), Some(&token)).await?;
    let response_json = match app.restore_cred().create(&opts.options.to_string()) {
        Ok(json) => json,
        Err(RestoreError::Unsupported) => return Ok(false),
        Err(e) => {
            tracing::warn!("restore credential not created: {e}");
            return Ok(false);
        }
    };
    let response = parse_response(&response_json)?;
    let r: RegisterResp = api::post(
        "/v1/auth/restore/register",
        &serde_json::json!({ "response": response }),
        Some(&token),
    )
    .await?;
    remember_credential(&app, &r.credential_id);
    Ok(true)
}

/// Sign in with the restore key that came along with the user's backup. `None` when there is
/// nothing to restore (fresh install, not Android, key cleared) or a session already exists.
#[tauri::command]
pub async fn cloud_restore_sign_in(app: tauri::AppHandle) -> Result<Option<Me>, ApiError> {
    if crate::auth::load_token(&app).is_some() {
        return Ok(None);
    }
    let opts: OptionsResp =
        api::post("/v1/auth/restore/assert/options", &serde_json::json!({}), None).await?;
    let response_json = match app.restore_cred().get(&opts.options.to_string()) {
        Ok(Some(json)) => json,
        Ok(None) | Err(RestoreError::Unsupported) => return Ok(None),
        Err(e) => {
            tracing::warn!("restore credential not read: {e}");
            return Ok(None);
        }
    };
    let response = parse_response(&response_json)?;
    let r: AssertResp =
        api::post("/v1/auth/restore/assert", &serde_json::json!({ "response": response }), None).await?;
    crate::auth::save_session_token(&app, &r.token)
        .map_err(|e| ApiError::Decode(format!("token store: {e}")))?;
    if let Some(id) = response.get("id").and_then(|v| v.as_str()) {
        remember_credential(&app, id);
    }
    Ok(Some(auth_client::fetch_me(&r.token).await?))
}

/// Revoke this device's restore key in the cloud (needs the still-valid session, so call it BEFORE
/// the session is revoked) and drop it locally. Best-effort.
pub async fn forget(app: &tauri::AppHandle) {
    if let (Some(token), Some(id)) = (crate::auth::load_token(app), stored_credential(app)) {
        let res: Result<serde_json::Value, ApiError> =
            api::delete(&format!("/v1/auth/restore/{id}"), Some(&token)).await;
        if let Err(e) = res {
            tracing::warn!("restore credential not revoked: {e}");
        }
    }
    clear_local(app);
}

/// Drop the local restore key and the remembered credential id (sign-out, account deletion, or a
/// session the cloud revoked). Best-effort.
pub fn clear_local(app: &tauri::AppHandle) {
    if let Some(path) = credential_path(app) {
        let _ = std::fs::remove_file(path);
    }
    match app.restore_cred().clear() {
        Ok(()) | Err(RestoreError::Unsupported) => {}
        Err(e) => tracing::warn!("restore credential not cleared: {e}"),
    }
}
