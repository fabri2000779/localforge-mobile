use tauri::{command, AppHandle, Runtime};

use crate::models::{QuickAction, RegisterResult};
use crate::PushExt;
use crate::Result;

/// Request notification permission + register for remote notifications,
/// resolving with this device's push token. Async on the native side (the
/// token arrives via a delegate callback / Firebase task).
#[command]
pub(crate) async fn register<R: Runtime>(app: AppHandle<R>) -> Result<RegisterResult> {
    app.push().register()
}

/// Replace this app's home-screen Quick Actions / shortcuts with one per
/// supplied server. Tapping a shortcut opens that server (same `openServer`
/// path as a tapped crash push). No-op on desktop.
#[command]
pub(crate) async fn set_quick_actions<R: Runtime>(
    app: AppHandle<R>,
    items: Vec<QuickAction>,
) -> Result<()> {
    app.push().set_quick_actions(items)
}
