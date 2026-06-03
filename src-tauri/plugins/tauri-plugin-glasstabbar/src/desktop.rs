//! Desktop stub — no native bar on the desktop preview build (it keeps the
//! in-webview CSS tab bar). Every method is a no-op.
use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;
use crate::Result;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<GlassTabBar<R>> {
    Ok(GlassTabBar(app.clone()))
}

pub struct GlassTabBar<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> GlassTabBar<R> {
    pub fn show_bar(&self, _req: ShowBarRequest) -> Result<()> {
        Ok(())
    }
    pub fn set_selected(&self, _req: SetSelectedRequest) -> Result<()> {
        Ok(())
    }
    pub fn hide_bar(&self) -> Result<()> {
        Ok(())
    }
}
