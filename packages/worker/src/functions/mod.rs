pub mod sandbox;
pub mod command;
pub mod filesystem;
pub mod git;
pub mod env;
pub mod process;
pub mod port;
pub mod snapshot;
pub mod clone;
pub mod template;
pub mod metrics;
pub mod monitor;
pub mod event;
pub mod queue;
pub mod background;
pub mod network;
pub mod volume;
pub mod observability;
pub mod stream;
pub mod interpreter;

use bollard::Docker;
use iii_sdk::III;
use std::sync::Arc;

use crate::config::EngineConfig;
use crate::state::StateKV;

pub fn register_all(iii: &Arc<III>, docker: &Arc<Docker>, kv: &StateKV, config: &EngineConfig) {
    sandbox::register(iii, docker, kv, config);
    command::register(iii, docker, kv, config);
    filesystem::register(iii, docker, kv, config);
    git::register(iii, docker, kv, config);
    env::register(iii, docker, kv, config);
    process::register(iii, docker, kv, config);
    port::register(iii, docker, kv, config);
    snapshot::register(iii, docker, kv, config);
    clone::register(iii, docker, kv, config);
    template::register(iii, kv, config);
    metrics::register(iii, docker, kv);
    monitor::register(iii, docker, kv, config);
    event::register(iii, kv, config);
    queue::register(iii, kv, config);
    background::register(iii, docker, kv, config);
    network::register(iii, docker, kv, config);
    volume::register(iii, docker, kv, config);
    observability::register(iii, kv, config);
    stream::register(iii, docker, kv, config);
    interpreter::register(iii, docker, kv, config);
}
