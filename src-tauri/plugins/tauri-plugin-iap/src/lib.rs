//! tauri-plugin-iap — In-App Purchase for LocalForge mobile.
//!
//! JS calls `getProducts` / `purchase` / `restorePurchases`; on mobile
//! these route to the native StoreKit (iOS) / Play Billing (Android)
//! implementations via the Tauri mobile plugin bridge. On desktop they
//! return `Error::Unsupported` (the desktop app uses Stripe).
//!
//! After a successful purchase the JS layer hands the returned
//! transaction id / purchase token to the cloud verify endpoint
//! (POST /v1/iap/{apple,google}/verify) which grants the plan. This
//! plugin's job ends at "the store says the purchase succeeded, here's
//! the receipt handle".

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
mod error;
mod models;

pub use error::{Error, Result};
pub use models::{Product, PurchaseResult};

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

#[cfg(desktop)]
use desktop::Iap;
#[cfg(mobile)]
use mobile::Iap;

/// Access to the IAP APIs from Rust (rarely needed — the React layer
/// drives everything through the commands).
pub trait IapExt<R: Runtime> {
    fn iap(&self) -> &Iap<R>;
}

impl<R: Runtime, T: Manager<R>> IapExt<R> for T {
    fn iap(&self) -> &Iap<R> {
        self.state::<Iap<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("iap")
        .invoke_handler(tauri::generate_handler![
            commands::get_products,
            commands::purchase,
            commands::restore_purchases,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let iap = mobile::init(app, api)?;
            #[cfg(desktop)]
            let iap = desktop::init(app, api)?;
            app.manage(iap);
            Ok(())
        })
        .build()
}
