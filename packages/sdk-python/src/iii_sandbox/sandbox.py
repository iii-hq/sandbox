from __future__ import annotations

import json
import time
from typing import AsyncGenerator

from .client import HttpClient
from .env import EnvManager
from .filesystem import FileSystem
from .git import GitManager
from .interpreter import CodeInterpreter
from .monitor import MonitorManager
from .port import PortManager
from .process import ProcessManager
from .queue import QueueManager
from .stream import StreamManager
from .types import (
    ExecResult,
    ExecStreamChunk,
    SandboxInfo,
    SandboxMetrics,
    SnapshotInfo,
)


class Sandbox:
    def __init__(self, client: HttpClient, info: SandboxInfo):
        self._client = client
        self.info = info
        self.env = EnvManager(client, info.id)
        self.filesystem = FileSystem(client, info.id)
        self.git = GitManager(client, info.id)
        self.interpreter = CodeInterpreter(client, info.id)
        self.processes = ProcessManager(client, info.id)
        self.ports = PortManager(client, info.id)
        self.queue = QueueManager(client, info.id)
        self.streams = StreamManager(client, info.id)
        self.monitor = MonitorManager(client, info.id)

    @property
    def id(self) -> str:
        return self.info.id

    @property
    def status(self) -> str:
        return self.info.status

    async def exec(
        self, command: str, timeout: int | None = None
    ) -> ExecResult:
        body: dict = {"command": command}
        if timeout is not None:
            body["timeout"] = timeout
        data = await self._client.post(
            f"/sandbox/sandboxes/{self.info.id}/exec", body
        )
        return ExecResult(**data)

    async def exec_stream(
        self, command: str
    ) -> AsyncGenerator[ExecStreamChunk, None]:
        lines = self._client.stream(
            f"/sandbox/sandboxes/{self.info.id}/exec/stream",
            {"command": command},
        )
        async for line in lines:
            try:
                chunk = ExecStreamChunk(**json.loads(line))
                yield chunk
                if chunk.type == "exit":
                    return
            except (json.JSONDecodeError, ValueError, TypeError, KeyError):
                yield ExecStreamChunk(
                    type="stdout",
                    data=line,
                    timestamp=int(time.time() * 1000),
                )

    async def clone(self, name: str | None = None) -> SandboxInfo:
        body: dict = {}
        if name is not None:
            body["name"] = name
        data = await self._client.post(
            f"/sandbox/sandboxes/{self.info.id}/clone", body
        )
        return SandboxInfo(**data)

    async def pause(self) -> None:
        await self._client.post(
            f"/sandbox/sandboxes/{self.info.id}/pause"
        )

    async def resume(self) -> None:
        await self._client.post(
            f"/sandbox/sandboxes/{self.info.id}/resume"
        )

    async def kill(self) -> None:
        await self._client.delete(
            f"/sandbox/sandboxes/{self.info.id}"
        )

    async def metrics(self) -> SandboxMetrics:
        data = await self._client.get(
            f"/sandbox/sandboxes/{self.info.id}/metrics"
        )
        return SandboxMetrics(**data)

    async def snapshot(self, name: str | None = None) -> SnapshotInfo:
        body: dict = {}
        if name is not None:
            body["name"] = name
        data = await self._client.post(
            f"/sandbox/sandboxes/{self.info.id}/snapshots", body
        )
        return SnapshotInfo(**data)

    async def restore(self, snapshot_id: str) -> SandboxInfo:
        data = await self._client.post(
            f"/sandbox/sandboxes/{self.info.id}/snapshots/restore",
            {"snapshotId": snapshot_id},
        )
        return SandboxInfo(**data)

    async def list_snapshots(self) -> dict:
        return await self._client.get(
            f"/sandbox/sandboxes/{self.info.id}/snapshots"
        )

    async def refresh(self) -> SandboxInfo:
        data = await self._client.get(
            f"/sandbox/sandboxes/{self.info.id}"
        )
        updated = SandboxInfo(**data)
        self.info = updated
        return updated
