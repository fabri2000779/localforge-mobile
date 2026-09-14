//! Mobile bridge. iOS forwards to the native `GlassTabBarPlugin`; Android
//! has no native side (it keeps the CSS bar), so every method is a no-op.
use serde::de::DeserializeOwned;
#[cfg(target_os = "ios")]
use tauri::plugin::PluginHandle;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;
use crate::Result;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_glasstabbar);

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<GlassTabBar<R>> {
    let _ = app;
    #[cfg(target_os = "ios")]
    {
        let handle = api.register_ios_plugin(init_plugin_glasstabbar)?;
        Ok(GlassTabBar::Ios(handle))
    }
    #[cfg(target_os = "android")]
    {
        let _ = api;
        Ok(GlassTabBar::Noop(std::marker::PhantomData))
    }
}

pub enum GlassTabBar<R: Runtime> {
    #[cfg(target_os = "ios")]
    Ios(PluginHandle<R>),
    // `fn() -> R` keeps the no-op Send + Sync without holding anything.
    #[cfg(target_os = "android")]
    Noop(std::marker::PhantomData<fn() -> R>),
}

impl<R: Runtime> GlassTabBar<R> {
    pub fn show_bar(&self, req: ShowBarRequest) -> Result<()> {
        match self {
            #[cfg(target_os = "ios")]
            GlassTabBar::Ios(h) => {
                h.run_mobile_plugin::<serde_json::Value>("showBar", req)?;
                Ok(())
            }
            #[cfg(target_os = "android")]
            GlassTabBar::Noop(_) => {
                let _ = req;
                Ok(())
            }
        }
    }

    pub fn set_selected(&self, req: SetSelectedRequest) -> Result<()> {
        match self {
            #[cfg(target_os = "ios")]
            GlassTabBar::Ios(h) => {
                h.run_mobile_plugin::<serde_json::Value>("setSelected", req)?;
                Ok(())
            }
            #[cfg(target_os = "android")]
            GlassTabBar::Noop(_) => {
                let _ = req;
                Ok(())
            }
        }
    }

    pub fn hide_bar(&self) -> Result<()> {
        match self {
            #[cfg(target_os = "ios")]
            GlassTabBar::Ios(h) => {
                h.run_mobile_plugin::<serde_json::Value>("hideBar", ())?;
                Ok(())
            }
            #[cfg(target_os = "android")]
            GlassTabBar::Noop(_) => Ok(()),
        }
    }
}
