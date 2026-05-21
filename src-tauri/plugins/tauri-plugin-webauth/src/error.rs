use serde::{Serialize, Serializer};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("in-app web auth is not available on this platform")]
    Unsupported,
    #[error("the user cancelled sign-in")]
    UserCancelled,
    #[error("web auth error: {0}")]
    Auth(String),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    #[cfg(mobile)]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

// Serialize to `{ kind, message }` so the React/Rust caller can switch on
// `kind` (stay silent on user_cancelled, surface a message otherwise).
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, ser: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let kind = match self {
            Error::Unsupported => "unsupported",
            Error::UserCancelled => "user_cancelled",
            Error::Auth(_) => "auth",
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
