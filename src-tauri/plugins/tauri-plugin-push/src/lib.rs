//! tauri-plugin-push — remote push registration for LocalForge mobile.
//!
//! JS calls `register()`; on mobile it routes to the native APNs (iOS) / FCM
//! (Android) registration, resolving with the device push token. On desktop it
//! returns `Error::Unsupported`. The plugin ALSO emits an `openServer` event
//! (serverId payload) when a crash push or Quick Action is tapped — the app
//! listens and deep-links to that server.
//!
//! Division of labour: this plugin's job ends at "here's the device token" and
//! "the user tapped a notification for server X". Forwarding the token to the
//! cloud (`cloud_push_register`) and resolving serverId → a real name happens
//! in the app layer, exactly mirroring how tauri-plugin-iap hands a receipt
//! handle back for the app to verify.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
mod error;
mod models;

pub use error::{Error, Result};
pub use models::RegisterResult;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

#[cfg(desktop)]
use desktop::Push;
#[cfg(mobile)]
use mobile::Push;

/// Access to the push APIs from Rust (rarely needed — the React layer drives
/// everything through the `register` command + the `openServer` event).
pub trait PushExt<R: Runtime> {
    fn push(&self) -> &Push<R>;
}

impl<R: Runtime, T: Manager<R>> PushExt<R> for T {
    fn push(&self) -> &Push<R> {
        self.state::<Push<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("push")
        .invoke_handler(tauri::generate_handler![
            commands::register,
            commands::set_quick_actions
        ])
        .setup(|app, _api| {
            #[cfg(mobile)]
            let push = mobile::init(app, _api)?;
            #[cfg(desktop)]
            let push = desktop::init(app, _api)?;
            app.manage(push);
            Ok(())
        })
        .build()
}
