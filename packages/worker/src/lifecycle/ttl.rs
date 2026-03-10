use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::runtime::SandboxRuntime;
use crate::state::{scopes, StateKV};
use crate::types::Sandbox;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

pub fn register(iii: &Arc<III>, rt: &Arc<dyn SandboxRuntime>, kv: &StateKV) {
    {
        let kv = kv.clone();
        let rt = rt.clone();
        iii.register_function_with_description("lifecycle::ttl-sweep", "Sweep expired sandboxes", move |_input: Value| {
            let kv = kv.clone();
            let rt = rt.clone();
            async move {
                let sandboxes: Vec<Sandbox> = kv.list(scopes::SANDBOXES).await;
                let now = now_ms();
                let mut swept: u64 = 0;

                for sandbox in &sandboxes {
                    if sandbox.expires_at <= now {
                        let cn = format!("iii-sbx-{}", sandbox.id);
                        let _ = rt.stop_sandbox(&cn).await;
                        let _ = rt.remove_sandbox(&cn, true).await;
                        let _ = kv.delete(scopes::SANDBOXES, &sandbox.id).await;
                        swept += 1;
                    }
                }

                Ok(json!({ "swept": swept }))
            }
        });
    }

    {
        iii.register_function_with_description("lifecycle::health", "Health check endpoint", move |_input: Value| {
            async move { Ok(json!({ "status": "healthy" })) }
        });
    }
}
