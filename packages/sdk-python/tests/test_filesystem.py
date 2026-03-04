import httpx
import pytest
import respx

from iii_sandbox.client import HttpClient
from iii_sandbox.filesystem import FileSystem
from iii_sandbox.types import ClientConfig

BASE_URL = "http://localhost:3111"
SANDBOX_ID = "sbx-test-1234"


@pytest.fixture
def fs():
    client = HttpClient(ClientConfig(base_url=BASE_URL))
    return FileSystem(client, SANDBOX_ID)


@pytest.mark.asyncio
async def test_read(fs):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/files/read"
        ).mock(
            return_value=httpx.Response(
                200, json="print('hello world')"
            )
        )
        content = await fs.read("/workspace/main.py")
        assert content == "print('hello world')"


@pytest.mark.asyncio
async def test_write(fs):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/files/write"
        ).mock(
            return_value=httpx.Response(200, json={"written": True})
        )
        await fs.write("/workspace/main.py", "print('hello')")


@pytest.mark.asyncio
async def test_delete(fs):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/files/delete"
        ).mock(
            return_value=httpx.Response(200, json={"deleted": True})
        )
        await fs.delete("/workspace/main.py")


@pytest.mark.asyncio
async def test_list(fs):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/files/list"
        ).mock(
            return_value=httpx.Response(
                200,
                json=[
                    {
                        "name": "main.py",
                        "path": "/workspace/main.py",
                        "size": 100,
                        "isDirectory": False,
                        "modifiedAt": 1700000000000,
                    },
                    {
                        "name": "src",
                        "path": "/workspace/src",
                        "size": 0,
                        "isDirectory": True,
                        "modifiedAt": 1700000000000,
                    },
                ],
            )
        )
        files = await fs.list("/workspace")
        assert len(files) == 2
        assert files[0].name == "main.py"
        assert files[0].isDirectory is False
        assert files[1].name == "src"
        assert files[1].isDirectory is True


@pytest.mark.asyncio
async def test_list_default_path(fs):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/files/list"
        ).mock(
            return_value=httpx.Response(200, json=[])
        )
        files = await fs.list()
        assert files == []


@pytest.mark.asyncio
async def test_search(fs):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/files/search"
        ).mock(
            return_value=httpx.Response(
                200,
                json=[
                    "/workspace/main.py",
                    "/workspace/utils.py",
                ],
            )
        )
        results = await fs.search("*.py")
        assert len(results) == 2
        assert "/workspace/main.py" in results


@pytest.mark.asyncio
async def test_upload(fs):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/files/upload"
        ).mock(
            return_value=httpx.Response(
                200, json={"uploaded": True}
            )
        )
        await fs.upload("/workspace/data.txt", "file content here")


@pytest.mark.asyncio
async def test_download(fs):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/files/download"
        ).mock(
            return_value=httpx.Response(
                200, json="downloaded content"
            )
        )
        content = await fs.download("/workspace/data.txt")
        assert content == "downloaded content"
