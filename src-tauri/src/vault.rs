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
    // Establish (or recover) the X25519 keypair so this user can be granted
    // org-shared access and (as owner) grant it. Best-effort — a failure here
    // doesn't undo the DEK unlock.
    let _ = ensure_keypair(&app, &kek, &token).await;
    Ok(())
}

/// Set up envelope encryption from the phone — for a member (typically OAuth)
/// who never used the desktop. Generates a DEK + salt, derives the KEK from the
/// chosen passphrase, wraps the DEK, POSTs it, then establishes + publishes the
/// X25519 keypair so the owner can grant this user org access. The cloud 409s
/// if a wrap already exists — callers only invoke this when status is
/// `not_set_up`.
#[tauri::command]
pub async fn cloud_sync_key_setup(app: tauri::AppHandle, secret: String) -> Result<(), ApiError> {
    let Some(token) = crate::auth::load_token(&app) else {
        return Err(ApiError::Server {
            status: 401,
            code: "unauthenticated".into(),
            message: None,
        });
    };
    // Reuse a local DEK if we somehow already have one, else mint a fresh one.
    let dek = match load_dek(&app) {
        Some(k) => k,
        None => {
            let k = crypto::generate_key();
            save_dek(&app, &k).map_err(|e| ApiError::Decode(format!("dek store: {e}")))?;
            k
        }
    };
    let salt = crypto::generate_salt();
    let kek = crypto::derive_kek(&secret, &salt).map_err(ApiError::Decode)?;
    let wrapped = crypto::wrap_dek(&kek, &dek).map_err(ApiError::Decode)?;

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Body {
        wrapped_dek: String,
        kek_salt: String,
        kek_params: crypto::KekParams,
        force: bool,
    }
    let body = Body {
        wrapped_dek: wrapped,
        kek_salt: base64::engine::general_purpose::STANDARD.encode(salt),
        kek_params: crypto::KekParams::defaults(),
        force: false,
    };
    let _: serde_json::Value =
        localforge_cloud_client::api::post("/v1/account/sync-key", &body, Some(&token)).await?;
    // Establish + publish the keypair so the user can receive org grants.
    let _ = ensure_keypair(&app, &kek, &token).await;
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

// ===========================================================================
// Team key sharing — per-org DEK distribution (X25519 sealed grants).
//
// Ported from the desktop's `cloud::vault`, adapted to the mobile file store.
// Lets a mobile sub-user OPEN the owner's org DEK (decrypt the owner's
// servers) and lets a mobile OWNER SEAL the org DEK to pending members (the
// "confirm" step). Storage mirrors the DEK: sandboxed files in app-data.
// ===========================================================================

// --- X25519 keypair --------------------------------------------------------

fn x25519_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {e}"))?;
    Ok(dir.join("x25519.sk"))
}

fn load_x25519_sk(app: &tauri::AppHandle) -> Option<[u8; KEY_LEN]> {
    let path = x25519_path(app).ok()?;
    let b64 = std::fs::read_to_string(&path).ok()?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .ok()?;
    if bytes.len() != KEY_LEN {
        return None;
    }
    let mut k = [0u8; KEY_LEN];
    k.copy_from_slice(&bytes);
    Some(k)
}

fn save_x25519_sk(app: &tauri::AppHandle, sk: &[u8; KEY_LEN]) -> Result<(), String> {
    let path = x25519_path(app)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(sk);
    std::fs::write(&path, b64).map_err(|e| format!("write x25519: {e}"))
}

/// Make sure this device holds the user's X25519 secret. Recover it from the
/// KEK-wrapped copy on the cloud, else mint a fresh keypair + publish the
/// public key. Called from `cloud_sync_key_unlock` (KEK in hand). Best-effort.
pub async fn ensure_keypair(
    app: &tauri::AppHandle,
    kek: &[u8; KEY_LEN],
    token: &str,
) -> Result<(), ApiError> {
    if load_x25519_sk(app).is_some() {
        return Ok(());
    }
    let me = auth::fetch_me(token).await?;
    if let Some(wrapped) = me.wrapped_x25519_sk {
        if let Ok(sk) = crypto::unwrap_dek(kek, &wrapped) {
            save_x25519_sk(app, &sk).map_err(|e| ApiError::Decode(format!("x25519: {e}")))?;
            return Ok(());
        }
    }
    let (sk, pk) = crypto::generate_keypair();
    let wrapped_sk = crypto::wrap_dek(kek, &sk).map_err(ApiError::Decode)?;
    let pk_b64 = base64::engine::general_purpose::STANDARD.encode(pk);
    localforge_cloud_client::keys::publish_pubkey(&pk_b64, &wrapped_sk, token).await?;
    save_x25519_sk(app, &sk).map_err(|e| ApiError::Decode(format!("x25519: {e}")))?;
    Ok(())
}

// --- Active-org DEK override + per-org DEK cache ----------------------------

static ACTIVE_DEK_OVERRIDE: OnceLock<std::sync::Mutex<Option<[u8; KEY_LEN]>>> = OnceLock::new();

fn active_override() -> &'static std::sync::Mutex<Option<[u8; KEY_LEN]>> {
    ACTIVE_DEK_OVERRIDE.get_or_init(|| std::sync::Mutex::new(None))
}

fn set_active_dek_override(dek: Option<[u8; KEY_LEN]>) {
    if let Ok(mut g) = active_override().lock() {
        *g = dek;
    }
}

/// The DEK the decrypt path should use: the active-org override when set (a
/// sub-user viewing another org), else our own cached DEK.
pub fn active_dek(app: &tauri::AppHandle) -> Option<[u8; KEY_LEN]> {
    if let Ok(g) = active_override().lock() {
        if let Some(d) = *g {
            return Some(d);
        }
    }
    load_dek(app)
}

fn org_dek_path(app: &tauri::AppHandle, org_id: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {e}"))?;
    // Sanitise the org id for a filename (org ids are alphanumeric, but be safe
    // on every FS).
    let safe: String = org_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    Ok(dir.join(format!("org-dek-{safe}.key")))
}

fn load_org_dek(app: &tauri::AppHandle, org_id: &str) -> Option<[u8; KEY_LEN]> {
    let path = org_dek_path(app, org_id).ok()?;
    let b64 = std::fs::read_to_string(&path).ok()?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .ok()?;
    if bytes.len() != KEY_LEN {
        return None;
    }
    let mut k = [0u8; KEY_LEN];
    k.copy_from_slice(&bytes);
    Some(k)
}

fn save_org_dek(app: &tauri::AppHandle, org_id: &str, dek: &[u8; KEY_LEN]) -> Result<(), String> {
    let path = org_dek_path(app, org_id)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(dek);
    std::fs::write(&path, b64).map_err(|e| format!("write org dek: {e}"))
}

/// Adopt an org DEK obtained via invite handoff: cache it durably + make it the
/// active decryption key. Used by the accept-invite command.
pub fn adopt_org_dek(app: &tauri::AppHandle, org_id: &str, dek: &[u8; KEY_LEN]) {
    let _ = save_org_dek(app, org_id, dek);
    set_active_dek_override(Some(*dek));
}

/// Member side: seal the org DEK we just obtained to OUR OWN pubkey + upload a
/// durable grant, so our other devices get access without waiting for the
/// owner. Best-effort: `Ok(false)` if no keypair on this device yet.
pub async fn self_seal_grant(
    app: &tauri::AppHandle,
    org_id: &str,
    my_user_id: &str,
    dek: &[u8; KEY_LEN],
    token: &str,
) -> Result<bool, ApiError> {
    let Some(sk) = load_x25519_sk(app) else {
        return Ok(false);
    };
    let pk = crypto::public_from_secret(&sk);
    let (epk_b64, sealed) = crypto::seal_to(&pk, dek).map_err(ApiError::Decode)?;
    localforge_cloud_client::keys::put_grant(org_id, my_user_id, &sealed, &epk_b64, token).await?;
    Ok(true)
}

// --- Tauri commands: unlock / clear / process grants ------------------------

/// Sub-user side: unlock the DEK for an org we DON'T own. Prefer the current
/// sealed grant from the cloud (so a rotated DEK is picked up); fall back to a
/// cached DEK (invite handoff / offline). Returns "granted" | "no_grant" |
/// "no_keypair".
#[tauri::command(rename_all = "camelCase")]
pub async fn cloud_unlock_org_dek(
    app: tauri::AppHandle,
    org_id: String,
) -> Result<&'static str, ApiError> {
    let Some(token) = crate::auth::load_token(&app) else {
        return Err(ApiError::Server {
            status: 401,
            code: "unauthenticated".into(),
            message: None,
        });
    };
    let have_keypair = load_x25519_sk(&app);
    if let Some(sk) = have_keypair {
        match localforge_cloud_client::keys::my_grant(&org_id, &token).await {
            Ok(Some(grant)) => {
                if let Ok(dek) = crypto::open_sealed(&sk, &grant.sealed_epk, &grant.sealed_dek) {
                    let _ = save_org_dek(&app, &org_id, &dek);
                    set_active_dek_override(Some(dek));
                    return Ok("granted");
                }
                // Grant exists but won't open with our key — fall through.
            }
            Ok(None) => { /* no grant yet — invite-handoff member uses the cache */ }
            Err(_) => { /* offline / transient — use the cache if we have one */ }
        }
    }
    if let Some(dek) = load_org_dek(&app, &org_id) {
        set_active_dek_override(Some(dek));
        return Ok("granted");
    }
    if have_keypair.is_none() {
        return Ok("no_keypair");
    }
    Ok("no_grant")
}

/// Clear the active-org override — call when switching back to an org we own,
/// so decryption uses our own DEK again.
#[tauri::command]
pub async fn cloud_clear_org_dek() -> Result<(), String> {
    set_active_dek_override(None);
    Ok(())
}

/// Owner side ("accept back" / confirm): seal OUR org DEK to every member who
/// published a key but has no grant yet. 403 (not the owner) → no-op. Requires
/// our sync key unlocked on this device (we need the DEK to seal). Returns the
/// number of members newly granted.
#[tauri::command(rename_all = "camelCase")]
pub async fn cloud_process_grants(
    app: tauri::AppHandle,
    org_id: String,
) -> Result<usize, ApiError> {
    let Some(token) = crate::auth::load_token(&app) else {
        return Err(ApiError::Server {
            status: 401,
            code: "unauthenticated".into(),
            message: None,
        });
    };
    let pending = match localforge_cloud_client::keys::pending_grants(&org_id, &token).await {
        Ok(p) => p,
        Err(ApiError::Server { status: 403, .. }) => return Ok(0), // not the owner
        Err(e) => return Err(e),
    };
    if pending.is_empty() {
        return Ok(0);
    }
    let Some(dek) = load_dek(&app) else {
        return Err(ApiError::Server {
            status: 412,
            code: "locked".into(),
            message: Some("unlock your sync key to confirm members".into()),
        });
    };
    let mut granted = 0usize;
    for m in pending {
        let pk_bytes = match base64::engine::general_purpose::STANDARD.decode(&m.pubkey) {
            Ok(b) if b.len() == crypto::X25519_PK_LEN => {
                let mut a = [0u8; crypto::X25519_PK_LEN];
                a.copy_from_slice(&b);
                a
            }
            _ => continue, // skip a malformed pubkey rather than abort the batch
        };
        let Ok((epk_b64, sealed)) = crypto::seal_to(&pk_bytes, &dek) else {
            continue;
        };
        if localforge_cloud_client::keys::put_grant(&org_id, &m.user_id, &sealed, &epk_b64, &token)
            .await
            .is_ok()
        {
            granted += 1;
        }
    }
    Ok(granted)
}
