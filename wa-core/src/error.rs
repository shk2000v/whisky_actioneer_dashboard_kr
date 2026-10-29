#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("HTTP 오류: {0}")]
    Http(#[from] reqwest::Error),
    #[error("DB 오류: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("JSON 오류: {0}")]
    Json(#[from] serde_json::Error),
    #[error("URL 오류: {0}")]
    Url(#[from] url::ParseError),
    #[error("요청 실패 (HTTP {status}): {url}")]
    Status { status: u16, url: String },
    #[error("{0}")]
    Other(String),
}

impl Error {
    pub fn other(msg: impl Into<String>) -> Self {
        Error::Other(msg.into())
    }
}

/// Tauri commands return errors to the frontend; serialize as a plain message.
impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
