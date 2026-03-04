import httpx
import pytest
import respx

from iii_sandbox.client import HttpClient
from iii_sandbox.process import ProcessManager
from iii_sandbox.types import ClientConfig

BASE_URL = "http://localhost:3111"
SANDBOX_ID = "sbx-test-1234"


@pytest.fixture
def proc():
    client = HttpClient(ClientConfig(base_url=BASE_URL))
    return ProcessManager(client, SANDBOX_ID)


@pytest.mark.asyncio
async def test_list(proc):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/processes"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "processes": [
                        {
                            "pid": 1,
                            "user": "root",
                            "cpu": "0.0",
                            "memory": "0.1",
                            "command": "/bin/sh",
                        },
                        {
                            "pid": 42,
                            "user": "root",
                            "cpu": "5.0",
                            "memory": "2.3",
                            "command": "python main.py",
                        },
                    ]
                },
            )
        )
        result = await proc.list()
        assert len(result["processes"]) == 2
        assert result["processes"][0]["pid"] == 1
        assert result["processes"][1]["command"] == "python main.py"


@pytest.mark.asyncio
async def test_kill(proc):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/processes/kill"
        ).mock(
            return_value=httpx.Response(
                200,
                json={"killed": 42, "signal": "SIGTERM"},
            )
        )
        result = await proc.kill(42)
        assert result["killed"] == 42
        assert result["signal"] == "SIGTERM"


@pytest.mark.asyncio
async def test_kill_with_signal(proc):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/processes/kill"
        ).mock(
            return_value=httpx.Response(
                200,
                json={"killed": 42, "signal": "SIGKILL"},
            )
        )
        result = await proc.kill(42, signal="SIGKILL")
        assert result["signal"] == "SIGKILL"


@pytest.mark.asyncio
async def test_top(proc):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/processes/top"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "processes": [
                        {
                            "pid": 1,
                            "cpu": "0.0",
                            "mem": "0.1",
                            "vsz": 4096,
                            "rss": 2048,
                            "command": "/bin/sh",
                        }
                    ]
                },
            )
        )
        result = await proc.top()
        assert len(result["processes"]) == 1
        assert result["processes"][0]["vsz"] == 4096
