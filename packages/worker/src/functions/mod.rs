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

pub fn register_all(bridge: &Arc<III>, docker: &Arc<Docker>, kv: &StateKV, config: &EngineConfig) {
    sandbox::register(bridge, docker, kv, config);
    command::register(bridge, docker, kv, config);
    filesystem::register(bridge, docker, kv, config);
    git::register(bridge, docker, kv, config);
    env::register(bridge, docker, kv, config);
    process::register(bridge, docker, kv, config);
    port::register(bridge, docker, kv, config);
    snapshot::register(bridge, docker, kv, config);
    clone::register(bridge, docker, kv, config);
    template::register(bridge, kv, config);
    metrics::register(bridge, docker, kv);
    monitor::register(bridge, docker, kv, config);
    event::register(bridge, kv, config);
    queue::register(bridge, kv, config);
    background::register(bridge, docker, kv, config);
    network::register(bridge, docker, kv, config);
    volume::register(bridge, docker, kv, config);
    observability::register(bridge, kv, config);
    stream::register(bridge, docker, kv, config);
    interpreter::register(bridge, docker, kv, config);
}
