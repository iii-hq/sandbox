from __future__ import annotations

from .client import HttpClient
from .types import VolumeInfo


class VolumeManager:
    def __init__(self, client: HttpClient):
        self._client = client

    async def create(
        self, name: str, driver: str | None = None
    ) -> VolumeInfo:
        body: dict = {"name": name}
        if driver is not None:
            body["driver"] = driver
        data = await self._client.post("/sandbox/volumes", body)
        return VolumeInfo(**data)

    async def list(self) -> dict:
        return await self._client.get("/sandbox/volumes")

    async def delete(self, volume_id: str) -> dict:
        return await self._client.delete(
            f"/sandbox/volumes/{volume_id}"
        )

    async def attach(
        self,
        volume_id: str,
        sandbox_id: str,
        mount_path: str,
    ) -> dict:
        return await self._client.post(
            f"/sandbox/volumes/{volume_id}/attach",
            {"sandboxId": sandbox_id, "mountPath": mount_path},
        )

    async def detach(self, volume_id: str) -> dict:
        return await self._client.post(
            f"/sandbox/volumes/{volume_id}/detach"
        )
