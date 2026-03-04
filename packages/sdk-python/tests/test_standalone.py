import httpx
import pytest
import respx

from iii_sandbox.client import HttpClient
from iii_sandbox.events import EventManager
from iii_sandbox.network import NetworkManager
from iii_sandbox.observability import ObservabilityClient
from iii_sandbox.types import ClientConfig
from iii_sandbox.volume import VolumeManager

BASE_URL = "http://localhost:3111"


@pytest.fixture
def client():
    return HttpClient(ClientConfig(base_url=BASE_URL))


@pytest.mark.asyncio
async def test_event_history(client):
    mgr = EventManager(client)
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/events/history"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "events": [
                        {
                            "id": "evt-1",
                            "topic": "sandbox.started",
                            "sandboxId": "sbx-1",
                            "data": {"image": "python:3.12-slim"},
                            "timestamp": 1700000000000,
                        }
                    ],
                    "total": 1,
                },
            )
        )
        result = await mgr.history()
        assert result["total"] == 1
        assert result["events"][0]["topic"] == "sandbox.started"


@pytest.mark.asyncio
async def test_event_history_with_filters(client):
    mgr = EventManager(client)
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/events/history",
            params={
                "sandboxId": "sbx-1",
                "topic": "sandbox.started",
                "limit": "5",
            },
        ).mock(
            return_value=httpx.Response(
                200, json={"events": [], "total": 0}
            )
        )
        result = await mgr.history(
            sandbox_id="sbx-1",
            topic="sandbox.started",
            limit=5,
        )
        assert result["total"] == 0


@pytest.mark.asyncio
async def test_event_publish(client):
    mgr = EventManager(client)
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/events/publish"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "evt-2",
                    "topic": "custom.event",
                    "sandboxId": "sbx-1",
                    "data": {"key": "value"},
                    "timestamp": 1700000000000,
                },
            )
        )
        event = await mgr.publish(
            "custom.event", "sbx-1", data={"key": "value"}
        )
        assert event.id == "evt-2"
        assert event.topic == "custom.event"
        assert event.data["key"] == "value"


@pytest.mark.asyncio
async def test_network_create(client):
    mgr = NetworkManager(client)
    with respx.mock:
        respx.post(f"{BASE_URL}/sandbox/networks").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "net-1",
                    "name": "my-network",
                    "dockerNetworkId": "docker-net-abc",
                    "sandboxes": [],
                    "createdAt": 1700000000000,
                },
            )
        )
        network = await mgr.create("my-network")
        assert network.id == "net-1"
        assert network.name == "my-network"
        assert network.sandboxes == []


@pytest.mark.asyncio
async def test_network_list(client):
    mgr = NetworkManager(client)
    with respx.mock:
        respx.get(f"{BASE_URL}/sandbox/networks").mock(
            return_value=httpx.Response(
                200,
                json={
                    "networks": [
                        {
                            "id": "net-1",
                            "name": "my-network",
                            "dockerNetworkId": "docker-net-abc",
                            "sandboxes": ["sbx-1"],
                            "createdAt": 1700000000000,
                        }
                    ]
                },
            )
        )
        result = await mgr.list()
        assert len(result["networks"]) == 1


@pytest.mark.asyncio
async def test_network_connect(client):
    mgr = NetworkManager(client)
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/networks/net-1/connect"
        ).mock(
            return_value=httpx.Response(
                200, json={"connected": True}
            )
        )
        result = await mgr.connect("net-1", "sbx-1")
        assert result["connected"] is True


@pytest.mark.asyncio
async def test_network_disconnect(client):
    mgr = NetworkManager(client)
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/networks/net-1/disconnect"
        ).mock(
            return_value=httpx.Response(
                200, json={"disconnected": True}
            )
        )
        result = await mgr.disconnect("net-1", "sbx-1")
        assert result["disconnected"] is True


@pytest.mark.asyncio
async def test_network_delete(client):
    mgr = NetworkManager(client)
    with respx.mock:
        respx.delete(
            f"{BASE_URL}/sandbox/networks/net-1"
        ).mock(
            return_value=httpx.Response(
                200, json={"deleted": "net-1"}
            )
        )
        result = await mgr.delete("net-1")
        assert result["deleted"] == "net-1"


@pytest.mark.asyncio
async def test_observability_traces(client):
    obs = ObservabilityClient(client)
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/observability/traces"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "traces": [
                        {
                            "id": "trace-1",
                            "functionId": "sandbox:create",
                            "sandboxId": "sbx-1",
                            "duration": 0.5,
                            "status": "ok",
                            "error": None,
                            "timestamp": 1700000000000,
                        }
                    ],
                    "total": 1,
                },
            )
        )
        result = await obs.traces()
        assert result["total"] == 1
        assert result["traces"][0]["functionId"] == "sandbox:create"


@pytest.mark.asyncio
async def test_observability_traces_with_filters(client):
    obs = ObservabilityClient(client)
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/observability/traces",
            params={"sandboxId": "sbx-1", "limit": "10"},
        ).mock(
            return_value=httpx.Response(
                200, json={"traces": [], "total": 0}
            )
        )
        result = await obs.traces(sandbox_id="sbx-1", limit=10)
        assert result["total"] == 0


@pytest.mark.asyncio
async def test_observability_metrics(client):
    obs = ObservabilityClient(client)
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/observability/metrics"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "totalRequests": 1500,
                    "totalErrors": 12,
                    "avgDuration": 0.25,
                    "p95Duration": 0.8,
                    "activeSandboxes": 5,
                    "functionCounts": {
                        "sandbox:create": 100,
                        "sandbox:exec": 800,
                    },
                },
            )
        )
        metrics = await obs.metrics()
        assert metrics.totalRequests == 1500
        assert metrics.totalErrors == 12
        assert metrics.activeSandboxes == 5


@pytest.mark.asyncio
async def test_observability_clear(client):
    obs = ObservabilityClient(client)
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/observability/clear"
        ).mock(
            return_value=httpx.Response(
                200, json={"cleared": 42}
            )
        )
        result = await obs.clear()
        assert result["cleared"] == 42


@pytest.mark.asyncio
async def test_observability_clear_with_before(client):
    obs = ObservabilityClient(client)
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/observability/clear"
        ).mock(
            return_value=httpx.Response(
                200, json={"cleared": 10}
            )
        )
        result = await obs.clear(before=1700000000000)
        assert result["cleared"] == 10


@pytest.mark.asyncio
async def test_volume_create(client):
    mgr = VolumeManager(client)
    with respx.mock:
        respx.post(f"{BASE_URL}/sandbox/volumes").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "vol-1",
                    "name": "my-volume",
                    "dockerVolumeName": "iii-vol-1",
                    "mountPath": None,
                    "sandboxId": None,
                    "size": None,
                    "createdAt": 1700000000000,
                },
            )
        )
        vol = await mgr.create("my-volume")
        assert vol.id == "vol-1"
        assert vol.name == "my-volume"


@pytest.mark.asyncio
async def test_volume_list(client):
    mgr = VolumeManager(client)
    with respx.mock:
        respx.get(f"{BASE_URL}/sandbox/volumes").mock(
            return_value=httpx.Response(
                200,
                json={
                    "volumes": [
                        {
                            "id": "vol-1",
                            "name": "my-volume",
                            "dockerVolumeName": "iii-vol-1",
                            "mountPath": "/data",
                            "sandboxId": "sbx-1",
                            "size": "100MB",
                            "createdAt": 1700000000000,
                        }
                    ]
                },
            )
        )
        result = await mgr.list()
        assert len(result["volumes"]) == 1


@pytest.mark.asyncio
async def test_volume_delete(client):
    mgr = VolumeManager(client)
    with respx.mock:
        respx.delete(
            f"{BASE_URL}/sandbox/volumes/vol-1"
        ).mock(
            return_value=httpx.Response(
                200, json={"deleted": "vol-1"}
            )
        )
        result = await mgr.delete("vol-1")
        assert result["deleted"] == "vol-1"


@pytest.mark.asyncio
async def test_volume_attach(client):
    mgr = VolumeManager(client)
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/volumes/vol-1/attach"
        ).mock(
            return_value=httpx.Response(
                200,
                json={"attached": True, "mountPath": "/data"},
            )
        )
        result = await mgr.attach("vol-1", "sbx-1", "/data")
        assert result["attached"] is True
        assert result["mountPath"] == "/data"


@pytest.mark.asyncio
async def test_volume_detach(client):
    mgr = VolumeManager(client)
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/volumes/vol-1/detach"
        ).mock(
            return_value=httpx.Response(
                200, json={"detached": True}
            )
        )
        result = await mgr.detach("vol-1")
        assert result["detached"] is True


@pytest.mark.asyncio
async def test_network_create_with_driver(client):
    mgr = NetworkManager(client)
    with respx.mock:
        import json

        route = respx.post(f"{BASE_URL}/sandbox/networks").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "net-2",
                    "name": "bridged-net",
                    "dockerNetworkId": "docker-net-xyz",
                    "sandboxes": [],
                    "createdAt": 1700000000000,
                },
            )
        )
        network = await mgr.create("bridged-net", driver="bridge")
        assert network.id == "net-2"
        body = json.loads(route.calls[0].request.content)
        assert body["driver"] == "bridge"


@pytest.mark.asyncio
async def test_volume_create_with_driver(client):
    mgr = VolumeManager(client)
    with respx.mock:
        import json

        route = respx.post(f"{BASE_URL}/sandbox/volumes").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "vol-2",
                    "name": "local-vol",
                    "dockerVolumeName": "iii-vol-2",
                    "mountPath": None,
                    "sandboxId": None,
                    "size": None,
                    "createdAt": 1700000000000,
                },
            )
        )
        vol = await mgr.create("local-vol", driver="local")
        assert vol.id == "vol-2"
        body = json.loads(route.calls[0].request.content)
        assert body["driver"] == "local"


@pytest.mark.asyncio
async def test_event_history_no_filters(client):
    mgr = EventManager(client)
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/events/history"
        ).mock(
            return_value=httpx.Response(
                200,
                json={"events": [], "total": 0},
            )
        )
        result = await mgr.history()
        assert result["total"] == 0
        assert result["events"] == []


@pytest.mark.asyncio
async def test_observability_traces_no_filters(client):
    obs = ObservabilityClient(client)
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/observability/traces"
        ).mock(
            return_value=httpx.Response(
                200, json={"traces": [], "total": 0}
            )
        )
        result = await obs.traces()
        assert result["total"] == 0
        assert result["traces"] == []


@pytest.mark.asyncio
async def test_event_history_with_offset(client):
    mgr = EventManager(client)
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/events/history",
            params={"offset": "10", "limit": "5"},
        ).mock(
            return_value=httpx.Response(
                200, json={"events": [], "total": 0}
            )
        )
        result = await mgr.history(offset=10, limit=5)
        assert result["total"] == 0


@pytest.mark.asyncio
async def test_observability_traces_with_function_id(client):
    obs = ObservabilityClient(client)
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/observability/traces",
            params={"functionId": "sandbox:exec"},
        ).mock(
            return_value=httpx.Response(
                200, json={"traces": [], "total": 0}
            )
        )
        result = await obs.traces(function_id="sandbox:exec")
        assert result["total"] == 0
