use bollard::Docker;
use iii_sdk::III;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Instant;

use crate::config::EngineConfig;
use crate::docker::{copy_to_container, exec_in_container};
use crate::state::{scopes, StateKV};
use crate::types::Sandbox;

fn get_file_extension(language: &str) -> &str {
    match language {
        "python" => ".py",
        "javascript" => ".js",
        "typescript" => ".ts",
        "go" => ".go",
        "bash" => ".sh",
        _ => ".py",
    }
}

fn get_exec_command(language: &str, filename: &str) -> Vec<String> {
    match language {
        "python" => vec!["python3".into(), filename.into()],
        "javascript" => vec!["node".into(), filename.into()],
        "typescript" => vec!["npx".into(), "tsx".into(), filename.into()],
        "go" => vec!["go".into(), "run".into(), filename.into()],
        "bash" => vec!["bash".into(), filename.into()],
        _ => vec!["python3".into(), filename.into()],
    }
}

fn get_install_command(manager: &str, packages: &[String]) -> Vec<String> {
    let mut cmd = match manager {
        "python" => vec!["pip".to_string(), "install".to_string()],
        "javascript" | "typescript" => vec!["npm".to_string(), "install".to_string(), "-g".to_string()],
        "go" => vec!["go".to_string(), "install".to_string()],
        "bash" => vec!["apt-get".to_string(), "install".to_string(), "-y".to_string()],
        _ => vec!["pip".to_string(), "install".to_string()],
    };
    cmd.extend(packages.iter().cloned());
    cmd
}

pub fn register(bridge: &Arc<III>, dk: &Arc<Docker>, kv: &StateKV, config: &EngineConfig) {
    // interp::execute
    {
        let kv = kv.clone(); let dk = dk.clone(); let cfg = config.clone();
        bridge.register_function_with_description("interp::execute", "Execute code in specified language", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone(); let cfg = cfg.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let code = input.get("code").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("code is required".into()))?;
                let language = input.get("language").and_then(|v| v.as_str()).unwrap_or("python");

                let _sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;

                let ext = get_file_extension(language);
                let filename = format!("/tmp/code{ext}");
                let cn = format!("iii-sbx-{id}");

                copy_to_container(&dk, &cn, &filename, code.as_bytes()).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e))?;

                let exec_cmd = get_exec_command(language, &filename);
                let start = Instant::now();
                let result = exec_in_container(&dk, &cn, &exec_cmd, cfg.max_command_timeout * 1000).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e))?;
                let execution_time = start.elapsed().as_millis() as u64;

                let error = if result.exit_code != 0 { Some(result.stderr.clone()) } else { None };
                Ok(json!({
                    "output": result.stdout,
                    "error": error,
                    "executionTime": execution_time,
                }))
            }
        });
    }

    // interp::install
    {
        let kv = kv.clone(); let dk = dk.clone();
        bridge.register_function_with_description("interp::install", "Install packages for language", move |input: Value| {
            let kv = kv.clone(); let dk = dk.clone();
            async move {
                let id = input.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("id is required".into()))?;
                let packages: Vec<String> = input.get("packages")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .ok_or_else(|| iii_sdk::IIIError::Handler("packages is required".into()))?;
                let manager = input.get("manager").and_then(|v| v.as_str()).unwrap_or("python");

                let _sandbox: Sandbox = kv.get(scopes::SANDBOXES, id).await
                    .ok_or_else(|| iii_sdk::IIIError::Handler(format!("Sandbox not found: {id}")))?;

                let cn = format!("iii-sbx-{id}");
                let cmd = get_install_command(manager, &packages);
                let result = exec_in_container(&dk, &cn, &cmd, 120000).await
                    .map_err(|e| iii_sdk::IIIError::Handler(e))?;
                if result.exit_code != 0 {
                    return Err(iii_sdk::IIIError::Handler(format!("Install failed: {}", result.stderr)));
                }
                Ok(json!({ "output": result.stdout }))
            }
        });
    }

    // interp::kernels
    {
        bridge.register_function_with_description("interp::kernels", "List available language runtimes", move |_input: Value| {
            async move {
                Ok(json!([
                    { "name": "python3", "language": "python", "displayName": "Python 3" },
                    { "name": "node", "language": "javascript", "displayName": "Node.js" },
                    { "name": "bash", "language": "bash", "displayName": "Bash" },
                    { "name": "go", "language": "go", "displayName": "Go" },
                ]))
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ext_python() {
        assert_eq!(get_file_extension("python"), ".py");
    }

    #[test]
    fn ext_javascript() {
        assert_eq!(get_file_extension("javascript"), ".js");
    }

    #[test]
    fn ext_typescript() {
        assert_eq!(get_file_extension("typescript"), ".ts");
    }

    #[test]
    fn ext_go() {
        assert_eq!(get_file_extension("go"), ".go");
    }

    #[test]
    fn ext_bash() {
        assert_eq!(get_file_extension("bash"), ".sh");
    }

    #[test]
    fn ext_unknown_defaults_to_py() {
        assert_eq!(get_file_extension("ruby"), ".py");
    }

    #[test]
    fn ext_empty_defaults_to_py() {
        assert_eq!(get_file_extension(""), ".py");
    }

    #[test]
    fn exec_python() {
        let cmd = get_exec_command("python", "script.py");
        assert_eq!(cmd, vec!["python3", "script.py"]);
    }

    #[test]
    fn exec_javascript() {
        let cmd = get_exec_command("javascript", "app.js");
        assert_eq!(cmd, vec!["node", "app.js"]);
    }

    #[test]
    fn exec_typescript() {
        let cmd = get_exec_command("typescript", "main.ts");
        assert_eq!(cmd, vec!["npx", "tsx", "main.ts"]);
    }

    #[test]
    fn exec_go() {
        let cmd = get_exec_command("go", "main.go");
        assert_eq!(cmd, vec!["go", "run", "main.go"]);
    }

    #[test]
    fn exec_bash() {
        let cmd = get_exec_command("bash", "run.sh");
        assert_eq!(cmd, vec!["bash", "run.sh"]);
    }

    #[test]
    fn exec_unknown_defaults_to_python3() {
        let cmd = get_exec_command("perl", "test.pl");
        assert_eq!(cmd[0], "python3");
    }

    #[test]
    fn exec_preserves_filename() {
        let cmd = get_exec_command("python", "/tmp/code.py");
        assert_eq!(cmd[1], "/tmp/code.py");
    }

    #[test]
    fn install_python_starts_with_pip() {
        let cmd = get_install_command("python", &["numpy".into()]);
        assert_eq!(&cmd[..2], &["pip", "install"]);
    }

    #[test]
    fn install_javascript_starts_with_npm() {
        let cmd = get_install_command("javascript", &["express".into()]);
        assert_eq!(&cmd[..3], &["npm", "install", "-g"]);
    }

    #[test]
    fn install_typescript_same_as_javascript() {
        let cmd = get_install_command("typescript", &["tsx".into()]);
        assert_eq!(&cmd[..3], &["npm", "install", "-g"]);
    }

    #[test]
    fn install_go_starts_with_go_install() {
        let cmd = get_install_command("go", &["example.com/tool@latest".into()]);
        assert_eq!(&cmd[..2], &["go", "install"]);
    }

    #[test]
    fn install_bash_starts_with_apt() {
        let cmd = get_install_command("bash", &["curl".into()]);
        assert_eq!(&cmd[..3], &["apt-get", "install", "-y"]);
    }

    #[test]
    fn install_unknown_defaults_to_pip() {
        let cmd = get_install_command("rust", &["cargo-edit".into()]);
        assert_eq!(&cmd[..2], &["pip", "install"]);
    }

    #[test]
    fn install_packages_appended() {
        let cmd = get_install_command("python", &["numpy".into()]);
        assert_eq!(cmd.last().unwrap(), "numpy");
    }

    #[test]
    fn install_multiple_packages_all_included() {
        let pkgs: Vec<String> = vec!["numpy".into(), "pandas".into(), "scipy".into()];
        let cmd = get_install_command("python", &pkgs);
        assert!(cmd.contains(&"numpy".to_string()));
        assert!(cmd.contains(&"pandas".to_string()));
        assert!(cmd.contains(&"scipy".to_string()));
    }

    #[test]
    fn install_empty_packages_returns_base_command() {
        let cmd = get_install_command("python", &[]);
        assert_eq!(cmd, vec!["pip", "install"]);
    }

    #[test]
    fn exec_typescript_has_three_parts() {
        let cmd = get_exec_command("typescript", "file.ts");
        assert_eq!(cmd.len(), 3);
    }

    #[test]
    fn exec_go_has_three_parts() {
        let cmd = get_exec_command("go", "file.go");
        assert_eq!(cmd.len(), 3);
    }

    #[test]
    fn exec_python_has_two_parts() {
        let cmd = get_exec_command("python", "file.py");
        assert_eq!(cmd.len(), 2);
    }
}
