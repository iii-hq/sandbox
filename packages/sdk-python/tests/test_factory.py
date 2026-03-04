import httpx
import pytest
import respx

import iii_sandbox

BASE_URL = "http://localhost:3111"


@pytest.mark.asyncio
async def test_create_sandbox():
    with respx.mock:
        respx.post(f"{BASE_URL}/sandbox/sandboxes").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "sbx-new-1",
                    "name": "my-sandbox",
                    "image": "python:3.12-slim",
                    "status": "creating",
                    "createdAt": 1700000000000,
                    "expiresAt": 1700003600000,
                },
            )
        )
        sandbox = await iii_sandbox.create_sandbox(
            name="my-sandbox"
        )
        assert sandbox.id == "sbx-new-1"
        assert sandbox.info.name == "my-sandbox"
        assert sandbox.info.image == "python:3.12-slim"


@pytest.mark.asyncio
async def test_create_sandbox_custom_image():
    with respx.mock:
        respx.post(f"{BASE_URL}/sandbox/sandboxes").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "sbx-new-2",
                    "name": "node-sandbox",
                    "image": "node:20-slim",
                    "status": "creating",
                    "createdAt": 1700000000000,
                    "expiresAt": 1700003600000,
                },
            )
        )
        sandbox = await iii_sandbox.create_sandbox(
            image="node:20-slim", name="node-sandbox"
        )
        assert sandbox.info.image == "node:20-slim"


@pytest.mark.asyncio
async def test_create_sandbox_with_all_options():
    with respx.mock:
        respx.post(f"{BASE_URL}/sandbox/sandboxes").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "sbx-full",
                    "name": "full-sandbox",
                    "image": "python:3.12-slim",
                    "status": "creating",
                    "createdAt": 1700000000000,
                    "expiresAt": 1700003600000,
                },
            )
        )
        sandbox = await iii_sandbox.create_sandbox(
            image="python:3.12-slim",
            name="full-sandbox",
            timeout=60000,
            memory=512,
            cpu=2,
            network=True,
            env={"KEY": "value"},
            workdir="/app",
        )
        assert sandbox.id == "sbx-full"


@pytest.mark.asyncio
async def test_list_sandboxes():
    with respx.mock:
        respx.get(f"{BASE_URL}/sandbox/sandboxes").mock(
            return_value=httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": "sbx-1",
                            "name": "sandbox-1",
                            "image": "python:3.12-slim",
                            "status": "running",
                            "createdAt": 1700000000000,
                            "expiresAt": 1700003600000,
                        },
                        {
                            "id": "sbx-2",
                            "name": "sandbox-2",
                            "image": "node:20-slim",
                            "status": "paused",
                            "createdAt": 1700000010000,
                            "expiresAt": 1700003610000,
                        },
                    ]
                },
            )
        )
        sandboxes = await iii_sandbox.list_sandboxes()
        assert len(sandboxes) == 2
        assert sandboxes[0].id == "sbx-1"
        assert sandboxes[1].status == "paused"


@pytest.mark.asyncio
async def test_list_sandboxes_empty():
    with respx.mock:
        respx.get(f"{BASE_URL}/sandbox/sandboxes").mock(
            return_value=httpx.Response(
                200, json={"items": []}
            )
        )
        sandboxes = await iii_sandbox.list_sandboxes()
        assert sandboxes == []


@pytest.mark.asyncio
async def test_get_sandbox():
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/sbx-existing"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "sbx-existing",
                    "name": "existing-sandbox",
                    "image": "python:3.12-slim",
                    "status": "running",
                    "createdAt": 1700000000000,
                    "expiresAt": 1700003600000,
                },
            )
        )
        sandbox = await iii_sandbox.get_sandbox("sbx-existing")
        assert sandbox.id == "sbx-existing"
        assert sandbox.status == "running"


@pytest.mark.asyncio
async def test_list_templates():
    with respx.mock:
        respx.get(f"{BASE_URL}/sandbox/templates").mock(
            return_value=httpx.Response(
                200,
                json={
                    "templates": [
                        {
                            "id": "tpl-python",
                            "name": "Python",
                            "description": "Python 3.12 environment",
                            "config": {
                                "image": "python:3.12-slim"
                            },
                            "builtin": True,
                            "createdAt": 1700000000000,
                        },
                        {
                            "id": "tpl-node",
                            "name": "Node.js",
                            "description": "Node.js 20 environment",
                            "config": {"image": "node:20-slim"},
                            "builtin": True,
                            "createdAt": 1700000000000,
                        },
                    ]
                },
            )
        )
        templates = await iii_sandbox.list_templates()
        assert len(templates) == 2
        assert templates[0].id == "tpl-python"
        assert templates[1].name == "Node.js"
        assert templates[0].builtin is True


@pytest.mark.asyncio
async def test_create_sandbox_with_token():
    with respx.mock:
        route = respx.post(f"{BASE_URL}/sandbox/sandboxes").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "sbx-auth",
                    "name": "auth-sandbox",
                    "image": "python:3.12-slim",
                    "status": "creating",
                    "createdAt": 1700000000000,
                    "expiresAt": 1700003600000,
                },
            )
        )
        sandbox = await iii_sandbox.create_sandbox(
            token="my-secret-token"
        )
        assert sandbox.id == "sbx-auth"
        assert (
            route.calls[0].request.headers["authorization"]
            == "Bearer my-secret-token"
        )


@pytest.mark.asyncio
async def test_create_sandbox_with_template():
    with respx.mock:
        import json

        route = respx.post(f"{BASE_URL}/sandbox/sandboxes").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "sbx-tpl-1",
                    "name": "tpl-sandbox",
                    "image": "node:20-slim",
                    "status": "creating",
                    "createdAt": 1700000000000,
                    "expiresAt": 1700003600000,
                },
            )
        )
        sandbox = await iii_sandbox.create_sandbox(
            template="node-web"
        )
        assert sandbox.id == "sbx-tpl-1"
        body = json.loads(route.calls[0].request.content)
        assert body["template"] == "node-web"


@pytest.mark.asyncio
async def test_create_sandbox_minimal():
    with respx.mock:
        respx.post(f"{BASE_URL}/sandbox/sandboxes").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "sbx-min",
                    "name": "minimal",
                    "image": "python:3.12-slim",
                    "status": "creating",
                    "createdAt": 1700000000000,
                    "expiresAt": 1700003600000,
                },
            )
        )
        sandbox = await iii_sandbox.create_sandbox()
        assert sandbox.id == "sbx-min"
        assert sandbox.info.image == "python:3.12-slim"
