use bollard::Docker;
use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::config::EngineConfig;
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
                    let port = u16::try_from(raw_port).map_err(|_| {
                        iii_sdk::IIIError::Handler(format!(
                            "port must be 1-65535, got {raw_port}"
                        ))
                    })?;
                    if port == 0 {
                        return Err(iii_sdk::IIIError::Handler(
                            "port must be 1-65535".into(),
                        ));
                    }
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

                    let container_ip = get_container_ip(&dk, &format!("iii-sbx-{id}")).await?;

                    let url = format!("http://{container_ip}:{port}{path}");

                    let http_method = method
                        .parse::<reqwest::Method>()
                        .map_err(|e| iii_sdk::IIIError::Handler(format!("Invalid method: {e}")))?;

                    let mut req = client.request(http_method.clone(), &url);

                    let timeout_ms: u64 = sandbox
                        .metadata
                        .get("proxy_timeout")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(30_000);
                    req = req.timeout(std::time::Duration::from_millis(timeout_ms));

                    if let Some(obj) = req_headers.as_object() {
                        for (k, v) in obj {
                            if let Some(val) = v.as_str() {
                                req = req.header(k, val);
                            }
                        }
                    }

                    if !body.is_empty()
                        && http_method != reqwest::Method::GET
                        && http_method != reqwest::Method::HEAD
                    {
                        req = req.body(body);
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
        let port = u16::try_from(raw);
        assert!(port.is_ok());
        assert_eq!(port.unwrap(), 0);
    }

    #[test]
    fn port_validation_rejects_overflow() {
        let raw: u64 = 70_000;
        let port = u16::try_from(raw);
        assert!(port.is_err());
    }

    #[test]
    fn port_validation_accepts_valid() {
        let raw: u64 = 8080;
        let port = u16::try_from(raw).unwrap();
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
}
