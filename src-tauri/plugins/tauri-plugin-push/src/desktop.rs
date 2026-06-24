//! Desktop stub.
//!
//! The desktop app has no remote push (it watches its own crash journal
//! directly and triggers cloud pushes for teammates). `register` returns
//! `Error::Unsupported`; we still register the plugin so the JS `invoke`
//! surface exists uniformly and the React layer can call it unconditionally.

use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::{QuickAction, RegisterResult};
use crate::{Error, Result};

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Push<R>> {
    Ok(Push(app.clone()))
}

/// Stub handle. Holds the `AppHandle` only so the type lines up with the
/// mobile flavour; the method never touches it.
pub struct Push<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> Push<R> {
    pub fn register(&self) -> Result<RegisterResult> {
        Err(Error::Unsupported)
    }

    pub fn set_quick_actions(&self, _items: Vec<QuickAction>) -> Result<()> {
        // No home-screen shortcuts on desktop — silently accept.
        Ok(())
    }
}
