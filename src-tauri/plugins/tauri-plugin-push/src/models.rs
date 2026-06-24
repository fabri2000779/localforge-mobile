//! Shared types crossing the JS ↔ Rust ↔ native boundary. serde round-trips
//! them; field names are camelCase on the wire to match the TS side.

use serde::{Deserialize, Serialize};

/// The result of registering for remote notifications: the opaque device
/// token + which platform minted it. The app forwards this verbatim to the
/// cloud (`cloud_push_register`) which stores it for crash-push delivery.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterResult {
    /// 'ios' (APNs hex token) | 'android' (FCM token).
    pub platform: String,
    pub token: String,
}

/// One home-screen Quick Action / app shortcut. Tapping it opens the given
/// server (same `openServer` event / deep link as a tapped crash push).
#[cfg_attr(desktop, allow(dead_code))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAction {
    pub server_id: String,
    /// Display label (the server name).
    pub label: String,
}

#[cfg_attr(desktop, allow(dead_code))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetQuickActionsRequest {
    pub items: Vec<QuickAction>,
}
