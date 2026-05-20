use tauri::{command, AppHandle, Runtime};

use crate::models::{Product, PurchaseResult};
use crate::IapExt;
use crate::Result;

#[command]
pub(crate) async fn get_products<R: Runtime>(
    app: AppHandle<R>,
    product_ids: Vec<String>,
) -> Result<Vec<Product>> {
    app.iap().get_products(product_ids)
}

#[command]
pub(crate) async fn purchase<R: Runtime>(
    app: AppHandle<R>,
    product_id: String,
) -> Result<PurchaseResult> {
    app.iap().purchase(product_id)
}

#[command]
pub(crate) async fn restore_purchases<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<PurchaseResult>> {
    app.iap().restore_purchases()
}
