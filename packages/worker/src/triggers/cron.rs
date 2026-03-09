use iii_sdk::III;
use serde_json::json;
use std::sync::Arc;

use crate::config::EngineConfig;

pub fn register(bridge: &Arc<III>, config: &EngineConfig) {
    let _ = bridge.register_trigger("cron", "lifecycle::ttl-sweep", json!({
        "expression": config.ttl_sweep_interval,
    }));
}
