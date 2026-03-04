import httpx
import pytest
import respx

from iii_sandbox.client import HttpClient
from iii_sandbox.stream import StreamManager
from iii_sandbox.types import ClientConfig

BASE_URL = "http://localhost:3111"
SANDBOX_ID = "sbx-test-1234"


@pytest.fixture
def stream_mgr():
    client = HttpClient(ClientConfig(base_url=BASE_URL))
    return StreamManager(client, SANDBOX_ID)


@pytest.mark.asyncio
async def test_logs(stream_mgr):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/stream/logs"
        ).mock(
            return_value=httpx.Response(
                200,
                content=(
                    b'data: {"type":"stdout","data":"line 1","timestamp":1700000000000}\n'
                    b'data: {"type":"stderr","data":"warn","timestamp":1700000001000}\n'
                    b'data: {"type":"end","data":"","timestamp":1700000002000}\n'
                ),
                headers={"content-type": "text/event-stream"},
            )
        )
        events = []
        async for event in stream_mgr.logs():
            events.append(event)
        assert len(events) == 3
        assert events[0].type == "stdout"
        assert events[0].data == "line 1"
        assert events[1].type == "stderr"
        assert events[2].type == "end"


@pytest.mark.asyncio
async def test_logs_with_tail(stream_mgr):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/stream/logs",
            params={"tail": "10"},
        ).mock(
            return_value=httpx.Response(
                200,
                content=b'data: {"type":"stdout","data":"last line","timestamp":1700000000000}\n',
                headers={"content-type": "text/event-stream"},
            )
        )
        events = []
        async for event in stream_mgr.logs(tail=10):
            events.append(event)
        assert len(events) == 1


@pytest.mark.asyncio
async def test_logs_with_follow(stream_mgr):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/stream/logs",
            params={"follow": "true"},
        ).mock(
            return_value=httpx.Response(
                200,
                content=b'data: {"type":"stdout","data":"streaming","timestamp":1700000000000}\n',
                headers={"content-type": "text/event-stream"},
            )
        )
        events = []
        async for event in stream_mgr.logs(follow=True):
            events.append(event)
        assert len(events) == 1
        assert events[0].data == "streaming"


@pytest.mark.asyncio
async def test_metrics_stream(stream_mgr):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/stream/metrics"
        ).mock(
            return_value=httpx.Response(
                200,
                content=(
                    b'data: {"sandboxId":"sbx-test-1234","cpuPercent":10.5,"memoryUsageMb":64.0,"memoryLimitMb":512.0,"networkRxBytes":100,"networkTxBytes":200,"pids":3}\n'
                    b'data: {"sandboxId":"sbx-test-1234","cpuPercent":15.2,"memoryUsageMb":72.0,"memoryLimitMb":512.0,"networkRxBytes":150,"networkTxBytes":300,"pids":4}\n'
                ),
                headers={"content-type": "text/event-stream"},
            )
        )
        metrics = []
        async for m in stream_mgr.metrics():
            metrics.append(m)
        assert len(metrics) == 2
        assert metrics[0].cpuPercent == 10.5
        assert metrics[1].cpuPercent == 15.2
        assert metrics[0].pids == 3


@pytest.mark.asyncio
async def test_metrics_stream_with_interval(stream_mgr):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/stream/metrics",
            params={"interval": "5"},
        ).mock(
            return_value=httpx.Response(
                200,
                content=b'data: {"sandboxId":"sbx-test-1234","cpuPercent":5.0,"memoryUsageMb":32.0,"memoryLimitMb":256.0,"networkRxBytes":50,"networkTxBytes":100,"pids":2}\n',
                headers={"content-type": "text/event-stream"},
            )
        )
        metrics = []
        async for m in stream_mgr.metrics(interval=5):
            metrics.append(m)
        assert len(metrics) == 1


@pytest.mark.asyncio
async def test_logs_malformed_json(stream_mgr):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/stream/logs"
        ).mock(
            return_value=httpx.Response(
                200,
                content=b"data: not-valid-json\n",
                headers={"content-type": "text/event-stream"},
            )
        )
        events = []
        async for event in stream_mgr.logs():
            events.append(event)
        assert len(events) == 0


@pytest.mark.asyncio
async def test_metrics_malformed_json(stream_mgr):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/stream/metrics"
        ).mock(
            return_value=httpx.Response(
                200,
                content=b"data: {bad-json}\n",
                headers={"content-type": "text/event-stream"},
            )
        )
        metrics = []
        async for m in stream_mgr.metrics():
            metrics.append(m)
        assert len(metrics) == 0
