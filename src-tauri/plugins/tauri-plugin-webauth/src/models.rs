//! Wire types for the `authenticate` command. camelCase on the wire to
//! match the native (Swift/Kotlin) JSON.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthRequest {
    /// The provider's authorization URL to load in the in-app browser.
    pub url: String,
    /// The custom URL scheme the cloud will redirect back to
    /// (e.g. "localforge"). iOS' ASWebAuthenticationSession captures it
    /// directly; Android routes it to the app via an intent filter.
    pub scheme: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResponse {
    /// The full callback URL the browser was redirected to, e.g.
    /// `localforge://auth/callback?token=…`.
    pub url: String,
}
