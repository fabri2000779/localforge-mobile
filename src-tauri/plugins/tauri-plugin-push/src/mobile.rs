//! Mobile bridge.
//!
//! Forwards `register` to the native plugin (`PushPlugin` on iOS,
//! `gg.localforge.push.PushPlugin` on Android) over the Tauri mobile
//! `run_mobile_plugin` channel. The native side does the real APNs / FCM
//! registration and resolves a `{ platform, token }` object we deserialize
//! here. The native side ALSO emits the `openServer` event directly to JS
//! (via the Tauri plugin event channel) on a notification tap — that path
//! doesn't pass back through Rust, so there's nothing to wire for it here.

use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::{QuickAction, RegisterResult, SetQuickActionsRequest};
use crate::Result;

// iOS binding — generates glue that calls the C function `init_plugin_push`
// exported from the Swift side (see PushPlugin.swift).
#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_push);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<Push<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("gg.localforge.push", "PushPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_push)?;
    Ok(Push(handle))
}

/// Handle onto the registered native plugin.
pub struct Push<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Push<R> {
    pub fn register(&self) -> Result<RegisterResult> {
        self.0.run_mobile_plugin("register", ()).map_err(|e| {
            // The native side rejects a denied permission with the literal
            // "denied"; lift it to its own kind so the UI can stay silent.
            let msg = e.to_string();
            if msg.contains("denied") {
                crate::Error::Denied
            } else {
                crate::Error::Push(msg)
            }
        })
    }

    pub fn set_quick_actions(&self, items: Vec<QuickAction>) -> Result<()> {
        self.0
            .run_mobile_plugin("setQuickActions", SetQuickActionsRequest { items })
            .map_err(|e| crate::Error::Push(e.to_string()))
    }
}
