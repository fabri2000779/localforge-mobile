//! Mobile org / team commands.
//!
//! Thin wrappers over the shared `localforge_cloud_client::orgs` so the
//! Team tab can list members and invite sub-users by email + role —
//! bringing the desktop's member management to the phone.

use localforge_cloud_client::api::ApiError;
use localforge_cloud_client::orgs::{self, OrgInfo, OrgSummary};

fn unauth() -> ApiError {
    ApiError::Server {
        status: 401,
        code: "unauthenticated".into(),
        message: None,
    }
}

/// The user's primary org — name, the caller's role, and the member list.
#[tauri::command]
pub async fn cloud_org_me(app: tauri::AppHandle) -> Result<OrgInfo, ApiError> {
    let Some(token) = crate::auth::load_token(&app) else {
        return Err(unauth());
    };
    orgs::me(&token).await
}

/// Every org the user belongs to (own + ones they were invited to). Powers
/// the org switcher so a sub-user can view the OWNER's org from the phone.
#[tauri::command]
pub async fn cloud_orgs_list(app: tauri::AppHandle) -> Result<Vec<OrgSummary>, ApiError> {
    let Some(token) = crate::auth::load_token(&app) else {
        return Err(unauth());
    };
    orgs::list(&token).await
}

/// Point every subsequent cloud call at a specific org (sent as the
/// `X-LocalForge-Org` header, membership-verified server-side). Set on org
/// switch so machine listing + server list resolve to the OWNER's org;
/// cleared on sign-out.
#[tauri::command(rename_all = "camelCase")]
pub fn cloud_set_active_org(org_id: Option<String>) {
    localforge_cloud_client::api::set_active_org(org_id);
}

/// Invite a sub-user by email with a role (viewer|operator|admin). The
/// cloud emails them a `localforge://invite` deep link. Admin+ only —
/// enforced server-side, so a non-admin call just 403s.
#[tauri::command]
pub async fn cloud_org_invite(
    app: tauri::AppHandle,
    org_id: String,
    email: String,
    role: String,
) -> Result<(), ApiError> {
    let Some(token) = crate::auth::load_token(&app) else {
        return Err(unauth());
    };
    orgs::invite(&org_id, &email, &role, &token).await?;
    Ok(())
}
