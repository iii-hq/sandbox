use std::sync::Arc;

use crate::client::HttpClient;
use crate::error::Result;
use crate::types::{ExecResult, GitBranchResult, GitDiffResponse, GitLogResponse, GitStatus};
use crate::util::url_encode;

pub struct GitManager {
    client: Arc<HttpClient>,
    sandbox_id: String,
}

#[derive(Debug, Clone, Default)]
pub struct GitCloneOptions {
    pub path: Option<String>,
    pub branch: Option<String>,
    pub depth: Option<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct GitCommitOptions {
    pub path: Option<String>,
    pub all: Option<bool>,
}

#[derive(Debug, Clone, Default)]
pub struct GitDiffOptions {
    pub path: Option<String>,
    pub staged: Option<bool>,
    pub file: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct GitLogOptions {
    pub path: Option<String>,
    pub count: Option<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct GitBranchOptions {
    pub path: Option<String>,
    pub name: Option<String>,
    pub delete: Option<bool>,
}

#[derive(Debug, Clone, Default)]
pub struct GitPushOptions {
    pub path: Option<String>,
    pub remote: Option<String>,
    pub branch: Option<String>,
    pub force: Option<bool>,
}

#[derive(Debug, Clone, Default)]
pub struct GitPullOptions {
    pub path: Option<String>,
    pub remote: Option<String>,
    pub branch: Option<String>,
}

impl GitManager {
    pub fn new(client: Arc<HttpClient>, sandbox_id: String) -> Self {
        Self { client, sandbox_id }
    }

    pub async fn clone_repo(
        &self,
        url: &str,
        options: Option<GitCloneOptions>,
    ) -> Result<ExecResult> {
        let mut body = serde_json::json!({ "url": url });
        if let Some(opts) = options {
            if let Some(path) = opts.path {
                body["path"] = serde_json::Value::String(path);
            }
            if let Some(branch) = opts.branch {
                body["branch"] = serde_json::Value::String(branch);
            }
            if let Some(depth) = opts.depth {
                body["depth"] = serde_json::json!(depth);
            }
        }
        self.client
            .post(
                &format!("/sandbox/sandboxes/{}/git/clone", self.sandbox_id),
                Some(&body),
            )
            .await
    }

    pub async fn status(&self, path: Option<&str>) -> Result<GitStatus> {
        let query = match path {
            Some(p) => format!(
                "?path={}",
                url_encode(p)
            ),
            None => String::new(),
        };
        self.client
            .get(&format!(
                "/sandbox/sandboxes/{}/git/status{}",
                self.sandbox_id, query
            ))
            .await
    }

    pub async fn commit(
        &self,
        message: &str,
        options: Option<GitCommitOptions>,
    ) -> Result<ExecResult> {
        let mut body = serde_json::json!({ "message": message });
        if let Some(opts) = options {
            if let Some(path) = opts.path {
                body["path"] = serde_json::Value::String(path);
            }
            if let Some(all) = opts.all {
                body["all"] = serde_json::json!(all);
            }
        }
        self.client
            .post(
                &format!("/sandbox/sandboxes/{}/git/commit", self.sandbox_id),
                Some(&body),
            )
            .await
    }

    pub async fn diff(&self, options: Option<GitDiffOptions>) -> Result<GitDiffResponse> {
        let mut params = Vec::new();
        if let Some(ref opts) = options {
            if let Some(ref path) = opts.path {
                params.push(format!("path={}", url_encode(path)));
            }
            if let Some(true) = opts.staged {
                params.push("staged=true".to_string());
            }
            if let Some(ref file) = opts.file {
                params.push(format!("file={}", url_encode(file)));
            }
        }
        let query = if params.is_empty() {
            String::new()
        } else {
            format!("?{}", params.join("&"))
        };
        self.client
            .get(&format!(
                "/sandbox/sandboxes/{}/git/diff{}",
                self.sandbox_id, query
            ))
            .await
    }

    pub async fn log(&self, options: Option<GitLogOptions>) -> Result<GitLogResponse> {
        let mut params = Vec::new();
        if let Some(ref opts) = options {
            if let Some(ref path) = opts.path {
                params.push(format!("path={}", url_encode(path)));
            }
            if let Some(count) = opts.count {
                params.push(format!("count={count}"));
            }
        }
        let query = if params.is_empty() {
            String::new()
        } else {
            format!("?{}", params.join("&"))
        };
        self.client
            .get(&format!(
                "/sandbox/sandboxes/{}/git/log{}",
                self.sandbox_id, query
            ))
            .await
    }

    pub async fn branch(&self, options: Option<GitBranchOptions>) -> Result<GitBranchResult> {
        let body = match options {
            Some(opts) => {
                let mut b = serde_json::json!({});
                if let Some(path) = opts.path {
                    b["path"] = serde_json::Value::String(path);
                }
                if let Some(name) = opts.name {
                    b["name"] = serde_json::Value::String(name);
                }
                if let Some(delete) = opts.delete {
                    b["delete"] = serde_json::json!(delete);
                }
                b
            }
            None => serde_json::json!({}),
        };
        self.client
            .post(
                &format!("/sandbox/sandboxes/{}/git/branch", self.sandbox_id),
                Some(&body),
            )
            .await
    }

    pub async fn checkout(&self, git_ref: &str, path: Option<&str>) -> Result<ExecResult> {
        let mut body = serde_json::json!({ "ref": git_ref });
        if let Some(p) = path {
            body["path"] = serde_json::Value::String(p.to_string());
        }
        self.client
            .post(
                &format!("/sandbox/sandboxes/{}/git/checkout", self.sandbox_id),
                Some(&body),
            )
            .await
    }

    pub async fn push(&self, options: Option<GitPushOptions>) -> Result<ExecResult> {
        let body = match options {
            Some(opts) => {
                let mut b = serde_json::json!({});
                if let Some(path) = opts.path {
                    b["path"] = serde_json::Value::String(path);
                }
                if let Some(remote) = opts.remote {
                    b["remote"] = serde_json::Value::String(remote);
                }
                if let Some(branch) = opts.branch {
                    b["branch"] = serde_json::Value::String(branch);
                }
                if let Some(force) = opts.force {
                    b["force"] = serde_json::json!(force);
                }
                b
            }
            None => serde_json::json!({}),
        };
        self.client
            .post(
                &format!("/sandbox/sandboxes/{}/git/push", self.sandbox_id),
                Some(&body),
            )
            .await
    }

    pub async fn pull(&self, options: Option<GitPullOptions>) -> Result<ExecResult> {
        let body = match options {
            Some(opts) => {
                let mut b = serde_json::json!({});
                if let Some(path) = opts.path {
                    b["path"] = serde_json::Value::String(path);
                }
                if let Some(remote) = opts.remote {
                    b["remote"] = serde_json::Value::String(remote);
                }
                if let Some(branch) = opts.branch {
                    b["branch"] = serde_json::Value::String(branch);
                }
                b
            }
            None => serde_json::json!({}),
        };
        self.client
            .post(
                &format!("/sandbox/sandboxes/{}/git/pull", self.sandbox_id),
                Some(&body),
            )
            .await
    }
}
