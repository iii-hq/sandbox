from __future__ import annotations

from .client import HttpClient


class EnvManager:
    def __init__(self, client: HttpClient, sandbox_id: str):
        self._client = client
        self._sandbox_id = sandbox_id

    async def get(self, key: str) -> dict:
        return await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/env/get", {"key": key}
        )

    async def set(self, vars: dict[str, str]) -> dict:
        return await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/env", {"vars": vars}
        )

    async def list(self) -> dict:
        return await self._client.get(
            f"/sandbox/sandboxes/{self._sandbox_id}/env"
        )

    async def delete(self, key: str) -> dict:
        return await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/env/delete", {"key": key}
        )
