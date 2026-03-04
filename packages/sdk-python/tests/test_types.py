import pytest

from iii_sandbox.types import (
    CodeResult,
    ExecResult,
    QueueJobInfo,
    ResourceAlert,
    SandboxInfo,
    SandboxMetrics,
    TraceRecord,
    VolumeInfo,
)


def test_sandbox_info_from_dict():
    data = {
        "id": "sbx-1",
        "name": "test",
        "image": "python:3.12-slim",
        "status": "running",
        "createdAt": 1700000000000,
        "expiresAt": 1700003600000,
    }
    info = SandboxInfo(**data)
    assert info.id == "sbx-1"
    assert info.name == "test"
    assert info.image == "python:3.12-slim"
    assert info.status == "running"
    assert info.createdAt == 1700000000000
    assert info.expiresAt == 1700003600000


def test_exec_result_from_dict():
    data = {
        "exitCode": 0,
        "stdout": "hello\n",
        "stderr": "",
        "duration": 0.05,
    }
    result = ExecResult(**data)
    assert result.exitCode == 0
    assert result.stdout == "hello\n"
    assert result.stderr == ""
    assert result.duration == 0.05


def test_sandbox_metrics_from_dict():
    data = {
        "sandboxId": "sbx-1",
        "cpuPercent": 25.5,
        "memoryUsageMb": 256.0,
        "memoryLimitMb": 1024.0,
        "networkRxBytes": 5000,
        "networkTxBytes": 3000,
        "pids": 10,
    }
    metrics = SandboxMetrics(**data)
    assert metrics.sandboxId == "sbx-1"
    assert metrics.cpuPercent == 25.5
    assert metrics.memoryUsageMb == 256.0
    assert metrics.memoryLimitMb == 1024.0
    assert metrics.networkRxBytes == 5000
    assert metrics.networkTxBytes == 3000
    assert metrics.pids == 10


def test_code_result_with_optional_fields():
    result = CodeResult(
        output="42",
        error=None,
        executionTime=0.01,
        mimeType=None,
    )
    assert result.output == "42"
    assert result.error is None
    assert result.mimeType is None
    assert result.executionTime == 0.01

    result_with = CodeResult(
        output="<html>",
        error="warning",
        executionTime=0.5,
        mimeType="text/html",
    )
    assert result_with.error == "warning"
    assert result_with.mimeType == "text/html"


def test_queue_job_info_optional_fields():
    job = QueueJobInfo(
        id="job-1",
        sandboxId="sbx-1",
        command="echo test",
        status="pending",
        result=None,
        error=None,
        retries=0,
        maxRetries=3,
        createdAt=1700000000000,
        startedAt=None,
        completedAt=None,
    )
    assert job.result is None
    assert job.error is None
    assert job.startedAt is None
    assert job.completedAt is None

    job_done = QueueJobInfo(
        id="job-2",
        sandboxId="sbx-1",
        command="echo done",
        status="completed",
        result={"exitCode": 0, "stdout": "done", "stderr": "", "duration": 1.0},
        error=None,
        retries=1,
        maxRetries=3,
        createdAt=1700000000000,
        startedAt=1700000001000,
        completedAt=1700000002000,
    )
    assert job_done.result is not None
    assert job_done.startedAt == 1700000001000
    assert job_done.completedAt == 1700000002000


def test_resource_alert_optional_fields():
    alert = ResourceAlert(
        id="alert-1",
        sandboxId="sbx-1",
        metric="cpu",
        threshold=80.0,
        action="notify",
        triggered=False,
        lastChecked=None,
        lastTriggered=None,
        createdAt=1700000000000,
    )
    assert alert.lastChecked is None
    assert alert.lastTriggered is None

    alert_triggered = ResourceAlert(
        id="alert-2",
        sandboxId="sbx-1",
        metric="memory",
        threshold=90.0,
        action="kill",
        triggered=True,
        lastChecked=1700000050000,
        lastTriggered=1700000045000,
        createdAt=1700000000000,
    )
    assert alert_triggered.lastChecked == 1700000050000
    assert alert_triggered.lastTriggered == 1700000045000
    assert alert_triggered.triggered is True


def test_volume_info_optional_fields():
    vol = VolumeInfo(
        id="vol-1",
        name="data-vol",
        dockerVolumeName="iii-vol-1",
        mountPath=None,
        sandboxId=None,
        size=None,
        createdAt=1700000000000,
    )
    assert vol.mountPath is None
    assert vol.sandboxId is None
    assert vol.size is None

    vol_attached = VolumeInfo(
        id="vol-2",
        name="attached-vol",
        dockerVolumeName="iii-vol-2",
        mountPath="/data",
        sandboxId="sbx-1",
        size="500MB",
        createdAt=1700000000000,
    )
    assert vol_attached.mountPath == "/data"
    assert vol_attached.sandboxId == "sbx-1"
    assert vol_attached.size == "500MB"


def test_trace_record_optional_fields():
    trace = TraceRecord(
        id="trace-1",
        functionId="sandbox:exec",
        sandboxId=None,
        duration=0.5,
        status="ok",
        error=None,
        timestamp=1700000000000,
    )
    assert trace.sandboxId is None
    assert trace.error is None

    trace_err = TraceRecord(
        id="trace-2",
        functionId="sandbox:create",
        sandboxId="sbx-1",
        duration=1.2,
        status="error",
        error="timeout exceeded",
        timestamp=1700000000000,
    )
    assert trace_err.sandboxId == "sbx-1"
    assert trace_err.error == "timeout exceeded"
    assert trace_err.status == "error"
