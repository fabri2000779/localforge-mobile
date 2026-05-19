//! Mobile auth Tauri commands + token storage.
//!
//! Same wire contract as the desktop's `cloud::auth` (the React layer
//! invokes the same command names). The differences are platform-
//! specific:
//!
//!   - Token store. Desktop uses the OS keychain via the `keyring`
//!     crate. Mobile uses a file in the app's sandboxed data dir for
//!     v0.0.x — iOS and Android both prevent cross-app access there,
//!     so the JWT is reasonably safe against unprivileged readers.
//!     We'll migrate to iOS Keychain Services + Android Keystore in a
//!     follow-up once we wire a `TokenStore` plugin trait that's
//!     symmetric across both platforms.
//!
//!   - Vault auto-setup is deliberately NOT done here. The mobile is
//!     observation-only in v0.0.x — it never needs the unwrapped DEK
//!     because it doesn't decrypt blobs, just observes server state
//!     and live events over the relay. When the mobile starts reading
//!     encrypted blobs (config viewer, custom-game template
//!     download) we'll add the SyncKeyDialog flow from the desktop.

use std::path::PathBuf;
use std::sync::OnceLock;

use localforge_cloud_client::api::ApiError;
use localforge_cloud_client::auth::{self, Me};
use tauri::Manager;

// In-memory cache of the loaded token. Avoids hitting the file
// system on every cloud call (audit emit, /me, relay reconnect, …).
// `OnceLock<RwLock<…>>` would be more correct than `OnceLock<Mutex<…>>`
// for the read-mostly access pattern, but the lock is held for
// microseconds and contention is non-existent on a single-user app.
static TOKEN_CACHE: OnceLock<std::sync::Mutex<Option<String>>> = OnceLock::new();

fn token_cache() -> &'static std::sync::Mutex<Option<String>> {
    TOKEN_CACHE.get_or_init(|| std::sync::Mutex::new(None))
}

fn token_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {e}"))?;
    Ok(dir.join("session.token"))
}

fn load_token_from_disk(app: &tauri::AppHandle) -> Option<String> {
    let path = token_path(app).ok()?;
    let raw = std::fs::read_to_string(&path).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Read the current token. Hits the cache first; on cache miss reads
/// the file and populates the cache. Returns None if no session is
/// stored.
pub fn load_token(app: &tauri::AppHandle) -> Option<String> {
    {
        let cache = token_cache().lock().ok()?;
        if let Some(t) = cache.as_ref() {
            return Some(t.clone());
        }
    }
    let from_disk = load_token_from_disk(app)?;
    if let Ok(mut cache) = token_cache().lock() {
        *cache = Some(from_disk.clone());
    }
    Some(from_disk)
}

fn save_token(app: &tauri::AppHandle, token: &str) -> Result<(), String> {
    let path = token_path(app)?;
    std::fs::write(&path, token).map_err(|e| format!("write token: {e}"))?;
    if let Ok(mut cache) = token_cache().lock() {
        *cache = Some(token.to_string());
    }
    Ok(())
}

fn clear_token(app: &tauri::AppHandle) -> Result<(), String> {
    let path = token_path(app)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("rm token: {e}"))?;
    }
    if let Ok(mut cache) = token_cache().lock() {
        *cache = None;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — surface names match the desktop's command registry so
// any future shared TS auth store can target both clients identically.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn cloud_login(
    app: tauri::AppHandle,
    email: String,
    password: String,
) -> Result<Me, ApiError> {
    let token = auth::login(&email, &password).await?;
    save_token(&app, &token).map_err(|e| ApiError::Decode(format!("token store: {e}")))?;
    auth::fetch_me(&token).await
}

#[tauri::command]
pub async fn cloud_signup(
    app: tauri::AppHandle,
    email: String,
    password: String,
    display_name: Option<String>,
) -> Result<Me, ApiError> {
    let token = auth::signup(&email, &password, display_name.as_deref()).await?;
    save_token(&app, &token).map_err(|e| ApiError::Decode(format!("token store: {e}")))?;
    auth::fetch_me(&token).await
}

#[tauri::command]
pub async fn cloud_me(app: tauri::AppHandle) -> Result<Option<Me>, ApiError> {
    let Some(token) = load_token(&app) else { return Ok(None) };
    match auth::fetch_me(&token).await {
        Ok(me) => Ok(Some(me)),
        // Token was revoked / expired remotely — drop it locally so the
        // UI shows the sign-in screen again instead of silently failing
        // every subsequent cloud call.
        Err(ApiError::Server { status, .. }) if status == 401 || status == 403 => {
            let _ = clear_token(&app);
            Ok(None)
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn cloud_logout(app: tauri::AppHandle) -> Result<(), ApiError> {
    // Tell the API to revoke the session so other devices stop syncing
    // from it. Fire-and-forget — if it fails (offline, etc.) the local
    // clear still happens.
    if let Some(token) = load_token(&app) {
        let _ = auth::logout(&token).await;
    }
    clear_token(&app).map_err(|e| ApiError::Decode(format!("token store: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn cloud_request_password_reset(email: String) -> Result<(), ApiError> {
    auth::request_password_reset(&email).await
}
