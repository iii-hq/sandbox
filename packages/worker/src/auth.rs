use crate::config::EngineConfig;
use serde_json::{json, Value};
use subtle::ConstantTimeEq;

pub fn check_auth(req: &Value, config: &EngineConfig) -> Option<Value> {
    let token = match &config.auth_token {
        Some(t) => t,
        None => return None,
    };

    let headers = req.get("headers").unwrap_or(&Value::Null);
    let auth_header = headers
        .get("authorization")
        .and_then(|v| {
            if let Some(s) = v.as_str() {
                Some(s.to_string())
            } else if let Some(arr) = v.as_array() {
                arr.first().and_then(|v| v.as_str()).map(|s| s.to_string())
            } else {
                None
            }
        });

    let auth_header = match auth_header {
        Some(h) => h,
        None => {
            return Some(json!({
                "status_code": 401,
                "body": { "error": "Missing authorization header" }
            }));
        }
    };

    let provided = auth_header.strip_prefix("Bearer ").unwrap_or(&auth_header);
    let provided_bytes = provided.as_bytes();
    let expected_bytes = token.as_bytes();

    if provided_bytes.len() != expected_bytes.len()
        || provided_bytes.ct_eq(expected_bytes).unwrap_u8() != 1
    {
        return Some(json!({
            "status_code": 403,
            "body": { "error": "Invalid token" }
        }));
    }

    None
}

pub fn validate_path(path: &str, workspace_dir: &str) -> Result<String, String> {
    let base = if workspace_dir.ends_with('/') {
        workspace_dir.to_string()
    } else {
        format!("{workspace_dir}/")
    };

    let normalized = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("{base}{path}")
    };

    if normalized != workspace_dir.trim_end_matches('/') && !normalized.starts_with(&base) {
        return Err(format!("Path traversal detected: {path}"));
    }
    if normalized.contains("..") {
        return Err(format!("Path traversal detected: {path}"));
    }
    Ok(normalized)
}

pub fn validate_sandbox_config(input: &Value) -> Result<Value, String> {
    let image = input
        .get("image")
        .and_then(|v| v.as_str())
        .ok_or("image is required and must be a string")?;

    if image.contains("..") || image.contains('$') {
        return Err("Invalid image name".to_string());
    }

    let mut config = serde_json::Map::new();
    config.insert("image".to_string(), Value::String(image.to_string()));

    if let Some(name) = input.get("name").and_then(|v| v.as_str()) {
        config.insert("name".to_string(), Value::String(name.to_string()));
    }
    if let Some(timeout) = input.get("timeout").and_then(|v| v.as_u64()) {
        config.insert(
            "timeout".to_string(),
            Value::Number(timeout.clamp(60, 86400).into()),
        );
    }
    if let Some(memory) = input.get("memory").and_then(|v| v.as_u64()) {
        config.insert(
            "memory".to_string(),
            Value::Number(memory.clamp(64, 4096).into()),
        );
    }
    if let Some(cpu) = input.get("cpu").and_then(|v| v.as_f64()) {
        let clamped = cpu.clamp(0.5, 4.0);
        config.insert("cpu".to_string(), serde_json::to_value(clamped).unwrap());
    }
    if let Some(network) = input.get("network").and_then(|v| v.as_bool()) {
        config.insert("network".to_string(), Value::Bool(network));
    }
    if let Some(env) = input.get("env") {
        if env.is_object() {
            config.insert("env".to_string(), env.clone());
        }
    }
    if let Some(workdir) = input.get("workdir").and_then(|v| v.as_str()) {
        config.insert("workdir".to_string(), Value::String(workdir.to_string()));
    }
    if let Some(metadata) = input.get("metadata") {
        if metadata.is_object() {
            config.insert("metadata".to_string(), metadata.clone());
        }
    }
    if let Some(entrypoint) = input.get("entrypoint") {
        if entrypoint.is_array() {
            config.insert("entrypoint".to_string(), entrypoint.clone());
        }
    }

    Ok(Value::Object(config))
}

pub fn validate_image_allowed(image: &str, allowed: &[String]) -> bool {
    if allowed.len() == 1 && allowed[0] == "*" {
        return true;
    }
    allowed.iter().any(|pattern| {
        if let Some(prefix) = pattern.strip_suffix('*') {
            image.starts_with(prefix)
        } else {
            image == pattern
        }
    })
}

pub fn validate_command(command: &str) -> Result<Vec<String>, String> {
    if command.is_empty() {
        return Err("command is required".to_string());
    }
    Ok(vec![
        "sh".to_string(),
        "-c".to_string(),
        command.to_string(),
    ])
}

pub fn validate_chmod_mode(mode: &str) -> Result<String, String> {
    if mode.is_empty() {
        return Err("mode is required".to_string());
    }
    let is_octal = mode.len() >= 3 && mode.len() <= 4 && mode.chars().all(|c| ('0'..='7').contains(&c));
    let is_symbolic = {
        let parts: Vec<&str> = mode.split(|c: char| c == '+' || c == '-' || c == '=').collect();
        parts.len() == 2
            && parts[0].chars().all(|c| "ugoa".contains(c))
            && parts[1].chars().all(|c| "rwxXt".contains(c))
    };
    if !is_octal && !is_symbolic {
        return Err(format!(
            "Invalid chmod mode: {mode}. Use octal (e.g. 755) or symbolic (e.g. u+x)"
        ));
    }
    Ok(mode.to_string())
}

pub fn validate_search_pattern(pattern: &str) -> Result<String, String> {
    if pattern.is_empty() {
        return Err("search pattern is required".to_string());
    }
    if pattern.len() > 200 {
        return Err("search pattern too long (max 200 chars)".to_string());
    }
    if pattern.chars().any(|c| ";|$`\\".contains(c)) {
        return Err("search pattern contains invalid characters".to_string());
    }
    Ok(pattern.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn config_with_token(token: &str) -> EngineConfig {
        EngineConfig {
            engine_url: "ws://localhost:49134".to_string(),
            worker_name: "test".to_string(),
            rest_port: 3111,
            api_prefix: "/sandbox".to_string(),
            auth_token: Some(token.to_string()),
            default_image: "python:3.12-slim".to_string(),
            default_timeout: 3600,
            default_memory: 512,
            default_cpu: 1,
            max_sandboxes: 50,
            ttl_sweep_interval: "*/30 * * * * *".to_string(),
            metrics_interval: "*/60 * * * * *".to_string(),
            allowed_images: vec!["*".to_string()],
            workspace_dir: "/workspace".to_string(),
            max_command_timeout: 300,
        }
    }

    fn config_no_token() -> EngineConfig {
        let mut cfg = config_with_token("unused");
        cfg.auth_token = None;
        cfg
    }

    // ---- check_auth ----

    #[test]
    fn check_auth_no_token_configured_allows_request() {
        let req = json!({"headers": {}});
        assert!(check_auth(&req, &config_no_token()).is_none());
    }

    #[test]
    fn check_auth_valid_bearer_token() {
        let req = json!({"headers": {"authorization": "Bearer secret123"}});
        assert!(check_auth(&req, &config_with_token("secret123")).is_none());
    }

    #[test]
    fn check_auth_valid_token_without_bearer_prefix() {
        let req = json!({"headers": {"authorization": "secret123"}});
        assert!(check_auth(&req, &config_with_token("secret123")).is_none());
    }

    #[test]
    fn check_auth_invalid_token_returns_403() {
        let req = json!({"headers": {"authorization": "Bearer wrong"}});
        let resp = check_auth(&req, &config_with_token("secret123")).unwrap();
        assert_eq!(resp["status_code"], 403);
        assert_eq!(resp["body"]["error"], "Invalid token");
    }

    #[test]
    fn check_auth_missing_header_returns_401() {
        let req = json!({"headers": {}});
        let resp = check_auth(&req, &config_with_token("secret123")).unwrap();
        assert_eq!(resp["status_code"], 401);
        assert_eq!(resp["body"]["error"], "Missing authorization header");
    }

    #[test]
    fn check_auth_missing_headers_object_returns_401() {
        let req = json!({});
        let resp = check_auth(&req, &config_with_token("secret123")).unwrap();
        assert_eq!(resp["status_code"], 401);
    }

    #[test]
    fn check_auth_token_from_array_header() {
        let req = json!({"headers": {"authorization": ["Bearer mytoken"]}});
        assert!(check_auth(&req, &config_with_token("mytoken")).is_none());
    }

    #[test]
    fn check_auth_token_from_array_header_invalid() {
        let req = json!({"headers": {"authorization": ["Bearer bad"]}});
        let resp = check_auth(&req, &config_with_token("mytoken")).unwrap();
        assert_eq!(resp["status_code"], 403);
    }

    #[test]
    fn check_auth_wrong_length_token_returns_403() {
        let req = json!({"headers": {"authorization": "Bearer short"}});
        let resp = check_auth(&req, &config_with_token("muchlongertoken")).unwrap();
        assert_eq!(resp["status_code"], 403);
    }

    #[test]
    fn check_auth_bearer_prefix_stripped_correctly() {
        let req = json!({"headers": {"authorization": "Bearer abc"}});
        assert!(check_auth(&req, &config_with_token("abc")).is_none());

        let req2 = json!({"headers": {"authorization": "abc"}});
        assert!(check_auth(&req2, &config_with_token("abc")).is_none());
    }

    #[test]
    fn check_auth_numeric_header_value_returns_401() {
        let req = json!({"headers": {"authorization": 12345}});
        let resp = check_auth(&req, &config_with_token("secret")).unwrap();
        assert_eq!(resp["status_code"], 401);
    }

    #[test]
    fn check_auth_empty_array_header_returns_401() {
        let req = json!({"headers": {"authorization": []}});
        let resp = check_auth(&req, &config_with_token("secret")).unwrap();
        assert_eq!(resp["status_code"], 401);
    }

    // ---- validate_path ----

    #[test]
    fn validate_path_absolute_inside_workspace() {
        let result = validate_path("/workspace/file.txt", "/workspace").unwrap();
        assert_eq!(result, "/workspace/file.txt");
    }

    #[test]
    fn validate_path_relative_inside_workspace() {
        let result = validate_path("subdir/file.txt", "/workspace").unwrap();
        assert_eq!(result, "/workspace/subdir/file.txt");
    }

    #[test]
    fn validate_path_traversal_with_dotdot_rejected() {
        let result = validate_path("/workspace/../etc/passwd", "/workspace");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Path traversal detected"));
    }

    #[test]
    fn validate_path_relative_traversal_rejected() {
        let result = validate_path("../etc/passwd", "/workspace");
        assert!(result.is_err());
    }

    #[test]
    fn validate_path_workspace_root_exact() {
        let result = validate_path("/workspace", "/workspace").unwrap();
        assert_eq!(result, "/workspace");
    }

    #[test]
    fn validate_path_outside_workspace_rejected() {
        let result = validate_path("/etc/passwd", "/workspace");
        assert!(result.is_err());
    }

    #[test]
    fn validate_path_workspace_with_trailing_slash() {
        let result = validate_path("file.txt", "/workspace/").unwrap();
        assert_eq!(result, "/workspace/file.txt");
    }

    #[test]
    fn validate_path_workspace_without_trailing_slash() {
        let result = validate_path("file.txt", "/workspace").unwrap();
        assert_eq!(result, "/workspace/file.txt");
    }

    #[test]
    fn validate_path_nested_deep_inside_workspace() {
        let result = validate_path("/workspace/a/b/c/d.txt", "/workspace").unwrap();
        assert_eq!(result, "/workspace/a/b/c/d.txt");
    }

    #[test]
    fn validate_path_dotdot_in_middle_rejected() {
        let result = validate_path("/workspace/a/../../../etc/passwd", "/workspace");
        assert!(result.is_err());
    }

    // ---- validate_sandbox_config ----

    #[test]
    fn validate_sandbox_config_minimal_image_only() {
        let input = json!({"image": "python:3.12"});
        let result = validate_sandbox_config(&input).unwrap();
        assert_eq!(result["image"], "python:3.12");
    }

    #[test]
    fn validate_sandbox_config_full_config() {
        let input = json!({
            "image": "python:3.12",
            "name": "test-sandbox",
            "timeout": 600,
            "memory": 1024,
            "cpu": 2.0,
            "network": true,
            "env": {"FOO": "bar"},
            "workdir": "/app",
            "metadata": {"key": "val"},
            "entrypoint": ["/bin/sh", "-c"]
        });
        let result = validate_sandbox_config(&input).unwrap();
        assert_eq!(result["image"], "python:3.12");
        assert_eq!(result["name"], "test-sandbox");
        assert_eq!(result["timeout"], 600);
        assert_eq!(result["memory"], 1024);
        assert_eq!(result["cpu"], 2.0);
        assert_eq!(result["network"], true);
        assert_eq!(result["env"]["FOO"], "bar");
        assert_eq!(result["workdir"], "/app");
        assert_eq!(result["metadata"]["key"], "val");
        assert_eq!(result["entrypoint"][0], "/bin/sh");
    }

    #[test]
    fn validate_sandbox_config_missing_image_errors() {
        let input = json!({"name": "test"});
        assert!(validate_sandbox_config(&input).is_err());
    }

    #[test]
    fn validate_sandbox_config_image_with_dotdot_rejected() {
        let input = json!({"image": "../malicious"});
        let result = validate_sandbox_config(&input);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Invalid image name");
    }

    #[test]
    fn validate_sandbox_config_image_with_dollar_rejected() {
        let input = json!({"image": "python:${VERSION}"});
        let result = validate_sandbox_config(&input);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Invalid image name");
    }

    #[test]
    fn validate_sandbox_config_timeout_clamped_to_min() {
        let input = json!({"image": "python:3.12", "timeout": 10});
        let result = validate_sandbox_config(&input).unwrap();
        assert_eq!(result["timeout"], 60);
    }

    #[test]
    fn validate_sandbox_config_timeout_clamped_to_max() {
        let input = json!({"image": "python:3.12", "timeout": 100000});
        let result = validate_sandbox_config(&input).unwrap();
        assert_eq!(result["timeout"], 86400);
    }

    #[test]
    fn validate_sandbox_config_timeout_within_range() {
        let input = json!({"image": "python:3.12", "timeout": 3600});
        let result = validate_sandbox_config(&input).unwrap();
        assert_eq!(result["timeout"], 3600);
    }

    #[test]
    fn validate_sandbox_config_memory_clamped_to_min() {
        let input = json!({"image": "python:3.12", "memory": 10});
        let result = validate_sandbox_config(&input).unwrap();
        assert_eq!(result["memory"], 64);
    }

    #[test]
    fn validate_sandbox_config_memory_clamped_to_max() {
        let input = json!({"image": "python:3.12", "memory": 99999});
        let result = validate_sandbox_config(&input).unwrap();
        assert_eq!(result["memory"], 4096);
    }

    #[test]
    fn validate_sandbox_config_cpu_clamped_to_min() {
        let input = json!({"image": "python:3.12", "cpu": 0.1});
        let result = validate_sandbox_config(&input).unwrap();
        assert_eq!(result["cpu"], 0.5);
    }

    #[test]
    fn validate_sandbox_config_cpu_clamped_to_max() {
        let input = json!({"image": "python:3.12", "cpu": 16.0});
        let result = validate_sandbox_config(&input).unwrap();
        assert_eq!(result["cpu"], 4.0);
    }

    #[test]
    fn validate_sandbox_config_env_object_included() {
        let input = json!({"image": "python:3.12", "env": {"A": "1", "B": "2"}});
        let result = validate_sandbox_config(&input).unwrap();
        assert_eq!(result["env"]["A"], "1");
        assert_eq!(result["env"]["B"], "2");
    }

    #[test]
    fn validate_sandbox_config_env_non_object_skipped() {
        let input = json!({"image": "python:3.12", "env": "not-an-object"});
        let result = validate_sandbox_config(&input).unwrap();
        assert!(result.get("env").is_none());
    }

    #[test]
    fn validate_sandbox_config_env_array_skipped() {
        let input = json!({"image": "python:3.12", "env": ["A=1"]});
        let result = validate_sandbox_config(&input).unwrap();
        assert!(result.get("env").is_none());
    }

    #[test]
    fn validate_sandbox_config_metadata_object_included() {
        let input = json!({"image": "python:3.12", "metadata": {"team": "infra"}});
        let result = validate_sandbox_config(&input).unwrap();
        assert_eq!(result["metadata"]["team"], "infra");
    }

    #[test]
    fn validate_sandbox_config_metadata_non_object_skipped() {
        let input = json!({"image": "python:3.12", "metadata": "string"});
        let result = validate_sandbox_config(&input).unwrap();
        assert!(result.get("metadata").is_none());
    }

    #[test]
    fn validate_sandbox_config_entrypoint_array_included() {
        let input = json!({"image": "python:3.12", "entrypoint": ["/bin/bash"]});
        let result = validate_sandbox_config(&input).unwrap();
        assert_eq!(result["entrypoint"][0], "/bin/bash");
    }

    #[test]
    fn validate_sandbox_config_entrypoint_non_array_skipped() {
        let input = json!({"image": "python:3.12", "entrypoint": "/bin/bash"});
        let result = validate_sandbox_config(&input).unwrap();
        assert!(result.get("entrypoint").is_none());
    }

    #[test]
    fn validate_sandbox_config_image_null_errors() {
        let input = json!({"image": null});
        assert!(validate_sandbox_config(&input).is_err());
    }

    // ---- validate_image_allowed ----

    #[test]
    fn validate_image_allowed_wildcard_allows_all() {
        assert!(validate_image_allowed("anything:latest", &["*".to_string()]));
    }

    #[test]
    fn validate_image_allowed_exact_match() {
        let allowed = vec!["python:3.12".to_string(), "node:20".to_string()];
        assert!(validate_image_allowed("python:3.12", &allowed));
    }

    #[test]
    fn validate_image_allowed_exact_no_match() {
        let allowed = vec!["python:3.12".to_string()];
        assert!(!validate_image_allowed("node:20", &allowed));
    }

    #[test]
    fn validate_image_allowed_prefix_wildcard() {
        let allowed = vec!["python:*".to_string()];
        assert!(validate_image_allowed("python:3.12-slim", &allowed));
    }

    #[test]
    fn validate_image_allowed_prefix_wildcard_no_match() {
        let allowed = vec!["python:*".to_string()];
        assert!(!validate_image_allowed("node:20", &allowed));
    }

    #[test]
    fn validate_image_allowed_empty_list() {
        let allowed: Vec<String> = vec![];
        assert!(!validate_image_allowed("python:3.12", &allowed));
    }

    #[test]
    fn validate_image_allowed_multiple_patterns() {
        let allowed = vec!["python:*".to_string(), "node:*".to_string()];
        assert!(validate_image_allowed("python:3.12", &allowed));
        assert!(validate_image_allowed("node:20", &allowed));
        assert!(!validate_image_allowed("ruby:3.3", &allowed));
    }

    #[test]
    fn validate_image_allowed_wildcard_in_multi_entry_still_matches_via_prefix() {
        let allowed = vec!["*".to_string(), "python:3.12".to_string()];
        assert!(validate_image_allowed("anything:latest", &allowed));
        assert!(validate_image_allowed("python:3.12", &allowed));
    }

    #[test]
    fn validate_image_allowed_sole_wildcard_fast_path() {
        let allowed = vec!["*".to_string()];
        assert!(validate_image_allowed("literally-anything", &allowed));
    }

    // ---- validate_command ----

    #[test]
    fn validate_command_empty_errors() {
        let result = validate_command("");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "command is required");
    }

    #[test]
    fn validate_command_simple() {
        let result = validate_command("ls -la").unwrap();
        assert_eq!(result, vec!["sh", "-c", "ls -la"]);
    }

    #[test]
    fn validate_command_with_pipes() {
        let result = validate_command("cat file.txt | grep foo").unwrap();
        assert_eq!(result, vec!["sh", "-c", "cat file.txt | grep foo"]);
    }

    #[test]
    fn validate_command_with_semicolons() {
        let result = validate_command("echo hello; echo world").unwrap();
        assert_eq!(result, vec!["sh", "-c", "echo hello; echo world"]);
    }

    #[test]
    fn validate_command_single_word() {
        let result = validate_command("whoami").unwrap();
        assert_eq!(result, vec!["sh", "-c", "whoami"]);
    }

    // ---- validate_chmod_mode ----

    #[test]
    fn validate_chmod_mode_octal_755() {
        assert_eq!(validate_chmod_mode("755").unwrap(), "755");
    }

    #[test]
    fn validate_chmod_mode_octal_644() {
        assert_eq!(validate_chmod_mode("644").unwrap(), "644");
    }

    #[test]
    fn validate_chmod_mode_octal_0755() {
        assert_eq!(validate_chmod_mode("0755").unwrap(), "0755");
    }

    #[test]
    fn validate_chmod_mode_symbolic_u_plus_x() {
        assert_eq!(validate_chmod_mode("u+x").unwrap(), "u+x");
    }

    #[test]
    fn validate_chmod_mode_symbolic_g_minus_w() {
        assert_eq!(validate_chmod_mode("g-w").unwrap(), "g-w");
    }

    #[test]
    fn validate_chmod_mode_symbolic_o_equals_r() {
        assert_eq!(validate_chmod_mode("o=r").unwrap(), "o=r");
    }

    #[test]
    fn validate_chmod_mode_invalid_letters() {
        let result = validate_chmod_mode("abc");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid chmod mode"));
    }

    #[test]
    fn validate_chmod_mode_empty() {
        let result = validate_chmod_mode("");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "mode is required");
    }

    #[test]
    fn validate_chmod_mode_octal_too_short() {
        let result = validate_chmod_mode("77");
        assert!(result.is_err());
    }

    #[test]
    fn validate_chmod_mode_octal_too_long() {
        let result = validate_chmod_mode("07755");
        assert!(result.is_err());
    }

    #[test]
    fn validate_chmod_mode_octal_with_8() {
        let result = validate_chmod_mode("789");
        assert!(result.is_err());
    }

    #[test]
    fn validate_chmod_mode_symbolic_ug_plus_rw() {
        assert_eq!(validate_chmod_mode("ug+rw").unwrap(), "ug+rw");
    }

    // ---- validate_search_pattern ----

    #[test]
    fn validate_search_pattern_valid() {
        assert_eq!(validate_search_pattern("hello").unwrap(), "hello");
    }

    #[test]
    fn validate_search_pattern_empty() {
        let result = validate_search_pattern("");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "search pattern is required");
    }

    #[test]
    fn validate_search_pattern_too_long() {
        let long = "a".repeat(201);
        let result = validate_search_pattern(&long);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too long"));
    }

    #[test]
    fn validate_search_pattern_max_length_ok() {
        let exact = "a".repeat(200);
        assert!(validate_search_pattern(&exact).is_ok());
    }

    #[test]
    fn validate_search_pattern_with_semicolon() {
        let result = validate_search_pattern("foo;rm -rf");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("invalid characters"));
    }

    #[test]
    fn validate_search_pattern_with_pipe() {
        let result = validate_search_pattern("foo|bar");
        assert!(result.is_err());
    }

    #[test]
    fn validate_search_pattern_with_backtick() {
        let result = validate_search_pattern("foo`whoami`");
        assert!(result.is_err());
    }

    #[test]
    fn validate_search_pattern_with_dollar() {
        let result = validate_search_pattern("$HOME");
        assert!(result.is_err());
    }

    #[test]
    fn validate_search_pattern_with_backslash() {
        let result = validate_search_pattern("foo\\nbar");
        assert!(result.is_err());
    }

    #[test]
    fn validate_search_pattern_with_regex_chars_allowed() {
        assert!(validate_search_pattern("foo.*bar").is_ok());
        assert!(validate_search_pattern("^start").is_ok());
        assert!(validate_search_pattern("end$").is_err());
    }

    #[test]
    fn validate_search_pattern_spaces_ok() {
        assert_eq!(
            validate_search_pattern("hello world").unwrap(),
            "hello world"
        );
    }
}
