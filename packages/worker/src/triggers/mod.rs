pub mod api;
pub mod cron;
pub mod events;

use bollard::Docker;
use iii_sdk::III;
use std::sync::Arc;

use crate::config::EngineConfig;
use crate::state::StateKV;

pub fn register_all(iii: &Arc<III>, _dk: &Arc<Docker>, kv: &StateKV, config: &EngineConfig) {
    api::register(iii, config);
    cron::register(iii, config);
    events::register(iii, kv);
}
