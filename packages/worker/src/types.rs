#![allow(dead_code)]
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxConfig {
    pub image: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workdir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entrypoint: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sandbox {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub config: SandboxConfig,
    pub metadata: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entrypoint: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worker_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    pub exit_code: i64,
    pub stdout: String,
    pub stderr: String,
    pub duration: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecStreamChunk {
    #[serde(rename = "type")]
    pub chunk_type: String,
    pub data: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_directory: bool,
    pub modified_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub path: String,
    pub size: u64,
    pub permissions: String,
    pub owner: String,
    pub group: String,
    pub is_directory: bool,
    pub is_symlink: bool,
    pub modified_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxMetrics {
    pub sandbox_id: String,
    pub cpu_percent: f64,
    pub memory_usage_mb: u64,
    pub memory_limit_mb: u64,
    pub network_rx_bytes: u64,
    pub network_tx_bytes: u64,
    pub pids: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalMetrics {
    pub active_sandboxes: usize,
    pub total_created: u64,
    pub total_killed: u64,
    pub total_expired: u64,
    pub uptime_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelSpec {
    pub name: String,
    pub language: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeResult {
    pub output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub execution_time: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedResult<T> {
    pub items: Vec<T>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundExec {
    pub id: String,
    pub sandbox_id: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u64>,
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    pub started_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub config: SandboxConfig,
    pub builtin: bool,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub sandbox_id: String,
    pub name: String,
    pub image_id: String,
    pub size: u64,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxEvent {
    pub id: String,
    pub topic: String,
    pub sandbox_id: String,
    pub data: serde_json::Value,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxNetwork {
    pub id: String,
    pub name: String,
    pub docker_network_id: String,
    pub sandboxes: Vec<String>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxVolume {
    pub id: String,
    pub name: String,
    pub docker_volume_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mount_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sandbox_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<String>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueJob {
    pub id: String,
    pub sandbox_id: String,
    pub command: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<ExecResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub retries: u32,
    pub max_retries: u32,
    pub created_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceAlert {
    pub id: String,
    pub sandbox_id: String,
    pub metric: String,
    pub threshold: f64,
    pub action: String,
    pub triggered: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_checked: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_triggered: Option<u64>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertEvent {
    pub alert_id: String,
    pub sandbox_id: String,
    pub metric: String,
    pub value: f64,
    pub threshold: f64,
    pub action: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceRecord {
    pub id: String,
    pub function_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sandbox_id: Option<String>,
    pub duration: u64,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservabilityMetrics {
    pub total_requests: usize,
    pub total_errors: usize,
    pub avg_duration: f64,
    pub p95_duration: f64,
    pub active_sandboxes: usize,
    pub function_counts: HashMap<String, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortMapping {
    pub container_port: u16,
    pub host_port: u16,
    pub protocol: String,
    pub state: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_sandbox_config() -> SandboxConfig {
        SandboxConfig {
            image: "python:3.12-slim".to_string(),
            name: None,
            timeout: None,
            memory: None,
            cpu: None,
            network: None,
            env: None,
            workdir: None,
            metadata: None,
            entrypoint: None,
        }
    }

    fn sample_sandbox() -> Sandbox {
        Sandbox {
            id: "sbx_abc123".to_string(),
            name: "test-sandbox".to_string(),
            image: "python:3.12-slim".to_string(),
            status: "running".to_string(),
            created_at: 1700000000,
            expires_at: 1700003600,
            config: sample_sandbox_config(),
            metadata: HashMap::new(),
            entrypoint: None,
            worker_id: None,
        }
    }

    #[test]
    fn sandbox_serializes_camel_case() {
        let sbx = sample_sandbox();
        let json = serde_json::to_value(&sbx).unwrap();
        assert!(json.get("createdAt").is_some(), "expected camelCase createdAt");
        assert!(json.get("expiresAt").is_some(), "expected camelCase expiresAt");
        assert!(json.get("created_at").is_none(), "snake_case should not appear");
    }

    #[test]
    fn sandbox_deserializes_from_camel_case() {
        let data = json!({
            "id": "sbx_1",
            "name": "my-sbx",
            "image": "node:20",
            "status": "running",
            "createdAt": 1000,
            "expiresAt": 2000,
            "config": { "image": "node:20" },
            "metadata": {}
        });
        let sbx: Sandbox = serde_json::from_value(data).unwrap();
        assert_eq!(sbx.created_at, 1000);
        assert_eq!(sbx.expires_at, 2000);
    }

    #[test]
    fn sandbox_roundtrip() {
        let original = sample_sandbox();
        let json_str = serde_json::to_string(&original).unwrap();
        let restored: Sandbox = serde_json::from_str(&json_str).unwrap();
        assert_eq!(restored.id, original.id);
        assert_eq!(restored.name, original.name);
        assert_eq!(restored.status, original.status);
        assert_eq!(restored.created_at, original.created_at);
    }

    #[test]
    fn exec_result_serialization() {
        let er = ExecResult {
            exit_code: 0,
            stdout: "hello".to_string(),
            stderr: "".to_string(),
            duration: 42,
        };
        let json = serde_json::to_value(&er).unwrap();
        assert_eq!(json["exitCode"], 0);
        assert_eq!(json["stdout"], "hello");
        assert_eq!(json["duration"], 42);
    }

    #[test]
    fn exec_result_deserialization() {
        let data = json!({"exitCode": 1, "stdout": "out", "stderr": "err", "duration": 100});
        let er: ExecResult = serde_json::from_value(data).unwrap();
        assert_eq!(er.exit_code, 1);
        assert_eq!(er.stderr, "err");
    }

    #[test]
    fn sandbox_config_all_none() {
        let cfg = sample_sandbox_config();
        let json = serde_json::to_value(&cfg).unwrap();
        assert!(json.get("name").is_none(), "None fields should be skipped");
        assert!(json.get("timeout").is_none());
        assert!(json.get("memory").is_none());
        assert!(json.get("cpu").is_none());
        assert!(json.get("network").is_none());
        assert!(json.get("env").is_none());
        assert!(json.get("workdir").is_none());
        assert!(json.get("metadata").is_none());
        assert!(json.get("entrypoint").is_none());
        assert_eq!(json["image"], "python:3.12-slim");
    }

    #[test]
    fn sandbox_config_all_some() {
        let mut env = HashMap::new();
        env.insert("FOO".to_string(), "bar".to_string());
        let mut meta = HashMap::new();
        meta.insert("key".to_string(), "val".to_string());
        let cfg = SandboxConfig {
            image: "alpine".to_string(),
            name: Some("my-cfg".to_string()),
            timeout: Some(600),
            memory: Some(1024),
            cpu: Some(2.5),
            network: Some(true),
            env: Some(env),
            workdir: Some("/app".to_string()),
            metadata: Some(meta),
            entrypoint: Some(vec!["sh".to_string(), "-c".to_string()]),
        };
        let json = serde_json::to_value(&cfg).unwrap();
        assert_eq!(json["name"], "my-cfg");
        assert_eq!(json["timeout"], 600);
        assert_eq!(json["memory"], 1024);
        assert_eq!(json["cpu"], 2.5);
        assert_eq!(json["network"], true);
        assert_eq!(json["env"]["FOO"], "bar");
        assert_eq!(json["workdir"], "/app");
        assert_eq!(json["metadata"]["key"], "val");
        assert_eq!(json["entrypoint"][0], "sh");
    }

    #[test]
    fn sandbox_config_roundtrip() {
        let cfg = SandboxConfig {
            image: "ubuntu".to_string(),
            name: Some("roundtrip".to_string()),
            timeout: Some(30),
            memory: None,
            cpu: None,
            network: Some(false),
            env: None,
            workdir: None,
            metadata: None,
            entrypoint: None,
        };
        let json_str = serde_json::to_string(&cfg).unwrap();
        let restored: SandboxConfig = serde_json::from_str(&json_str).unwrap();
        assert_eq!(restored.image, "ubuntu");
        assert_eq!(restored.name, Some("roundtrip".to_string()));
        assert_eq!(restored.timeout, Some(30));
        assert!(restored.memory.is_none());
    }

    #[test]
    fn sandbox_event_serialization() {
        let evt = SandboxEvent {
            id: "evt_1".to_string(),
            topic: "exec.done".to_string(),
            sandbox_id: "sbx_1".to_string(),
            data: json!({"key": "value"}),
            timestamp: 9999,
        };
        let json = serde_json::to_value(&evt).unwrap();
        assert_eq!(json["id"], "evt_1");
        assert_eq!(json["topic"], "exec.done");
        assert_eq!(json["sandboxId"], "sbx_1");
        assert_eq!(json["timestamp"], 9999);
    }

    #[test]
    fn queue_job_minimal() {
        let job = QueueJob {
            id: "q_1".to_string(),
            sandbox_id: "sbx_1".to_string(),
            command: "echo hi".to_string(),
            status: "pending".to_string(),
            result: None,
            error: None,
            retries: 0,
            max_retries: 3,
            created_at: 1000,
            started_at: None,
            completed_at: None,
        };
        let json = serde_json::to_value(&job).unwrap();
        assert!(json.get("result").is_none());
        assert!(json.get("error").is_none());
        assert!(json.get("startedAt").is_none());
        assert!(json.get("completedAt").is_none());
        assert_eq!(json["retries"], 0);
    }

    #[test]
    fn queue_job_with_result() {
        let job = QueueJob {
            id: "q_2".to_string(),
            sandbox_id: "sbx_2".to_string(),
            command: "ls".to_string(),
            status: "completed".to_string(),
            result: Some(ExecResult {
                exit_code: 0,
                stdout: "file.txt".to_string(),
                stderr: "".to_string(),
                duration: 10,
            }),
            error: None,
            retries: 1,
            max_retries: 3,
            created_at: 1000,
            started_at: Some(1001),
            completed_at: Some(1002),
        };
        let json = serde_json::to_value(&job).unwrap();
        assert!(json.get("result").is_some());
        assert_eq!(json["startedAt"], 1001);
        assert_eq!(json["completedAt"], 1002);
    }

    #[test]
    fn background_exec_serialization() {
        let bg = BackgroundExec {
            id: "bg_1".to_string(),
            sandbox_id: "sbx_1".to_string(),
            command: "sleep 100".to_string(),
            pid: Some(12345),
            running: true,
            exit_code: None,
            started_at: 5000,
            finished_at: None,
        };
        let json = serde_json::to_value(&bg).unwrap();
        assert_eq!(json["sandboxId"], "sbx_1");
        assert_eq!(json["pid"], 12345);
        assert_eq!(json["running"], true);
        assert!(json.get("exitCode").is_none());
        assert!(json.get("finishedAt").is_none());
    }

    #[test]
    fn sandbox_template_serialization() {
        let tmpl = SandboxTemplate {
            id: "tmpl_1".to_string(),
            name: "python-dev".to_string(),
            description: "Python development environment".to_string(),
            config: sample_sandbox_config(),
            builtin: true,
            created_at: 1000,
        };
        let json = serde_json::to_value(&tmpl).unwrap();
        assert_eq!(json["name"], "python-dev");
        assert_eq!(json["builtin"], true);
        assert_eq!(json["createdAt"], 1000);
    }

    #[test]
    fn snapshot_serialization() {
        let snap = Snapshot {
            id: "snap_1".to_string(),
            sandbox_id: "sbx_1".to_string(),
            name: "checkpoint-1".to_string(),
            image_id: "sha256:abc".to_string(),
            size: 50_000_000,
            created_at: 2000,
        };
        let json = serde_json::to_value(&snap).unwrap();
        assert_eq!(json["id"], "snap_1");
        assert_eq!(json["sandboxId"], "sbx_1");
        assert_eq!(json["imageId"], "sha256:abc");
        assert_eq!(json["size"], 50_000_000u64);
    }

    #[test]
    fn resource_alert_serialization() {
        let alert = ResourceAlert {
            id: "alert_1".to_string(),
            sandbox_id: "sbx_1".to_string(),
            metric: "cpu".to_string(),
            threshold: 90.0,
            action: "kill".to_string(),
            triggered: false,
            last_checked: None,
            last_triggered: None,
            created_at: 3000,
        };
        let json = serde_json::to_value(&alert).unwrap();
        assert_eq!(json["metric"], "cpu");
        assert_eq!(json["threshold"], 90.0);
        assert_eq!(json["triggered"], false);
        assert!(json.get("lastChecked").is_none());
        assert!(json.get("lastTriggered").is_none());
    }

    #[test]
    fn resource_alert_with_timestamps() {
        let alert = ResourceAlert {
            id: "alert_2".to_string(),
            sandbox_id: "sbx_2".to_string(),
            metric: "memory".to_string(),
            threshold: 80.0,
            action: "notify".to_string(),
            triggered: true,
            last_checked: Some(4000),
            last_triggered: Some(3999),
            created_at: 3000,
        };
        let json = serde_json::to_value(&alert).unwrap();
        assert_eq!(json["lastChecked"], 4000);
        assert_eq!(json["lastTriggered"], 3999);
        assert_eq!(json["triggered"], true);
    }

    #[test]
    fn trace_record_serialization() {
        let tr = TraceRecord {
            id: "tr_1".to_string(),
            function_id: "fn_exec".to_string(),
            sandbox_id: Some("sbx_1".to_string()),
            duration: 150,
            status: "ok".to_string(),
            error: None,
            timestamp: 5000,
        };
        let json = serde_json::to_value(&tr).unwrap();
        assert_eq!(json["functionId"], "fn_exec");
        assert_eq!(json["sandboxId"], "sbx_1");
        assert!(json.get("error").is_none());
    }

    #[test]
    fn trace_record_with_error() {
        let tr = TraceRecord {
            id: "tr_2".to_string(),
            function_id: "fn_create".to_string(),
            sandbox_id: None,
            duration: 500,
            status: "error".to_string(),
            error: Some("timeout".to_string()),
            timestamp: 6000,
        };
        let json = serde_json::to_value(&tr).unwrap();
        assert!(json.get("sandboxId").is_none());
        assert_eq!(json["error"], "timeout");
    }

    #[test]
    fn sandbox_network_serialization() {
        let net = SandboxNetwork {
            id: "net_1".to_string(),
            name: "my-net".to_string(),
            docker_network_id: "docker_abc".to_string(),
            sandboxes: vec!["sbx_1".to_string(), "sbx_2".to_string()],
            created_at: 7000,
        };
        let json = serde_json::to_value(&net).unwrap();
        assert_eq!(json["dockerNetworkId"], "docker_abc");
        assert_eq!(json["sandboxes"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn sandbox_volume_serialization() {
        let vol = SandboxVolume {
            id: "vol_1".to_string(),
            name: "data-vol".to_string(),
            docker_volume_name: "vol_docker_xyz".to_string(),
            mount_path: Some("/data".to_string()),
            sandbox_id: Some("sbx_1".to_string()),
            size: Some("100MB".to_string()),
            created_at: 8000,
        };
        let json = serde_json::to_value(&vol).unwrap();
        assert_eq!(json["dockerVolumeName"], "vol_docker_xyz");
        assert_eq!(json["mountPath"], "/data");
        assert_eq!(json["size"], "100MB");
    }

    #[test]
    fn sandbox_volume_minimal() {
        let vol = SandboxVolume {
            id: "vol_2".to_string(),
            name: "empty-vol".to_string(),
            docker_volume_name: "dv_2".to_string(),
            mount_path: None,
            sandbox_id: None,
            size: None,
            created_at: 8001,
        };
        let json = serde_json::to_value(&vol).unwrap();
        assert!(json.get("mountPath").is_none());
        assert!(json.get("sandboxId").is_none());
        assert!(json.get("size").is_none());
    }

    #[test]
    fn port_mapping_serialization() {
        let pm = PortMapping {
            container_port: 8080,
            host_port: 9090,
            protocol: "tcp".to_string(),
            state: "open".to_string(),
        };
        let json = serde_json::to_value(&pm).unwrap();
        assert_eq!(json["containerPort"], 8080);
        assert_eq!(json["hostPort"], 9090);
        assert_eq!(json["protocol"], "tcp");
    }

    #[test]
    fn file_info_serialization() {
        let fi = FileInfo {
            name: "main.py".to_string(),
            path: "/workspace/main.py".to_string(),
            size: 256,
            is_directory: false,
            modified_at: 10000,
        };
        let json = serde_json::to_value(&fi).unwrap();
        assert_eq!(json["name"], "main.py");
        assert_eq!(json["isDirectory"], false);
        assert_eq!(json["modifiedAt"], 10000);
    }

    #[test]
    fn file_info_directory() {
        let fi = FileInfo {
            name: "src".to_string(),
            path: "/workspace/src".to_string(),
            size: 4096,
            is_directory: true,
            modified_at: 10001,
        };
        let json = serde_json::to_value(&fi).unwrap();
        assert_eq!(json["isDirectory"], true);
    }

    #[test]
    fn file_metadata_serialization() {
        let fm = FileMetadata {
            path: "/workspace/script.sh".to_string(),
            size: 1024,
            permissions: "rwxr-xr-x".to_string(),
            owner: "root".to_string(),
            group: "root".to_string(),
            is_directory: false,
            is_symlink: false,
            modified_at: 11000,
        };
        let json = serde_json::to_value(&fm).unwrap();
        assert_eq!(json["permissions"], "rwxr-xr-x");
        assert_eq!(json["isSymlink"], false);
        assert_eq!(json["isDirectory"], false);
    }

    #[test]
    fn file_metadata_symlink() {
        let fm = FileMetadata {
            path: "/usr/bin/python".to_string(),
            size: 0,
            permissions: "rwxrwxrwx".to_string(),
            owner: "root".to_string(),
            group: "root".to_string(),
            is_directory: false,
            is_symlink: true,
            modified_at: 11001,
        };
        let json = serde_json::to_value(&fm).unwrap();
        assert_eq!(json["isSymlink"], true);
    }

    #[test]
    fn exec_stream_chunk_serialization() {
        let chunk = ExecStreamChunk {
            chunk_type: "stdout".to_string(),
            data: "line1\n".to_string(),
            timestamp: 12000,
        };
        let json = serde_json::to_value(&chunk).unwrap();
        assert_eq!(json["type"], "stdout");
        assert_eq!(json["data"], "line1\n");
    }

    #[test]
    fn sandbox_metrics_serialization() {
        let m = SandboxMetrics {
            sandbox_id: "sbx_1".to_string(),
            cpu_percent: 45.5,
            memory_usage_mb: 256,
            memory_limit_mb: 512,
            network_rx_bytes: 1000,
            network_tx_bytes: 2000,
            pids: 5,
        };
        let json = serde_json::to_value(&m).unwrap();
        assert_eq!(json["sandboxId"], "sbx_1");
        assert_eq!(json["cpuPercent"], 45.5);
        assert_eq!(json["memoryUsageMb"], 256);
    }

    #[test]
    fn alert_event_serialization() {
        let ae = AlertEvent {
            alert_id: "alert_1".to_string(),
            sandbox_id: "sbx_1".to_string(),
            metric: "cpu".to_string(),
            value: 95.0,
            threshold: 90.0,
            action: "kill".to_string(),
            timestamp: 13000,
        };
        let json = serde_json::to_value(&ae).unwrap();
        assert_eq!(json["alertId"], "alert_1");
        assert_eq!(json["value"], 95.0);
        assert_eq!(json["threshold"], 90.0);
    }

    #[test]
    fn global_metrics_serialization() {
        let gm = GlobalMetrics {
            active_sandboxes: 5,
            total_created: 100,
            total_killed: 50,
            total_expired: 30,
            uptime_seconds: 86400,
        };
        let json = serde_json::to_value(&gm).unwrap();
        assert_eq!(json["activeSandboxes"], 5);
        assert_eq!(json["uptimeSeconds"], 86400);
    }

    #[test]
    fn observability_metrics_serialization() {
        let mut func_counts = HashMap::new();
        func_counts.insert("exec".to_string(), 100);
        func_counts.insert("create".to_string(), 50);
        let om = ObservabilityMetrics {
            total_requests: 150,
            total_errors: 2,
            avg_duration: 45.3,
            p95_duration: 120.0,
            active_sandboxes: 10,
            function_counts: func_counts,
        };
        let json = serde_json::to_value(&om).unwrap();
        assert_eq!(json["totalRequests"], 150);
        assert_eq!(json["p95Duration"], 120.0);
        assert_eq!(json["functionCounts"]["exec"], 100);
    }

    #[test]
    fn sandbox_deserializes_without_worker_id() {
        let data = json!({
            "id": "sbx_1",
            "name": "my-sbx",
            "image": "node:20",
            "status": "running",
            "createdAt": 1000,
            "expiresAt": 2000,
            "config": { "image": "node:20" },
            "metadata": {}
        });
        let sbx: Sandbox = serde_json::from_value(data).unwrap();
        assert_eq!(sbx.id, "sbx_1");
        assert!(sbx.worker_id.is_none());
    }

    #[test]
    fn sandbox_serializes_with_worker_id() {
        let mut sbx = sample_sandbox();
        sbx.worker_id = Some("w1".into());
        let json = serde_json::to_value(&sbx).unwrap();
        assert_eq!(json["workerId"], "w1");
    }
}
