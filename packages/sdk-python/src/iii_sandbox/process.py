from __future__ import annotations

from .client import HttpClient
from .types import ProcessInfo, ProcessTopInfo


class ProcessManager:
    def __init__(self, client: HttpClient, sandbox_id: str):
        self._client = client
        self._sandbox_id = sandbox_id

    async def list(self) -> dict:
        return await self._client.get(
            f"/sandbox/sandboxes/{self._sandbox_id}/processes"
        )

    async def kill(
        self, pid: int, signal: str | None = None
    ) -> dict:
        body: dict = {"pid": pid}
        if signal is not None:
            body["signal"] = signal
        return await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/processes/kill", body
        )

    async def top(self) -> dict:
        return await self._client.get(
            f"/sandbox/sandboxes/{self._sandbox_id}/processes/top"
        )
