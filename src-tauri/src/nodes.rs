//! Mobile node/machine commands.
//!
//! Thin wrapper over the shared `localforge_cloud_client::nodes` — reads
//! the bearer token from the keychain and delegates. Lets the Machines
//! tab enumerate every machine in the org (desktops + agents) with live
//! online status, so a sub-user can see and switch across all of them.

use localforge_cloud_client::api::ApiError;
use localforge_cloud_client::nodes::{self, Machine};

fn unauth() -> ApiError {
    ApiError::Server {
        status: 401,
        code: "unauthenticated".into(),
        message: None,
    }
}

/// Every machine in the caller's org — desktops + agents — with live
/// online status from the relay.
#[tauri::command]
pub async fn cloud_list_machines(app: tauri::AppHandle) -> Result<Vec<Machine>, ApiError> {
    let Some(token) = crate::auth::load_token(&app) else {
        return Err(unauth());
    };
    nodes::machines(&token).await
}
