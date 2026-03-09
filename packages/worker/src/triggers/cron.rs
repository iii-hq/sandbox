use iii_sdk::III;
use serde_json::json;
use std::sync::Arc;

use crate::config::EngineConfig;

pub fn register(iii: &Arc<III>, config: &EngineConfig) {
    let _ = iii.register_trigger("cron", "lifecycle::ttl-sweep", json!({
        "expression": config.ttl_sweep_interval,
    }));
}
