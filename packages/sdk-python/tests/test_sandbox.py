import httpx
import pytest
import respx

from iii_sandbox.client import HttpClient
from iii_sandbox.sandbox import Sandbox
from iii_sandbox.types import ClientConfig, SandboxInfo

BASE_URL = "http://localhost:3111"
SANDBOX_ID = "sbx-test-1234"


@pytest.fixture
def sandbox():
    client = HttpClient(ClientConfig(base_url=BASE_URL))
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
async def test_sandbox_id_property(sandbox):
    assert sandbox.id == SANDBOX_ID


@pytest.mark.asyncio
async def test_sandbox_status_property(sandbox):
    assert sandbox.status == "running"


@pytest.mark.asyncio
async def test_exec(sandbox):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/exec"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "exitCode": 0,
                    "stdout": "hello\n",
                    "stderr": "",
                    "duration": 0.05,
                },
            )
        )
        result = await sandbox.exec("echo hello")
        assert result.exitCode == 0
        assert result.stdout == "hello\n"
        assert result.stderr == ""
        assert result.duration == 0.05


@pytest.mark.asyncio
async def test_exec_with_timeout(sandbox):
    with respx.mock:
        route = respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/exec"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "exitCode": 0,
                    "stdout": "",
                    "stderr": "",
                    "duration": 1.0,
                },
            )
        )
        await sandbox.exec("sleep 1", timeout=5000)
        assert route.calls[0].request.content is not None


@pytest.mark.asyncio
async def test_exec_stream(sandbox):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/exec/stream"
        ).mock(
            return_value=httpx.Response(
                200,
                content=b'data: {"type":"stdout","data":"hi","timestamp":1700000000000}\ndata: {"type":"exit","data":"0","timestamp":1700000001000}\n',
                headers={"content-type": "text/event-stream"},
            )
        )
        chunks = []
        async for chunk in sandbox.exec_stream("echo hi"):
            chunks.append(chunk)
        assert len(chunks) == 2
        assert chunks[0].type == "stdout"
        assert chunks[0].data == "hi"
        assert chunks[1].type == "exit"


@pytest.mark.asyncio
async def test_clone(sandbox):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/clone"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "sbx-clone-5678",
                    "name": "clone-1",
                    "image": "python:3.12-slim",
                    "status": "creating",
                    "createdAt": 1700000010000,
                    "expiresAt": 1700003610000,
                },
            )
        )
        result = await sandbox.clone("clone-1")
        assert result.id == "sbx-clone-5678"
        assert result.name == "clone-1"


@pytest.mark.asyncio
async def test_pause(sandbox):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/pause"
        ).mock(
            return_value=httpx.Response(
                200, json={"status": "paused"}
            )
        )
        await sandbox.pause()


@pytest.mark.asyncio
async def test_resume(sandbox):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/resume"
        ).mock(
            return_value=httpx.Response(
                200, json={"status": "running"}
            )
        )
        await sandbox.resume()


@pytest.mark.asyncio
async def test_kill(sandbox):
    with respx.mock:
        respx.delete(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}"
        ).mock(
            return_value=httpx.Response(
                200, json={"deleted": SANDBOX_ID}
            )
        )
        await sandbox.kill()


@pytest.mark.asyncio
async def test_metrics(sandbox):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/metrics"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "sandboxId": SANDBOX_ID,
                    "cpuPercent": 12.5,
                    "memoryUsageMb": 128.0,
                    "memoryLimitMb": 512.0,
                    "networkRxBytes": 1024,
                    "networkTxBytes": 2048,
                    "pids": 5,
                },
            )
        )
        m = await sandbox.metrics()
        assert m.sandboxId == SANDBOX_ID
        assert m.cpuPercent == 12.5
        assert m.memoryUsageMb == 128.0
        assert m.pids == 5


@pytest.mark.asyncio
async def test_snapshot(sandbox):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/snapshots"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "snap-1",
                    "sandboxId": SANDBOX_ID,
                    "name": "my-snapshot",
                    "imageId": "sha256:abc",
                    "size": 50000000,
                    "createdAt": 1700000020000,
                },
            )
        )
        snap = await sandbox.snapshot("my-snapshot")
        assert snap.id == "snap-1"
        assert snap.name == "my-snapshot"


@pytest.mark.asyncio
async def test_restore(sandbox):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/snapshots/restore"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": SANDBOX_ID,
                    "name": "test-sandbox",
                    "image": "python:3.12-slim",
                    "status": "running",
                    "createdAt": 1700000000000,
                    "expiresAt": 1700003600000,
                },
            )
        )
        result = await sandbox.restore("snap-1")
        assert result.id == SANDBOX_ID


@pytest.mark.asyncio
async def test_list_snapshots(sandbox):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/snapshots"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "snapshots": [
                        {
                            "id": "snap-1",
                            "sandboxId": SANDBOX_ID,
                            "name": "s1",
                            "imageId": "sha256:abc",
                            "size": 50000000,
                            "createdAt": 1700000020000,
                        }
                    ]
                },
            )
        )
        result = await sandbox.list_snapshots()
        assert len(result["snapshots"]) == 1


@pytest.mark.asyncio
async def test_refresh(sandbox):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": SANDBOX_ID,
                    "name": "test-sandbox",
                    "image": "python:3.12-slim",
                    "status": "paused",
                    "createdAt": 1700000000000,
                    "expiresAt": 1700003600000,
                },
            )
        )
        result = await sandbox.refresh()
        assert result.status == "paused"
        assert sandbox.info.status == "paused"
        assert sandbox.status == "paused"


@pytest.mark.asyncio
async def test_exec_stream_malformed_json(sandbox):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/exec/stream"
        ).mock(
            return_value=httpx.Response(
                200,
                content=b"data: not-valid-json\ndata: also-bad\n",
                headers={"content-type": "text/event-stream"},
            )
        )
        chunks = []
        async for chunk in sandbox.exec_stream("echo hi"):
            chunks.append(chunk)
        assert len(chunks) == 0


@pytest.mark.asyncio
async def test_clone_no_name(sandbox):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/clone"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "sbx-clone-9999",
                    "name": "auto-clone",
                    "image": "python:3.12-slim",
                    "status": "creating",
                    "createdAt": 1700000010000,
                    "expiresAt": 1700003610000,
                },
            )
        )
        result = await sandbox.clone()
        assert result.id == "sbx-clone-9999"
        assert result.name == "auto-clone"
