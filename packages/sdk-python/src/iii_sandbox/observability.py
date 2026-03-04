from __future__ import annotations

from urllib.parse import urlencode

from .client import HttpClient
from .types import ObservabilityMetrics


class ObservabilityClient:
    def __init__(self, client: HttpClient):
        self._client = client

    async def traces(
        self,
        sandbox_id: str | None = None,
        function_id: str | None = None,
        limit: int | None = None,
    ) -> dict:
        params: dict[str, str] = {}
        if sandbox_id is not None:
            params["sandboxId"] = sandbox_id
        if function_id is not None:
            params["functionId"] = function_id
        if limit is not None:
            params["limit"] = str(limit)
        qs = f"?{urlencode(params)}" if params else ""
        return await self._client.get(
            f"/sandbox/observability/traces{qs}"
        )

    async def metrics(self) -> ObservabilityMetrics:
        data = await self._client.get("/sandbox/observability/metrics")
        return ObservabilityMetrics(**data)

    async def clear(self, before: int | None = None) -> dict:
        body: dict = {}
        if before is not None:
            body["before"] = before
        return await self._client.post(
            "/sandbox/observability/clear", body
        )
