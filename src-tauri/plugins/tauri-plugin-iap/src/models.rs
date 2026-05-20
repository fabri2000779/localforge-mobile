//! Shared types crossing the JS ↔ Rust ↔ native boundary. serde
//! round-trips them; field names are camelCase on the wire to match
//! the TS side.

use serde::{Deserialize, Serialize};

/// A purchasable product as the store reports it. Price is the
/// store-localised display string ("€5.00", "$4.99") — we never do
/// our own currency formatting, the store knows the user's locale +
/// regional pricing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: String,
    pub title: String,
    pub description: String,
    /// Localised, currency-formatted price string from the store.
    pub display_price: String,
    /// 'hobby' | 'team'. The native stores don't know our plan concept,
    /// so they omit it (serde default = ""); the guest-js layer fills it
    /// from the id, keeping the id→plan map in exactly one place.
    #[serde(default)]
    pub plan: String,
}

/// The result of a completed purchase (or a restored one). Carries
/// exactly what the backend verify endpoints need:
///   iOS     → `transaction_id`  → POST /v1/iap/apple/verify
///   Android → `purchase_token`  → POST /v1/iap/google/verify
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseResult {
    pub product_id: String,
    /// 'ios' | 'android'
    pub platform: String,
    /// StoreKit 2 transaction id (iOS only).
    pub transaction_id: Option<String>,
    /// Play Billing purchase token (Android only).
    pub purchase_token: Option<String>,
}

// These request payloads are only constructed by the mobile bridge
// (`mobile.rs`, cfg(mobile)); on a desktop preview build they're unused,
// so suppress the dead-code lint there without hiding the type.
#[cfg_attr(desktop, allow(dead_code))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetProductsRequest {
    /// Product identifiers to fetch from the store.
    pub product_ids: Vec<String>,
}

#[cfg_attr(desktop, allow(dead_code))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseRequest {
    pub product_id: String,
}
