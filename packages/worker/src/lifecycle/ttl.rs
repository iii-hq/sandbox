use bollard::container::RemoveContainerOptions;
use bollard::Docker;
use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::state::{scopes, StateKV};
use crate::types::Sandbox;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

pub fn register(bridge: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV) {
    {
        let kv = kv.clone();
        let dk = dk.clone();
        bridge.register_function("lifecycle::ttl-sweep", move |_input: Value| {
            let kv = kv.clone();
            let dk = dk.clone();
            async move {
                let sandboxes: Vec<Sandbox> = kv.list(scopes::SANDBOXES).await;
                let now = now_ms();
                let mut swept: u64 = 0;

                for sandbox in &sandboxes {
                    if sandbox.expires_at <= now {
                        let cn = format!("iii-sbx-{}", sandbox.id);
                        let _ = dk.stop_container(&cn, None).await;
                        let _ = dk
                            .remove_container(
                                &cn,
                                Some(RemoveContainerOptions {
                                    force: true,
                                    ..Default::default()
                                }),
                            )
                            .await;
                        let _ = kv.delete(scopes::SANDBOXES, &sandbox.id).await;
                        swept += 1;
                    }
                }

                Ok(json!({ "swept": swept }))
            }
        });
    }

    {
        bridge.register_function("lifecycle::health", move |_input: Value| {
            async move { Ok(json!({ "status": "healthy" })) }
        });
    }
}
