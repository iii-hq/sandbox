import httpx
import pytest
import respx

import iii_sandbox
from iii_sandbox.client import HttpClient
from iii_sandbox.monitor import MonitorManager
from iii_sandbox.network import NetworkManager
from iii_sandbox.port import PortManager
from iii_sandbox.process import ProcessManager
from iii_sandbox.queue import QueueManager
from iii_sandbox.sandbox import Sandbox
from iii_sandbox.types import ClientConfig, SandboxInfo
from iii_sandbox.volume import VolumeManager

BASE_URL = "http://localhost:3111"
SANDBOX_ID = "sbx-test-1234"


@pytest.fixture
def client():
    return HttpClient(ClientConfig(base_url=BASE_URL))


@pytest.fixture
def sandbox(client):
    info = SandboxInfo(
        id=SANDBOX_ID,
        name="test-sandbox",
        image="python:3.12-slim",
        status="running",
        createdAt=1700000000000,
        expiresAt=1700003600000,
    )
    return Sandbox(client, info)


@pytest.mark.asyncio
async def test_http_404_raises(client):
    with respx.mock:
        respx.get(f"{BASE_URL}/sandbox/sandboxes/nonexistent").mock(
            return_value=httpx.Response(404, json={"error": "not found"})
        )
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            await client.get("/sandbox/sandboxes/nonexistent")
        assert exc_info.value.response.status_code == 404


@pytest.mark.asyncio
async def test_http_500_raises(client):
    with respx.mock:
        respx.post(f"{BASE_URL}/sandbox/sandboxes").mock(
            return_value=httpx.Response(500, json={"error": "internal"})
        )
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            await client.post("/sandbox/sandboxes", {"image": "python:3.12-slim"})
        assert exc_info.value.response.status_code == 500


@pytest.mark.asyncio
async def test_http_401_raises(client):
    with respx.mock:
        respx.get(f"{BASE_URL}/sandbox/sandboxes").mock(
            return_value=httpx.Response(401, json={"error": "unauthorized"})
        )
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            await client.get("/sandbox/sandboxes")
        assert exc_info.value.response.status_code == 401


@pytest.mark.asyncio
async def test_sandbox_exec_failure(sandbox):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/exec"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "exitCode": 1,
                    "stdout": "",
                    "stderr": "command not found\n",
                    "duration": 0.01,
                },
            )
        )
        result = await sandbox.exec("nonexistent-cmd")
        assert result.exitCode == 1
        assert "command not found" in result.stderr


@pytest.mark.asyncio
async def test_empty_sandbox_list():
    with respx.mock:
        respx.get(f"{BASE_URL}/sandbox/sandboxes").mock(
            return_value=httpx.Response(200, json={"items": []})
        )
        sandboxes = await iii_sandbox.list_sandboxes()
        assert sandboxes == []
        assert len(sandboxes) == 0


@pytest.mark.asyncio
async def test_empty_snapshot_list(sandbox):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/snapshots"
        ).mock(
            return_value=httpx.Response(200, json={"snapshots": []})
        )
        result = await sandbox.list_snapshots()
        assert result["snapshots"] == []


@pytest.mark.asyncio
async def test_empty_process_list(client):
    mgr = ProcessManager(client, SANDBOX_ID)
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/processes"
        ).mock(
            return_value=httpx.Response(200, json={"processes": []})
        )
        result = await mgr.list()
        assert result["processes"] == []


@pytest.mark.asyncio
async def test_empty_alert_list(client):
    mgr = MonitorManager(client, SANDBOX_ID)
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/alerts"
        ).mock(
            return_value=httpx.Response(200, json={"alerts": []})
        )
        result = await mgr.list_alerts()
        assert result["alerts"] == []


@pytest.mark.asyncio
async def test_empty_port_list(client):
    mgr = PortManager(client, SANDBOX_ID)
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/ports"
        ).mock(
            return_value=httpx.Response(200, json={"ports": []})
        )
        result = await mgr.list()
        assert result["ports"] == []


@pytest.mark.asyncio
async def test_empty_queue_dlq(client):
    mgr = QueueManager(client, SANDBOX_ID)
    with respx.mock:
        respx.get(f"{BASE_URL}/sandbox/queue/dlq").mock(
            return_value=httpx.Response(200, json={"jobs": [], "total": 0})
        )
        result = await mgr.dlq()
        assert result["jobs"] == []
        assert result["total"] == 0


@pytest.mark.asyncio
async def test_empty_network_list(client):
    mgr = NetworkManager(client)
    with respx.mock:
        respx.get(f"{BASE_URL}/sandbox/networks").mock(
            return_value=httpx.Response(200, json={"networks": []})
        )
        result = await mgr.list()
        assert result["networks"] == []


@pytest.mark.asyncio
async def test_empty_volume_list(client):
    mgr = VolumeManager(client)
    with respx.mock:
        respx.get(f"{BASE_URL}/sandbox/volumes").mock(
            return_value=httpx.Response(200, json={"volumes": []})
        )
        result = await mgr.list()
        assert result["volumes"] == []


@pytest.mark.asyncio
async def test_queue_job_with_result(client):
    mgr = QueueManager(client, SANDBOX_ID)
    with respx.mock:
        respx.get(f"{BASE_URL}/sandbox/queue/job-done/status").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "job-done",
                    "sandboxId": SANDBOX_ID,
                    "command": "python script.py",
                    "status": "completed",
                    "result": {
                        "exitCode": 0,
                        "stdout": "output",
                        "stderr": "",
                        "duration": 2.0,
                    },
                    "error": None,
                    "retries": 0,
                    "maxRetries": 3,
                    "createdAt": 1700000000000,
                    "startedAt": 1700000001000,
                    "completedAt": 1700000003000,
                },
            )
        )
        job = await mgr.status("job-done")
        assert job.status == "completed"
        assert job.result is not None
        assert job.result["exitCode"] == 0
        assert job.startedAt == 1700000001000
        assert job.completedAt == 1700000003000


@pytest.mark.asyncio
async def test_queue_job_failed_status(client):
    mgr = QueueManager(client, SANDBOX_ID)
    with respx.mock:
        respx.get(f"{BASE_URL}/sandbox/queue/job-fail/status").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "job-fail",
                    "sandboxId": SANDBOX_ID,
                    "command": "bad-cmd",
                    "status": "failed",
                    "result": None,
                    "error": "max retries exceeded",
                    "retries": 3,
                    "maxRetries": 3,
                    "createdAt": 1700000000000,
                    "startedAt": 1700000001000,
                    "completedAt": 1700000010000,
                },
            )
        )
        job = await mgr.status("job-fail")
        assert job.status == "failed"
        assert job.error == "max retries exceeded"
        assert job.result is None
        assert job.retries == 3
