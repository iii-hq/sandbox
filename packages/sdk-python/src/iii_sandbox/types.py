from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class SandboxCreateOptions(BaseModel):
    image: str = "python:3.12-slim"
    name: Optional[str] = None
    timeout: Optional[int] = None
    memory: Optional[int] = None
    cpu: Optional[int] = None
    network: Optional[bool] = None
    env: Optional[dict[str, str]] = None
    workdir: Optional[str] = None
    template: Optional[str] = None


class SandboxTemplate(BaseModel):
    id: str
    name: str
    description: str
    config: dict
    builtin: bool
    createdAt: int


class SandboxInfo(BaseModel):
    id: str
    name: str
    image: str
    status: str
    createdAt: int
    expiresAt: int


class ExecResult(BaseModel):
    exitCode: int
    stdout: str
    stderr: str
    duration: float


class ExecStreamChunk(BaseModel):
    type: str
    data: str
    timestamp: int


class FileInfo(BaseModel):
    name: str
    path: str
    size: int
    isDirectory: bool
    modifiedAt: int


class SandboxMetrics(BaseModel):
    sandboxId: str
    cpuPercent: float
    memoryUsageMb: float
    memoryLimitMb: float
    networkRxBytes: int
    networkTxBytes: int
    pids: int


class CodeResult(BaseModel):
    output: str
    error: Optional[str] = None
    executionTime: float
    mimeType: Optional[str] = None


class KernelSpec(BaseModel):
    name: str
    language: str
    displayName: str


class SnapshotInfo(BaseModel):
    id: str
    sandboxId: str
    name: str
    imageId: str
    size: int
    createdAt: int


class ClientConfig(BaseModel):
    base_url: str = "http://localhost:3111"
    token: Optional[str] = None
    timeout_ms: int = 30000


class GitStatus(BaseModel):
    branch: str
    clean: bool
    files: list[dict]


class GitLogEntry(BaseModel):
    hash: str
    message: str
    author: str
    date: str


class GitBranchResult(BaseModel):
    branches: list[str]
    current: str


class ProcessInfo(BaseModel):
    pid: int
    user: str
    cpu: str
    memory: str
    command: str


class ProcessTopInfo(BaseModel):
    pid: int
    cpu: str
    mem: str
    vsz: int
    rss: int
    command: str


class PortMapping(BaseModel):
    containerPort: int
    hostPort: int
    protocol: str
    state: str


class QueueJobInfo(BaseModel):
    id: str
    sandboxId: str
    command: str
    status: str
    result: Optional[dict] = None
    error: Optional[str] = None
    retries: int
    maxRetries: int
    createdAt: int
    startedAt: Optional[int] = None
    completedAt: Optional[int] = None


class LogEvent(BaseModel):
    type: str
    data: str
    timestamp: int


class ResourceAlert(BaseModel):
    id: str
    sandboxId: str
    metric: str
    threshold: float
    action: str
    triggered: bool
    lastChecked: Optional[int] = None
    lastTriggered: Optional[int] = None
    createdAt: int


class AlertEvent(BaseModel):
    alertId: str
    sandboxId: str
    metric: str
    value: float
    threshold: float
    action: str
    timestamp: int


class SandboxEvent(BaseModel):
    id: str
    topic: str
    sandboxId: str
    data: dict
    timestamp: int


class SandboxNetwork(BaseModel):
    id: str
    name: str
    dockerNetworkId: str
    sandboxes: list[str]
    createdAt: int


class TraceRecord(BaseModel):
    id: str
    functionId: str
    sandboxId: Optional[str] = None
    duration: float
    status: str
    error: Optional[str] = None
    timestamp: int


class ObservabilityMetrics(BaseModel):
    totalRequests: int
    totalErrors: int
    avgDuration: float
    p95Duration: float
    activeSandboxes: int
    functionCounts: dict[str, int]


class VolumeInfo(BaseModel):
    id: str
    name: str
    dockerVolumeName: str
    mountPath: Optional[str] = None
    sandboxId: Optional[str] = None
    size: Optional[str] = None
    createdAt: int
