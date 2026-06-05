//! Mobile In-App Purchase verification commands.
//!
//! Two-stage purchase flow:
//!   1. The native plugin (`tauri-plugin-iap`, Swift StoreKit / Kotlin
//!      Play Billing) runs the store purchase sheet and hands JS a
//!      receipt handle — an Apple `transactionId` or a Google
//!      `purchaseToken`.
//!   2. JS calls one of these commands. We POST the handle to the cloud
//!      verify endpoint, which re-checks it against the store's server
//!      API and grants the plan, then we re-fetch `Me` so the UI sees
//!      the upgraded subscription without waiting for the next poll.
//!
//! Verification originates Rust-side because the session JWT lives here
//! (in the sandboxed token file, never in the WebView). The cloud route
//! is authed, so the bearer has to come from `load_token`.

use serde::{Deserialize, Serialize};

use localforge_cloud_client::api::{self, ApiError};
use localforge_cloud_client::auth::{self, Me};

fn require_token(app: &tauri::AppHandle) -> Result<String, ApiError> {
    crate::auth::load_token(app).ok_or(ApiError::Server {
        status: 401,
        code: "unauthenticated".into(),
        message: None,
    })
}

/// The cloud verify routes answer `{ ok: true, plan }`. We don't act on
/// the body — `fetch_me` is the source of truth for the refreshed
/// subscription — but `api::post` needs a concrete deserialisation type.
#[derive(Deserialize)]
struct VerifyResponse {
    #[allow(dead_code)]
    ok: bool,
    #[allow(dead_code)]
    plan: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppleVerifyBody<'a> {
    transaction_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleVerifyBody<'a> {
    purchase_token: &'a str,
    product_id: &'a str,
}

/// iOS: confirm a StoreKit transaction id and grant the plan.
#[tauri::command]
pub async fn cloud_iap_verify_apple(
    app: tauri::AppHandle,
    transaction_id: String,
) -> Result<Me, ApiError> {
    let token = require_token(&app)?;
    let _: VerifyResponse = api::post(
        "/v1/iap/apple/verify",
        &AppleVerifyBody {
            transaction_id: &transaction_id,
        },
        Some(&token),
    )
    .await?;
    auth::fetch_me(&token).await
}

/// Android: confirm a Play Billing purchase token and grant the plan.
#[tauri::command]
pub async fn cloud_iap_verify_google(
    app: tauri::AppHandle,
    purchase_token: String,
    product_id: String,
) -> Result<Me, ApiError> {
    let token = require_token(&app)?;
    let _: VerifyResponse = api::post(
        "/v1/iap/google/verify",
        &GoogleVerifyBody {
            purchase_token: &purchase_token,
            product_id: &product_id,
        },
        Some(&token),
    )
    .await?;
    auth::fetch_me(&token).await
}

/// Open the platform's subscription-management UI so the user can cancel their
/// IAP subscription themselves. Apps CANNOT cancel an Apple/Google
/// subscription on the user's behalf (it's billed against their store account,
/// not ours), so on account deletion we warn them and hand them off here.
/// Apple's documented deep link is https://apps.apple.com/account/subscriptions;
/// Google uses the Play equivalent.
#[tauri::command]
pub fn open_manage_subscriptions(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    #[cfg(target_os = "android")]
    let url = "https://play.google.com/store/account/subscriptions";
    #[cfg(not(target_os = "android"))]
    let url = "https://apps.apple.com/account/subscriptions";
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("failed to open subscription settings: {e}"))
}
