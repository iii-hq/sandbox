from __future__ import annotations

from urllib.parse import urlencode

from .client import HttpClient
from .types import SandboxEvent


class EventManager:
    def __init__(self, client: HttpClient):
        self._client = client

    async def history(
        self,
        sandbox_id: str | None = None,
        topic: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> dict:
        params: dict[str, str] = {}
        if sandbox_id is not None:
            params["sandboxId"] = sandbox_id
        if topic is not None:
            params["topic"] = topic
        if limit is not None:
            params["limit"] = str(limit)
        if offset is not None:
            params["offset"] = str(offset)
        qs = f"?{urlencode(params)}" if params else ""
        return await self._client.get(f"/sandbox/events/history{qs}")

    async def publish(
        self,
        topic: str,
        sandbox_id: str,
        data: dict | None = None,
    ) -> SandboxEvent:
        body: dict = {"topic": topic, "sandboxId": sandbox_id}
        if data is not None:
            body["data"] = data
        result = await self._client.post("/sandbox/events/publish", body)
        return SandboxEvent(**result)
