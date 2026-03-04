from __future__ import annotations

from .client import HttpClient
from .types import SandboxNetwork


class NetworkManager:
    def __init__(self, client: HttpClient):
        self._client = client

    async def create(
        self, name: str, driver: str | None = None
    ) -> SandboxNetwork:
        body: dict = {"name": name}
        if driver is not None:
            body["driver"] = driver
        data = await self._client.post("/sandbox/networks", body)
        return SandboxNetwork(**data)

    async def list(self) -> dict:
        return await self._client.get("/sandbox/networks")

    async def connect(
        self, network_id: str, sandbox_id: str
    ) -> dict:
        return await self._client.post(
            f"/sandbox/networks/{network_id}/connect",
            {"sandboxId": sandbox_id},
        )

    async def disconnect(
        self, network_id: str, sandbox_id: str
    ) -> dict:
        return await self._client.post(
            f"/sandbox/networks/{network_id}/disconnect",
            {"sandboxId": sandbox_id},
        )

    async def delete(self, network_id: str) -> dict:
        return await self._client.delete(
            f"/sandbox/networks/{network_id}"
        )
