use bollard::container::{
    Config as ContainerConfig, CreateContainerOptions, LogOutput, LogsOptions,
    StatsOptions, TopOptions, UploadToContainerOptions,
};
use bollard::exec::{CreateExecOptions, StartExecResults};
use bollard::image::CreateImageOptions;
use bollard::Docker;
use bytes::Bytes;
use futures_util::StreamExt;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use crate::types::{ExecResult, FileInfo, FileMetadata, SandboxConfig, SandboxMetrics};

const MAX_OUTPUT_BYTES: usize = 10 * 1024 * 1024;

pub fn connect_docker() -> Arc<Docker> {
    Arc::new(Docker::connect_with_local_defaults().expect("Failed to connect to Docker"))
}

pub async fn ensure_image(docker: &Docker, image: &str) -> Result<(), String> {
    match docker.inspect_image(image).await {
        Ok(_) => Ok(()),
        Err(_) => {
            let opts = CreateImageOptions {
                from_image: image,
                ..Default::default()
            };
            let mut stream = docker.create_image(Some(opts), None, None);
            while let Some(result) = stream.next().await {
                if let Err(e) = result {
                    return Err(format!("Failed to pull image {image}: {e}"));
                }
            }
            Ok(())
        }
    }
}

pub async fn create_container(
    docker: &Docker,
    id: &str,
    config: &SandboxConfig,
    entrypoint: Option<&[String]>,
) -> Result<(), String> {
    let container_name = format!("iii-sbx-{id}");
    let workdir = config.workdir.as_deref().unwrap_or("/workspace");
    let memory = config.memory.unwrap_or(512);
    let cpu = config.cpu.unwrap_or(1.0);
    let network_mode = if config.network.unwrap_or(false) {
        "bridge"
    } else {
        "none"
    };

    let env_vars: Vec<String> = config
        .env
        .as_ref()
        .map(|e| e.iter().map(|(k, v)| format!("{k}={v}")).collect())
        .unwrap_or_default();

    let mut labels = HashMap::new();
    labels.insert("iii-sandbox".to_string(), "true".to_string());
    labels.insert("iii-sandbox-id".to_string(), id.to_string());

    let host_config = bollard::models::HostConfig {
        memory: Some((memory * 1024 * 1024) as i64),
        cpu_shares: Some((cpu * 1024.0) as i64),
        pids_limit: Some(256),
        security_opt: Some(vec!["no-new-privileges".to_string()]),
        cap_drop: Some(vec![
            "NET_RAW".to_string(),
            "SYS_ADMIN".to_string(),
            "MKNOD".to_string(),
        ]),
        network_mode: Some(network_mode.to_string()),
        readonly_rootfs: Some(false),
        ..Default::default()
    };

    let (cmd, ep) = match entrypoint {
        Some(ep) if !ep.is_empty() => (None, Some(ep.to_vec())),
        _ => (
            Some(vec!["tail".to_string(), "-f".to_string(), "/dev/null".to_string()]),
            None,
        ),
    };

    let container_config: ContainerConfig<String> = ContainerConfig {
        image: Some(config.image.clone()),
        hostname: Some(id.to_string()),
        working_dir: Some(workdir.to_string()),
        env: Some(env_vars),
        tty: Some(false),
        open_stdin: Some(false),
        host_config: Some(host_config),
        labels: Some(labels),
        cmd,
        entrypoint: ep,
        ..Default::default()
    };

    let opts = CreateContainerOptions {
        name: container_name.as_str(),
        platform: None,
    };

    docker
        .create_container(Some(opts), container_config)
        .await
        .map_err(|e| format!("Failed to create container: {e}"))?;

    docker
        .start_container::<String>(&container_name, None)
        .await
        .map_err(|e| format!("Failed to start container: {e}"))?;

    Ok(())
}

pub async fn exec_in_container(
    docker: &Docker,
    container_name: &str,
    command: &[String],
    timeout_ms: u64,
) -> Result<ExecResult, String> {
    let start = Instant::now();
    let exec = docker
        .create_exec(
            container_name,
            CreateExecOptions {
                cmd: Some(command.iter().map(|s| s.as_str()).collect()),
                attach_stdout: Some(true),
                attach_stderr: Some(true),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| format!("Failed to create exec: {e}"))?;

    let exec_id = exec.id;
    let start_result = docker
        .start_exec(&exec_id, None)
        .await
        .map_err(|e| format!("Failed to start exec: {e}"))?;

    let mut stdout = String::new();
    let mut stderr = String::new();

    if let StartExecResults::Attached { mut output, .. } = start_result {
        let timeout = tokio::time::Duration::from_millis(timeout_ms);
        let result = tokio::time::timeout(timeout, async {
            while let Some(Ok(msg)) = output.next().await {
                match msg {
                    LogOutput::StdOut { message } => {
                        if stdout.len() < MAX_OUTPUT_BYTES {
                            stdout.push_str(&String::from_utf8_lossy(&message));
                        }
                    }
                    LogOutput::StdErr { message } => {
                        if stderr.len() < MAX_OUTPUT_BYTES {
                            stderr.push_str(&String::from_utf8_lossy(&message));
                        }
                    }
                    _ => {}
                }
            }
        })
        .await;

        if result.is_err() {
            return Err(format!("Command timed out after {timeout_ms}ms"));
        }
    }

    let inspect = docker.inspect_exec(&exec_id).await.ok();
    let exit_code = inspect
        .and_then(|i| i.exit_code)
        .unwrap_or(-1);

    Ok(ExecResult {
        exit_code,
        stdout,
        stderr,
        duration: start.elapsed().as_millis() as u64,
    })
}

pub async fn get_container_stats(
    docker: &Docker,
    container_name: &str,
    sandbox_id: &str,
) -> Result<SandboxMetrics, String> {
    let opts = StatsOptions {
        stream: false,
        one_shot: true,
    };

    let mut stream = docker.stats(container_name, Some(opts));
    let stats = stream
        .next()
        .await
        .ok_or("No stats returned")?
        .map_err(|e| format!("Stats error: {e}"))?;

    let cpu_delta = stats.cpu_stats.cpu_usage.total_usage as f64
        - stats.precpu_stats.cpu_usage.total_usage as f64;
    let system_delta = stats.cpu_stats.system_cpu_usage.unwrap_or(0) as f64
        - stats.precpu_stats.system_cpu_usage.unwrap_or(0) as f64;
    let cpu_count = stats.cpu_stats.online_cpus.unwrap_or(1) as f64;
    let cpu_percent = if system_delta > 0.0 {
        (cpu_delta / system_delta) * cpu_count * 100.0
    } else {
        0.0
    };

    let memory_usage = stats.memory_stats.usage.unwrap_or(0);
    let memory_limit = stats.memory_stats.limit.unwrap_or(1);

    let (rx_bytes, tx_bytes) = stats
        .networks
        .as_ref()
        .and_then(|nets| nets.get("eth0"))
        .map(|eth| (eth.rx_bytes, eth.tx_bytes))
        .unwrap_or((0, 0));

    let pids = stats.pids_stats.current.unwrap_or(0);

    Ok(SandboxMetrics {
        sandbox_id: sandbox_id.to_string(),
        cpu_percent,
        memory_usage_mb: memory_usage / 1024 / 1024,
        memory_limit_mb: memory_limit / 1024 / 1024,
        network_rx_bytes: rx_bytes,
        network_tx_bytes: tx_bytes,
        pids,
    })
}

pub async fn copy_to_container(
    docker: &Docker,
    container_name: &str,
    path: &str,
    content: &[u8],
) -> Result<(), String> {
    let filename = path.rsplit('/').next().unwrap_or(path);
    let dir = &path[..path.rfind('/').unwrap_or(0)];
    let dir = if dir.is_empty() { "/" } else { dir };

    let mut header = tar::Header::new_gnu();
    header.set_path(filename).map_err(|e| e.to_string())?;
    header.set_size(content.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();

    let mut tar_buf = Vec::new();
    {
        let mut ar = tar::Builder::new(&mut tar_buf);
        ar.append(&header, content).map_err(|e| e.to_string())?;
        ar.finish().map_err(|e| e.to_string())?;
    }

    let opts = UploadToContainerOptions {
        path: dir.to_string(),
        ..Default::default()
    };

    docker
        .upload_to_container(container_name, Some(opts), Bytes::from(tar_buf))
        .await
        .map_err(|e| format!("Upload failed: {e}"))
}

pub async fn copy_from_container(
    docker: &Docker,
    container_name: &str,
    path: &str,
) -> Result<Vec<u8>, String> {
    let mut stream = docker
        .download_from_container(container_name, Some(bollard::container::DownloadFromContainerOptions { path: path.to_string() }))
        .map(|chunk| chunk.map_err(|e| format!("Download error: {e}")));

    let mut tar_bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        tar_bytes.extend_from_slice(&chunk?);
    }

    let mut archive = tar::Archive::new(tar_bytes.as_slice());
    let mut content = Vec::new();
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        std::io::Read::read_to_end(&mut entry, &mut content).map_err(|e| e.to_string())?;
    }

    Ok(content)
}

pub async fn list_container_dir(
    docker: &Docker,
    container_name: &str,
    path: &str,
) -> Result<Vec<FileInfo>, String> {
    let quoted = path.replace('\'', "'\\''");
    let cmd = vec![
        "sh".to_string(),
        "-c".to_string(),
        format!("find '{}' -maxdepth 1 ! -name '.' -exec sh -c 'for f; do name=$(basename \"$f\"); if [ -d \"$f\" ]; then t=d; s=0; elif [ -L \"$f\" ]; then t=l; s=0; else t=f; s=$(wc -c < \"$f\" 2>/dev/null || echo 0); fi; echo \"$name\\t$s\\t0\\t$t\"; done' _ {{}} +", quoted),
    ];
    let result = exec_in_container(docker, container_name, &cmd, 10000).await?;
    if result.exit_code != 0 {
        return Ok(vec![]);
    }

    let files = result
        .stdout
        .trim()
        .lines()
        .skip(1)
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 4 {
                return None;
            }
            let name = parts[0].to_string();
            let size = parts[1].parse().unwrap_or(0);
            let mtime = parts[2].parse::<f64>().unwrap_or(0.0);
            let file_type = parts[3];
            let file_path = format!("{}/{}", path.trim_end_matches('/'), name);
            Some(FileInfo {
                name,
                path: file_path,
                size,
                is_directory: file_type == "d",
                modified_at: (mtime * 1000.0) as u64,
            })
        })
        .collect();

    Ok(files)
}

pub async fn search_in_container(
    docker: &Docker,
    container_name: &str,
    dir: &str,
    pattern: &str,
) -> Result<Vec<String>, String> {
    let cmd = vec![
        "find".to_string(),
        dir.to_string(),
        "-name".to_string(),
        pattern.to_string(),
        "-type".to_string(),
        "f".to_string(),
    ];
    let result = exec_in_container(docker, container_name, &cmd, 10000).await?;
    if result.exit_code != 0 {
        return Ok(vec![]);
    }
    Ok(result
        .stdout
        .trim()
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect())
}

pub async fn get_file_info(
    docker: &Docker,
    container_name: &str,
    paths: &[String],
) -> Result<Vec<FileMetadata>, String> {
    let quoted = paths
        .iter()
        .map(|p| format!("\"{}\"", p.replace('"', "\\\"")))
        .collect::<Vec<_>>()
        .join(" ");
    let cmd = vec![
        "sh".to_string(),
        "-c".to_string(),
        format!("stat -c '%n\t%s\t%A\t%U\t%G\t%F\t%Y' {quoted}"),
    ];
    let result = exec_in_container(docker, container_name, &cmd, 10000).await?;
    if result.exit_code != 0 {
        return Err(format!("stat failed: {}", result.stderr));
    }

    let metadata = result
        .stdout
        .trim()
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 7 {
                return None;
            }
            Some(FileMetadata {
                path: parts[0].to_string(),
                size: parts[1].parse().unwrap_or(0),
                permissions: parts[2].to_string(),
                owner: parts[3].to_string(),
                group: parts[4].to_string(),
                is_directory: parts[5] == "directory",
                is_symlink: parts[5] == "symbolic link",
                modified_at: parts[6].parse::<u64>().unwrap_or(0) * 1000,
            })
        })
        .collect();

    Ok(metadata)
}

pub async fn container_logs(
    docker: &Docker,
    container_name: &str,
    follow: bool,
    tail: &str,
) -> Result<Vec<Value>, String> {
    let opts = LogsOptions::<String> {
        follow,
        stdout: true,
        stderr: true,
        tail: tail.to_string(),
        timestamps: true,
        ..Default::default()
    };

    let mut stream = docker.logs(container_name, Some(opts));
    let mut logs = Vec::new();

    while let Some(Ok(log)) = stream.next().await {
        let (log_type, data) = match log {
            LogOutput::StdOut { message } => ("stdout", String::from_utf8_lossy(&message).to_string()),
            LogOutput::StdErr { message } => ("stderr", String::from_utf8_lossy(&message).to_string()),
            _ => continue,
        };
        logs.push(serde_json::json!({
            "type": log_type,
            "data": data,
            "timestamp": chrono::Utc::now().timestamp_millis() as u64,
        }));

        if !follow && logs.len() > 1000 {
            break;
        }
    }

    Ok(logs)
}

pub async fn container_top(
    docker: &Docker,
    container_name: &str,
) -> Result<Value, String> {
    let top = docker
        .top_processes(container_name, Some(TopOptions { ps_args: "aux" }))
        .await
        .map_err(|e| format!("Top failed: {e}"))?;

    Ok(serde_json::to_value(top).unwrap_or(Value::Null))
}

pub async fn create_pool_container(
    docker: &Docker,
    container_name: &str,
    config: &SandboxConfig,
) -> Result<(), String> {
    let workdir = config.workdir.as_deref().unwrap_or("/workspace");
    let memory = config.memory.unwrap_or(512);
    let cpu = config.cpu.unwrap_or(1.0);
    let network_mode = if config.network.unwrap_or(false) {
        "bridge"
    } else {
        "none"
    };

    let mut labels = HashMap::new();
    labels.insert("iii-sandbox".to_string(), "true".to_string());
    labels.insert("iii-pool".to_string(), "true".to_string());

    let host_config = bollard::models::HostConfig {
        memory: Some((memory * 1024 * 1024) as i64),
        cpu_shares: Some((cpu * 1024.0) as i64),
        pids_limit: Some(256),
        security_opt: Some(vec!["no-new-privileges".to_string()]),
        cap_drop: Some(vec![
            "NET_RAW".to_string(),
            "SYS_ADMIN".to_string(),
            "MKNOD".to_string(),
        ]),
        network_mode: Some(network_mode.to_string()),
        readonly_rootfs: Some(false),
        ..Default::default()
    };

    let container_config: ContainerConfig<String> = ContainerConfig {
        image: Some(config.image.clone()),
        working_dir: Some(workdir.to_string()),
        tty: Some(false),
        open_stdin: Some(false),
        host_config: Some(host_config),
        labels: Some(labels),
        cmd: Some(vec!["tail".to_string(), "-f".to_string(), "/dev/null".to_string()]),
        ..Default::default()
    };

    let opts = CreateContainerOptions {
        name: container_name,
        platform: None,
    };

    docker
        .create_container(Some(opts), container_config)
        .await
        .map_err(|e| format!("Failed to create pool container: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn container_name_for_sandbox(id: &str) -> String {
        format!("iii-sbx-{id}")
    }

    fn parse_stat_line(line: &str) -> Option<FileMetadata> {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 7 {
            return None;
        }
        Some(FileMetadata {
            path: parts[0].to_string(),
            size: parts[1].parse().unwrap_or(0),
            permissions: parts[2].to_string(),
            owner: parts[3].to_string(),
            group: parts[4].to_string(),
            is_directory: parts[5] == "directory",
            is_symlink: parts[5] == "symbolic link",
            modified_at: parts[6].parse::<u64>().unwrap_or(0) * 1000,
        })
    }

    fn parse_dir_entry(line: &str, base_path: &str) -> Option<FileInfo> {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 4 {
            return None;
        }
        let name = parts[0].to_string();
        let size = parts[1].parse().unwrap_or(0);
        let mtime = parts[2].parse::<f64>().unwrap_or(0.0);
        let file_type = parts[3];
        let file_path = format!("{}/{}", base_path.trim_end_matches('/'), name);
        Some(FileInfo {
            name,
            path: file_path,
            size,
            is_directory: file_type == "d",
            modified_at: (mtime * 1000.0) as u64,
        })
    }

    #[test]
    fn container_name_format() {
        assert_eq!(container_name_for_sandbox("abc123"), "iii-sbx-abc123");
    }

    #[test]
    fn container_name_with_prefix() {
        let name = container_name_for_sandbox("sbx_deadbeef");
        assert!(name.starts_with("iii-sbx-"));
        assert_eq!(name, "iii-sbx-sbx_deadbeef");
    }

    #[test]
    fn parse_stat_line_regular_file() {
        let line = "/workspace/main.py\t1024\t-rw-r--r--\troot\troot\tregular file\t1700000000";
        let meta = parse_stat_line(line).unwrap();
        assert_eq!(meta.path, "/workspace/main.py");
        assert_eq!(meta.size, 1024);
        assert_eq!(meta.permissions, "-rw-r--r--");
        assert_eq!(meta.owner, "root");
        assert_eq!(meta.group, "root");
        assert!(!meta.is_directory);
        assert!(!meta.is_symlink);
        assert_eq!(meta.modified_at, 1700000000000);
    }

    #[test]
    fn parse_stat_line_directory() {
        let line = "/workspace/src\t4096\tdrwxr-xr-x\troot\troot\tdirectory\t1700000000";
        let meta = parse_stat_line(line).unwrap();
        assert!(meta.is_directory);
        assert!(!meta.is_symlink);
    }

    #[test]
    fn parse_stat_line_symlink() {
        let line = "/usr/bin/python\t0\tlrwxrwxrwx\troot\troot\tsymbolic link\t1700000000";
        let meta = parse_stat_line(line).unwrap();
        assert!(meta.is_symlink);
        assert!(!meta.is_directory);
    }

    #[test]
    fn parse_stat_line_too_few_fields() {
        assert!(parse_stat_line("only\ttwo\tfields").is_none());
        assert!(parse_stat_line("").is_none());
    }

    #[test]
    fn parse_stat_line_invalid_size_defaults_to_zero() {
        let line = "/file\tnotanumber\t-rw-r--r--\troot\troot\tregular file\t0";
        let meta = parse_stat_line(line).unwrap();
        assert_eq!(meta.size, 0);
    }

    #[test]
    fn parse_stat_line_invalid_mtime_defaults_to_zero() {
        let line = "/file\t100\t-rw-r--r--\troot\troot\tregular file\tbadtime";
        let meta = parse_stat_line(line).unwrap();
        assert_eq!(meta.modified_at, 0);
    }

    #[test]
    fn parse_dir_entry_file() {
        let entry = parse_dir_entry("main.py\t512\t0\tf", "/workspace").unwrap();
        assert_eq!(entry.name, "main.py");
        assert_eq!(entry.path, "/workspace/main.py");
        assert_eq!(entry.size, 512);
        assert!(!entry.is_directory);
    }

    #[test]
    fn parse_dir_entry_directory() {
        let entry = parse_dir_entry("src\t4096\t0\td", "/workspace").unwrap();
        assert_eq!(entry.name, "src");
        assert_eq!(entry.path, "/workspace/src");
        assert!(entry.is_directory);
    }

    #[test]
    fn parse_dir_entry_trailing_slash_base() {
        let entry = parse_dir_entry("file.txt\t100\t0\tf", "/workspace/").unwrap();
        assert_eq!(entry.path, "/workspace/file.txt");
    }

    #[test]
    fn parse_dir_entry_too_few_fields() {
        assert!(parse_dir_entry("only\ttwo", "/workspace").is_none());
    }

    #[test]
    fn parse_dir_entry_with_mtime() {
        let entry = parse_dir_entry("app.js\t200\t1700000.5\tf", "/src").unwrap();
        assert_eq!(entry.modified_at, 1700000500);
    }

    #[test]
    fn parse_dir_entry_invalid_size() {
        let entry = parse_dir_entry("bad\tXX\t0\tf", "/").unwrap();
        assert_eq!(entry.size, 0);
    }

    #[test]
    fn max_output_bytes_constant() {
        assert_eq!(MAX_OUTPUT_BYTES, 10 * 1024 * 1024);
    }

    #[test]
    fn cpu_percent_zero_on_zero_system_delta() {
        let cpu_delta = 100.0_f64;
        let system_delta = 0.0_f64;
        let cpu_count = 4.0_f64;
        let cpu_percent = if system_delta > 0.0 {
            (cpu_delta / system_delta) * cpu_count * 100.0
        } else {
            0.0
        };
        assert_eq!(cpu_percent, 0.0);
    }

    #[test]
    fn cpu_percent_calculation() {
        let cpu_delta = 50_000_000.0_f64;
        let system_delta = 1_000_000_000.0_f64;
        let cpu_count = 4.0_f64;
        let cpu_percent = (cpu_delta / system_delta) * cpu_count * 100.0;
        assert!((cpu_percent - 20.0).abs() < 0.001);
    }

    #[test]
    fn memory_mb_calculation() {
        let usage: u64 = 536_870_912;
        let limit: u64 = 1_073_741_824;
        assert_eq!(usage / 1024 / 1024, 512);
        assert_eq!(limit / 1024 / 1024, 1024);
    }

    #[test]
    fn path_quoting_for_shell() {
        let path = "/workspace/it's here";
        let quoted = path.replace('\'', "'\\''");
        assert_eq!(quoted, "/workspace/it'\\''s here");
    }

    #[test]
    fn path_quoting_no_special_chars() {
        let path = "/workspace/src";
        let quoted = path.replace('\'', "'\\''");
        assert_eq!(quoted, path);
    }

    #[test]
    fn file_path_quoting_for_stat() {
        let paths = vec!["/workspace/file.txt".to_string(), "/workspace/with\"quote".to_string()];
        let quoted = paths
            .iter()
            .map(|p| format!("\"{}\"", p.replace('"', "\\\"")))
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(quoted, "\"/workspace/file.txt\" \"/workspace/with\\\"quote\"");
    }
}
