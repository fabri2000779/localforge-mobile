//! Mobile sync commands.
//!
//! The mobile is observation-only — it never pushes encrypted blobs
//! and never decrypts them. The only sync endpoint we expose is the
//! plaintext-metadata list: name + id + updated_at per server. We
//! strip the encrypted_blob from the response on the way back to JS
//! both because we don't need it and because it's ~5-50 KB per row
//! that would otherwise cross the IPC boundary for nothing.

use serde::Serialize;

use localforge_cloud_client::api::ApiError;
use localforge_cloud_client::sync;

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
