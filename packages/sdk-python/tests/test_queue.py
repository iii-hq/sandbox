import httpx
import pytest
import respx

from iii_sandbox.client import HttpClient
from iii_sandbox.queue import QueueManager
from iii_sandbox.types import ClientConfig

BASE_URL = "http://localhost:3111"
SANDBOX_ID = "sbx-test-1234"


@pytest.fixture
def queue():
    client = HttpClient(ClientConfig(base_url=BASE_URL))
    return QueueManager(client, SANDBOX_ID)


@pytest.mark.asyncio
async def test_submit(queue):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/exec/queue"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "job-1",
                    "sandboxId": SANDBOX_ID,
                    "command": "python train.py",
                    "status": "pending",
                    "result": None,
                    "error": None,
                    "retries": 0,
                    "maxRetries": 3,
                    "createdAt": 1700000000000,
                    "startedAt": None,
                    "completedAt": None,
                },
            )
        )
        job = await queue.submit("python train.py", max_retries=3)
        assert job.id == "job-1"
        assert job.status == "pending"
        assert job.maxRetries == 3


@pytest.mark.asyncio
async def test_status(queue):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/queue/job-1/status"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "job-1",
                    "sandboxId": SANDBOX_ID,
                    "command": "python train.py",
                    "status": "completed",
                    "result": {
                        "exitCode": 0,
                        "stdout": "done",
                        "stderr": "",
                        "duration": 5.0,
                    },
                    "error": None,
                    "retries": 0,
                    "maxRetries": 3,
                    "createdAt": 1700000000000,
                    "startedAt": 1700000001000,
                    "completedAt": 1700000006000,
                },
            )
        )
        job = await queue.status("job-1")
        assert job.status == "completed"
        assert job.result["exitCode"] == 0


@pytest.mark.asyncio
async def test_cancel(queue):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/queue/job-1/cancel"
        ).mock(
            return_value=httpx.Response(
                200, json={"cancelled": "job-1"}
            )
        )
        result = await queue.cancel("job-1")
        assert result["cancelled"] == "job-1"


@pytest.mark.asyncio
async def test_dlq(queue):
    with respx.mock:
        respx.get(f"{BASE_URL}/sandbox/queue/dlq").mock(
            return_value=httpx.Response(
                200,
                json={
                    "jobs": [
                        {
                            "id": "job-2",
                            "sandboxId": SANDBOX_ID,
                            "command": "failing-cmd",
                            "status": "failed",
                            "result": None,
                            "error": "command not found",
                            "retries": 3,
                            "maxRetries": 3,
                            "createdAt": 1700000000000,
                            "startedAt": 1700000001000,
                            "completedAt": 1700000010000,
                        }
                    ],
                    "total": 1,
                },
            )
        )
        result = await queue.dlq()
        assert result["total"] == 1
        assert result["jobs"][0]["status"] == "failed"


@pytest.mark.asyncio
async def test_dlq_with_limit(queue):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/queue/dlq", params={"limit": "5"}
        ).mock(
            return_value=httpx.Response(
                200, json={"jobs": [], "total": 0}
            )
        )
        result = await queue.dlq(limit=5)
        assert result["total"] == 0


@pytest.mark.asyncio
async def test_submit_with_timeout(queue):
    with respx.mock:
        import json

        route = respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/exec/queue"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "job-t",
                    "sandboxId": SANDBOX_ID,
                    "command": "long-task",
                    "status": "pending",
                    "result": None,
                    "error": None,
                    "retries": 0,
                    "maxRetries": 1,
                    "createdAt": 1700000000000,
                    "startedAt": None,
                    "completedAt": None,
                },
            )
        )
        job = await queue.submit(
            "long-task", max_retries=1, timeout=60000
        )
        assert job.id == "job-t"
        body = json.loads(route.calls[0].request.content)
        assert body["timeout"] == 60000
