//! Payloads crossing Rust ↔ Kotlin; camelCase on the wire.

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonArg<'a> {
    pub request_json: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonResult {
    pub response_json: String,
}

/// `get` resolves with an empty object when the device holds no restore credential.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaybeJsonResult {
    #[serde(default)]
    pub response_json: Option<String>,
}
