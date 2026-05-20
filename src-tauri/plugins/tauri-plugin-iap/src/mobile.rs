//! Mobile bridge.
//!
//! Forwards each command to the native plugin (`IapPlugin` on iOS,
//! `gg.localforge.iap.IapPlugin` on Android) over the Tauri mobile
//! `run_mobile_plugin` channel. The native side does the real StoreKit /
//! Play Billing work and resolves a JSON object we deserialize here.
//!
//! Native resolves objects (Android's `JSObject` can't be a bare array),
//! so list-returning calls come back wrapped — `{ "products": [...] }`,
//! `{ "purchases": [...] }` — and we unwrap before handing to the
//! command layer. `purchase` resolves a single `PurchaseResult` object.

use serde::{de::DeserializeOwned, Deserialize};
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;
use crate::Result;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_iap);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<Iap<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("gg.localforge.iap", "IapPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_iap)?;
    Ok(Iap(handle))
}

#[derive(Deserialize)]
struct ProductsResponse {
    products: Vec<Product>,
}

#[derive(Deserialize)]
struct PurchasesResponse {
    purchases: Vec<PurchaseResult>,
}

/// Handle onto the registered native plugin.
pub struct Iap<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Iap<R> {
    pub fn get_products(&self, product_ids: Vec<String>) -> Result<Vec<Product>> {
        let res: ProductsResponse = self
            .0
            .run_mobile_plugin("getProducts", GetProductsRequest { product_ids })?;
        Ok(res.products)
    }

    pub fn purchase(&self, product_id: String) -> Result<PurchaseResult> {
        self.0
            .run_mobile_plugin("purchase", PurchaseRequest { product_id })
            .map_err(|e| {
                // The native side rejects a user-cancelled sheet with the
                // literal "user_cancelled"; lift it to its own kind so the
                // UI can stay silent. Everything else is a store error the
                // user should see.
                let msg = e.to_string();
                if msg.contains("user_cancelled") {
                    crate::Error::UserCancelled
                } else {
                    crate::Error::Store(msg)
                }
            })
    }

    pub fn restore_purchases(&self) -> Result<Vec<PurchaseResult>> {
        let res: PurchasesResponse = self.0.run_mobile_plugin("restorePurchases", ())?;
        Ok(res.purchases)
    }
}
