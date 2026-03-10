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
pub mod warmpool;
pub mod terminal;
pub mod proxy;
pub mod worker;

use iii_sdk::III;
use std::sync::Arc;

use crate::config::EngineConfig;
use crate::runtime::SandboxRuntime;
use crate::state::StateKV;

pub fn register_all(iii: &Arc<III>, rt: &Arc<dyn SandboxRuntime>, kv: &StateKV, config: &EngineConfig) {
    sandbox::register(iii, rt, kv, config);
    command::register(iii, rt, kv, config);
    filesystem::register(iii, rt, kv, config);
    git::register(iii, rt, kv, config);
    env::register(iii, rt, kv, config);
    process::register(iii, rt, kv, config);
    port::register(iii, rt, kv, config);
    snapshot::register(iii, rt, kv, config);
    clone::register(iii, rt, kv, config);
    template::register(iii, kv, config);
    metrics::register(iii, rt, kv);
    monitor::register(iii, rt, kv, config);
    event::register(iii, kv, config);
    queue::register(iii, kv, config);
    background::register(iii, rt, kv, config);
    network::register(iii, rt, kv, config);
    volume::register(iii, rt, kv, config);
    observability::register(iii, kv, config);
    stream::register(iii, rt, kv, config);
    interpreter::register(iii, rt, kv, config);
    warmpool::register(iii, rt, kv, config);
    terminal::register(iii, rt, kv, config);
    proxy::register(iii, rt, kv, config);
    worker::register(iii, rt, kv, config);
    worker::register_scoped(iii, rt, kv, config);
}
