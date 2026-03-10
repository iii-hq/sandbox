pub mod ttl;
pub mod cleanup;

use iii_sdk::III;
use std::sync::Arc;

use crate::config::EngineConfig;
use crate::runtime::SandboxRuntime;
use crate::state::StateKV;

pub fn register_all(iii: &Arc<III>, rt: &Arc<dyn SandboxRuntime>, kv: &StateKV, _config: &EngineConfig) {
    ttl::register(iii, rt, kv);
}
