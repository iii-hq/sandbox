use std::sync::Arc;

use iii_sandbox_sdk::git::{
    GitBranchOptions, GitCloneOptions, GitCommitOptions, GitDiffOptions, GitLogOptions, GitManager,
    GitPullOptions, GitPushOptions,
};
use iii_sandbox_sdk::{ClientConfig, HttpClient};

fn make_git(url: &str) -> GitManager {
    let client = Arc::new(HttpClient::new(ClientConfig {
        base_url: url.to_string(),
        token: None,
        timeout_ms: None,
    }).unwrap());
    GitManager::new(client, "sbx-1".into())
}

#[tokio::test]
async fn test_clone_repo_url_only() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/git/clone")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "exitCode": 0,
                "stdout": "Cloning into...",
                "stderr": "",
                "duration": 2.5
            })
            .to_string(),
        )
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git
        .clone_repo("https://github.com/user/repo.git", None)
        .await
        .unwrap();
    assert_eq!(result.exit_code, 0);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_clone_repo_with_all_options() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/git/clone")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "exitCode": 0,
                "stdout": "Cloning into /workspace/myrepo...",
                "stderr": "",
                "duration": 1.0
            })
            .to_string(),
        )
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git
        .clone_repo(
            "https://github.com/user/repo.git",
            Some(GitCloneOptions {
                path: Some("/workspace/myrepo".into()),
                branch: Some("develop".into()),
                depth: Some(1),
            }),
        )
        .await
        .unwrap();
    assert_eq!(result.exit_code, 0);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_status_without_path() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/sandboxes/sbx-1/git/status")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "branch": "main",
                "clean": true,
                "files": []
            })
            .to_string(),
        )
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git.status(None).await.unwrap();
    assert_eq!(result.branch, "main");
    assert!(result.clean);
    assert!(result.files.is_empty());
    mock.assert_async().await;
}

#[tokio::test]
async fn test_status_with_path() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock(
            "GET",
            "/sandbox/sandboxes/sbx-1/git/status?path=%2Fworkspace%2Frepo",
        )
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "branch": "feat",
                "clean": false,
                "files": [{"path": "main.py", "status": "modified"}]
            })
            .to_string(),
        )
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git.status(Some("/workspace/repo")).await.unwrap();
    assert_eq!(result.branch, "feat");
    assert!(!result.clean);
    assert_eq!(result.files.len(), 1);
    assert_eq!(result.files[0].status, "modified");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_commit_message_only() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/git/commit")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "exitCode": 0,
                "stdout": "[main abc1234] initial commit",
                "stderr": "",
                "duration": 0.1
            })
            .to_string(),
        )
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git.commit("initial commit", None).await.unwrap();
    assert_eq!(result.exit_code, 0);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_commit_with_path_and_all() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/git/commit")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "exitCode": 0,
                "stdout": "committed",
                "stderr": "",
                "duration": 0.2
            })
            .to_string(),
        )
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git
        .commit(
            "add all",
            Some(GitCommitOptions {
                path: Some("/workspace/repo".into()),
                all: Some(true),
            }),
        )
        .await
        .unwrap();
    assert_eq!(result.exit_code, 0);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_diff_no_params() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/sandboxes/sbx-1/git/diff")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!({"diff": "--- a/f\n+++ b/f"}).to_string())
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git.diff(None).await.unwrap();
    assert_eq!(result.diff, "--- a/f\n+++ b/f");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_diff_with_staged() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock(
            "GET",
            "/sandbox/sandboxes/sbx-1/git/diff?staged=true",
        )
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!({"diff": "+new line"}).to_string())
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git
        .diff(Some(GitDiffOptions {
            staged: Some(true),
            ..Default::default()
        }))
        .await
        .unwrap();
    assert_eq!(result.diff, "+new line");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_diff_with_path_and_file() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock(
            "GET",
            "/sandbox/sandboxes/sbx-1/git/diff?path=%2Fworkspace&file=main.py",
        )
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!({"diff": "changes"}).to_string())
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git
        .diff(Some(GitDiffOptions {
            path: Some("/workspace".into()),
            file: Some("main.py".into()),
            ..Default::default()
        }))
        .await
        .unwrap();
    assert_eq!(result.diff, "changes");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_log_no_params() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/sandboxes/sbx-1/git/log")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "entries": [
                    {"hash": "abc123", "message": "init", "author": "user", "date": "2025-01-01"}
                ]
            })
            .to_string(),
        )
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git.log(None).await.unwrap();
    assert_eq!(result.entries.len(), 1);
    assert_eq!(result.entries[0].hash, "abc123");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_log_with_count() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/sandbox/sandboxes/sbx-1/git/log?count=5")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!({"entries": []}).to_string())
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git
        .log(Some(GitLogOptions {
            count: Some(5),
            ..Default::default()
        }))
        .await
        .unwrap();
    assert!(result.entries.is_empty());
    mock.assert_async().await;
}

#[tokio::test]
async fn test_log_with_path_and_count() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock(
            "GET",
            "/sandbox/sandboxes/sbx-1/git/log?path=%2Fworkspace&count=10",
        )
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(serde_json::json!({"entries": []}).to_string())
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git
        .log(Some(GitLogOptions {
            path: Some("/workspace".into()),
            count: Some(10),
        }))
        .await
        .unwrap();
    assert!(result.entries.is_empty());
    mock.assert_async().await;
}

#[tokio::test]
async fn test_branch_no_params() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/git/branch")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "branches": ["main", "develop"],
                "current": "main"
            })
            .to_string(),
        )
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git.branch(None).await.unwrap();
    assert_eq!(result.branches.len(), 2);
    assert_eq!(result.current, "main");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_branch_with_name_path_delete() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/git/branch")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "branches": ["main"],
                "current": "main"
            })
            .to_string(),
        )
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git
        .branch(Some(GitBranchOptions {
            path: Some("/workspace".into()),
            name: Some("feat".into()),
            delete: Some(true),
        }))
        .await
        .unwrap();
    assert_eq!(result.current, "main");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_checkout_without_path() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/git/checkout")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "exitCode": 0,
                "stdout": "Switched to branch 'develop'",
                "stderr": "",
                "duration": 0.05
            })
            .to_string(),
        )
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git.checkout("develop", None).await.unwrap();
    assert_eq!(result.exit_code, 0);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_checkout_with_path() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/git/checkout")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "exitCode": 0,
                "stdout": "Switched",
                "stderr": "",
                "duration": 0.03
            })
            .to_string(),
        )
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git.checkout("main", Some("/workspace/repo")).await.unwrap();
    assert_eq!(result.exit_code, 0);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_push_no_params() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/git/push")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "exitCode": 0,
                "stdout": "pushed",
                "stderr": "",
                "duration": 1.0
            })
            .to_string(),
        )
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git.push(None).await.unwrap();
    assert_eq!(result.exit_code, 0);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_push_with_all_options() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/git/push")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "exitCode": 0,
                "stdout": "force pushed",
                "stderr": "",
                "duration": 0.8
            })
            .to_string(),
        )
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git
        .push(Some(GitPushOptions {
            path: Some("/workspace".into()),
            remote: Some("origin".into()),
            branch: Some("main".into()),
            force: Some(true),
        }))
        .await
        .unwrap();
    assert_eq!(result.exit_code, 0);
    mock.assert_async().await;
}

#[tokio::test]
async fn test_pull_no_params() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/git/pull")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "exitCode": 0,
                "stdout": "Already up to date.",
                "stderr": "",
                "duration": 0.5
            })
            .to_string(),
        )
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git.pull(None).await.unwrap();
    assert_eq!(result.exit_code, 0);
    assert_eq!(result.stdout, "Already up to date.");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_pull_with_all_options() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/sandbox/sandboxes/sbx-1/git/pull")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "exitCode": 0,
                "stdout": "pulled from upstream",
                "stderr": "",
                "duration": 1.5
            })
            .to_string(),
        )
        .create_async()
        .await;

    let git = make_git(&server.url());
    let result = git
        .pull(Some(GitPullOptions {
            path: Some("/workspace".into()),
            remote: Some("upstream".into()),
            branch: Some("develop".into()),
        }))
        .await
        .unwrap();
    assert_eq!(result.exit_code, 0);
    mock.assert_async().await;
}
