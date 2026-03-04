import httpx
import pytest
import respx

from iii_sandbox.client import HttpClient
from iii_sandbox.types import ClientConfig

BASE_URL = "http://localhost:3111"


@pytest.mark.asyncio
async def test_get_request():
    client = HttpClient(ClientConfig(base_url=BASE_URL))
    with respx.mock:
        respx.get(f"{BASE_URL}/sandbox/sandboxes").mock(
            return_value=httpx.Response(200, json={"items": []})
        )
        result = await client.get("/sandbox/sandboxes")
        assert result == {"items": []}


@pytest.mark.asyncio
async def test_post_request():
    client = HttpClient(ClientConfig(base_url=BASE_URL))
    with respx.mock:
        respx.post(f"{BASE_URL}/sandbox/sandboxes").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "sbx-1",
                    "name": "test",
                    "image": "python:3.12-slim",
                    "status": "creating",
                    "createdAt": 1700000000000,
                    "expiresAt": 1700003600000,
                },
            )
        )
        result = await client.post(
            "/sandbox/sandboxes", {"image": "python:3.12-slim"}
        )
        assert result["id"] == "sbx-1"
        assert result["status"] == "creating"


@pytest.mark.asyncio
async def test_delete_request():
    client = HttpClient(ClientConfig(base_url=BASE_URL))
    with respx.mock:
        respx.delete(f"{BASE_URL}/sandbox/sandboxes/sbx-1").mock(
            return_value=httpx.Response(200, json={"deleted": "sbx-1"})
        )
        result = await client.delete("/sandbox/sandboxes/sbx-1")
        assert result == {"deleted": "sbx-1"}


@pytest.mark.asyncio
async def test_get_with_auth_token():
    client = HttpClient(
        ClientConfig(base_url=BASE_URL, token="test-token-123")
    )
    with respx.mock:
        route = respx.get(f"{BASE_URL}/sandbox/sandboxes").mock(
            return_value=httpx.Response(200, json={"items": []})
        )
        await client.get("/sandbox/sandboxes")
        assert (
            route.calls[0].request.headers["authorization"]
            == "Bearer test-token-123"
        )


@pytest.mark.asyncio
async def test_get_raises_on_error():
    client = HttpClient(ClientConfig(base_url=BASE_URL))
    with respx.mock:
        respx.get(f"{BASE_URL}/sandbox/sandboxes/bad").mock(
            return_value=httpx.Response(404, json={"error": "not found"})
        )
        with pytest.raises(httpx.HTTPStatusError):
            await client.get("/sandbox/sandboxes/bad")


@pytest.mark.asyncio
async def test_post_raises_on_error():
    client = HttpClient(ClientConfig(base_url=BASE_URL))
    with respx.mock:
        respx.post(f"{BASE_URL}/sandbox/sandboxes").mock(
            return_value=httpx.Response(
                500, json={"error": "internal error"}
            )
        )
        with pytest.raises(httpx.HTTPStatusError):
            await client.post("/sandbox/sandboxes", {"image": "bad"})


@pytest.mark.asyncio
async def test_trailing_slash_stripped():
    client = HttpClient(
        ClientConfig(base_url="http://localhost:3111/")
    )
    assert client.base_url == "http://localhost:3111"


@pytest.mark.asyncio
async def test_close():
    client = HttpClient(ClientConfig(base_url=BASE_URL))
    await client.close()


@pytest.mark.asyncio
async def test_context_manager():
    async with HttpClient(ClientConfig(base_url=BASE_URL)) as client:
        with respx.mock:
            respx.get(f"{BASE_URL}/sandbox/sandboxes").mock(
                return_value=httpx.Response(200, json={"items": []})
            )
            result = await client.get("/sandbox/sandboxes")
            assert result == {"items": []}


@pytest.mark.asyncio
async def test_stream_post():
    client = HttpClient(ClientConfig(base_url=BASE_URL))
    with respx.mock:
        respx.post(f"{BASE_URL}/sandbox/sandboxes/sbx-1/exec/stream").mock(
            return_value=httpx.Response(
                200,
                content=b'data: {"type":"stdout","data":"hello","timestamp":1700000000000}\ndata: {"type":"exit","data":"0","timestamp":1700000001000}\n',
                headers={"content-type": "text/event-stream"},
            )
        )
        chunks = []
        async for chunk in client.stream(
            "/sandbox/sandboxes/sbx-1/exec/stream",
            {"command": "echo hello"},
        ):
            chunks.append(chunk)
        assert len(chunks) == 2
        assert '"stdout"' in chunks[0]


@pytest.mark.asyncio
async def test_stream_get():
    client = HttpClient(ClientConfig(base_url=BASE_URL))
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/sbx-1/stream/logs"
        ).mock(
            return_value=httpx.Response(
                200,
                content=b'data: {"type":"stdout","data":"log line","timestamp":1700000000000}\n',
                headers={"content-type": "text/event-stream"},
            )
        )
        chunks = []
        async for chunk in client.stream_get(
            "/sandbox/sandboxes/sbx-1/stream/logs"
        ):
            chunks.append(chunk)
        assert len(chunks) == 1
