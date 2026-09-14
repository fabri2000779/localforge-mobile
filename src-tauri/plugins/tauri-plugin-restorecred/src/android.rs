//! Android bridge: forwards each call to `gg.localforge.restorecred.RestoreCredPlugin` over the Tauri
//! mobile plugin channel and blocks until Kotlin resolves it.

use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::{JsonArg, JsonResult, MaybeJsonResult};
use crate::{Error, Result};

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<RestoreCred<R>> {
    let handle = api.register_android_plugin("gg.localforge.restorecred", "RestoreCredPlugin")?;
    Ok(RestoreCred(handle))
}

pub struct RestoreCred<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> RestoreCred<R> {
    /// WebAuthn creation options JSON in, registration response JSON out.
    pub fn create(&self, request_json: &str) -> Result<String> {
        let r: JsonResult = self
            .0
            .run_mobile_plugin("create", JsonArg { request_json })
            .map_err(map_err)?;
        Ok(r.response_json)
    }

    /// WebAuthn request options JSON in; `None` when the device holds no restore credential.
    pub fn get(&self, request_json: &str) -> Result<Option<String>> {
        let r: MaybeJsonResult = self
            .0
            .run_mobile_plugin("get", JsonArg { request_json })
            .map_err(map_err)?;
        Ok(r.response_json)
    }

    pub fn clear(&self) -> Result<()> {
        self.0.run_mobile_plugin("clear", ()).map_err(map_err)
    }
}

// Kotlin rejects with the literal "unsupported" below Android 9; everything else is a native error.
fn map_err(e: tauri::plugin::mobile::PluginInvokeError) -> Error {
    let msg = e.to_string();
    if msg.contains("unsupported") {
        Error::Unsupported
    } else {
        Error::Native(msg)
    }
}
