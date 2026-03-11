use std::path::Path;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;
use tokio::time::timeout;
use serde::de::DeserializeOwned;

use super::fc_types::*;

const SOCKET_TIMEOUT: Duration = Duration::from_secs(30);

pub struct FcClient {
    socket_path: String,
}

impl FcClient {
    pub fn new(socket_path: &str) -> Self {
        Self {
            socket_path: socket_path.to_string(),
        }
    }

    async fn request<T: DeserializeOwned>(
        &self,
        method: &str,
        path: &str,
        body: Option<&str>,
    ) -> Result<T, String> {
        let raw = self.raw_request(method, path, body).await?;
        serde_json::from_str(&raw)
            .map_err(|e| format!("Failed to parse response from {path}: {e}"))
    }

    async fn request_no_body(
        &self,
        method: &str,
        path: &str,
        body: Option<&str>,
    ) -> Result<(), String> {
        self.raw_request(method, path, body).await?;
        Ok(())
    }

    async fn raw_request(
        &self,
        method: &str,
        path: &str,
        body: Option<&str>,
    ) -> Result<String, String> {
        let mut stream = timeout(Duration::from_secs(5), UnixStream::connect(&self.socket_path))
            .await
            .map_err(|_| format!("Timeout connecting to Firecracker socket {}", self.socket_path))?
            .map_err(|e| format!("Failed to connect to Firecracker socket {}: {e}", self.socket_path))?;

        let body_bytes = body.unwrap_or("");
        let content_length = body_bytes.len();

        let request = if content_length > 0 {
            format!(
                "{method} {path} HTTP/1.1\r\n\
                 Host: localhost\r\n\
                 Accept: application/json\r\n\
                 Content-Type: application/json\r\n\
                 Content-Length: {content_length}\r\n\
                 \r\n\
                 {body_bytes}"
            )
        } else {
            format!(
                "{method} {path} HTTP/1.1\r\n\
                 Host: localhost\r\n\
                 Accept: application/json\r\n\
                 \r\n"
            )
        };

        timeout(SOCKET_TIMEOUT, stream.write_all(request.as_bytes()))
            .await
            .map_err(|_| "Timeout writing to Firecracker socket".to_string())?
            .map_err(|e| format!("Failed to write to socket: {e}"))?;

        timeout(Duration::from_secs(5), stream.shutdown())
            .await
            .map_err(|_| "Timeout shutting down write".to_string())?
            .map_err(|e| format!("Failed to shutdown write: {e}"))?;

        let mut response = Vec::new();
        timeout(SOCKET_TIMEOUT, stream.read_to_end(&mut response))
            .await
            .map_err(|_| "Timeout reading from Firecracker socket".to_string())?
            .map_err(|e| format!("Failed to read from socket: {e}"))?;

        let response_str = String::from_utf8_lossy(&response);
        parse_http_response(&response_str)
    }

    pub async fn set_boot_source(&self, boot: &BootSource) -> Result<(), String> {
        let body = serde_json::to_string(boot)
            .map_err(|e| format!("Failed to serialize boot source: {e}"))?;
        self.request_no_body("PUT", "/boot-source", Some(&body)).await
    }

    pub async fn set_machine_config(&self, config: &MachineConfig) -> Result<(), String> {
        let body = serde_json::to_string(config)
            .map_err(|e| format!("Failed to serialize machine config: {e}"))?;
        self.request_no_body("PUT", "/machine-config", Some(&body)).await
    }

    pub async fn add_drive(&self, drive: &Drive) -> Result<(), String> {
        let body = serde_json::to_string(drive)
            .map_err(|e| format!("Failed to serialize drive: {e}"))?;
        let path = format!("/drives/{}", drive.drive_id);
        self.request_no_body("PUT", &path, Some(&body)).await
    }

    pub async fn add_network_interface(&self, iface: &NetworkInterface) -> Result<(), String> {
        let body = serde_json::to_string(iface)
            .map_err(|e| format!("Failed to serialize network interface: {e}"))?;
        let path = format!("/network-interfaces/{}", iface.iface_id);
        self.request_no_body("PUT", &path, Some(&body)).await
    }

    pub async fn set_vsock(&self, vsock: &Vsock) -> Result<(), String> {
        let body = serde_json::to_string(vsock)
            .map_err(|e| format!("Failed to serialize vsock: {e}"))?;
        self.request_no_body("PUT", "/vsock", Some(&body)).await
    }

    pub async fn start_instance(&self) -> Result<(), String> {
        let action = InstanceActionInfo {
            action_type: "InstanceStart".to_string(),
        };
        let body = serde_json::to_string(&action)
            .map_err(|e| format!("Failed to serialize action: {e}"))?;
        self.request_no_body("PUT", "/actions", Some(&body)).await
    }

    pub async fn pause_instance(&self) -> Result<(), String> {
        let state = VmState {
            state: "Paused".to_string(),
        };
        let body = serde_json::to_string(&state)
            .map_err(|e| format!("Failed to serialize state: {e}"))?;
        self.request_no_body("PATCH", "/vm", Some(&body)).await
    }

    pub async fn resume_instance(&self) -> Result<(), String> {
        let state = VmState {
            state: "Resumed".to_string(),
        };
        let body = serde_json::to_string(&state)
            .map_err(|e| format!("Failed to serialize state: {e}"))?;
        self.request_no_body("PATCH", "/vm", Some(&body)).await
    }

    pub async fn get_instance_info(&self) -> Result<InstanceInfo, String> {
        self.request("GET", "/", None).await
    }

    pub async fn create_snapshot(&self, params: &SnapshotCreateParams) -> Result<(), String> {
        let body = serde_json::to_string(params)
            .map_err(|e| format!("Failed to serialize snapshot params: {e}"))?;
        self.request_no_body("PUT", "/snapshot/create", Some(&body)).await
    }

    pub async fn load_snapshot(&self, params: &SnapshotLoadParams) -> Result<(), String> {
        let body = serde_json::to_string(params)
            .map_err(|e| format!("Failed to serialize snapshot load params: {e}"))?;
        self.request_no_body("PUT", "/snapshot/load", Some(&body)).await
    }

    pub fn socket_exists(&self) -> bool {
        Path::new(&self.socket_path).exists()
    }
}

fn parse_http_response(raw: &str) -> Result<String, String> {
    let (headers, body) = if let Some((h, b)) = raw.split_once("\r\n\r\n") {
        (h, b.trim())
    } else if let Some((h, b)) = raw.split_once("\n\n") {
        (h, b.trim())
    } else {
        return Err(format!("Malformed HTTP response (no body separator): {}", raw.chars().take(200).collect::<String>()));
    };

    let status_line = headers.lines().next().unwrap_or("");
    let status_code = extract_status_code(status_line)?;

    if status_code >= 400 {
        return Err(format!("Firecracker API error {status_code}: {body}"));
    }

    Ok(body.to_string())
}

fn extract_status_code(status_line: &str) -> Result<u16, String> {
    status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| format!("Failed to parse HTTP status from: {status_line}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_http_200_empty_body() {
        let raw = "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n";
        let result = parse_http_response(raw).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn parse_http_200_with_body() {
        let raw = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"id\":\"test\"}";
        let result = parse_http_response(raw).unwrap();
        assert_eq!(result, "{\"id\":\"test\"}");
    }

    #[test]
    fn parse_http_400_error() {
        let raw = "HTTP/1.1 400 Bad Request\r\n\r\n{\"fault_message\":\"invalid config\"}";
        let result = parse_http_response(raw);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("400"));
    }

    #[test]
    fn parse_http_no_body_separator_is_error() {
        let raw = "HTTP/1.1 200 OK";
        let result = parse_http_response(raw);
        assert!(result.is_err());
    }

    #[test]
    fn extract_status_code_valid() {
        assert_eq!(extract_status_code("HTTP/1.1 200 OK").unwrap(), 200);
        assert_eq!(extract_status_code("HTTP/1.1 404 Not Found").unwrap(), 404);
        assert_eq!(extract_status_code("HTTP/1.1 204 No Content").unwrap(), 204);
    }

    #[test]
    fn extract_status_code_invalid() {
        assert!(extract_status_code("garbage").is_err());
        assert!(extract_status_code("").is_err());
    }

    #[test]
    fn fc_client_new() {
        let client = FcClient::new("/tmp/test.sock");
        assert_eq!(client.socket_path, "/tmp/test.sock");
    }

    #[test]
    fn fc_client_socket_exists_false() {
        let client = FcClient::new("/tmp/nonexistent-firecracker-socket-12345.sock");
        assert!(!client.socket_exists());
    }
}
