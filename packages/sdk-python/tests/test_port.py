import httpx
import pytest
import respx

from iii_sandbox.client import HttpClient
from iii_sandbox.port import PortManager
from iii_sandbox.types import ClientConfig

BASE_URL = "http://localhost:3111"
SANDBOX_ID = "sbx-test-1234"


@pytest.fixture
def port_mgr():
    client = HttpClient(ClientConfig(base_url=BASE_URL))
    return PortManager(client, SANDBOX_ID)


@pytest.mark.asyncio
async def test_expose(port_mgr):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/ports"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "containerPort": 8080,
                    "hostPort": 9090,
                    "protocol": "tcp",
                    "state": "mapped",
                },
            )
        )
        result = await port_mgr.expose(8080, host_port=9090)
        assert result.containerPort == 8080
        assert result.hostPort == 9090
        assert result.protocol == "tcp"


@pytest.mark.asyncio
async def test_expose_default(port_mgr):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/ports"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "containerPort": 3000,
                    "hostPort": 32768,
                    "protocol": "tcp",
                    "state": "mapped",
                },
            )
        )
        result = await port_mgr.expose(3000)
        assert result.containerPort == 3000
        assert result.hostPort == 32768


@pytest.mark.asyncio
async def test_list(port_mgr):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/ports"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "ports": [
                        {
                            "containerPort": 8080,
                            "hostPort": 9090,
                            "protocol": "tcp",
                            "state": "active",
                        }
                    ]
                },
            )
        )
        result = await port_mgr.list()
        assert len(result["ports"]) == 1
        assert result["ports"][0]["containerPort"] == 8080


@pytest.mark.asyncio
async def test_unexpose(port_mgr):
    with respx.mock:
        respx.delete(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/ports",
            params={"containerPort": "8080"},
        ).mock(
            return_value=httpx.Response(
                200, json={"removed": 8080}
            )
        )
        result = await port_mgr.unexpose(8080)
        assert result["removed"] == 8080


@pytest.mark.asyncio
async def test_expose_with_protocol(port_mgr):
    with respx.mock:
        import json

        route = respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/ports"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "containerPort": 53,
                    "hostPort": 32800,
                    "protocol": "udp",
                    "state": "mapped",
                },
            )
        )
        result = await port_mgr.expose(53, protocol="udp")
        assert result.containerPort == 53
        assert result.protocol == "udp"
        body = json.loads(route.calls[0].request.content)
        assert body["protocol"] == "udp"
