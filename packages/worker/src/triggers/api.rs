use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::auth::check_auth;
use crate::config::EngineConfig;
use crate::ratelimit::RateLimiter;

pub fn register(iii: &Arc<III>, config: &EngineConfig, limiter: &Arc<RateLimiter>) {
    let p = &config.api_prefix;

    let routes: Vec<(&str, &str, &str, bool)> = vec![
        ("sandbox::create", "POST", "/sandboxes", true),
        ("sandbox::list", "GET", "/sandboxes", true),
        ("sandbox::get", "GET", "/sandboxes/:id", true),
        ("sandbox::kill", "DELETE", "/sandboxes/:id", true),
        ("sandbox::pause", "POST", "/sandboxes/:id/pause", true),
        ("sandbox::resume", "POST", "/sandboxes/:id/resume", true),
        ("sandbox::renew", "POST", "/sandboxes/:id/renew", true),
        ("sandbox::clone", "POST", "/sandboxes/:id/clone", true),

        ("cmd::run", "POST", "/sandboxes/:id/exec", true),
        ("cmd::background", "POST", "/sandboxes/:id/exec/background", true),
        ("cmd::background-status", "GET", "/exec/background/:id/status", true),
        ("cmd::background-logs", "GET", "/exec/background/:id/logs", true),
        ("cmd::interrupt", "POST", "/sandboxes/:id/exec/interrupt", true),

        ("fs::read", "POST", "/sandboxes/:id/files/read", true),
        ("fs::write", "POST", "/sandboxes/:id/files/write", true),
        ("fs::delete", "POST", "/sandboxes/:id/files/delete", true),
        ("fs::list", "POST", "/sandboxes/:id/files/list", true),
        ("fs::search", "POST", "/sandboxes/:id/files/search", true),
        ("fs::upload", "POST", "/sandboxes/:id/files/upload", true),
        ("fs::download", "POST", "/sandboxes/:id/files/download", true),
        ("fs::info", "POST", "/sandboxes/:id/files/info", true),
        ("fs::move", "POST", "/sandboxes/:id/files/move", true),
        ("fs::mkdir", "POST", "/sandboxes/:id/files/mkdir", true),
        ("fs::rmdir", "POST", "/sandboxes/:id/files/rmdir", true),
        ("fs::chmod", "POST", "/sandboxes/:id/files/chmod", true),

        ("env::get", "POST", "/sandboxes/:id/env/get", true),
        ("env::set", "POST", "/sandboxes/:id/env", true),
        ("env::list", "GET", "/sandboxes/:id/env", true),
        ("env::delete", "POST", "/sandboxes/:id/env/delete", true),

        ("git::clone", "POST", "/sandboxes/:id/git/clone", true),
        ("git::status", "GET", "/sandboxes/:id/git/status", true),
        ("git::commit", "POST", "/sandboxes/:id/git/commit", true),
        ("git::diff", "GET", "/sandboxes/:id/git/diff", true),
        ("git::log", "GET", "/sandboxes/:id/git/log", true),
        ("git::branch", "POST", "/sandboxes/:id/git/branch", true),
        ("git::checkout", "POST", "/sandboxes/:id/git/checkout", true),
        ("git::push", "POST", "/sandboxes/:id/git/push", true),
        ("git::pull", "POST", "/sandboxes/:id/git/pull", true),

        ("proc::list", "GET", "/sandboxes/:id/processes", true),
        ("proc::kill", "POST", "/sandboxes/:id/processes/kill", true),
        ("proc::top", "GET", "/sandboxes/:id/processes/top", true),

        ("port::expose", "POST", "/sandboxes/:id/ports", true),
        ("port::list", "GET", "/sandboxes/:id/ports", true),
        ("port::unexpose", "DELETE", "/sandboxes/:id/ports", true),

        ("snapshot::create", "POST", "/sandboxes/:id/snapshots", true),
        ("snapshot::list", "GET", "/sandboxes/:id/snapshots", true),
        ("snapshot::restore", "POST", "/sandboxes/:id/snapshots/restore", true),
        ("snapshot::delete", "DELETE", "/snapshots/:snapshotId", true),

        ("template::create", "POST", "/templates", true),
        ("template::list", "GET", "/templates", true),
        ("template::get", "GET", "/templates/:id", true),
        ("template::delete", "DELETE", "/templates/:id", true),

        ("interp::execute", "POST", "/sandboxes/:id/interpret/execute", true),
        ("interp::install", "POST", "/sandboxes/:id/interpret/install", true),
        ("interp::kernels", "GET", "/sandboxes/:id/interpret/kernels", true),

        ("metrics::sandbox", "GET", "/sandboxes/:id/metrics", true),
        ("metrics::global", "GET", "/metrics", true),

        ("event::history", "GET", "/events/history", true),
        ("event::publish", "POST", "/events/publish", true),

        ("queue::submit", "POST", "/sandboxes/:id/exec/queue", true),
        ("queue::status", "GET", "/queue/:jobId/status", true),
        ("queue::cancel", "POST", "/queue/:jobId/cancel", true),
        ("queue::dlq", "GET", "/queue/dlq", true),

        ("network::create", "POST", "/networks", true),
        ("network::list", "GET", "/networks", true),
        ("network::connect", "POST", "/networks/:networkId/connect", true),
        ("network::disconnect", "POST", "/networks/:networkId/disconnect", true),
        ("network::delete", "DELETE", "/networks/:networkId", true),

        ("observability::traces", "GET", "/observability/traces", true),
        ("observability::metrics", "GET", "/observability/metrics", true),
        ("observability::clear", "POST", "/observability/clear", true),

        ("monitor::set-alert", "POST", "/sandboxes/:id/alerts", true),
        ("monitor::list-alerts", "GET", "/sandboxes/:id/alerts", true),
        ("monitor::delete-alert", "DELETE", "/alerts/:alertId", true),
        ("monitor::history", "GET", "/sandboxes/:id/alerts/history", true),

        ("volume::create", "POST", "/volumes", true),
        ("volume::list", "GET", "/volumes", true),
        ("volume::delete", "DELETE", "/volumes/:volumeId", true),
        ("volume::attach", "POST", "/volumes/:volumeId/attach", true),
        ("volume::detach", "POST", "/volumes/:volumeId/detach", true),

        ("lifecycle::health", "GET", "/health", false),
        ("lifecycle::ttl-sweep", "POST", "/admin/sweep", true),
    ];

    for (fn_id, method, path, require_auth) in &routes {
        let wrapped_id = format!("api::{fn_id}");
        let fn_id_owned = fn_id.to_string();
        let cfg = config.clone();
        let iii2 = iii.clone();
        let ra = *require_auth;
        let lim = limiter.clone();

        iii.register_function(&wrapped_id, move |req: Value| {
            let iii2 = iii2.clone();
            let fn_id = fn_id_owned.clone();
            let cfg = cfg.clone();
            let lim = lim.clone();
            async move {
                if ra {
                    if let Some(auth_err) = check_auth(&req, &cfg) {
                        return Ok(auth_err);
                    }
                }

                let token = req.get("headers")
                    .and_then(|h| h.get("authorization"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("anonymous");
                if !lim.check_token(token) {
                    return Ok(json!({
                        "status_code": 429,
                        "body": { "error": "Rate limit exceeded" }
                    }));
                }

                let mut merged = serde_json::Map::new();
                if let Some(qp) = req.get("query_params").and_then(|v| v.as_object()) {
                    for (k, v) in qp { merged.insert(k.clone(), v.clone()); }
                }
                if let Some(body) = req.get("body").and_then(|v| v.as_object()) {
                    for (k, v) in body { merged.insert(k.clone(), v.clone()); }
                }
                if let Some(pp) = req.get("path_params").and_then(|v| v.as_object()) {
                    for (k, v) in pp { merged.insert(k.clone(), v.clone()); }
                }

                match iii2.trigger(&fn_id, Value::Object(merged)).await {
                    Ok(result) => Ok(json!({ "status_code": 200, "body": result })),
                    Err(e) => {
                        let msg = e.to_string();
                        let code = if msg.contains("not found") { 404 }
                            else if msg.contains("not allowed") { 403 }
                            else { 500 };
                        Ok(json!({ "status_code": code, "body": { "error": msg } }))
                    }
                }
            }
        });

        let api_path = format!("{p}{path}");
        let _ = iii.register_trigger("http", &wrapped_id, json!({
            "api_path": api_path,
            "http_method": method,
        }));
    }

    // Direct streaming triggers (bypass wrap pattern)
    let _ = iii.register_trigger("http", "cmd::run-stream", json!({
        "api_path": format!("{p}/sandboxes/:id/exec/stream"),
        "http_method": "POST",
    }));
    let _ = iii.register_trigger("http", "stream::logs", json!({
        "api_path": format!("{p}/sandboxes/:id/stream/logs"),
        "http_method": "GET",
    }));
    let _ = iii.register_trigger("http", "stream::metrics", json!({
        "api_path": format!("{p}/sandboxes/:id/stream/metrics"),
        "http_method": "GET",
    }));
    let _ = iii.register_trigger("http", "stream::events", json!({
        "api_path": format!("{p}/stream/events"),
        "http_method": "GET",
    }));
}

#[cfg(test)]
mod tests {
    const ROUTES: &[(&str, &str, &str, bool)] = &[
        ("sandbox::create", "POST", "/sandboxes", true),
        ("sandbox::list", "GET", "/sandboxes", true),
        ("sandbox::get", "GET", "/sandboxes/:id", true),
        ("sandbox::kill", "DELETE", "/sandboxes/:id", true),
        ("sandbox::pause", "POST", "/sandboxes/:id/pause", true),
        ("sandbox::resume", "POST", "/sandboxes/:id/resume", true),
        ("sandbox::renew", "POST", "/sandboxes/:id/renew", true),
        ("sandbox::clone", "POST", "/sandboxes/:id/clone", true),
        ("cmd::run", "POST", "/sandboxes/:id/exec", true),
        ("cmd::background", "POST", "/sandboxes/:id/exec/background", true),
        ("cmd::background-status", "GET", "/exec/background/:id/status", true),
        ("cmd::background-logs", "GET", "/exec/background/:id/logs", true),
        ("cmd::interrupt", "POST", "/sandboxes/:id/exec/interrupt", true),
        ("fs::read", "POST", "/sandboxes/:id/files/read", true),
        ("fs::write", "POST", "/sandboxes/:id/files/write", true),
        ("fs::delete", "POST", "/sandboxes/:id/files/delete", true),
        ("fs::list", "POST", "/sandboxes/:id/files/list", true),
        ("fs::search", "POST", "/sandboxes/:id/files/search", true),
        ("fs::upload", "POST", "/sandboxes/:id/files/upload", true),
        ("fs::download", "POST", "/sandboxes/:id/files/download", true),
        ("fs::info", "POST", "/sandboxes/:id/files/info", true),
        ("fs::move", "POST", "/sandboxes/:id/files/move", true),
        ("fs::mkdir", "POST", "/sandboxes/:id/files/mkdir", true),
        ("fs::rmdir", "POST", "/sandboxes/:id/files/rmdir", true),
        ("fs::chmod", "POST", "/sandboxes/:id/files/chmod", true),
        ("env::get", "POST", "/sandboxes/:id/env/get", true),
        ("env::set", "POST", "/sandboxes/:id/env", true),
        ("env::list", "GET", "/sandboxes/:id/env", true),
        ("env::delete", "POST", "/sandboxes/:id/env/delete", true),
        ("git::clone", "POST", "/sandboxes/:id/git/clone", true),
        ("git::status", "GET", "/sandboxes/:id/git/status", true),
        ("git::commit", "POST", "/sandboxes/:id/git/commit", true),
        ("git::diff", "GET", "/sandboxes/:id/git/diff", true),
        ("git::log", "GET", "/sandboxes/:id/git/log", true),
        ("git::branch", "POST", "/sandboxes/:id/git/branch", true),
        ("git::checkout", "POST", "/sandboxes/:id/git/checkout", true),
        ("git::push", "POST", "/sandboxes/:id/git/push", true),
        ("git::pull", "POST", "/sandboxes/:id/git/pull", true),
        ("proc::list", "GET", "/sandboxes/:id/processes", true),
        ("proc::kill", "POST", "/sandboxes/:id/processes/kill", true),
        ("proc::top", "GET", "/sandboxes/:id/processes/top", true),
        ("port::expose", "POST", "/sandboxes/:id/ports", true),
        ("port::list", "GET", "/sandboxes/:id/ports", true),
        ("port::unexpose", "DELETE", "/sandboxes/:id/ports", true),
        ("snapshot::create", "POST", "/sandboxes/:id/snapshots", true),
        ("snapshot::list", "GET", "/sandboxes/:id/snapshots", true),
        ("snapshot::restore", "POST", "/sandboxes/:id/snapshots/restore", true),
        ("snapshot::delete", "DELETE", "/snapshots/:snapshotId", true),
        ("template::create", "POST", "/templates", true),
        ("template::list", "GET", "/templates", true),
        ("template::get", "GET", "/templates/:id", true),
        ("template::delete", "DELETE", "/templates/:id", true),
        ("interp::execute", "POST", "/sandboxes/:id/interpret/execute", true),
        ("interp::install", "POST", "/sandboxes/:id/interpret/install", true),
        ("interp::kernels", "GET", "/sandboxes/:id/interpret/kernels", true),
        ("metrics::sandbox", "GET", "/sandboxes/:id/metrics", true),
        ("metrics::global", "GET", "/metrics", true),
        ("event::history", "GET", "/events/history", true),
        ("event::publish", "POST", "/events/publish", true),
        ("queue::submit", "POST", "/sandboxes/:id/exec/queue", true),
        ("queue::status", "GET", "/queue/:jobId/status", true),
        ("queue::cancel", "POST", "/queue/:jobId/cancel", true),
        ("queue::dlq", "GET", "/queue/dlq", true),
        ("network::create", "POST", "/networks", true),
        ("network::list", "GET", "/networks", true),
        ("network::connect", "POST", "/networks/:networkId/connect", true),
        ("network::disconnect", "POST", "/networks/:networkId/disconnect", true),
        ("network::delete", "DELETE", "/networks/:networkId", true),
        ("observability::traces", "GET", "/observability/traces", true),
        ("observability::metrics", "GET", "/observability/metrics", true),
        ("observability::clear", "POST", "/observability/clear", true),
        ("monitor::set-alert", "POST", "/sandboxes/:id/alerts", true),
        ("monitor::list-alerts", "GET", "/sandboxes/:id/alerts", true),
        ("monitor::delete-alert", "DELETE", "/alerts/:alertId", true),
        ("monitor::history", "GET", "/sandboxes/:id/alerts/history", true),
        ("volume::create", "POST", "/volumes", true),
        ("volume::list", "GET", "/volumes", true),
        ("volume::delete", "DELETE", "/volumes/:volumeId", true),
        ("volume::attach", "POST", "/volumes/:volumeId/attach", true),
        ("volume::detach", "POST", "/volumes/:volumeId/detach", true),
        ("lifecycle::health", "GET", "/health", false),
        ("lifecycle::ttl-sweep", "POST", "/admin/sweep", true),
    ];

    #[test]
    fn routes_count() {
        assert_eq!(ROUTES.len(), 82);
    }

    #[test]
    fn sandbox_create_exists() {
        assert!(ROUTES.iter().any(|(id, _, _, _)| *id == "sandbox::create"));
    }

    #[test]
    fn sandbox_list_exists() {
        assert!(ROUTES.iter().any(|(id, _, _, _)| *id == "sandbox::list"));
    }

    #[test]
    fn cmd_run_exists() {
        assert!(ROUTES.iter().any(|(id, _, _, _)| *id == "cmd::run"));
    }

    #[test]
    fn fs_read_exists() {
        assert!(ROUTES.iter().any(|(id, _, _, _)| *id == "fs::read"));
    }

    #[test]
    fn fs_write_exists() {
        assert!(ROUTES.iter().any(|(id, _, _, _)| *id == "fs::write"));
    }

    #[test]
    fn git_clone_exists() {
        assert!(ROUTES.iter().any(|(id, _, _, _)| *id == "git::clone"));
    }

    #[test]
    fn snapshot_create_exists() {
        assert!(ROUTES.iter().any(|(id, _, _, _)| *id == "snapshot::create"));
    }

    #[test]
    fn each_route_has_valid_http_method() {
        for (id, method, _, _) in ROUTES {
            assert!(
                *method == "GET" || *method == "POST" || *method == "DELETE",
                "Route {id} has invalid method: {method}"
            );
        }
    }

    #[test]
    fn health_does_not_require_auth() {
        let health = ROUTES.iter().find(|(id, _, _, _)| *id == "lifecycle::health");
        assert!(health.is_some());
        assert!(!health.unwrap().3);
    }

    #[test]
    fn sandbox_create_requires_auth() {
        let route = ROUTES.iter().find(|(id, _, _, _)| *id == "sandbox::create");
        assert!(route.unwrap().3);
    }

    #[test]
    fn all_paths_start_with_slash() {
        for (id, _, path, _) in ROUTES {
            assert!(path.starts_with('/'), "Route {id} path does not start with /: {path}");
        }
    }

    #[test]
    fn no_duplicate_function_ids() {
        let mut seen = std::collections::HashSet::new();
        for (id, _, _, _) in ROUTES {
            assert!(seen.insert(*id), "Duplicate function ID: {id}");
        }
    }

    #[test]
    fn template_routes_exist() {
        let template_routes: Vec<_> = ROUTES.iter()
            .filter(|(id, _, _, _)| id.starts_with("template::"))
            .collect();
        assert_eq!(template_routes.len(), 4);
    }

    #[test]
    fn network_routes_exist() {
        let network_routes: Vec<_> = ROUTES.iter()
            .filter(|(id, _, _, _)| id.starts_with("network::"))
            .collect();
        assert_eq!(network_routes.len(), 5);
    }

    #[test]
    fn volume_routes_exist() {
        let volume_routes: Vec<_> = ROUTES.iter()
            .filter(|(id, _, _, _)| id.starts_with("volume::"))
            .collect();
        assert_eq!(volume_routes.len(), 5);
    }

    #[test]
    fn ttl_sweep_requires_auth() {
        let route = ROUTES.iter().find(|(id, _, _, _)| *id == "lifecycle::ttl-sweep");
        assert!(route.is_some());
        assert!(route.unwrap().3);
    }

    #[test]
    fn sandbox_kill_uses_delete() {
        let route = ROUTES.iter().find(|(id, _, _, _)| *id == "sandbox::kill");
        assert_eq!(route.unwrap().1, "DELETE");
    }
}
