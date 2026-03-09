pub mod ttl;
pub mod cleanup;

use bollard::Docker;
use iii_sdk::III;
use std::sync::Arc;

use crate::config::EngineConfig;
use crate::state::StateKV;

pub fn register_all(iii: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV, _config: &EngineConfig) {
    ttl::register(iii, dk, kv);
}
