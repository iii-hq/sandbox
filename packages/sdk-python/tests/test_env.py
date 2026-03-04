import httpx
import pytest
import respx

from iii_sandbox.client import HttpClient
from iii_sandbox.env import EnvManager
from iii_sandbox.types import ClientConfig

BASE_URL = "http://localhost:3111"
SANDBOX_ID = "sbx-test-1234"


@pytest.fixture
def env_mgr():
    client = HttpClient(ClientConfig(base_url=BASE_URL))
    return EnvManager(client, SANDBOX_ID)


@pytest.mark.asyncio
async def test_get(env_mgr):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/env/get"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "key": "DATABASE_URL",
                    "value": "postgres://localhost/db",
                    "exists": True,
                },
            )
        )
        result = await env_mgr.get("DATABASE_URL")
        assert result["key"] == "DATABASE_URL"
        assert result["value"] == "postgres://localhost/db"
        assert result["exists"] is True


@pytest.mark.asyncio
async def test_get_missing(env_mgr):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/env/get"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "key": "MISSING",
                    "value": None,
                    "exists": False,
                },
            )
        )
        result = await env_mgr.get("MISSING")
        assert result["exists"] is False
        assert result["value"] is None


@pytest.mark.asyncio
async def test_set(env_mgr):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/env"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "set": ["API_KEY", "SECRET"],
                    "count": 2,
                },
            )
        )
        result = await env_mgr.set(
            {"API_KEY": "abc123", "SECRET": "xyz789"}
        )
        assert result["count"] == 2
        assert "API_KEY" in result["set"]


@pytest.mark.asyncio
async def test_list(env_mgr):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/env"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "vars": {"PATH": "/usr/bin", "HOME": "/root"},
                    "count": 2,
                },
            )
        )
        result = await env_mgr.list()
        assert result["count"] == 2
        assert result["vars"]["PATH"] == "/usr/bin"


@pytest.mark.asyncio
async def test_delete(env_mgr):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/env/delete"
        ).mock(
            return_value=httpx.Response(
                200, json={"deleted": "API_KEY"}
            )
        )
        result = await env_mgr.delete("API_KEY")
        assert result["deleted"] == "API_KEY"
