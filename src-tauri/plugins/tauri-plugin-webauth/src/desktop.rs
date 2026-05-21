//! Desktop stub. The real desktop app receives the localforge:// OAuth
//! callback through its own deep-link wiring; the mobile-repo desktop
//! preview build just returns Unsupported (the caller falls back to
//! opening the system browser).
use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;
use crate::{Error, Result};

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Webauth<R>> {
    Ok(Webauth(app.clone()))
}

pub struct Webauth<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> Webauth<R> {
    pub fn authenticate(&self, _url: String, _scheme: String) -> Result<AuthResponse> {
        Err(Error::Unsupported)
    }
}
