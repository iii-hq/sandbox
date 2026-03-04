import httpx
import pytest
import respx

from iii_sandbox.client import HttpClient
from iii_sandbox.interpreter import CodeInterpreter
from iii_sandbox.types import ClientConfig

BASE_URL = "http://localhost:3111"
SANDBOX_ID = "sbx-test-1234"


@pytest.fixture
def interp():
    client = HttpClient(ClientConfig(base_url=BASE_URL))
    return CodeInterpreter(client, SANDBOX_ID)


@pytest.mark.asyncio
async def test_run_python(interp):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/interpret/execute"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "output": "42\n",
                    "error": None,
                    "executionTime": 0.01,
                    "mimeType": "text/plain",
                },
            )
        )
        result = await interp.run("print(42)")
        assert result.output == "42\n"
        assert result.error is None
        assert result.executionTime == 0.01


@pytest.mark.asyncio
async def test_run_javascript(interp):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/interpret/execute"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "output": "hello\n",
                    "error": None,
                    "executionTime": 0.02,
                    "mimeType": None,
                },
            )
        )
        result = await interp.run(
            "console.log('hello')", language="javascript"
        )
        assert result.output == "hello\n"


@pytest.mark.asyncio
async def test_run_with_error(interp):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/interpret/execute"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "output": "",
                    "error": "NameError: name 'x' is not defined",
                    "executionTime": 0.005,
                    "mimeType": None,
                },
            )
        )
        result = await interp.run("print(x)")
        assert result.error is not None
        assert "NameError" in result.error


@pytest.mark.asyncio
async def test_install_pip(interp):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/interpret/install"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "output": "Successfully installed requests-2.31.0"
                },
            )
        )
        output = await interp.install(["requests"])
        assert "Successfully installed" in output


@pytest.mark.asyncio
async def test_install_npm(interp):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/interpret/install"
        ).mock(
            return_value=httpx.Response(
                200,
                json={"output": "added 1 package"},
            )
        )
        output = await interp.install(
            ["express"], manager="npm"
        )
        assert "added" in output


@pytest.mark.asyncio
async def test_kernels(interp):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/interpret/kernels"
        ).mock(
            return_value=httpx.Response(
                200,
                json=[
                    {
                        "name": "python3",
                        "language": "python",
                        "displayName": "Python 3",
                    },
                    {
                        "name": "node",
                        "language": "javascript",
                        "displayName": "Node.js",
                    },
                ],
            )
        )
        kernels = await interp.kernels()
        assert len(kernels) == 2
        assert kernels[0].name == "python3"
        assert kernels[1].language == "javascript"
