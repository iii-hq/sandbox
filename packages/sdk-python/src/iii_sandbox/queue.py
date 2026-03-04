from __future__ import annotations

from .client import HttpClient
from .types import QueueJobInfo


class QueueManager:
    def __init__(self, client: HttpClient, sandbox_id: str):
        self._client = client
        self._sandbox_id = sandbox_id

    async def submit(
        self,
        command: str,
        max_retries: int | None = None,
        timeout: int | None = None,
    ) -> QueueJobInfo:
        body: dict = {"command": command}
        if max_retries is not None:
            body["maxRetries"] = max_retries
        if timeout is not None:
            body["timeout"] = timeout
        data = await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/exec/queue", body
        )
        return QueueJobInfo(**data)

    async def status(self, job_id: str) -> QueueJobInfo:
        data = await self._client.get(f"/sandbox/queue/{job_id}/status")
        return QueueJobInfo(**data)

    async def cancel(self, job_id: str) -> dict:
        return await self._client.post(f"/sandbox/queue/{job_id}/cancel")

    async def dlq(self, limit: int | None = None) -> dict:
        qs = f"?limit={limit}" if limit is not None else ""
        return await self._client.get(f"/sandbox/queue/dlq{qs}")
