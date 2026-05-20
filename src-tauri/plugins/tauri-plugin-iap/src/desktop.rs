//! Desktop stub.
//!
//! The desktop app monetises through Stripe (cloud `/v1/stripe`), so the
//! IAP commands have nothing to do here — every call returns
//! `Error::Unsupported`. We still register the plugin so the JS `invoke`
//! surface exists uniformly across platforms; the React paywall checks
//! the platform and never calls these on desktop.

use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;
use crate::{Error, Result};

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Iap<R>> {
    Ok(Iap(app.clone()))
}

/// Stub handle. Holds the `AppHandle` only so the type lines up with the
/// mobile flavour; none of the methods touch it.
pub struct Iap<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> Iap<R> {
    pub fn get_products(&self, _product_ids: Vec<String>) -> Result<Vec<Product>> {
        Err(Error::Unsupported)
    }

    pub fn purchase(&self, _product_id: String) -> Result<PurchaseResult> {
        Err(Error::Unsupported)
    }

    pub fn restore_purchases(&self) -> Result<Vec<PurchaseResult>> {
        Err(Error::Unsupported)
    }
}
