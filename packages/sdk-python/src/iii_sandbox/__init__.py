from __future__ import annotations

from .client import HttpClient
from .env import EnvManager
from .events import EventManager
from .filesystem import FileSystem
from .git import GitManager
from .interpreter import CodeInterpreter
from .monitor import MonitorManager
from .network import NetworkManager
from .observability import ObservabilityClient
from .port import PortManager
from .process import ProcessManager
from .queue import QueueManager
from .sandbox import Sandbox
from .stream import StreamManager
from .types import (
    AlertEvent,
    ClientConfig,
    CodeResult,
    ExecResult,
    ExecStreamChunk,
    FileInfo,
    GitBranchResult,
    GitLogEntry,
    GitStatus,
    KernelSpec,
    LogEvent,
    ObservabilityMetrics,
    PortMapping,
    ProcessInfo,
    ProcessTopInfo,
    QueueJobInfo,
    ResourceAlert,
    SandboxCreateOptions,
    SandboxEvent,
    SandboxInfo,
    SandboxMetrics,
    SandboxNetwork,
    SandboxTemplate,
    SnapshotInfo,
    TraceRecord,
    VolumeInfo,
)
from .volume import VolumeManager

DEFAULT_BASE_URL = "http://localhost:3111"


async def create_sandbox(
    image: str = "python:3.12-slim",
    name: str | None = None,
    timeout: int | None = None,
    memory: int | None = None,
    cpu: int | None = None,
    network: bool | None = None,
    env: dict[str, str] | None = None,
    workdir: str | None = None,
    template: str | None = None,
    base_url: str = DEFAULT_BASE_URL,
    token: str | None = None,
) -> Sandbox:
    client = HttpClient(ClientConfig(base_url=base_url, token=token))
    body: dict = {"image": image}
    if name is not None:
        body["name"] = name
    if timeout is not None:
        body["timeout"] = timeout
    if memory is not None:
        body["memory"] = memory
    if cpu is not None:
        body["cpu"] = cpu
    if network is not None:
        body["network"] = network
    if env is not None:
        body["env"] = env
    if workdir is not None:
        body["workdir"] = workdir
    if template is not None:
        body["template"] = template
    data = await client.post("/sandbox/sandboxes", body)
    info = SandboxInfo(**data)
    return Sandbox(client, info)


async def list_sandboxes(
    base_url: str = DEFAULT_BASE_URL,
    token: str | None = None,
) -> list[SandboxInfo]:
    client = HttpClient(ClientConfig(base_url=base_url, token=token))
    data = await client.get("/sandbox/sandboxes")
    return [SandboxInfo(**s) for s in data["items"]]


async def get_sandbox(
    id: str,
    base_url: str = DEFAULT_BASE_URL,
    token: str | None = None,
) -> Sandbox:
    client = HttpClient(ClientConfig(base_url=base_url, token=token))
    data = await client.get(f"/sandbox/sandboxes/{id}")
    info = SandboxInfo(**data)
    return Sandbox(client, info)


async def list_templates(
    base_url: str = DEFAULT_BASE_URL,
    token: str | None = None,
) -> list[SandboxTemplate]:
    client = HttpClient(ClientConfig(base_url=base_url, token=token))
    data = await client.get("/sandbox/templates")
    return [SandboxTemplate(**t) for t in data["templates"]]


__all__ = [
    "create_sandbox",
    "list_sandboxes",
    "get_sandbox",
    "list_templates",
    "Sandbox",
    "HttpClient",
    "FileSystem",
    "EnvManager",
    "GitManager",
    "CodeInterpreter",
    "ProcessManager",
    "PortManager",
    "QueueManager",
    "StreamManager",
    "MonitorManager",
    "EventManager",
    "NetworkManager",
    "ObservabilityClient",
    "VolumeManager",
    "SandboxCreateOptions",
    "SandboxTemplate",
    "SandboxInfo",
    "ExecResult",
    "ExecStreamChunk",
    "FileInfo",
    "SandboxMetrics",
    "CodeResult",
    "KernelSpec",
    "SnapshotInfo",
    "ClientConfig",
    "GitStatus",
    "GitLogEntry",
    "GitBranchResult",
    "ProcessInfo",
    "ProcessTopInfo",
    "PortMapping",
    "QueueJobInfo",
    "LogEvent",
    "ResourceAlert",
    "AlertEvent",
    "SandboxEvent",
    "SandboxNetwork",
    "TraceRecord",
    "ObservabilityMetrics",
    "VolumeInfo",
]
