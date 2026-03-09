mod auth;
mod config;
mod docker;
mod functions;
mod lifecycle;
mod state;
mod triggers;
mod types;

use iii_sdk::{III, WorkerMetadata};
use std::sync::Arc;
use tokio::signal;
use tracing::info;

use config::EngineConfig;
use docker::connect_docker;
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

    let dk = connect_docker();
    info!("Connected to Docker");

    let kv = StateKV::new(iii.clone());

    functions::register_all(&iii, &dk, &kv, &config);
    lifecycle::register_all(&iii, &dk, &kv, &config);
    triggers::register_all(&iii, &dk, &kv, &config);

    info!(
        port = config.rest_port,
        prefix = %config.api_prefix,
        "All functions and triggers registered"
    );

    let dk_shutdown = dk.clone();
    let kv_shutdown = kv.clone();
    let iii_shutdown = iii.clone();

    signal::ctrl_c().await.expect("Failed to listen for SIGINT");
    info!("Shutting down...");
    lifecycle::cleanup::cleanup_all(&dk_shutdown, &kv_shutdown).await;
    iii_shutdown.shutdown_async().await;
    info!("Shutdown complete");
}
