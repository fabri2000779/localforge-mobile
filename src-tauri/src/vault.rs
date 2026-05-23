//! Mobile vault — DEK storage + sync-key unlock.
//!
//! The mobile is no longer strictly observation-only: to VIEW (and
//! later edit) a server's config it has to decrypt the AES-GCM blobs
//! the owner's desktop syncs. That needs the Data Encryption Key (DEK).
//!
//! Zero-knowledge contract (same as desktop): the DEK is never sent to
//! the cloud in the clear. The cloud holds it WRAPPED behind a Key
//! Encryption Key derived (scrypt) from the user's password / sync
//! passphrase. `cloud_sync_key_unlock` re-derives the KEK from the
//! secret the user types, unwraps the DEK, and caches it locally so
//! subsequent decrypts are instant.
//!
//! Storage mirrors `auth.rs`: a file in the app's sandboxed data dir
//! (iOS + Android both block cross-app reads there). iOS Keychain /
//! Android Keystore is the same follow-up tracked for the token store.

use std::path::PathBuf;
use std::sync::OnceLock;

use base64::Engine;
use localforge_cloud_client::api::ApiError;
use localforge_cloud_client::auth;
use localforge_cloud_client::vault as crypto;
use tauri::Manager;

const KEY_LEN: usize = crypto::KEY_LEN;

// In-memory cache of the unwrapped DEK so we don't re-read the file on
// every decrypt. Written on unlock, read on each config view.
static DEK_CACHE: OnceLock<std::sync::Mutex<Option<[u8; KEY_LEN]>>> = OnceLock::new();

fn dek_cache() -> &'static std::sync::Mutex<Option<[u8; KEY_LEN]>> {
    DEK_CACHE.get_or_init(|| std::sync::Mutex::new(None))
}

fn dek_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {e}"))?;
    Ok(dir.join("vault.dek"))
}

/// Load the cached DEK — memory first, then the sandboxed file. Returns
/// None when the sync key hasn't been unlocked on this device yet.
pub fn load_dek(app: &tauri::AppHandle) -> Option<[u8; KEY_LEN]> {
    {
        let cache = dek_cache().lock().ok()?;
        if let Some(k) = cache.as_ref() {
            return Some(*k);
        }
    }
    let path = dek_path(app).ok()?;
    let b64 = std::fs::read_to_string(&path).ok()?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .ok()?;
    if bytes.len() != KEY_LEN {
        return None;
    }
    let mut k = [0u8; KEY_LEN];
    k.copy_from_slice(&bytes);
    if let Ok(mut cache) = dek_cache().lock() {
        *cache = Some(k);
    }
    Some(k)
}

fn save_dek(app: &tauri::AppHandle, dek: &[u8; KEY_LEN]) -> Result<(), String> {
    let path = dek_path(app)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(dek);
    std::fs::write(&path, b64).map_err(|e| format!("write dek: {e}"))?;
    if let Ok(mut cache) = dek_cache().lock() {
        *cache = Some(*dek);
    }
    Ok(())
}

/// Unlock the DEK on this device. Fetches the wrapped DEK from /me,
/// re-derives the KEK from the user's secret, unwraps, and caches it.
///
/// `secret` is the account password (email/pwd users) or the sync
/// passphrase (OAuth users) — whichever was set at setup time on the
/// desktop. Wrong secret → AES-GCM authentication fails → returns
/// `wrong_secret` so the UI can prompt again without locking anything.
#[tauri::command]
pub async fn cloud_sync_key_unlock(app: tauri::AppHandle, secret: String) -> Result<(), ApiError> {
    let Some(token) = crate::auth::load_token(&app) else {
        return Err(ApiError::Server {
            status: 401,
            code: "unauthenticated".into(),
            message: None,
        });
    };
    let me = auth::fetch_me(&token).await?;
    let Some(sk) = me.sync_key else {
        return Err(ApiError::Server {
            status: 412,
            code: "sync_key_not_set".into(),
            message: Some("set up the sync passphrase on the desktop first".into()),
        });
    };
    let salt = base64::engine::general_purpose::STANDARD
        .decode(&sk.kek_salt)
        .map_err(|e| ApiError::Decode(format!("bad salt: {e}")))?;
    let kek = crypto::derive_kek(&secret, &salt).map_err(ApiError::Decode)?;
    let dek = crypto::unwrap_dek(&kek, &sk.wrapped_dek).map_err(|_| ApiError::Server {
        status: 400,
        code: "wrong_secret".into(),
        message: Some("incorrect passphrase".into()),
    })?;
    save_dek(&app, &dek).map_err(|e| ApiError::Decode(format!("dek store: {e}")))?;
    Ok(())
}

/// Three-state status the UI uses to decide whether to prompt for the
/// passphrase, mirroring the desktop's `cloud_sync_key_status`:
///   "not_set_up" — no wrapped DEK on the server (owner never set sync up)
///   "locked"     — wrap exists, but this device hasn't unlocked it
///   "unlocked"   — DEK cached locally, ready to decrypt configs
#[tauri::command]
pub async fn cloud_sync_key_status(app: tauri::AppHandle) -> Result<&'static str, ApiError> {
    let Some(token) = crate::auth::load_token(&app) else {
        return Ok("not_set_up");
    };
    let local = load_dek(&app).is_some();
    let me = auth::fetch_me(&token).await?;
    Ok(match (me.sync_key.is_some(), local) {
        (true, true) => "unlocked",
        (true, false) => "locked",
        (false, _) => "not_set_up",
    })
}
