from __future__ import annotations

from .client import HttpClient
from .types import PortMapping


class PortManager:
    def __init__(self, client: HttpClient, sandbox_id: str):
        self._client = client
        self._sandbox_id = sandbox_id

    async def expose(
        self,
        container_port: int,
        host_port: int | None = None,
        protocol: str | None = None,
    ) -> PortMapping:
        body: dict = {"containerPort": container_port}
        if host_port is not None:
            body["hostPort"] = host_port
        if protocol is not None:
            body["protocol"] = protocol
        data = await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/ports", body
        )
        return PortMapping(**data)

    async def list(self) -> dict:
        return await self._client.get(
            f"/sandbox/sandboxes/{self._sandbox_id}/ports"
        )

    async def unexpose(self, container_port: int) -> dict:
        return await self._client.delete(
            f"/sandbox/sandboxes/{self._sandbox_id}/ports?containerPort={container_port}"
        )
