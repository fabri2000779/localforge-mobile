//! Mobile org / team commands.
//!
//! Thin wrappers over the shared `localforge_cloud_client::orgs` so the
//! Team tab can list members and invite sub-users by email + role —
//! bringing the desktop's member management to the phone.

use base64::Engine;

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

/// Accept an invitation from the phone. `token` is the invitation id (from the
/// `localforge://invite` deep link or pasted); `secret` is the base64 invite
/// secret from the link #fragment when present (handoff). On a handoff we
/// unwrap the org DEK, adopt it (instant decrypt + durable cache) and self-seal
/// a grant so the member's other devices get access too. Returns the joined
/// org id so the UI can switch to it.
#[tauri::command(rename_all = "camelCase")]
pub async fn cloud_orgs_accept_invite(
    app: tauri::AppHandle,
    token: String,
    secret: Option<String>,
) -> Result<String, ApiError> {
    let Some(bearer) = crate::auth::load_token(&app) else {
        return Err(unauth());
    };
    let res = orgs::accept_invite_full(&token, &bearer).await?;
    if let (Some(secret_b64), Some(wrapped)) = (secret, res.wrapped_dek.as_ref()) {
        if let Ok(s) = base64::engine::general_purpose::STANDARD.decode(secret_b64.trim()) {
            if s.len() == 32 {
                let mut sk = [0u8; 32];
                sk.copy_from_slice(&s);
                if let Ok(dek) = localforge_cloud_client::vault::unwrap_dek(&sk, wrapped) {
                    crate::vault::adopt_org_dek(&app, &res.org_id, &dek);
                    // Durable cross-device access without waiting for the owner:
                    // self-seal a grant to our own pubkey. We need our user id —
                    // fetch /me rather than depend on the accept response field
                    // (which only newer cloud-client builds expose). Best-effort;
                    // self_seal_grant skips silently if we have no keypair yet.
                    if let Ok(me) = localforge_cloud_client::auth::fetch_me(&bearer).await {
                        let _ =
                            crate::vault::self_seal_grant(&app, &res.org_id, &me.id, &dek, &bearer)
                                .await;
                    }
                }
            }
        }
    }
    Ok(res.org_id)
}
