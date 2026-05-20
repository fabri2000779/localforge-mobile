use serde::{Serialize, Serializer};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("IAP is not available on this platform (desktop sells via Stripe)")]
    Unsupported,
    #[error("the user cancelled the purchase")]
    UserCancelled,
    #[error("store error: {0}")]
    Store(String),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    #[cfg(mobile)]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

// Serialize to a `{ kind, message }` object so the React layer can
// switch on `kind` (e.g. show nothing for user_cancelled, show a
// toast for store errors).
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, ser: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let kind = match self {
            Error::Unsupported => "unsupported",
            Error::UserCancelled => "user_cancelled",
            Error::Store(_) => "store",
            Error::Tauri(_) => "internal",
            #[cfg(mobile)]
            Error::PluginInvoke(_) => "internal",
        };
        let mut m = ser.serialize_map(Some(2))?;
        m.serialize_entry("kind", kind)?;
        m.serialize_entry("message", &self.to_string())?;
        m.end()
    }
}
