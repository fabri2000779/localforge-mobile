//! tauri-plugin-restorecred — Android Restore Credentials (Credential Manager) for Zero-Tap Sign-In.
//!
//! `create` stores a WebAuthn key in Block Store (backed up with the user's Google backup), `get`
//! signs the cloud's challenge with it on the next device, `clear` drops it on sign-out. Android-only:
//! iOS and desktop get a stub whose calls report `Error::Unsupported`. No JS surface — the app's Rust
//! auth module drives it and does the cloud round-trips.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod error;
#[cfg(target_os = "android")]
mod models;

pub use error::{Error, Result};

#[cfg(target_os = "android")]
mod android;
#[cfg(not(target_os = "android"))]
mod stub;

#[cfg(target_os = "android")]
use android::RestoreCred;
#[cfg(not(target_os = "android"))]
use stub::RestoreCred;

pub trait RestoreCredExt<R: Runtime> {
    fn restore_cred(&self) -> &RestoreCred<R>;
}

impl<R: Runtime, T: Manager<R>> RestoreCredExt<R> for T {
    fn restore_cred(&self) -> &RestoreCred<R> {
        self.state::<RestoreCred<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("restorecred")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let handle = android::init(app, api)?;
            #[cfg(not(target_os = "android"))]
            let handle = stub::init(app, api)?;
            app.manage(handle);
            Ok(())
        })
        .build()
}
