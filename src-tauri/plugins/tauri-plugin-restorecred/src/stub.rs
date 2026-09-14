//! iOS / desktop: Restore Credentials are Android-only, so every call reports `Unsupported`.

use std::marker::PhantomData;

use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::{Error, Result};

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> Result<RestoreCred<R>> {
    Ok(RestoreCred(PhantomData))
}

// `fn() -> R` keeps the handle Send + Sync regardless of the runtime type (managed state needs both).
pub struct RestoreCred<R: Runtime>(PhantomData<fn() -> R>);

impl<R: Runtime> RestoreCred<R> {
    pub fn create(&self, _request_json: &str) -> Result<String> {
        Err(Error::Unsupported)
    }

    pub fn get(&self, _request_json: &str) -> Result<Option<String>> {
        Err(Error::Unsupported)
    }

    pub fn clear(&self) -> Result<()> {
        Ok(())
    }
}
