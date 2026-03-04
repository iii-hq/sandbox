from __future__ import annotations

from .client import HttpClient
from .types import ResourceAlert


class MonitorManager:
    def __init__(self, client: HttpClient, sandbox_id: str):
        self._client = client
        self._sandbox_id = sandbox_id

    async def set_alert(
        self,
        metric: str,
        threshold: float,
        action: str | None = None,
    ) -> ResourceAlert:
        body: dict = {"metric": metric, "threshold": threshold}
        if action is not None:
            body["action"] = action
        data = await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/alerts", body
        )
        return ResourceAlert(**data)

    async def list_alerts(self) -> dict:
        return await self._client.get(
            f"/sandbox/sandboxes/{self._sandbox_id}/alerts"
        )

    async def delete_alert(self, alert_id: str) -> dict:
        return await self._client.delete(f"/sandbox/alerts/{alert_id}")

    async def history(self, limit: int | None = None) -> dict:
        qs = f"?limit={limit}" if limit is not None else ""
        return await self._client.get(
            f"/sandbox/sandboxes/{self._sandbox_id}/alerts/history{qs}"
        )
