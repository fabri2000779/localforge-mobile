//! Wire types. camelCase on the wire to match the native Swift JSON.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabItem {
    /// Stable id the JS uses to identify the tab (e.g. "servers").
    pub id: String,
    /// Visible label under the icon.
    pub label: String,
    /// SF Symbol name for the icon (e.g. "externaldrive").
    pub sf_symbol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowBarRequest {
    pub items: Vec<TabItem>,
    /// Which tab id is selected on first show. Defaults to the first.
    pub selected: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSelectedRequest {
    pub id: String,
}
