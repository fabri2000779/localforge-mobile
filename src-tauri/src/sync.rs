//! Mobile sync commands.
//!
//! The mobile is observation-only — it never pushes encrypted blobs
//! and never decrypts them. The only sync endpoint we expose is the
//! plaintext-metadata list: name + id + updated_at per server. We
//! strip the encrypted_blob from the response on the way back to JS
//! both because we don't need it and because it's ~5-50 KB per row
//! that would otherwise cross the IPC boundary for nothing.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use localforge_cloud_client::api::ApiError;
use localforge_cloud_client::sync;
use localforge_cloud_client::vault as crypto;
use localforge_core::types::GameType;

/// Mobile-side projection of `cloud_client::sync::SyncedServer`. We
/// rename to camelCase on the way out so the React layer sees the
/// same naming convention as the rest of our IPC surface (Me +
/// Subscription etc.). `encrypted_blob` is dropped on purpose.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSummary {
    pub id: String,
    pub name: String,
    pub updated_at: i64,
}

#[tauri::command]
pub async fn cloud_servers_list(app: tauri::AppHandle) -> Result<Vec<ServerSummary>, ApiError> {
    let Some(token) = crate::auth::load_token(&app) else {
        return Err(ApiError::Server {
            status: 401,
            code: "unauthenticated".into(),
            message: None,
        });
    };
    let raw = sync::list_servers(&token).await?;
    Ok(raw
        .into_iter()
        .map(|s| ServerSummary {
            id: s.id,
            name: s.name,
            updated_at: s.updated_at,
        })
        .collect())
}

/// The decrypted server config the mobile shows (and lets the user
/// edit). Deserialised from the AES-GCM blob the owner's desktop wrote
/// — that blob is plain serde (snake_case), so each multi-word field
/// carries a snake alias while we serialise camelCase out to JS to
/// match the rest of the mobile IPC surface.
///
/// The mobile never re-encrypts / re-writes this: edits go to the owner
/// over the relay (`server.update_config`), and the owner re-syncs. So
/// this is a read-shaped projection, not the canonical sync type.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfigView {
    pub id: String,
    pub name: String,
    #[serde(alias = "game_type")]
    pub game_type: GameType,
    pub port: u16,
    #[serde(alias = "memory_mb")]
    pub memory_mb: u32,
    pub config: HashMap<String, String>,
    #[serde(default, alias = "node_id")]
    pub node_id: Option<String>,
}

/// Decrypt one synced server's config blob for the viewer/editor.
///
/// Requires the sync key to be unlocked on this device (`vault::load_dek`);
/// returns `locked` (412) otherwise so the UI can prompt for the
/// passphrase first.
#[tauri::command]
pub async fn cloud_server_config(
    app: tauri::AppHandle,
    server_id: String,
) -> Result<ServerConfigView, ApiError> {
    let Some(token) = crate::auth::load_token(&app) else {
        return Err(ApiError::Server {
            status: 401,
            code: "unauthenticated".into(),
            message: None,
        });
    };
    let Some(dek) = crate::vault::load_dek(&app) else {
        return Err(ApiError::Server {
            status: 412,
            code: "locked".into(),
            message: Some("unlock the sync key first".into()),
        });
    };
    let raw = sync::list_servers(&token).await?;
    let Some(server) = raw.into_iter().find(|s| s.id == server_id) else {
        return Err(ApiError::Server {
            status: 404,
            code: "not_found".into(),
            message: None,
        });
    };
    let plain = crypto::decrypt(&dek, &server.encrypted_blob)
        .map_err(|e| ApiError::Decode(format!("decrypt: {e}")))?;
    serde_json::from_slice::<ServerConfigView>(&plain)
        .map_err(|e| ApiError::Decode(format!("parse config: {e}")))
}
