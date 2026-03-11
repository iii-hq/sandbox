use bollard::Docker;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::process::Command;
use tokio::fs;

pub async fn ensure_rootfs(
    docker: &Arc<Docker>,
    image: &str,
    cache_dir: &Path,
    agent_path: &Path,
) -> Result<PathBuf, String> {
    let safe_name = image.replace(['/', ':', '.'], "_");
    let rootfs_path = cache_dir.join(format!("{safe_name}.ext4"));

    if rootfs_path.exists() {
        return Ok(rootfs_path);
    }

    fs::create_dir_all(cache_dir)
        .await
        .map_err(|e| format!("Failed to create cache dir: {e}"))?;

    tracing::info!(image = %image, "Converting OCI image to ext4 rootfs");

    crate::docker::ensure_image(docker, image).await?;

    let tar_path = cache_dir.join(format!("{safe_name}.tar"));
    export_image_to_tar(docker, image, &tar_path).await?;

    let extract_dir = cache_dir.join(format!("{safe_name}_extract"));
    fs::create_dir_all(&extract_dir)
        .await
        .map_err(|e| format!("Failed to create extract dir: {e}"))?;

    extract_tar(&tar_path, &extract_dir).await?;
    extract_layers(&extract_dir).await?;

    let merged_dir = cache_dir.join(format!("{safe_name}_merged"));
    fs::create_dir_all(&merged_dir)
        .await
        .map_err(|e| format!("Failed to create merged dir: {e}"))?;

    merge_layers(&extract_dir, &merged_dir).await?;

    if agent_path.exists() {
        let agent_dest = merged_dir.join("usr/local/bin/iii-guest-agent");
        if let Some(parent) = agent_dest.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create agent dir: {e}"))?;
        }
        fs::copy(agent_path, &agent_dest)
            .await
            .map_err(|e| format!("Failed to copy guest agent: {e}"))?;
    }

    super::fc_init::inject_init(&merged_dir).await?;

    let temp_rootfs_path = cache_dir.join(format!("{safe_name}.ext4.tmp"));
    create_ext4(&merged_dir, &temp_rootfs_path).await?;

    fs::rename(&temp_rootfs_path, &rootfs_path)
        .await
        .map_err(|e| {
            let _ = std::fs::remove_file(&temp_rootfs_path);
            format!("Failed to finalize rootfs: {e}")
        })?;

    let _ = fs::remove_file(&tar_path).await;
    let _ = fs::remove_dir_all(&extract_dir).await;
    let _ = fs::remove_dir_all(&merged_dir).await;

    tracing::info!(path = %rootfs_path.display(), "Rootfs created");
    Ok(rootfs_path)
}

async fn export_image_to_tar(
    docker: &Arc<Docker>,
    image: &str,
    tar_path: &Path,
) -> Result<(), String> {
    use bollard::container::{Config, CreateContainerOptions, RemoveContainerOptions};
    use futures_util::StreamExt;

    let container_name = format!("iii-rootfs-export-{}", uuid::Uuid::new_v4().to_string().get(..8).unwrap_or("tmp"));

    docker
        .create_container(
            Some(CreateContainerOptions::<String> {
                name: container_name.clone(),
                ..Default::default()
            }),
            Config::<String> {
                image: Some(image.to_string()),
                cmd: Some(vec!["/bin/true".to_string()]),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| format!("Failed to create export container: {e}"))?;

    let cleanup = |docker: &Arc<Docker>, name: String| {
        let docker = docker.clone();
        async move {
            let _ = docker
                .remove_container(
                    &name,
                    Some(RemoveContainerOptions {
                        force: true,
                        ..Default::default()
                    }),
                )
                .await;
        }
    };

    let mut archive_stream = docker.export_container(&container_name);
    let mut file = match tokio::fs::File::create(tar_path).await {
        Ok(f) => f,
        Err(e) => {
            cleanup(docker, container_name).await;
            return Err(format!("Failed to create tar file: {e}"));
        }
    };

    let mut export_error = None;
    while let Some(chunk) = archive_stream.next().await {
        match chunk {
            Ok(data) => {
                if let Err(e) = tokio::io::AsyncWriteExt::write_all(&mut file, &data).await {
                    export_error = Some(format!("Failed to write tar: {e}"));
                    break;
                }
            }
            Err(e) => {
                export_error = Some(format!("Export stream error: {e}"));
                break;
            }
        }
    }

    cleanup(docker, container_name).await;

    if let Some(e) = export_error {
        return Err(e);
    }

    Ok(())
}

async fn extract_tar(tar_path: &Path, dest: &Path) -> Result<(), String> {
    let output = Command::new("tar")
        .args(["xf", &tar_path.to_string_lossy(), "-C", &dest.to_string_lossy()])
        .output()
        .await
        .map_err(|e| format!("Failed to run tar: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("tar extract failed: {stderr}"));
    }
    Ok(())
}

async fn extract_layers(extract_dir: &Path) -> Result<(), String> {
    let manifest_path = extract_dir.join("manifest.json");
    if !manifest_path.exists() {
        return Ok(());
    }

    let manifest_data = fs::read_to_string(&manifest_path)
        .await
        .map_err(|e| format!("Failed to read manifest: {e}"))?;

    let manifest: Vec<serde_json::Value> = serde_json::from_str(&manifest_data)
        .map_err(|e| format!("Failed to parse manifest: {e}"))?;

    if let Some(entry) = manifest.first() {
        if let Some(layers) = entry.get("Layers").and_then(|l| l.as_array()) {
            for layer in layers {
                if let Some(layer_path) = layer.as_str() {
                    let full_path = extract_dir.join(layer_path);
                    if full_path.exists() {
                        let layer_dir = extract_dir.join("_layers");
                        fs::create_dir_all(&layer_dir)
                            .await
                            .map_err(|e| format!("Failed to create layers dir: {e}"))?;

                        let output = Command::new("tar")
                            .args(["xf", &full_path.to_string_lossy(), "-C", &layer_dir.to_string_lossy()])
                            .output()
                            .await
                            .map_err(|e| format!("Failed to extract layer: {e}"))?;

                        if !output.status.success() {
                            tracing::warn!(
                                layer = %layer_path,
                                stderr = %String::from_utf8_lossy(&output.stderr),
                                "Layer extraction had warnings"
                            );
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

async fn merge_layers(extract_dir: &Path, merged_dir: &Path) -> Result<(), String> {
    let layers_dir = extract_dir.join("_layers");
    if layers_dir.exists() {
        let mut entries = fs::read_dir(&layers_dir)
            .await
            .map_err(|e| format!("Failed to read layers dir: {e}"))?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| format!("Failed to read entry: {e}"))? {
            let src = entry.path();
            let src_lossy = src.to_string_lossy();
            let dest_lossy = merged_dir.to_string_lossy();
            let output = Command::new("cp")
                .args(["-a", src_lossy.as_ref(), dest_lossy.as_ref()])
                .output()
                .await
                .map_err(|e| format!("Failed to copy layer entry: {e}"))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                tracing::warn!(path = %src.display(), stderr = %stderr, "Layer copy had warnings");
            }
        }
    } else {
        let mut entries = fs::read_dir(extract_dir)
            .await
            .map_err(|e| format!("Failed to read extract dir: {e}"))?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| format!("Failed to read entry: {e}"))? {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("tar") {
                let output = Command::new("tar")
                    .args(["xf", &path.to_string_lossy(), "-C", &merged_dir.to_string_lossy()])
                    .output()
                    .await;

                if let Ok(o) = &output {
                    if !o.status.success() {
                        tracing::warn!(path = %path.display(), "Layer tar extraction had warnings");
                    }
                }
            }
        }
    }

    Ok(())
}

async fn create_ext4(source_dir: &Path, output_path: &Path) -> Result<(), String> {
    let dir_size = get_dir_size(source_dir).await?;
    let image_size_mb = ((dir_size / (1024 * 1024)) + 128).max(256);

    let output = Command::new("dd")
        .args([
            "if=/dev/zero",
            &format!("of={}", output_path.to_string_lossy()),
            "bs=1M",
            &format!("count={image_size_mb}"),
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to create disk image: {e}"))?;

    if !output.status.success() {
        return Err(format!("dd failed: {}", String::from_utf8_lossy(&output.stderr)));
    }

    let output = Command::new("mkfs.ext4")
        .args(["-F", "-q", &output_path.to_string_lossy()])
        .output()
        .await
        .map_err(|e| format!("Failed to run mkfs.ext4: {e}"))?;

    if !output.status.success() {
        return Err(format!("mkfs.ext4 failed: {}", String::from_utf8_lossy(&output.stderr)));
    }

    let mount_dir = output_path.parent().unwrap().join("_mount_tmp");
    fs::create_dir_all(&mount_dir)
        .await
        .map_err(|e| format!("Failed to create mount dir: {e}"))?;

    let output = Command::new("mount")
        .args(["-o", "loop", &output_path.to_string_lossy(), &mount_dir.to_string_lossy()])
        .output()
        .await
        .map_err(|e| format!("Failed to mount ext4: {e}"))?;

    if !output.status.success() {
        let _ = fs::remove_dir(&mount_dir).await;
        return Err(format!("mount failed: {}", String::from_utf8_lossy(&output.stderr)));
    }

    let mut cp_error = None;
    match fs::read_dir(source_dir).await {
        Ok(mut entries) => {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let src = entry.path();
                let src_lossy = src.to_string_lossy();
                let dest_lossy = mount_dir.to_string_lossy();
                let output = Command::new("cp")
                    .args(["-a", src_lossy.as_ref(), dest_lossy.as_ref()])
                    .output()
                    .await;

                match output {
                    Ok(o) if !o.status.success() => {
                        let stderr = String::from_utf8_lossy(&o.stderr);
                        tracing::warn!(path = %src.display(), stderr = %stderr, "cp to rootfs had warnings");
                    }
                    Err(e) => {
                        cp_error = Some(format!("Failed to copy {} to rootfs: {e}", src.display()));
                        break;
                    }
                    _ => {}
                }
            }
        }
        Err(e) => {
            cp_error = Some(format!("Failed to read source dir: {e}"));
        }
    }

    let _ = Command::new("umount").arg(mount_dir.to_string_lossy().to_string()).output().await;
    let _ = fs::remove_dir(&mount_dir).await;

    if let Some(e) = cp_error {
        return Err(e);
    }

    Ok(())
}

async fn get_dir_size(path: &Path) -> Result<u64, String> {
    let output = Command::new("du")
        .args(["-sb", &path.to_string_lossy()])
        .output()
        .await
        .map_err(|e| format!("Failed to get directory size: {e}"))?;

    if !output.status.success() {
        return Ok(256 * 1024 * 1024);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .split_whitespace()
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "Failed to parse directory size".to_string())
}

pub async fn remove_rootfs(cache_dir: &Path, image: &str) -> Result<(), String> {
    let safe_name = image.replace(['/', ':', '.'], "_");
    let rootfs_path = cache_dir.join(format!("{safe_name}.ext4"));

    if rootfs_path.exists() {
        fs::remove_file(&rootfs_path)
            .await
            .map_err(|e| format!("Failed to remove rootfs: {e}"))?;
    }

    Ok(())
}

pub async fn rootfs_size(cache_dir: &Path, image: &str) -> Result<u64, String> {
    let safe_name = image.replace(['/', ':', '.'], "_");
    let rootfs_path = cache_dir.join(format!("{safe_name}.ext4"));

    if !rootfs_path.exists() {
        return Err(format!("Rootfs not found: {}", rootfs_path.display()));
    }

    let meta = fs::metadata(&rootfs_path)
        .await
        .map_err(|e| format!("Failed to stat rootfs: {e}"))?;

    Ok(meta.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_image_name() {
        let name = "python:3.12-slim".replace(['/', ':', '.'], "_");
        assert_eq!(name, "python_3_12-slim");

        let name2 = "docker.io/library/node:20".replace(['/', ':', '.'], "_");
        assert_eq!(name2, "docker_io_library_node_20");
    }

    #[tokio::test]
    async fn remove_rootfs_nonexistent() {
        let dir = std::env::temp_dir().join("fc_rootfs_test_nonexistent");
        let result = remove_rootfs(&dir, "nonexistent:image").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn rootfs_size_not_found() {
        let dir = std::env::temp_dir().join("fc_rootfs_test_size");
        let result = rootfs_size(&dir, "missing:image").await;
        assert!(result.is_err());
    }
}
