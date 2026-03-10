pub mod api;
pub mod cron;
pub mod events;

use bollard::Docker;
use iii_sdk::III;
use std::sync::Arc;

use crate::config::EngineConfig;
use crate::ratelimit::RateLimiter;
use crate::state::StateKV;

pub fn register_all(iii: &Arc<III>, _dk: &Arc<Docker>, kv: &StateKV, config: &EngineConfig, limiter: &Arc<RateLimiter>) {
    api::register(iii, config, limiter);
    cron::register(iii, config);
    events::register(iii, kv);
}
