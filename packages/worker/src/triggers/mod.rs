pub mod api;
pub mod cron;
pub mod events;

use bollard::Docker;
use iii_sdk::III;
use std::sync::Arc;

use crate::config::EngineConfig;
use crate::state::StateKV;

pub fn register_all(bridge: &Arc<III>, _dk: &Arc<Docker>, kv: &StateKV, config: &EngineConfig) {
    api::register(bridge, config);
    cron::register(bridge, config);
    events::register(bridge, kv);
}
