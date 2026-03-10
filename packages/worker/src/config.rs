use std::env;

use crate::ratelimit::RateLimitConfig;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct PoolProfile {
    pub image: String,
    pub memory_mb: u64,
    pub cpu: f64,
    pub network_enabled: bool,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct EngineConfig {
    pub engine_url: String,
    pub worker_name: String,
    pub rest_port: u16,
    pub api_prefix: String,
    pub auth_token: Option<String>,
    pub default_image: String,
    pub default_timeout: u64,
    pub default_memory: u64,
    pub default_cpu: u64,
    pub max_sandboxes: usize,
    pub ttl_sweep_interval: String,
    pub metrics_interval: String,
    pub allowed_images: Vec<String>,
    pub workspace_dir: String,
    pub max_command_timeout: u64,
    pub warm_pool_size: usize,
    pub warm_pool_replenish_interval: String,
    pub warm_pool_profiles: Vec<PoolProfile>,
    pub isolation_backend: String,
    pub firecracker_kernel: String,
    pub firecracker_rootfs: String,
    pub firecracker_vcpus: u32,
    pub firecracker_mem_mib: u64,
    pub rate_limit: RateLimitConfig,
}

fn parse_int_or_default(var: &str, default: u64) -> u64 {
    env::var(var)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

impl EngineConfig {
    pub fn from_env() -> Self {
        let allowed_images = env::var("III_ALLOWED_IMAGES")
            .unwrap_or_else(|_| "*".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .collect();

        let mut cfg = Self {
            engine_url: env::var("III_ENGINE_URL")
                .unwrap_or_else(|_| "ws://localhost:49134".to_string()),
            worker_name: env::var("III_WORKER_NAME").unwrap_or_else(|_| {
                let hostname = env::var("HOSTNAME")
                    .unwrap_or_else(|_| "local".to_string());
                let suffix = &uuid::Uuid::new_v4().to_string()[..8];
                format!("iii-sandbox-{hostname}-{suffix}")
            }),
            rest_port: parse_int_or_default("III_REST_PORT", 3111) as u16,
            api_prefix: env::var("III_API_PREFIX")
                .unwrap_or_else(|_| "sandbox".to_string()),
            auth_token: env::var("III_AUTH_TOKEN").ok(),
            default_image: env::var("III_DEFAULT_IMAGE")
                .unwrap_or_else(|_| "python:3.12-slim".to_string()),
            default_timeout: parse_int_or_default("III_DEFAULT_TIMEOUT", 3600),
            default_memory: parse_int_or_default("III_DEFAULT_MEMORY", 512),
            default_cpu: parse_int_or_default("III_DEFAULT_CPU", 1),
            max_sandboxes: parse_int_or_default("III_MAX_SANDBOXES", 50) as usize,
            ttl_sweep_interval: env::var("III_TTL_SWEEP")
                .unwrap_or_else(|_| "*/30 * * * * *".to_string()),
            metrics_interval: env::var("III_METRICS_INTERVAL")
                .unwrap_or_else(|_| "*/60 * * * * *".to_string()),
            allowed_images,
            workspace_dir: env::var("III_WORKSPACE_DIR")
                .unwrap_or_else(|_| "/workspace".to_string()),
            max_command_timeout: parse_int_or_default("III_MAX_CMD_TIMEOUT", 300),
            warm_pool_size: parse_int_or_default("III_POOL_SIZE", 0).min(1000) as usize,
            warm_pool_replenish_interval: env::var("III_POOL_REPLENISH")
                .unwrap_or_else(|_| "*/30 * * * * *".to_string()),
            warm_pool_profiles: vec![],
            isolation_backend: env::var("III_ISOLATION_BACKEND")
                .unwrap_or_else(|_| "docker".to_string()),
            firecracker_kernel: env::var("III_FIRECRACKER_KERNEL")
                .unwrap_or_else(|_| "/opt/firecracker/vmlinux".to_string()),
            firecracker_rootfs: env::var("III_FIRECRACKER_ROOTFS")
                .unwrap_or_else(|_| "/opt/firecracker/rootfs.ext4".to_string()),
            firecracker_vcpus: parse_int_or_default("III_FIRECRACKER_VCPUS", 2) as u32,
            firecracker_mem_mib: parse_int_or_default("III_FIRECRACKER_MEM_MIB", 512),
            rate_limit: RateLimitConfig {
                enabled: env::var("III_RATE_LIMIT_ENABLED")
                    .map(|v| v == "true" || v == "1")
                    .unwrap_or(false),
                token_requests_per_minute: parse_int_or_default("III_RATE_TOKEN_RPM", 600).min(u32::MAX as u64) as u32,
                token_burst: parse_int_or_default("III_RATE_TOKEN_BURST", 100).min(u32::MAX as u64) as u32,
                sandbox_exec_per_minute: parse_int_or_default("III_RATE_SBX_EXEC_PM", 120).min(u32::MAX as u64) as u32,
                sandbox_fs_ops_per_minute: parse_int_or_default("III_RATE_SBX_FS_PM", 300).min(u32::MAX as u64) as u32,
            },
        };
        cfg.warm_pool_profiles = parse_pool_profiles(&cfg);
        cfg
    }
}

fn parse_pool_profiles(config: &EngineConfig) -> Vec<PoolProfile> {
    let raw = env::var("III_POOL_PROFILES").unwrap_or_default();
    if raw.is_empty() {
        return vec![
            PoolProfile {
                image: config.default_image.clone(),
                memory_mb: config.default_memory,
                cpu: config.default_cpu as f64,
                network_enabled: false,
            },
        ];
    }
    raw.split(';')
        .filter_map(|entry| {
            let parts: Vec<&str> = entry.split(',').collect();
            if parts.len() < 4 {
                tracing::warn!(entry = entry, "Malformed III_POOL_PROFILES entry, skipping");
                return None;
            }
            Some(PoolProfile {
                image: parts[0].trim().to_string(),
                memory_mb: parts[1].trim().parse().unwrap_or(config.default_memory),
                cpu: parts[2].trim().parse().unwrap_or(config.default_cpu as f64),
                network_enabled: parts[3].trim() == "true",
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn clear_all_iii_vars() {
        let vars = [
            "III_ENGINE_URL",
            "III_WORKER_NAME",
            "III_REST_PORT",
            "III_API_PREFIX",
            "III_AUTH_TOKEN",
            "III_DEFAULT_IMAGE",
            "III_DEFAULT_TIMEOUT",
            "III_DEFAULT_MEMORY",
            "III_DEFAULT_CPU",
            "III_MAX_SANDBOXES",
            "III_TTL_SWEEP",
            "III_METRICS_INTERVAL",
            "III_ALLOWED_IMAGES",
            "III_WORKSPACE_DIR",
            "III_MAX_CMD_TIMEOUT",
            "III_POOL_SIZE",
            "III_POOL_REPLENISH",
            "III_POOL_PROFILES",
            "III_RATE_LIMIT_ENABLED",
            "III_RATE_TOKEN_RPM",
            "III_RATE_TOKEN_BURST",
            "III_RATE_SBX_EXEC_PM",
            "III_RATE_SBX_FS_PM",
            "III_ISOLATION_BACKEND",
            "III_FIRECRACKER_KERNEL",
            "III_FIRECRACKER_ROOTFS",
            "III_FIRECRACKER_VCPUS",
            "III_FIRECRACKER_MEM_MIB",
        ];
        for var in vars {
            unsafe { env::remove_var(var) };
        }
    }

    #[test]
    fn defaults_when_no_env_vars() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_all_iii_vars();
        let cfg = EngineConfig::from_env();
        assert_eq!(cfg.engine_url, "ws://localhost:49134");
        assert!(cfg.worker_name.starts_with("iii-sandbox-"), "worker_name should be auto-generated: {}", cfg.worker_name);
        assert_eq!(cfg.rest_port, 3111);
        assert_eq!(cfg.api_prefix, "sandbox");
        assert!(cfg.auth_token.is_none());
        assert_eq!(cfg.default_image, "python:3.12-slim");
        assert_eq!(cfg.default_timeout, 3600);
        assert_eq!(cfg.default_memory, 512);
        assert_eq!(cfg.default_cpu, 1);
        assert_eq!(cfg.max_sandboxes, 50);
        assert_eq!(cfg.ttl_sweep_interval, "*/30 * * * * *");
        assert_eq!(cfg.metrics_interval, "*/60 * * * * *");
        assert_eq!(cfg.allowed_images, vec!["*"]);
        assert_eq!(cfg.workspace_dir, "/workspace");
        assert_eq!(cfg.max_command_timeout, 300);
        assert_eq!(cfg.warm_pool_size, 0);
        assert_eq!(cfg.warm_pool_replenish_interval, "*/30 * * * * *");
        assert_eq!(cfg.warm_pool_profiles.len(), 1);
        assert_eq!(cfg.warm_pool_profiles[0].image, "python:3.12-slim");
        assert!(!cfg.warm_pool_profiles[0].network_enabled);
        assert_eq!(cfg.isolation_backend, "docker");
        assert_eq!(cfg.firecracker_kernel, "/opt/firecracker/vmlinux");
        assert_eq!(cfg.firecracker_rootfs, "/opt/firecracker/rootfs.ext4");
        assert_eq!(cfg.firecracker_vcpus, 2);
        assert_eq!(cfg.firecracker_mem_mib, 512);
        assert!(!cfg.rate_limit.enabled);
        assert_eq!(cfg.rate_limit.token_requests_per_minute, 600);
        assert_eq!(cfg.rate_limit.token_burst, 100);
    }

    #[test]
    fn custom_engine_url() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_all_iii_vars();
        unsafe { env::set_var("III_ENGINE_URL", "ws://engine:5000") };
        let cfg = EngineConfig::from_env();
        assert_eq!(cfg.engine_url, "ws://engine:5000");
    }

    #[test]
    fn custom_worker_name() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_all_iii_vars();
        unsafe { env::set_var("III_WORKER_NAME", "custom-worker") };
        let cfg = EngineConfig::from_env();
        assert_eq!(cfg.worker_name, "custom-worker");
    }

    #[test]
    fn custom_rest_port() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_all_iii_vars();
        unsafe { env::set_var("III_REST_PORT", "8080") };
        let cfg = EngineConfig::from_env();
        assert_eq!(cfg.rest_port, 8080);
    }

    #[test]
    fn custom_api_prefix() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_all_iii_vars();
        unsafe { env::set_var("III_API_PREFIX", "/api/v2") };
        let cfg = EngineConfig::from_env();
        assert_eq!(cfg.api_prefix, "/api/v2");
    }

    #[test]
    fn auth_token_when_set() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_all_iii_vars();
        unsafe { env::set_var("III_AUTH_TOKEN", "secret-token-123") };
        let cfg = EngineConfig::from_env();
        assert_eq!(cfg.auth_token, Some("secret-token-123".to_string()));
    }

    #[test]
    fn auth_token_none_when_unset() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_all_iii_vars();
        let cfg = EngineConfig::from_env();
        assert!(cfg.auth_token.is_none());
    }

    #[test]
    fn custom_default_image() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_all_iii_vars();
        unsafe { env::set_var("III_DEFAULT_IMAGE", "node:20-alpine") };
        let cfg = EngineConfig::from_env();
        assert_eq!(cfg.default_image, "node:20-alpine");
    }

    #[test]
    fn custom_max_sandboxes() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_all_iii_vars();
        unsafe { env::set_var("III_MAX_SANDBOXES", "200") };
        let cfg = EngineConfig::from_env();
        assert_eq!(cfg.max_sandboxes, 200);
    }

    #[test]
    fn allowed_images_comma_separated() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_all_iii_vars();
        unsafe { env::set_var("III_ALLOWED_IMAGES", "python:3.12, node:20, alpine") };
        let cfg = EngineConfig::from_env();
        assert_eq!(cfg.allowed_images.len(), 3);
        assert_eq!(cfg.allowed_images[0], "python:3.12");
        assert_eq!(cfg.allowed_images[1], "node:20");
        assert_eq!(cfg.allowed_images[2], "alpine");
    }

    #[test]
    fn allowed_images_single_value() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_all_iii_vars();
        unsafe { env::set_var("III_ALLOWED_IMAGES", "ubuntu:22.04") };
        let cfg = EngineConfig::from_env();
        assert_eq!(cfg.allowed_images, vec!["ubuntu:22.04"]);
    }

    #[test]
    fn numeric_parse_invalid_falls_back_to_default() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_all_iii_vars();
        unsafe { env::set_var("III_REST_PORT", "not_a_number") };
        let cfg = EngineConfig::from_env();
        assert_eq!(cfg.rest_port, 3111);
    }

    #[test]
    fn custom_workspace_dir() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_all_iii_vars();
        unsafe { env::set_var("III_WORKSPACE_DIR", "/home/user/work") };
        let cfg = EngineConfig::from_env();
        assert_eq!(cfg.workspace_dir, "/home/user/work");
    }

    #[test]
    fn custom_max_command_timeout() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_all_iii_vars();
        unsafe { env::set_var("III_MAX_CMD_TIMEOUT", "600") };
        let cfg = EngineConfig::from_env();
        assert_eq!(cfg.max_command_timeout, 600);
    }

    #[test]
    fn custom_ttl_sweep_and_metrics_intervals() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_all_iii_vars();
        unsafe { env::set_var("III_TTL_SWEEP", "*/10 * * * * *") };
        unsafe { env::set_var("III_METRICS_INTERVAL", "*/5 * * * * *") };
        let cfg = EngineConfig::from_env();
        assert_eq!(cfg.ttl_sweep_interval, "*/10 * * * * *");
        assert_eq!(cfg.metrics_interval, "*/5 * * * * *");
    }

    #[test]
    fn custom_isolation_backend() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_all_iii_vars();
        unsafe { env::set_var("III_ISOLATION_BACKEND", "firecracker") };
        let cfg = EngineConfig::from_env();
        assert_eq!(cfg.isolation_backend, "firecracker");
    }

    #[test]
    fn parse_int_or_default_valid() {
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe { env::set_var("III_TEST_PARSE_INT", "42") };
        assert_eq!(parse_int_or_default("III_TEST_PARSE_INT", 0), 42);
        unsafe { env::remove_var("III_TEST_PARSE_INT") };
    }

    #[test]
    fn parse_int_or_default_missing() {
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe { env::remove_var("III_TEST_PARSE_MISSING") };
        assert_eq!(parse_int_or_default("III_TEST_PARSE_MISSING", 99), 99);
    }

    #[test]
    fn parse_int_or_default_invalid() {
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe { env::set_var("III_TEST_PARSE_BAD", "xyz") };
        assert_eq!(parse_int_or_default("III_TEST_PARSE_BAD", 77), 77);
        unsafe { env::remove_var("III_TEST_PARSE_BAD") };
    }
}
