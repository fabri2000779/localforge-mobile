use serde::{Serialize, Serializer};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("push is not available on this platform")]
    Unsupported,
    #[error("the user denied notification permission")]
    Denied,
    #[error("push error: {0}")]
    Push(String),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    #[cfg(mobile)]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

// Serialize to a `{ kind, message }` object so the React layer can switch on
// `kind` (e.g. stay silent on `denied`, log `unsupported`).
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, ser: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let kind = match self {
            Error::Unsupported => "unsupported",
            Error::Denied => "denied",
            Error::Push(_) => "push",
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
