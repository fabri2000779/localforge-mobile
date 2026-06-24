//! Mobile push-token registration.
//!
//! The native layer (iOS APNs / Android FCM) acquires this device's opaque
//! push token and hands it here; we register it with the cloud so crash pushes
//! can reach this phone. User-scoped (a token belongs to a person, not an org),
//! so the session JWT is all the cloud needs. Delivery itself is
//! credential-gated server-side (lib/push.ts on the Worker).
//!
//! NOTE: the native token acquisition (registering for remote notifications +
//! catching the device token) lives in the generated iOS/Android shells and is
//! wired in a device session — this command is the bridge it calls.

use localforge_cloud_client::api::{self, ApiError};

fn unauth() -> ApiError {
    ApiError::Server {
        status: 401,
        code: "unauthenticated".into(),
        message: None,
    }
}

#[derive(serde::Serialize)]
struct RegisterBody<'a> {
    platform: &'a str,
    token: &'a str,
}

/// Register this device's push token with the cloud. `platform` is "apns"
/// (iOS) or "fcm" (Android); `token` is the opaque device token the OS handed
/// the native layer. Idempotent server-side (the token is the primary key, so
/// re-registering just refreshes the owner + last-seen).
#[tauri::command]
pub async fn cloud_push_register(
    app: tauri::AppHandle,
    platform: String,
    token: String,
) -> Result<(), ApiError> {
    let session = crate::auth::load_token(&app).ok_or_else(unauth)?;
    let _: serde_json::Value = api::post(
        "/v1/push/register",
        &RegisterBody {
            platform: &platform,
            token: &token,
        },
        Some(&session),
    )
    .await?;
    Ok(())
}
