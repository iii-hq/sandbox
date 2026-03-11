use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;
use tokio::time::timeout;

use super::fc_types::*;
use crate::types::{ExecResult, FileInfo, FileMetadata, SandboxMetrics};

const AGENT_PORT: u32 = 52;
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

pub struct AgentClient {
    vsock_uds_path: String,
    guest_cid: u32,
}

impl AgentClient {
    pub fn new(vsock_uds_path: &str, guest_cid: u32) -> Self {
        Self {
            vsock_uds_path: vsock_uds_path.to_string(),
            guest_cid,
        }
    }

    async fn send_request<Req: serde::Serialize, Resp: serde::de::DeserializeOwned>(
        &self,
        method: &str,
        endpoint: &str,
        request: &Req,
        timeout_dur: Duration,
    ) -> Result<Resp, String> {
        let connect_path = format!("{}_{}", self.vsock_uds_path, AGENT_PORT);

        let mut stream = timeout(Duration::from_secs(5), UnixStream::connect(&connect_path))
            .await
            .map_err(|_| format!("Timeout connecting to guest agent vsock CID {} port {AGENT_PORT}", self.guest_cid))?
            .map_err(|e| format!("Failed to connect to guest agent: {e}"))?;

        let body = serde_json::to_string(request)
            .map_err(|e| format!("Failed to serialize request: {e}"))?;

        let request_line = format!(
            "{method} {endpoint} HTTP/1.1\r\n\
             Host: localhost\r\n\
             Content-Type: application/json\r\n\
             Content-Length: {}\r\n\
             \r\n\
             {body}",
            body.len()
        );

        timeout(Duration::from_secs(5), stream.write_all(request_line.as_bytes()))
            .await
            .map_err(|_| "Timeout writing to guest agent".to_string())?
            .map_err(|e| format!("Failed to write to agent: {e}"))?;

        let mut response = Vec::new();
        timeout(timeout_dur, stream.read_to_end(&mut response))
            .await
            .map_err(|_| format!("Timeout waiting for guest agent response on {endpoint}"))?
            .map_err(|e| format!("Failed to read agent response: {e}"))?;

        let response_str = String::from_utf8_lossy(&response);

        if let Some(status_line) = response_str.lines().next() {
            if let Some(code_str) = status_line.split_whitespace().nth(1) {
                if let Ok(code) = code_str.parse::<u16>() {
                    if code >= 400 {
                        let body_str = extract_body(&response_str);
                        return Err(format!("Agent error {code} on {endpoint}: {body_str}"));
                    }
                }
            }
        }

        let body_str = extract_body(&response_str);

        serde_json::from_str(body_str)
            .map_err(|e| format!("Failed to parse agent response from {endpoint}: {e}"))
    }

    pub async fn exec(
        &self,
        command: &[String],
        timeout_ms: u64,
    ) -> Result<ExecResult, String> {
        let req = AgentExecRequest {
            command: command.to_vec(),
            timeout_ms: Some(timeout_ms),
            workdir: None,
            env: None,
        };

        let timeout_dur = Duration::from_millis(timeout_ms + 5000);
        let resp: AgentExecResponse = self
            .send_request("POST", "/exec", &req, timeout_dur)
            .await?;

        Ok(ExecResult {
            exit_code: resp.exit_code,
            stdout: resp.stdout,
            stderr: resp.stderr,
            duration: resp.duration_ms,
        })
    }

    pub async fn exec_detached(
        &self,
        command: &[String],
    ) -> Result<String, String> {
        #[derive(serde::Serialize)]
        struct DetachedReq {
            command: Vec<String>,
            detached: bool,
        }
        #[derive(serde::Deserialize)]
        struct DetachedResp {
            pid: String,
        }

        let req = DetachedReq {
            command: command.to_vec(),
            detached: true,
        };

        let resp: DetachedResp = self
            .send_request("POST", "/exec", &req, DEFAULT_TIMEOUT)
            .await?;
        Ok(resp.pid)
    }

    pub async fn write_file(
        &self,
        path: &str,
        content: &[u8],
    ) -> Result<(), String> {
        let req = AgentFileWriteRequest {
            path: path.to_string(),
            content: base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                content,
            ),
            mode: None,
        };

        let _: serde_json::Value = self
            .send_request("POST", "/file/write", &req, DEFAULT_TIMEOUT)
            .await?;
        Ok(())
    }

    pub async fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        let req = AgentFileReadRequest {
            path: path.to_string(),
        };

        let resp: AgentFileReadResponse = self
            .send_request("POST", "/file/read", &req, DEFAULT_TIMEOUT)
            .await?;

        base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &resp.content,
        )
        .map_err(|e| format!("Failed to decode file content: {e}"))
    }

    pub async fn list_dir(&self, path: &str) -> Result<Vec<FileInfo>, String> {
        let req = AgentListDirRequest {
            path: path.to_string(),
        };

        let entries: Vec<AgentListDirEntry> = self
            .send_request("POST", "/file/list", &req, DEFAULT_TIMEOUT)
            .await?;

        Ok(entries
            .into_iter()
            .map(|e| FileInfo {
                name: e.name,
                path: e.path,
                size: e.size,
                is_directory: e.is_directory,
                modified_at: e.modified_at,
            })
            .collect())
    }

    pub async fn search_files(
        &self,
        dir: &str,
        pattern: &str,
    ) -> Result<Vec<String>, String> {
        let req = AgentSearchRequest {
            dir: dir.to_string(),
            pattern: pattern.to_string(),
        };

        self.send_request("POST", "/file/search", &req, DEFAULT_TIMEOUT).await
    }

    pub async fn file_info(
        &self,
        paths: &[String],
    ) -> Result<Vec<FileMetadata>, String> {
        let req = AgentFileInfoRequest {
            paths: paths.to_vec(),
        };

        let entries: Vec<AgentFileInfoEntry> = self
            .send_request("POST", "/file/info", &req, DEFAULT_TIMEOUT)
            .await?;

        Ok(entries
            .into_iter()
            .map(|e| FileMetadata {
                path: e.path,
                size: e.size,
                permissions: e.permissions,
                owner: e.owner,
                group: e.group,
                is_directory: e.is_directory,
                is_symlink: e.is_symlink,
                modified_at: e.modified_at,
            })
            .collect())
    }

    pub async fn stats(&self, sandbox_id: &str) -> Result<SandboxMetrics, String> {
        #[derive(serde::Serialize)]
        struct StatsReq {}

        let resp: AgentStatsResponse = self
            .send_request("POST", "/stats", &StatsReq {}, DEFAULT_TIMEOUT)
            .await?;

        Ok(SandboxMetrics {
            sandbox_id: sandbox_id.to_string(),
            cpu_percent: resp.cpu_percent,
            memory_usage_mb: resp.memory_usage_bytes / (1024 * 1024),
            memory_limit_mb: resp.memory_total_bytes / (1024 * 1024),
            network_rx_bytes: resp.network_rx_bytes,
            network_tx_bytes: resp.network_tx_bytes,
            pids: resp.pids,
        })
    }

    pub async fn processes(&self) -> Result<Vec<AgentProcessEntry>, String> {
        #[derive(serde::Serialize)]
        struct ProcReq {}

        self.send_request("POST", "/processes", &ProcReq {}, DEFAULT_TIMEOUT).await
    }

    pub async fn terminal_create(
        &self,
        cols: u16,
        rows: u16,
        shell: &str,
    ) -> Result<String, String> {
        let req = AgentTerminalCreateRequest {
            cols,
            rows,
            shell: shell.to_string(),
        };

        let resp: AgentTerminalCreateResponse = self
            .send_request("POST", "/terminal/create", &req, DEFAULT_TIMEOUT)
            .await?;
        Ok(resp.session_id)
    }

    pub async fn terminal_write(
        &self,
        session_id: &str,
        data: &[u8],
    ) -> Result<(), String> {
        let req = AgentTerminalWriteRequest {
            session_id: session_id.to_string(),
            data: base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                data,
            ),
        };

        let _: serde_json::Value = self
            .send_request("POST", "/terminal/write", &req, DEFAULT_TIMEOUT)
            .await?;
        Ok(())
    }

    pub async fn terminal_read(
        &self,
        session_id: &str,
    ) -> Result<(Vec<u8>, bool), String> {
        let req = AgentTerminalReadRequest {
            session_id: session_id.to_string(),
        };

        let resp: AgentTerminalReadResponse = self
            .send_request("POST", "/terminal/read", &req, DEFAULT_TIMEOUT)
            .await?;

        let data = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &resp.data,
        )
        .map_err(|e| format!("Failed to decode terminal data: {e}"))?;

        Ok((data, resp.eof))
    }

    pub async fn terminal_resize(
        &self,
        session_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let req = AgentTerminalResizeRequest {
            session_id: session_id.to_string(),
            cols,
            rows,
        };

        let _: serde_json::Value = self
            .send_request("POST", "/terminal/resize", &req, DEFAULT_TIMEOUT)
            .await?;
        Ok(())
    }

    pub async fn terminal_close(
        &self,
        session_id: &str,
    ) -> Result<(), String> {
        let req = AgentTerminalCloseRequest {
            session_id: session_id.to_string(),
        };

        let _: serde_json::Value = self
            .send_request("POST", "/terminal/close", &req, DEFAULT_TIMEOUT)
            .await?;
        Ok(())
    }

    pub async fn health_check(&self) -> Result<bool, String> {
        #[derive(serde::Serialize)]
        struct HealthReq {}
        #[derive(serde::Deserialize)]
        struct HealthResp {
            healthy: bool,
        }

        match timeout(
            Duration::from_secs(3),
            self.send_request::<HealthReq, HealthResp>("GET", "/health", &HealthReq {}, Duration::from_secs(3)),
        )
        .await
        {
            Ok(Ok(resp)) => Ok(resp.healthy),
            _ => Ok(false),
        }
    }
}

fn extract_body(raw: &str) -> &str {
    if let Some(idx) = raw.find("\r\n\r\n") {
        let body = &raw[idx + 4..];
        return body.trim();
    }
    if let Some(idx) = raw.find("\n\n") {
        let body = &raw[idx + 2..];
        return body.trim();
    }
    raw.trim()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_body_with_crlf() {
        let raw = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"ok\":true}";
        assert_eq!(extract_body(raw), "{\"ok\":true}");
    }

    #[test]
    fn extract_body_with_lf() {
        let raw = "HTTP/1.1 200 OK\n\n{\"ok\":true}";
        assert_eq!(extract_body(raw), "{\"ok\":true}");
    }

    #[test]
    fn extract_body_no_headers() {
        let raw = "{\"ok\":true}";
        assert_eq!(extract_body(raw), "{\"ok\":true}");
    }

    #[test]
    fn agent_client_new() {
        let client = AgentClient::new("/tmp/vsock.sock", 100);
        assert_eq!(client.vsock_uds_path, "/tmp/vsock.sock");
        assert_eq!(client.guest_cid, 100);
    }
}
