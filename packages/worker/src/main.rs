mod auth;
mod config;
mod docker;
mod functions;
mod lifecycle;
mod ratelimit;
mod runtime;
mod state;
mod triggers;
mod types;

use iii_sdk::{III, WorkerMetadata};
use std::sync::Arc;
use tokio::signal;
use tracing::info;

use config::EngineConfig;
use docker::connect_docker;
use ratelimit::RateLimiter;
use runtime::SandboxRuntime;
use runtime::docker::DockerRuntime;
use state::StateKV;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let config = EngineConfig::from_env();
    info!(worker = %config.worker_name, url = %config.engine_url, prefix = %config.api_prefix, "Starting iii-sandbox worker");

    let iii = Arc::new(III::with_metadata(&config.engine_url, WorkerMetadata {
        name: config.worker_name.clone(),
        ..Default::default()
    }));
    iii.connect().await.expect("Failed to connect to iii-engine");
    info!("Connected to iii-engine");

    let rt: Arc<dyn SandboxRuntime> = match config.isolation_backend.as_str() {
        #[cfg(feature = "firecracker")]
        "firecracker" => {
            use runtime::firecracker::FirecrackerRuntime;
            Arc::new(FirecrackerRuntime::new(
                std::path::PathBuf::from("/tmp/firecracker-sockets"),
                std::path::PathBuf::from(&config.firecracker_kernel),
                std::path::PathBuf::from(&config.firecracker_rootfs),
                config.firecracker_vcpus,
                config.firecracker_mem_mib,
            ))
        }
        "docker" => {
            let dk = connect_docker();
            Arc::new(DockerRuntime::new(dk))
        }
        other => {
            tracing::warn!(backend = %other, "Unknown isolation backend, defaulting to docker");
            let dk = connect_docker();
            Arc::new(DockerRuntime::new(dk))
        }
    };
    info!(backend = %config.isolation_backend, "Isolation backend initialized");

    let kv = StateKV::new(iii.clone());
    let limiter = Arc::new(RateLimiter::new(config.rate_limit.clone()));

    if config.rate_limit.enabled {
        info!(
            token_rpm = config.rate_limit.token_requests_per_minute,
            burst = config.rate_limit.token_burst,
            "Rate limiting enabled"
        );
    }

    if config.warm_pool_size > 0 {
        info!(pool_size = config.warm_pool_size, "Warm pool enabled");
    }

    let cleanup_limiter = limiter.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        loop {
            interval.tick().await;
            cleanup_limiter.cleanup_stale();
        }
    });

    functions::register_all(&iii, &rt, &kv, &config);
    lifecycle::register_all(&iii, &rt, &kv, &config);
    triggers::register_all(&iii, &rt, &kv, &config, &limiter);

    info!(
        port = config.rest_port,
        prefix = %config.api_prefix,
        "All functions and triggers registered"
    );

    let rt_shutdown = rt.clone();
    let kv_shutdown = kv.clone();
    let iii_shutdown = iii.clone();

    signal::ctrl_c().await.expect("Failed to listen for SIGINT");
    info!("Shutting down...");
    lifecycle::cleanup::cleanup_all(&rt_shutdown, &kv_shutdown).await;
    iii_shutdown.shutdown_async().await;
    info!("Shutdown complete");
}
