//! tauri-plugin-webauth — in-app OAuth browser for LocalForge mobile.
//!
//! One command, `authenticate(url, scheme)`, opens the provider's auth
//! page in an in-app browser and resolves with the callback URL the
//! browser was redirected to:
//!   iOS     → ASWebAuthenticationSession (captures the callbackScheme).
//!   Android → Chrome Custom Tabs; the `scheme://…` redirect comes back
//!             via the activity's onNewIntent.
//! Desktop returns `Error::Unsupported`.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
mod error;
mod models;

pub use error::{Error, Result};
pub use models::{AuthRequest, AuthResponse};

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

#[cfg(desktop)]
use desktop::Webauth;
#[cfg(mobile)]
use mobile::Webauth;

/// Rust access to the in-app web-auth API (the mobile OAuth flow calls
/// this directly from `oauth::cloud_oauth_start`).
pub trait WebauthExt<R: Runtime> {
    fn webauth(&self) -> &Webauth<R>;
}

impl<R: Runtime, T: Manager<R>> WebauthExt<R> for T {
    fn webauth(&self) -> &Webauth<R> {
        self.state::<Webauth<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("webauth")
        .invoke_handler(tauri::generate_handler![commands::authenticate])
        .setup(|app, api| {
            #[cfg(mobile)]
            let webauth = mobile::init(app, api)?;
            #[cfg(desktop)]
            let webauth = desktop::init(app, api)?;
            app.manage(webauth);
            Ok(())
        })
        .build()
}
