use bollard::container::RemoveContainerOptions;
use bollard::Docker;
use std::sync::Arc;
use tracing::{info, warn};

use crate::state::{scopes, StateKV};
use crate::types::Sandbox;

pub async fn cleanup_all(dk: &Arc<Docker>, kv: &StateKV) {
    let sandboxes: Vec<Sandbox> = kv.list(scopes::SANDBOXES).await;

    for sandbox in &sandboxes {
        let cn = format!("iii-sbx-{}", sandbox.id);
        let stop_result = dk.stop_container(&cn, None).await;
        if stop_result.is_err() {
            warn!(id = %sandbox.id, "Stop failed during cleanup");
        }
        let remove_result = dk
            .remove_container(
                &cn,
                Some(RemoveContainerOptions {
                    force: true,
                    ..Default::default()
                }),
            )
            .await;
        if let Err(e) = remove_result {
            warn!(id = %sandbox.id, error = %e, "Remove failed during cleanup");
        }
        let _ = kv.delete(scopes::SANDBOXES, &sandbox.id).await;
    }

    if !sandboxes.is_empty() {
        info!(count = sandboxes.len(), "Cleanup complete");
    }
}
