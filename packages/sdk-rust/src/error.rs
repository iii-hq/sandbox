use thiserror::Error;

#[derive(Error, Debug)]
pub enum SandboxError {
    #[error("HTTP error: {method} {path} failed with status {status}: {body}")]
    Http {
        method: String,
        path: String,
        status: u16,
        body: String,
    },
    #[error("Request error: {0}")]
    Request(#[from] reqwest::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Stream error: {0}")]
    Stream(String),
    #[error("Client build error: {0}")]
    ClientBuild(String),
}

pub type Result<T> = std::result::Result<T, SandboxError>;
