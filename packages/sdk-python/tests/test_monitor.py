import httpx
import pytest
import respx

from iii_sandbox.client import HttpClient
from iii_sandbox.monitor import MonitorManager
from iii_sandbox.types import ClientConfig

BASE_URL = "http://localhost:3111"
SANDBOX_ID = "sbx-test-1234"


@pytest.fixture
def monitor():
    client = HttpClient(ClientConfig(base_url=BASE_URL))
    return MonitorManager(client, SANDBOX_ID)


@pytest.mark.asyncio
async def test_set_alert(monitor):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/alerts"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "alert-1",
                    "sandboxId": SANDBOX_ID,
                    "metric": "cpu",
                    "threshold": 80.0,
                    "action": "notify",
                    "triggered": False,
                    "lastChecked": None,
                    "lastTriggered": None,
                    "createdAt": 1700000000000,
                },
            )
        )
        alert = await monitor.set_alert("cpu", 80.0, action="notify")
        assert alert.id == "alert-1"
        assert alert.metric == "cpu"
        assert alert.threshold == 80.0
        assert alert.triggered is False


@pytest.mark.asyncio
async def test_set_alert_default_action(monitor):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/alerts"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "alert-2",
                    "sandboxId": SANDBOX_ID,
                    "metric": "memory",
                    "threshold": 90.0,
                    "action": "kill",
                    "triggered": False,
                    "lastChecked": None,
                    "lastTriggered": None,
                    "createdAt": 1700000000000,
                },
            )
        )
        alert = await monitor.set_alert("memory", 90.0)
        assert alert.metric == "memory"


@pytest.mark.asyncio
async def test_list_alerts(monitor):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/alerts"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "alerts": [
                        {
                            "id": "alert-1",
                            "sandboxId": SANDBOX_ID,
                            "metric": "cpu",
                            "threshold": 80.0,
                            "action": "notify",
                            "triggered": False,
                            "lastChecked": None,
                            "lastTriggered": None,
                            "createdAt": 1700000000000,
                        }
                    ]
                },
            )
        )
        result = await monitor.list_alerts()
        assert len(result["alerts"]) == 1
        assert result["alerts"][0]["id"] == "alert-1"


@pytest.mark.asyncio
async def test_delete_alert(monitor):
    with respx.mock:
        respx.delete(
            f"{BASE_URL}/sandbox/alerts/alert-1"
        ).mock(
            return_value=httpx.Response(
                200, json={"deleted": "alert-1"}
            )
        )
        result = await monitor.delete_alert("alert-1")
        assert result["deleted"] == "alert-1"


@pytest.mark.asyncio
async def test_history(monitor):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/alerts/history"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "events": [
                        {
                            "alertId": "alert-1",
                            "sandboxId": SANDBOX_ID,
                            "metric": "cpu",
                            "value": 95.0,
                            "threshold": 80.0,
                            "action": "notify",
                            "timestamp": 1700000050000,
                        }
                    ],
                    "total": 1,
                },
            )
        )
        result = await monitor.history()
        assert result["total"] == 1
        assert result["events"][0]["value"] == 95.0


@pytest.mark.asyncio
async def test_history_with_limit(monitor):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/alerts/history",
            params={"limit": "10"},
        ).mock(
            return_value=httpx.Response(
                200, json={"events": [], "total": 0}
            )
        )
        result = await monitor.history(limit=10)
        assert result["total"] == 0
