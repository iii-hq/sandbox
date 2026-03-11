use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::os::unix::fs::MetadataExt;
use std::process::Command;
use std::time::{Instant, UNIX_EPOCH};

const MAX_BODY_SIZE: usize = 10 * 1024 * 1024;

fn main() {
    #[cfg(unix)]
    unsafe {
        libc::signal(libc::SIGCHLD, libc::SIG_IGN);
    }

    let port = std::env::var("AGENT_PORT")
        .unwrap_or_else(|_| "8052".to_string())
        .parse::<u16>()
        .unwrap_or(8052);

    let listener = TcpListener::bind(format!("0.0.0.0:{port}"))
        .unwrap_or_else(|e| {
            eprintln!("Failed to bind on port {port}: {e}");
            std::process::exit(1);
        });

    eprintln!("iii-guest-agent listening on port {port}");

    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => {
                std::thread::spawn(move || {
                    if let Err(e) = handle_connection(&mut stream) {
                        eprintln!("Request error: {e}");
                    }
                });
            }
            Err(e) => eprintln!("Accept error: {e}"),
        }
    }
}

fn handle_connection(stream: &mut std::net::TcpStream) -> Result<(), String> {
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);

    let mut request_line = String::new();
    reader.read_line(&mut request_line).map_err(|e| e.to_string())?;

    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return send_response(stream, 400, &serde_json::json!({"error": "bad request"}));
    }

    let method = parts[0];
    let path = parts[1];

    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|e| e.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some(val) = trimmed.strip_prefix("Content-Length: ") {
            content_length = val.parse().unwrap_or(0);
        }
    }

    let body = if content_length > 0 {
        if content_length > MAX_BODY_SIZE {
            return send_response(stream, 400, &serde_json::json!({"error": "body too large"}));
        }
        let mut buf = vec![0u8; content_length];
        reader.read_exact(&mut buf).map_err(|e| e.to_string())?;
        String::from_utf8_lossy(&buf).to_string()
    } else {
        String::new()
    };

    match (method, path) {
        ("GET", "/health") => {
            send_response(stream, 200, &serde_json::json!({"healthy": true}))
        }
        ("POST", "/exec") => handle_exec(stream, &body),
        ("POST", "/file/write") => handle_file_write(stream, &body),
        ("POST", "/file/read") => handle_file_read(stream, &body),
        ("POST", "/file/list") => handle_file_list(stream, &body),
        ("POST", "/file/search") => handle_file_search(stream, &body),
        ("POST", "/file/info") => handle_file_info(stream, &body),
        ("POST", "/stats") => handle_stats(stream),
        ("POST", "/processes") => handle_processes(stream),
        _ => send_response(stream, 404, &serde_json::json!({"error": "not found"})),
    }
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct ExecRequest {
    command: Vec<String>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default)]
    detached: Option<bool>,
    #[serde(default)]
    workdir: Option<String>,
    #[serde(default)]
    env: Option<HashMap<String, String>>,
}

#[derive(Serialize)]
struct ExecResponse {
    exit_code: i64,
    stdout: String,
    stderr: String,
    duration_ms: u64,
}

fn handle_exec(stream: &mut std::net::TcpStream, body: &str) -> Result<(), String> {
    let req: ExecRequest = serde_json::from_str(body)
        .map_err(|e| format!("Invalid exec request: {e}"))?;

    if req.command.is_empty() {
        return send_response(stream, 400, &serde_json::json!({"error": "empty command"}));
    }

    if req.detached.unwrap_or(false) {
        let mut cmd = Command::new(&req.command[0]);
        cmd.args(&req.command[1..]);

        if let Some(ref dir) = req.workdir {
            cmd.current_dir(dir);
        }
        if let Some(ref env) = req.env {
            for (k, v) in env {
                cmd.env(k, v);
            }
        }

        match cmd.spawn() {
            Ok(child) => {
                let pid = child.id().to_string();
                send_response(stream, 200, &serde_json::json!({"pid": pid}))
            }
            Err(e) => send_response(stream, 500, &serde_json::json!({"error": e.to_string()})),
        }
    } else {
        let start = Instant::now();
        let mut cmd = Command::new(&req.command[0]);
        cmd.args(&req.command[1..]);

        if let Some(ref dir) = req.workdir {
            cmd.current_dir(dir);
        }
        if let Some(ref env) = req.env {
            for (k, v) in env {
                cmd.env(k, v);
            }
        }

        match cmd.output() {
            Ok(output) => {
                let duration = start.elapsed().as_millis() as u64;
                let resp = ExecResponse {
                    exit_code: output.status.code().unwrap_or(-1) as i64,
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                    duration_ms: duration,
                };
                send_response(stream, 200, &resp)
            }
            Err(e) => send_response(stream, 500, &serde_json::json!({"error": e.to_string()})),
        }
    }
}

#[derive(Deserialize)]
struct FileWriteRequest {
    path: String,
    content: String,
    #[serde(default)]
    mode: Option<u32>,
}

fn handle_file_write(stream: &mut std::net::TcpStream, body: &str) -> Result<(), String> {
    let req: FileWriteRequest = serde_json::from_str(body)
        .map_err(|e| format!("Invalid file write request: {e}"))?;

    let decoded = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &req.content,
    )
    .map_err(|e| format!("Invalid base64: {e}"))?;

    if let Some(parent) = std::path::Path::new(&req.path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    std::fs::write(&req.path, &decoded)
        .map_err(|e| format!("Write failed: {e}"))?;

    if let Some(mode) = req.mode {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(mode);
        std::fs::set_permissions(&req.path, perms)
            .map_err(|e| format!("Failed to set permissions on {}: {e}", req.path))?;
    }

    send_response(stream, 200, &serde_json::json!({"ok": true}))
}

#[derive(Deserialize)]
struct FileReadRequest {
    path: String,
}

fn handle_file_read(stream: &mut std::net::TcpStream, body: &str) -> Result<(), String> {
    let req: FileReadRequest = serde_json::from_str(body)
        .map_err(|e| format!("Invalid file read request: {e}"))?;

    let data = std::fs::read(&req.path)
        .map_err(|e| format!("Read failed: {e}"))?;

    let encoded = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &data,
    );

    let size = data.len() as u64;
    send_response(stream, 200, &serde_json::json!({
        "content": encoded,
        "size": size
    }))
}

#[derive(Deserialize)]
struct ListDirRequest {
    path: String,
}

#[derive(Serialize)]
struct ListDirEntry {
    name: String,
    path: String,
    size: u64,
    is_directory: bool,
    modified_at: u64,
}

fn handle_file_list(stream: &mut std::net::TcpStream, body: &str) -> Result<(), String> {
    let req: ListDirRequest = serde_json::from_str(body)
        .map_err(|e| format!("Invalid list dir request: {e}"))?;

    let entries: Vec<ListDirEntry> = std::fs::read_dir(&req.path)
        .map_err(|e| format!("List dir failed: {e}"))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let meta = entry.metadata().ok()?;
            let modified = meta
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_millis() as u64;
            Some(ListDirEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                path: entry.path().to_string_lossy().to_string(),
                size: meta.len(),
                is_directory: meta.is_dir(),
                modified_at: modified,
            })
        })
        .collect();

    send_response(stream, 200, &entries)
}

#[derive(Deserialize)]
struct SearchRequest {
    dir: String,
    pattern: String,
}

fn handle_file_search(stream: &mut std::net::TcpStream, body: &str) -> Result<(), String> {
    let req: SearchRequest = serde_json::from_str(body)
        .map_err(|e| format!("Invalid search request: {e}"))?;

    let output = Command::new("find")
        .args([&req.dir, "-name", &req.pattern, "-type", "f"])
        .output()
        .map_err(|e| format!("Search failed: {e}"))?;

    let results: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();

    send_response(stream, 200, &results)
}

#[derive(Deserialize)]
struct FileInfoRequest {
    paths: Vec<String>,
}

#[derive(Serialize)]
struct FileInfoEntry {
    path: String,
    size: u64,
    permissions: String,
    owner: String,
    group: String,
    is_directory: bool,
    is_symlink: bool,
    modified_at: u64,
}

fn handle_file_info(stream: &mut std::net::TcpStream, body: &str) -> Result<(), String> {
    let req: FileInfoRequest = serde_json::from_str(body)
        .map_err(|e| format!("Invalid file info request: {e}"))?;

    let entries: Vec<FileInfoEntry> = req
        .paths
        .iter()
        .filter_map(|p| {
            let meta = std::fs::symlink_metadata(p).ok()?;
            let modified = meta
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_millis() as u64;
            Some(FileInfoEntry {
                path: p.clone(),
                size: meta.len(),
                permissions: format!("{:o}", meta.mode() & 0o7777),
                owner: meta.uid().to_string(),
                group: meta.gid().to_string(),
                is_directory: meta.is_dir(),
                is_symlink: meta.is_symlink(),
                modified_at: modified,
            })
        })
        .collect();

    send_response(stream, 200, &entries)
}

#[derive(Serialize)]
struct StatsResponse {
    cpu_percent: f64,
    memory_usage_bytes: u64,
    memory_total_bytes: u64,
    network_rx_bytes: u64,
    network_tx_bytes: u64,
    pids: u64,
}

fn handle_stats(stream: &mut std::net::TcpStream) -> Result<(), String> {
    let meminfo = std::fs::read_to_string("/proc/meminfo").unwrap_or_default();
    let mut mem_total = 0u64;
    let mut mem_available = 0u64;
    for line in meminfo.lines() {
        if let Some(val) = line.strip_prefix("MemTotal:") {
            mem_total = parse_kb(val) * 1024;
        } else if let Some(val) = line.strip_prefix("MemAvailable:") {
            mem_available = parse_kb(val) * 1024;
        }
    }

    let loadavg = std::fs::read_to_string("/proc/loadavg").unwrap_or_default();
    let cpu_percent = loadavg
        .split_whitespace()
        .next()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0)
        * 100.0;

    let pids = std::fs::read_dir("/proc")
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.file_name()
                        .to_string_lossy()
                        .chars()
                        .all(|c| c.is_ascii_digit())
                })
                .count() as u64
        })
        .unwrap_or(0);

    let (rx, tx) = read_network_stats();

    let resp = StatsResponse {
        cpu_percent,
        memory_usage_bytes: mem_total.saturating_sub(mem_available),
        memory_total_bytes: mem_total,
        network_rx_bytes: rx,
        network_tx_bytes: tx,
        pids,
    };

    send_response(stream, 200, &resp)
}

#[derive(Serialize)]
struct ProcessEntry {
    pid: u64,
    user: String,
    command: String,
    cpu: f64,
    memory: f64,
}

fn handle_processes(stream: &mut std::net::TcpStream) -> Result<(), String> {
    let output = Command::new("ps")
        .args(["aux", "--no-headers"])
        .output()
        .map_err(|e| format!("ps failed: {e}"))?;

    let processes: Vec<ProcessEntry> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 11 {
                return None;
            }
            Some(ProcessEntry {
                pid: parts[1].parse().unwrap_or(0),
                user: parts[0].to_string(),
                command: parts[10..].join(" "),
                cpu: parts[2].parse().unwrap_or(0.0),
                memory: parts[3].parse().unwrap_or(0.0),
            })
        })
        .collect();

    send_response(stream, 200, &processes)
}

fn send_response<T: Serialize>(
    stream: &mut std::net::TcpStream,
    status: u16,
    body: &T,
) -> Result<(), String> {
    let body_str = serde_json::to_string(body).map_err(|e| e.to_string())?;
    let status_text = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "Unknown",
    };
    let response = format!(
        "HTTP/1.1 {status} {status_text}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         \r\n\
         {body_str}",
        body_str.len()
    );
    stream.write_all(response.as_bytes()).map_err(|e| e.to_string())?;
    stream.flush().map_err(|e| e.to_string())?;
    Ok(())
}

fn parse_kb(val: &str) -> u64 {
    val.trim()
        .strip_suffix("kB")
        .or_else(|| val.trim().strip_suffix("KB"))
        .unwrap_or(val.trim())
        .trim()
        .parse()
        .unwrap_or(0)
}

fn read_network_stats() -> (u64, u64) {
    let content = std::fs::read_to_string("/proc/net/dev").unwrap_or_default();
    let mut rx_total = 0u64;
    let mut tx_total = 0u64;

    for line in content.lines().skip(2) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 10 {
            let iface = parts[0].trim_end_matches(':');
            if iface != "lo" {
                rx_total += parts[1].parse::<u64>().unwrap_or(0);
                tx_total += parts[9].parse::<u64>().unwrap_or(0);
            }
        }
    }

    (rx_total, tx_total)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_kb_normal() {
        assert_eq!(parse_kb("    1024 kB"), 1024);
        assert_eq!(parse_kb("512 kB"), 512);
    }

    #[test]
    fn parse_kb_edge() {
        assert_eq!(parse_kb("0 kB"), 0);
        assert_eq!(parse_kb("invalid"), 0);
    }

    #[test]
    fn parse_kb_uppercase() {
        assert_eq!(parse_kb("2048 KB"), 2048);
    }

    #[test]
    fn exec_request_deserialization() {
        let json = r#"{"command":["echo","hello"],"timeout_ms":5000}"#;
        let req: ExecRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.command, vec!["echo", "hello"]);
        assert_eq!(req.timeout_ms, Some(5000));
        assert!(req.detached.is_none());
    }

    #[test]
    fn exec_request_detached() {
        let json = r#"{"command":["sleep","100"],"detached":true}"#;
        let req: ExecRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.detached, Some(true));
    }

    #[test]
    fn file_write_request_deserialization() {
        let json = r#"{"path":"/tmp/test.txt","content":"aGVsbG8="}"#;
        let req: FileWriteRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.path, "/tmp/test.txt");
        assert_eq!(req.content, "aGVsbG8=");
        assert!(req.mode.is_none());
    }

    #[test]
    fn exec_response_serialization() {
        let resp = ExecResponse {
            exit_code: 0,
            stdout: "hello\n".into(),
            stderr: String::new(),
            duration_ms: 42,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["exit_code"], 0);
        assert_eq!(json["duration_ms"], 42);
    }

    #[test]
    fn stats_response_serialization() {
        let stats = StatsResponse {
            cpu_percent: 25.5,
            memory_usage_bytes: 1073741824,
            memory_total_bytes: 2147483648,
            network_rx_bytes: 1000,
            network_tx_bytes: 2000,
            pids: 50,
        };
        let json = serde_json::to_value(&stats).unwrap();
        assert_eq!(json["cpu_percent"], 25.5);
        assert_eq!(json["pids"], 50);
    }

    #[test]
    fn list_dir_entry_serialization() {
        let entry = ListDirEntry {
            name: "test.py".into(),
            path: "/workspace/test.py".into(),
            size: 100,
            is_directory: false,
            modified_at: 1700000000,
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["name"], "test.py");
        assert_eq!(json["is_directory"], false);
    }

    #[test]
    fn process_entry_serialization() {
        let entry = ProcessEntry {
            pid: 1234,
            user: "root".into(),
            command: "python main.py".into(),
            cpu: 5.5,
            memory: 2.3,
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["pid"], 1234);
        assert_eq!(json["user"], "root");
    }

    #[test]
    fn read_network_stats_returns_tuple() {
        let (rx, tx) = read_network_stats();
        assert!(rx == 0 || rx > 0);
        assert!(tx == 0 || tx > 0);
    }
}
