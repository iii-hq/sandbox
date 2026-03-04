use std::sync::Arc;

use crate::client::HttpClient;
use crate::error::Result;
use crate::types::{
    VolumeAttachResponse, VolumeDeleteResponse, VolumeDetachResponse, VolumeInfo,
    VolumeListResponse,
};

pub struct VolumeManager {
    client: Arc<HttpClient>,
}

impl VolumeManager {
    pub fn new(client: Arc<HttpClient>) -> Self {
        Self { client }
    }

    pub async fn create(&self, name: &str, driver: Option<&str>) -> Result<VolumeInfo> {
        self.client
            .post(
                "/sandbox/volumes",
                Some(&serde_json::json!({
                    "name": name,
                    "driver": driver,
                })),
            )
            .await
    }

    pub async fn list(&self) -> Result<VolumeListResponse> {
        self.client.get("/sandbox/volumes").await
    }

    pub async fn delete(&self, volume_id: &str) -> Result<VolumeDeleteResponse> {
        self.client
            .delete(&format!("/sandbox/volumes/{volume_id}"))
            .await
    }

    pub async fn attach(
        &self,
        volume_id: &str,
        sandbox_id: &str,
        mount_path: &str,
    ) -> Result<VolumeAttachResponse> {
        self.client
            .post(
                &format!("/sandbox/volumes/{volume_id}/attach"),
                Some(&serde_json::json!({
                    "sandboxId": sandbox_id,
                    "mountPath": mount_path,
                })),
            )
            .await
    }

    pub async fn detach(&self, volume_id: &str) -> Result<VolumeDetachResponse> {
        self.client
            .post_no_body(&format!("/sandbox/volumes/{volume_id}/detach"))
            .await
    }
}
