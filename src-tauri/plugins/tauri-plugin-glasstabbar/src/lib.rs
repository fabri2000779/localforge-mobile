//! tauri-plugin-glasstabbar — native iOS tab bar for LocalForge mobile.
//!
//! On iOS it mounts a native `UITabBar` over the webview (which renders
//! with the Liquid Glass material on iOS 26) and emits a `select` event
//! when the user taps a tab. The JS layer switches its route on that event
//! and hides the in-webview CSS tab bar. Android + desktop are no-ops.
//!
//! Commands (JS → native):
//!   show_bar(items, selected) — create/replace the bar.
//!   set_selected(id)          — sync the highlight after a programmatic nav.
//!   hide_bar()                — remove it.
//! Event (native → JS): `select` `{ id }` — a tab was tapped.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
mod error;
mod models;

pub use error::{Error, Result};
pub use models::{SetSelectedRequest, ShowBarRequest, TabItem};

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

#[cfg(desktop)]
use desktop::GlassTabBar;
#[cfg(mobile)]
use mobile::GlassTabBar;

pub trait GlassTabBarExt<R: Runtime> {
    fn glasstabbar(&self) -> &GlassTabBar<R>;
}

impl<R: Runtime, T: Manager<R>> GlassTabBarExt<R> for T {
    fn glasstabbar(&self) -> &GlassTabBar<R> {
        self.state::<GlassTabBar<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("glasstabbar")
        .invoke_handler(tauri::generate_handler![
            commands::show_bar,
            commands::set_selected,
            commands::hide_bar
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let g = mobile::init(app, api)?;
            #[cfg(desktop)]
            let g = desktop::init(app, api)?;
            app.manage(g);
            Ok(())
        })
        .build()
}
