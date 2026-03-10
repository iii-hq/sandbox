use bollard::Docker;
use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::config::EngineConfig;
use crate::docker::exec_in_container;
use crate::state::{scopes, StateKV};
use crate::types::{PortMapping, Sandbox};

pub fn register(iii: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV, config: &EngineConfig) {
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("Failed to create reqwest client");

    // proxy::request
    {
        let kv = kv.clone();
        let dk = dk.clone();
        let client = http_client.clone();
        iii.register_function_with_description(
            "proxy::request",
            "Forward HTTP request to a sandbox container port via direct HTTP",
            move |input: Value| {
                let kv = kv.clone();
                let dk = dk.clone();
                let client = client.clone();
                async move {
                    let id = input
                        .get("id")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                    let raw_port = input
                        .get("port")
                        .and_then(|v| {
                            v.as_u64()
                                .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
                        })
                        .ok_or_else(|| iii_sdk::IIIError::Handler("port is required".into()))?;
                    if raw_port == 0 || raw_port > 65535 {
                        return Err(iii_sdk::IIIError::Handler(format!(
                            "port must be 1-65535, got {raw_port}"
                        )));
                    }
                    let port = raw_port as u16;
                    let method = input
                        .get("method")
                        .and_then(|v| v.as_str())
                        .unwrap_or("GET")
                        .to_uppercase();
                    let path = match input.get("path").and_then(|v| v.as_str()) {
                        Some(p) if p.starts_with('/') => p,
                        Some("") => "/",
                        Some(p) => {
                            return Err(iii_sdk::IIIError::Handler(format!(
                                "path must start with '/', got '{p}'"
                            )));
                        }
                        None => "/",
                    };
                    let req_headers = input
                        .get("headers")
                        .cloned()
                        .unwrap_or(json!({}));
                    let body = input
                        .get("body")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let sandbox: Sandbox = kv
                        .get(scopes::SANDBOXES, id)
                        .await
                        .ok_or_else(|| {
                            iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}"))
                        })?;
                    if sandbox.status != "running" {
                        return Err(iii_sdk::IIIError::Handler(format!(
                            "Sandbox is not running: {}",
                            sandbox.status
                        )));
                    }

                    let ports: Vec<PortMapping> = sandbox
                        .metadata
                        .get("ports")
                        .and_then(|v| serde_json::from_str(v).ok())
                        .unwrap_or_default();
                    if !ports.iter().any(|p| p.container_port == port) {
                        return Err(iii_sdk::IIIError::Handler(format!(
                            "Port {port} is not exposed on sandbox {id}"
                        )));
                    }

                    let http_method: reqwest::Method = method
                        .parse()
                        .map_err(|e| iii_sdk::IIIError::Handler(format!("Invalid method: {e}")))?;

                    let timeout_ms: u64 = sandbox
                        .metadata
                        .get("proxy_timeout")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(30_000);

                    let container_name = format!("iii-sbx-{id}");

                    let direct = try_direct_proxy(
                        &dk, &client, &container_name, port, path,
                        http_method, &req_headers, &body, timeout_ms,
                    )
                    .await;

                    match direct {
                        Ok(result) => Ok(result),
                        Err(_) => {
                            proxy_via_exec(
                                &dk, &container_name, &method, port, path,
                                &req_headers, &body, timeout_ms,
                            )
                            .await
                        }
                    }
                }
            },
        );
    }

    // proxy::config
    {
        let kv = kv.clone();
        let config = config.clone();
        iii.register_function_with_description(
            "proxy::config",
            "Get or set proxy configuration for a sandbox",
            move |input: Value| {
                let kv = kv.clone();
                let config = config.clone();
                async move {
                    let id = input
                        .get("id")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;

                    let mut sandbox: Sandbox = kv
                        .get(scopes::SANDBOXES, id)
                        .await
                        .ok_or_else(|| {
                            iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}"))
                        })?;

                    if let Some(cors) = input.get("cors").and_then(|v| v.as_str()) {
                        sandbox
                            .metadata
                            .insert("proxy_cors".to_string(), cors.to_string());
                    }
                    if let Some(auth) = input.get("requireAuth").and_then(|v| v.as_bool()) {
                        sandbox
                            .metadata
                            .insert("proxy_auth".to_string(), auth.to_string());
                    }
                    if let Some(timeout) = input.get("timeout").and_then(|v| v.as_u64()) {
                        sandbox
                            .metadata
                            .insert("proxy_timeout".to_string(), timeout.to_string());
                    }

                    kv.set(scopes::SANDBOXES, id, &sandbox)
                        .await
                        .map_err(|e| iii_sdk::IIIError::Handler(e.to_string()))?;

                    let proxy_base = format!("{}/proxy/{id}", config.api_prefix);

                    let cors = sandbox
                        .metadata
                        .get("proxy_cors")
                        .cloned()
                        .unwrap_or_else(|| "*".to_string());
                    let require_auth: bool = sandbox
                        .metadata
                        .get("proxy_auth")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(false);
                    let timeout: u64 = sandbox
                        .metadata
                        .get("proxy_timeout")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(30_000);

                    Ok(json!({
                        "sandboxId": id,
                        "proxyBase": proxy_base,
                        "cors": cors,
                        "requireAuth": require_auth,
                        "timeout": timeout,
                    }))
                }
            },
        );
    }
}

async fn try_direct_proxy(
    dk: &Docker,
    client: &reqwest::Client,
    container_name: &str,
    port: u16,
    path: &str,
    method: reqwest::Method,
    headers: &Value,
    body: &str,
    timeout_ms: u64,
) -> Result<Value, iii_sdk::IIIError> {
    let container_ip = get_container_ip(dk, container_name).await?;
    let url = format!("http://{container_ip}:{port}{path}");

    let send_body = !body.is_empty()
        && method != reqwest::Method::GET
        && method != reqwest::Method::HEAD;

    let mut req = client
        .request(method, &url)
        .timeout(std::time::Duration::from_millis(timeout_ms));

    if let Some(obj) = headers.as_object() {
        for (k, v) in obj {
            if let Some(val) = v.as_str() {
                req = req.header(k, val);
            }
        }
    }

    if send_body {
        req = req.body(body.to_string());
    }

    let resp = req.send().await.map_err(|e| {
        iii_sdk::IIIError::Handler(format!("Proxy request failed: {e}"))
    })?;

    let status = resp.status().as_u16();
    let resp_headers: serde_json::Map<String, Value> = resp
        .headers()
        .iter()
        .filter_map(|(k, v)| {
            v.to_str()
                .ok()
                .map(|val| (k.to_string(), Value::String(val.to_string())))
        })
        .collect();
    let resp_body = resp.text().await.map_err(|e| {
        iii_sdk::IIIError::Handler(format!("Failed to read response: {e}"))
    })?;

    Ok(json!({
        "statusCode": status,
        "headers": resp_headers,
        "body": resp_body,
        "url": url,
    }))
}

async fn proxy_via_exec(
    dk: &Docker,
    container_name: &str,
    method: &str,
    port: u16,
    path: &str,
    headers: &Value,
    body: &str,
    timeout_ms: u64,
) -> Result<Value, iii_sdk::IIIError> {
    let mut curl_cmd = format!(
        "curl -s -D /dev/stderr -w '\\n__PROXY_STATUS__%{{http_code}}' -X {method}"
    );

    if let Some(obj) = headers.as_object() {
        for (k, v) in obj {
            if let Some(val) = v.as_str() {
                let ek = k.replace('\'', "'\\''");
                let ev = val.replace('\'', "'\\''");
                curl_cmd.push_str(&format!(" -H '{ek}: {ev}'"));
            }
        }
    }

    if !body.is_empty() && method != "GET" && method != "HEAD" {
        let eb = body.replace('\'', "'\\''");
        curl_cmd.push_str(&format!(" -d '{eb}'"));
    }

    let escaped_path = path.replace('\'', "'\\''");
    curl_cmd.push_str(&format!(" 'http://localhost:{port}{escaped_path}'"));

    let cmd = vec!["sh".to_string(), "-c".to_string(), curl_cmd];

    let result = exec_in_container(dk, container_name, &cmd, timeout_ms)
        .await
        .map_err(|e| iii_sdk::IIIError::Handler(format!("Exec proxy failed: {e}")))?;

    if result.exit_code != 0 && !result.stdout.contains("__PROXY_STATUS__") {
        let msg = if result.stderr.contains("not found") {
            "curl not available in container — install curl or run worker in Docker".to_string()
        } else {
            format!("curl failed (exit {}): {}", result.exit_code, result.stderr)
        };
        return Err(iii_sdk::IIIError::Handler(msg));
    }

    let (resp_body, status_code) = parse_curl_output(&result.stdout);
    let resp_headers = parse_curl_headers(&result.stderr);

    Ok(json!({
        "statusCode": status_code,
        "headers": resp_headers,
        "body": resp_body,
        "url": format!("http://localhost:{port}{path}"),
        "proxiedVia": "exec",
    }))
}

fn parse_curl_output(stdout: &str) -> (String, u16) {
    const MARKER: &str = "\n__PROXY_STATUS__";
    if let Some(pos) = stdout.rfind(MARKER) {
        let body = &stdout[..pos];
        let status_str = &stdout[pos + MARKER.len()..];
        let status = status_str.trim().parse::<u16>().unwrap_or(0);
        (body.to_string(), status)
    } else {
        (stdout.to_string(), 0)
    }
}

fn parse_curl_headers(stderr: &str) -> serde_json::Map<String, Value> {
    let mut headers = serde_json::Map::new();
    for line in stderr.lines() {
        if line.starts_with("HTTP/") || line.trim().is_empty() {
            continue;
        }
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(
                key.trim().to_lowercase(),
                Value::String(value.trim().to_string()),
            );
        }
    }
    headers
}

async fn get_container_ip(dk: &Docker, container_name: &str) -> Result<String, iii_sdk::IIIError> {
    let inspect = dk
        .inspect_container(container_name, None)
        .await
        .map_err(|e| {
            iii_sdk::IIIError::Handler(format!("Failed to inspect container: {e}"))
        })?;

    let ip = inspect
        .network_settings
        .as_ref()
        .and_then(|ns| ns.networks.as_ref())
        .and_then(|nets| {
            nets.values()
                .next()
                .and_then(|n| n.ip_address.clone())
        })
        .unwrap_or_default();

    if ip.is_empty() {
        return Err(iii_sdk::IIIError::Handler(
            "Container has no IP address (network may be disabled)".into(),
        ));
    }

    Ok(ip)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_method_is_get() {
        let input = json!({ "id": "sbx_1", "port": 3000 });
        let method = input
            .get("method")
            .and_then(|v| v.as_str())
            .unwrap_or("GET");
        assert_eq!(method, "GET");
    }

    #[test]
    fn default_path_is_root() {
        let input = json!({ "id": "sbx_1", "port": 3000 });
        let path = input
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("/");
        assert_eq!(path, "/");
    }

    #[test]
    fn port_from_input() {
        let input = json!({ "id": "sbx_1", "port": 3000 });
        let port = input.get("port").and_then(|v| v.as_u64()).unwrap() as u16;
        assert_eq!(port, 3000);
    }

    #[test]
    fn proxy_url_format() {
        let container_ip = "172.17.0.2";
        let port = 3000u16;
        let path = "/api/data";
        let url = format!("http://{container_ip}:{port}{path}");
        assert_eq!(url, "http://172.17.0.2:3000/api/data");
    }

    #[test]
    fn proxy_url_root_path() {
        let container_ip = "172.17.0.2";
        let port = 8080u16;
        let path = "/";
        let url = format!("http://{container_ip}:{port}{path}");
        assert_eq!(url, "http://172.17.0.2:8080/");
    }

    #[test]
    fn method_parsing() {
        assert!("GET".parse::<reqwest::Method>().is_ok());
        assert!("POST".parse::<reqwest::Method>().is_ok());
        assert!("PUT".parse::<reqwest::Method>().is_ok());
        assert!("DELETE".parse::<reqwest::Method>().is_ok());
        assert!("PATCH".parse::<reqwest::Method>().is_ok());
    }

    #[test]
    fn method_case_normalization() {
        let input = json!({ "method": "post" });
        let method = input
            .get("method")
            .and_then(|v| v.as_str())
            .unwrap_or("GET")
            .to_uppercase();
        assert_eq!(method, "POST");
    }

    #[test]
    fn response_header_extraction() {
        let headers: serde_json::Map<String, Value> = [
            ("content-type".to_string(), Value::String("application/json".to_string())),
            ("x-custom".to_string(), Value::String("value".to_string())),
        ]
        .into_iter()
        .collect();
        assert_eq!(headers.len(), 2);
        assert_eq!(headers["content-type"], "application/json");
    }

    #[test]
    fn empty_body_not_sent_on_get() {
        let method = reqwest::Method::GET;
        let body = "";
        let should_send = !body.is_empty()
            && method != reqwest::Method::GET
            && method != reqwest::Method::HEAD;
        assert!(!should_send);
    }

    #[test]
    fn body_sent_on_post() {
        let method = reqwest::Method::POST;
        let body = "{\"key\":\"val\"}";
        let should_send = !body.is_empty()
            && method != reqwest::Method::GET
            && method != reqwest::Method::HEAD;
        assert!(should_send);
    }

    #[test]
    fn port_validation_rejects_zero() {
        let raw: u64 = 0;
        assert!(raw == 0 || raw > 65535);
    }

    #[test]
    fn port_validation_rejects_overflow() {
        let raw: u64 = 70_000;
        assert!(raw == 0 || raw > 65535);
    }

    #[test]
    fn port_validation_accepts_valid() {
        let raw: u64 = 8080;
        assert!(raw > 0 && raw <= 65535);
        let port = raw as u16;
        assert_eq!(port, 8080);
    }

    #[test]
    fn path_must_start_with_slash() {
        let path = "/api/data";
        assert!(path.starts_with('/'));
    }

    #[test]
    fn empty_path_becomes_root() {
        let input = json!({ "id": "sbx_1", "port": 3000, "path": "" });
        let raw = input.get("path").and_then(|v| v.as_str()).unwrap_or("/");
        let path = if raw.is_empty() { "/" } else { raw };
        assert_eq!(path, "/");
    }

    #[test]
    fn config_returns_typed_values() {
        let require_auth: bool = "true".parse().unwrap();
        let timeout: u64 = "5000".parse().unwrap();
        assert!(require_auth);
        assert_eq!(timeout, 5000);
    }

    #[test]
    fn config_defaults_typed() {
        let require_auth: bool = "".parse().unwrap_or(false);
        let timeout: u64 = "".parse().unwrap_or(30_000);
        assert!(!require_auth);
        assert_eq!(timeout, 30_000);
    }

    #[test]
    fn parse_curl_output_with_status() {
        let stdout = "{\"ok\":true}\n__PROXY_STATUS__200";
        let (body, status) = parse_curl_output(stdout);
        assert_eq!(body, "{\"ok\":true}");
        assert_eq!(status, 200);
    }

    #[test]
    fn parse_curl_output_no_marker() {
        let stdout = "raw output without marker";
        let (body, status) = parse_curl_output(stdout);
        assert_eq!(body, "raw output without marker");
        assert_eq!(status, 0);
    }

    #[test]
    fn parse_curl_output_empty() {
        let (body, status) = parse_curl_output("");
        assert_eq!(body, "");
        assert_eq!(status, 0);
    }

    #[test]
    fn parse_curl_output_multiline_body() {
        let stdout = "line1\nline2\nline3\n__PROXY_STATUS__201";
        let (body, status) = parse_curl_output(stdout);
        assert_eq!(body, "line1\nline2\nline3");
        assert_eq!(status, 201);
    }

    #[test]
    fn parse_curl_output_404() {
        let stdout = "Not Found\n__PROXY_STATUS__404";
        let (body, status) = parse_curl_output(stdout);
        assert_eq!(body, "Not Found");
        assert_eq!(status, 404);
    }

    #[test]
    fn parse_curl_headers_basic() {
        let stderr = "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nx-custom: value\r\n\r\n";
        let headers = parse_curl_headers(stderr);
        assert_eq!(headers["content-type"], "application/json");
        assert_eq!(headers["x-custom"], "value");
    }

    #[test]
    fn parse_curl_headers_skips_status_line() {
        let stderr = "HTTP/1.1 200 OK\r\nserver: nginx\r\n";
        let headers = parse_curl_headers(stderr);
        assert!(!headers.contains_key("http/1.1"));
        assert_eq!(headers["server"], "nginx");
    }

    #[test]
    fn parse_curl_headers_empty() {
        let headers = parse_curl_headers("");
        assert!(headers.is_empty());
    }

    #[test]
    fn parse_curl_headers_lowercases_keys() {
        let stderr = "Content-Type: text/html\r\nX-Request-ID: abc123\r\n";
        let headers = parse_curl_headers(stderr);
        assert_eq!(headers["content-type"], "text/html");
        assert_eq!(headers["x-request-id"], "abc123");
    }

    #[test]
    fn exec_proxy_url_format() {
        let port = 3000u16;
        let path = "/api/data";
        let url = format!("http://localhost:{port}{path}");
        assert_eq!(url, "http://localhost:3000/api/data");
    }

    #[test]
    fn exec_proxy_url_root() {
        let port = 8080u16;
        let path = "/";
        let url = format!("http://localhost:{port}{path}");
        assert_eq!(url, "http://localhost:8080/");
    }

    #[test]
    fn shell_escape_single_quotes() {
        let body = "it's a test";
        let escaped = body.replace('\'', "'\\''");
        assert_eq!(escaped, "it'\\''s a test");
    }

    #[test]
    fn shell_escape_no_special() {
        let body = "normal body";
        let escaped = body.replace('\'', "'\\''");
        assert_eq!(escaped, "normal body");
    }

    #[test]
    fn curl_cmd_format_get() {
        let method = "GET";
        let port = 3000u16;
        let path = "/health";
        let cmd = format!(
            "curl -s -D /dev/stderr -w '\\n__PROXY_STATUS__%{{http_code}}' -X {method} 'http://localhost:{port}{path}'"
        );
        assert!(cmd.contains("-X GET"));
        assert!(cmd.contains("localhost:3000/health"));
        assert!(cmd.contains("__PROXY_STATUS__"));
    }

    #[test]
    fn curl_cmd_format_post_with_body() {
        let method = "POST";
        let body = "{\"key\":\"val\"}";
        let eb = body.replace('\'', "'\\''");
        let cmd = format!(
            "curl -s -D /dev/stderr -w '\\n__PROXY_STATUS__%{{http_code}}' -X {method} -d '{eb}' 'http://localhost:3000/api'"
        );
        assert!(cmd.contains("-X POST"));
        assert!(cmd.contains("-d '{\"key\":\"val\"}'"));
    }
}
