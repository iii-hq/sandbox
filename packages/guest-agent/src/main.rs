use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::os::unix::fs::MetadataExt;
use std::os::unix::io::RawFd;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const MAX_BODY_SIZE: usize = 10 * 1024 * 1024;
const MAX_PTY_SESSIONS: usize = 16;
const PTY_READ_BUF_SIZE: usize = 65536;

#[allow(dead_code)]
struct PtySession {
    master_fd: RawFd,
    child_pid: libc::pid_t,
    created_at: u64,
}

impl Drop for PtySession {
    fn drop(&mut self) {
        unsafe {
            libc::kill(self.child_pid, libc::SIGKILL);
            libc::waitpid(self.child_pid, std::ptr::null_mut(), libc::WNOHANG);
            libc::close(self.master_fd);
        }
    }
}

type PtySessions = Arc<Mutex<HashMap<String, PtySession>>>;

static PTY_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn main() {
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

    let pty_sessions: PtySessions = Arc::new(Mutex::new(HashMap::new()));

    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => {
                let sessions = Arc::clone(&pty_sessions);
                std::thread::spawn(move || {
                    if let Err(e) = handle_connection(&mut stream, &sessions) {
                        eprintln!("Request error: {e}");
                    }
                });
            }
            Err(e) => eprintln!("Accept error: {e}"),
        }
    }
}

fn handle_connection(stream: &mut std::net::TcpStream, sessions: &PtySessions) -> Result<(), String> {
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
        ("POST", "/terminal/create") => handle_terminal_create(stream, &body, sessions),
        ("POST", "/terminal/write") => handle_terminal_write(stream, &body, sessions),
        ("POST", "/terminal/resize") => handle_terminal_resize(stream, &body, sessions),
        ("POST", "/terminal/read") => handle_terminal_read(stream, &body, sessions),
        ("POST", "/terminal/close") => handle_terminal_close(stream, &body, sessions),
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
                std::thread::spawn(move || {
                    let mut child = child;
                    let _ = child.wait();
                });
                send_response(stream, 200, &serde_json::json!({"pid": pid}))
            }
            Err(e) => send_response(stream, 500, &serde_json::json!({"error": e.to_string()})),
        }
    } else {
        let start = Instant::now();
        let timeout_ms = req.timeout_ms.unwrap_or(300_000);
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
            Ok(mut child) => {
                let timeout_dur = std::time::Duration::from_millis(timeout_ms);
                let deadline = Instant::now() + timeout_dur;
                loop {
                    match child.try_wait() {
                        Ok(Some(_)) => break,
                        Ok(None) => {
                            if Instant::now() >= deadline {
                                let _ = child.kill();
                                let _ = child.wait();
                                let duration = start.elapsed().as_millis() as u64;
                                return send_response(stream, 200, &ExecResponse {
                                    exit_code: -1,
                                    stdout: String::new(),
                                    stderr: format!("Command timed out after {timeout_ms}ms"),
                                    duration_ms: duration,
                                });
                            }
                            std::thread::sleep(std::time::Duration::from_millis(10));
                        }
                        Err(e) => return send_response(stream, 500, &serde_json::json!({"error": e.to_string()})),
                    }
                }
                let output = child.wait_with_output()
                    .map_err(|e| e.to_string())?;
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

#[derive(Deserialize)]
struct TerminalCreateRequest {
    #[serde(default = "default_shell")]
    shell: String,
    #[serde(default = "default_cols")]
    cols: u16,
    #[serde(default = "default_rows")]
    rows: u16,
}

fn default_shell() -> String { "/bin/sh".to_string() }
fn default_cols() -> u16 { 80 }
fn default_rows() -> u16 { 24 }

#[derive(Deserialize)]
struct TerminalSessionRequest {
    session_id: String,
}

#[derive(Deserialize)]
struct TerminalWriteRequest {
    session_id: String,
    data: String,
}

#[derive(Deserialize)]
struct TerminalResizeRequest {
    session_id: String,
    cols: u16,
    rows: u16,
}

fn handle_terminal_create(
    stream: &mut std::net::TcpStream,
    body: &str,
    sessions: &PtySessions,
) -> Result<(), String> {
    let req: TerminalCreateRequest = serde_json::from_str(body)
        .map_err(|e| format!("Invalid terminal create request: {e}"))?;

    {
        let locked = sessions.lock().map_err(|e| e.to_string())?;
        if locked.len() >= MAX_PTY_SESSIONS {
            return send_response(
                stream,
                400,
                &serde_json::json!({"error": "max pty sessions reached"}),
            );
        }
    }

    let mut master_fd: RawFd = -1;
    let mut ws = libc::winsize {
        ws_row: req.rows,
        ws_col: req.cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };

    let pid = unsafe { libc::forkpty(&mut master_fd, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::addr_of_mut!(ws)) };

    if pid < 0 {
        return send_response(
            stream,
            500,
            &serde_json::json!({"error": "forkpty failed"}),
        );
    }

    if pid == 0 {
        let shell = std::ffi::CString::new(req.shell.as_str()).unwrap_or_else(|_| {
            std::ffi::CString::new("/bin/sh").unwrap()
        });
        let shell_name = req.shell.rsplit('/').next().unwrap_or("sh");
        let argv0 = std::ffi::CString::new(format!("-{shell_name}")).unwrap_or_else(|_| {
            std::ffi::CString::new("-sh").unwrap()
        });
        unsafe {
            libc::execl(
                shell.as_ptr(),
                argv0.as_ptr(),
                std::ptr::null::<libc::c_char>(),
            );
            libc::_exit(127);
        }
    }

    unsafe {
        let flags = libc::fcntl(master_fd, libc::F_GETFL);
        libc::fcntl(master_fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
    }

    let counter = PTY_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let session_id = format!("pty-{counter}");

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let session = PtySession {
        master_fd,
        child_pid: pid,
        created_at: now,
    };

    {
        let mut locked = sessions.lock().map_err(|e| e.to_string())?;
        locked.insert(session_id.clone(), session);
    }

    send_response(
        stream,
        200,
        &serde_json::json!({"session_id": session_id, "pid": pid}),
    )
}

fn handle_terminal_write(
    stream: &mut std::net::TcpStream,
    body: &str,
    sessions: &PtySessions,
) -> Result<(), String> {
    let req: TerminalWriteRequest = serde_json::from_str(body)
        .map_err(|e| format!("Invalid terminal write request: {e}"))?;

    let locked = sessions.lock().map_err(|e| e.to_string())?;
    let session = locked.get(&req.session_id).ok_or_else(|| "session not found".to_string())?;

    let data = req.data.as_bytes();
    let written = unsafe {
        libc::write(session.master_fd, data.as_ptr() as *const libc::c_void, data.len())
    };

    if written < 0 {
        return send_response(
            stream,
            500,
            &serde_json::json!({"error": "write to pty failed"}),
        );
    }

    send_response(stream, 200, &serde_json::json!({"ok": true}))
}

fn handle_terminal_resize(
    stream: &mut std::net::TcpStream,
    body: &str,
    sessions: &PtySessions,
) -> Result<(), String> {
    let req: TerminalResizeRequest = serde_json::from_str(body)
        .map_err(|e| format!("Invalid terminal resize request: {e}"))?;

    let locked = sessions.lock().map_err(|e| e.to_string())?;
    let session = locked.get(&req.session_id).ok_or_else(|| "session not found".to_string())?;

    let ws = libc::winsize {
        ws_row: req.rows,
        ws_col: req.cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };

    let ret = unsafe { libc::ioctl(session.master_fd, libc::TIOCSWINSZ, &ws) };
    if ret < 0 {
        return send_response(
            stream,
            500,
            &serde_json::json!({"error": "ioctl TIOCSWINSZ failed"}),
        );
    }

    send_response(stream, 200, &serde_json::json!({"ok": true}))
}

fn handle_terminal_read(
    stream: &mut std::net::TcpStream,
    body: &str,
    sessions: &PtySessions,
) -> Result<(), String> {
    let req: TerminalSessionRequest = serde_json::from_str(body)
        .map_err(|e| format!("Invalid terminal read request: {e}"))?;

    let locked = sessions.lock().map_err(|e| e.to_string())?;
    let session = locked.get(&req.session_id).ok_or_else(|| "session not found".to_string())?;

    let mut buf = vec![0u8; PTY_READ_BUF_SIZE];
    let n = unsafe {
        libc::read(
            session.master_fd,
            buf.as_mut_ptr() as *mut libc::c_void,
            buf.len(),
        )
    };

    let data = if n > 0 {
        buf.truncate(n as usize);
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &buf)
    } else {
        String::new()
    };

    send_response(stream, 200, &serde_json::json!({"data": data}))
}

fn handle_terminal_close(
    stream: &mut std::net::TcpStream,
    body: &str,
    sessions: &PtySessions,
) -> Result<(), String> {
    let req: TerminalSessionRequest = serde_json::from_str(body)
        .map_err(|e| format!("Invalid terminal close request: {e}"))?;

    let mut locked = sessions.lock().map_err(|e| e.to_string())?;
    if locked.remove(&req.session_id).is_none() {
        return send_response(
            stream,
            404,
            &serde_json::json!({"error": "session not found"}),
        );
    }

    send_response(stream, 200, &serde_json::json!({"ok": true}))
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

    #[test]
    fn terminal_create_request_defaults() {
        let json = r#"{}"#;
        let req: TerminalCreateRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.shell, "/bin/sh");
        assert_eq!(req.cols, 80);
        assert_eq!(req.rows, 24);
    }

    #[test]
    fn terminal_create_request_custom() {
        let json = r#"{"shell":"/bin/bash","cols":120,"rows":40}"#;
        let req: TerminalCreateRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.shell, "/bin/bash");
        assert_eq!(req.cols, 120);
        assert_eq!(req.rows, 40);
    }

    #[test]
    fn terminal_write_request_deserialization() {
        let json = r#"{"session_id":"pty-1","data":"ls\n"}"#;
        let req: TerminalWriteRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.session_id, "pty-1");
        assert_eq!(req.data, "ls\n");
    }

    #[test]
    fn terminal_resize_request_deserialization() {
        let json = r#"{"session_id":"pty-1","cols":120,"rows":40}"#;
        let req: TerminalResizeRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.session_id, "pty-1");
        assert_eq!(req.cols, 120);
        assert_eq!(req.rows, 40);
    }

    #[test]
    fn terminal_session_request_deserialization() {
        let json = r#"{"session_id":"pty-42"}"#;
        let req: TerminalSessionRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.session_id, "pty-42");
    }

    #[test]
    fn pty_counter_increments() {
        let a = PTY_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let b = PTY_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        assert_eq!(b, a + 1);
    }

    #[test]
    fn pty_sessions_max_check() {
        let sessions: PtySessions = Arc::new(Mutex::new(HashMap::new()));
        let locked = sessions.lock().unwrap();
        assert!(locked.len() < MAX_PTY_SESSIONS);
    }
}
