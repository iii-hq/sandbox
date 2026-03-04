from __future__ import annotations

from .client import HttpClient
from .types import FileInfo


class FileSystem:
    def __init__(self, client: HttpClient, sandbox_id: str):
        self._client = client
        self._sandbox_id = sandbox_id

    async def read(self, path: str) -> str:
        return await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/files/read", {"path": path}
        )

    async def write(self, path: str, content: str) -> None:
        await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/files/write",
            {"path": path, "content": content},
        )

    async def delete(self, path: str) -> None:
        await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/files/delete", {"path": path}
        )

    async def list(self, path: str = "/workspace") -> list[FileInfo]:
        data = await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/files/list", {"path": path}
        )
        return [FileInfo(**f) for f in data]

    async def search(
        self, pattern: str, dir: str = "/workspace"
    ) -> list[str]:
        return await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/files/search",
            {"pattern": pattern, "dir": dir},
        )

    async def upload(self, path: str, content: str) -> None:
        await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/files/upload",
            {"path": path, "content": content},
        )

    async def download(self, path: str) -> str:
        return await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/files/download",
            {"path": path},
        )
