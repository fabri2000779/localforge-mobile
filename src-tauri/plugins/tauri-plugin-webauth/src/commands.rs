use tauri::{command, AppHandle, Runtime};

use crate::models::AuthResponse;
use crate::Result;
use crate::WebauthExt;

#[command]
pub(crate) async fn authenticate<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    scheme: String,
) -> Result<AuthResponse> {
    app.webauth().authenticate(url, scheme)
}
