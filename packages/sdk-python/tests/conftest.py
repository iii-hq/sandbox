import pytest

from iii_sandbox.client import HttpClient
from iii_sandbox.types import ClientConfig, SandboxInfo

BASE_URL = "http://localhost:3111"
SANDBOX_ID = "sbx-test-1234"


@pytest.fixture
def base_url():
    return BASE_URL


@pytest.fixture
def sandbox_id():
    return SANDBOX_ID


@pytest.fixture
def client():
    return HttpClient(ClientConfig(base_url=BASE_URL))


@pytest.fixture
def sandbox_info():
    return SandboxInfo(
        id=SANDBOX_ID,
        name="test-sandbox",
        image="python:3.12-slim",
        status="running",
        createdAt=1700000000000,
        expiresAt=1700003600000,
    )
