//! Mobile bridge. Forwards `authenticate` to the native plugin
//! (`WebauthPlugin` on iOS, `gg.localforge.webauth.WebauthPlugin` on
//! Android) and blocks until the native side resolves with the callback
//! URL (i.e. once the user finishes signing in in the in-app browser).
use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;
use crate::Result;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_webauth);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<Webauth<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("gg.localforge.webauth", "WebauthPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_webauth)?;
    Ok(Webauth(handle))
}

pub struct Webauth<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Webauth<R> {
    /// Present the in-app browser and block until the redirect to
    /// `scheme://…` lands. Returns the full callback URL.
    pub fn authenticate(&self, url: String, scheme: String) -> Result<AuthResponse> {
        self.0
            .run_mobile_plugin("authenticate", AuthRequest { url, scheme })
            .map_err(|e| {
                // The native side rejects a user-dismissed sheet with the
                // literal "user_cancelled" so the UI can stay silent.
                let msg = e.to_string();
                if msg.contains("user_cancelled") {
                    crate::Error::UserCancelled
                } else {
                    crate::Error::Auth(msg)
                }
            })
    }
}
