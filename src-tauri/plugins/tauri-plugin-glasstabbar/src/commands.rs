use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::GlassTabBarExt;
use crate::Result;

#[command]
pub(crate) async fn show_bar<R: Runtime>(
    app: AppHandle<R>,
    items: Vec<TabItem>,
    selected: Option<String>,
) -> Result<()> {
    app.glasstabbar().show_bar(ShowBarRequest { items, selected })
}

#[command]
pub(crate) async fn set_selected<R: Runtime>(app: AppHandle<R>, id: String) -> Result<()> {
    app.glasstabbar().set_selected(SetSelectedRequest { id })
}

#[command]
pub(crate) async fn hide_bar<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.glasstabbar().hide_bar()
}
