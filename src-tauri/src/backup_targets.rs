//! Org backup-target commands for mobile.
//!
//! The mobile doesn't hold S3 credentials locally (it never executes backups
//! directly — it fires them over the relay and the host executes). Instead
//! it reads/writes the cloud-stored list, encrypted with the org DEK.
//!
//! - LIST: GET /v1/sync/backup-targets → decrypt each blob → return views
//! - ADD:  encrypt BackupTarget with org DEK → POST /v1/sync/backup-targets
//! - DELETE: DELETE /v1/sync/backup-targets/:id

use localforge_cloud_client::api::{self, ApiError};
use serde::{Deserialize, Serialize};

// ── Wire types ───────────────────────────────────────────────────────────────

/// The credential fields to add/update.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupTargetInput {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub access_key: String,
    pub secret_key: String,
    #[serde(default)]
    pub path_style: bool,
}

/// Redacted view returned to the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupTargetView {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub access_key: String,
    pub path_style: bool,
}

#[derive(Deserialize)]
struct CloudRow {
    id: String,
    name: String,
    #[serde(rename = "encryptedBlob")]
    encrypted_blob: String,
}

#[derive(Deserialize)]
struct ListResp {
    targets: Vec<CloudRow>,
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Pull the org's backup targets from the cloud, decrypt with the org DEK,
/// and return a redacted list. Viewer+ can call this.
#[tauri::command]
pub async fn cloud_backup_targets_list(
    app: tauri::AppHandle,
) -> Result<Vec<BackupTargetView>, ApiError> {
    let token = crate::auth::load_token(&app).ok_or_else(|| ApiError::Server {
        status: 401,
        code: "unauthenticated".into(),
        message: None,
    })?;
    let dek = crate::vault::active_dek(&app).ok_or_else(|| ApiError::Server {
        status: 412,
        code: "locked".into(),
        message: Some("unlock the sync key first".into()),
    })?;
    let resp: ListResp = api::get("/v1/sync/backup-targets", Some(&token)).await?;
    let mut out = Vec::with_capacity(resp.targets.len());
    for row in resp.targets {
        let plain = localforge_cloud_client::vault::decrypt(&dek, &row.encrypted_blob)
            .map_err(|e| ApiError::Decode(format!("decrypt {}: {e}", row.id)))?;
        let creds: BackupTargetInput = serde_json::from_slice(&plain)
            .map_err(|e| ApiError::Decode(format!("parse {}: {e}", row.id)))?;
        out.push(BackupTargetView {
            id: row.id,
            name: row.name,
            endpoint: creds.endpoint,
            region: creds.region,
            bucket: creds.bucket,
            access_key: creds.access_key,
            path_style: creds.path_style,
        });
    }
    Ok(out)
}

/// Add (or update) one named backup target. Admin+ required. Encrypts the
/// credentials with the org DEK before sending — the cloud never sees plaintext.
#[tauri::command]
pub async fn cloud_backup_target_add(
    app: tauri::AppHandle,
    id: String,
    name: String,
    credentials: BackupTargetInput,
) -> Result<BackupTargetView, ApiError> {
    let token = crate::auth::load_token(&app).ok_or_else(|| ApiError::Server {
        status: 401,
        code: "unauthenticated".into(),
        message: None,
    })?;
    let dek = crate::vault::active_dek(&app).ok_or_else(|| ApiError::Server {
        status: 412,
        code: "locked".into(),
        message: Some("unlock the sync key first".into()),
    })?;
    let plain = serde_json::to_vec(&credentials)
        .map_err(|e| ApiError::Decode(format!("serialize: {e}")))?;
    let blob = localforge_cloud_client::vault::encrypt(&dek, &plain)
        .map_err(|e| ApiError::Decode(format!("encrypt: {e}")))?;
    #[derive(Serialize)]
    struct Body<'a> {
        id: &'a str,
        name: &'a str,
        #[serde(rename = "encryptedBlob")]
        encrypted_blob: &'a str,
    }
    let _: serde_json::Value = api::post(
        "/v1/sync/backup-targets",
        &Body { id: &id, name: &name, encrypted_blob: &blob },
        Some(&token),
    )
    .await?;
    Ok(BackupTargetView {
        id,
        name,
        endpoint: credentials.endpoint,
        region: credentials.region,
        bucket: credentials.bucket,
        access_key: credentials.access_key,
        path_style: credentials.path_style,
    })
}

/// Remove one backup target by id. Admin+ required.
#[tauri::command]
pub async fn cloud_backup_target_delete(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), ApiError> {
    let token = crate::auth::load_token(&app).ok_or_else(|| ApiError::Server {
        status: 401,
        code: "unauthenticated".into(),
        message: None,
    })?;
    let _: serde_json::Value =
        api::delete(&format!("/v1/sync/backup-targets/{}", id), Some(&token)).await?;
    Ok(())
}
