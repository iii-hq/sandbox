from __future__ import annotations

import json
from typing import AsyncGenerator

from .client import HttpClient
from .types import LogEvent, SandboxMetrics


class StreamManager:
    def __init__(self, client: HttpClient, sandbox_id: str):
        self._client = client
        self._sandbox_id = sandbox_id

    async def logs(
        self,
        tail: int | None = None,
        follow: bool | None = None,
    ) -> AsyncGenerator[LogEvent, None]:
        params: list[str] = []
        if tail is not None:
            params.append(f"tail={tail}")
        if follow is not None:
            params.append(f"follow={str(follow).lower()}")
        qs = f"?{'&'.join(params)}" if params else ""
        path = f"/sandbox/sandboxes/{self._sandbox_id}/stream/logs{qs}"
        async for line in self._client.stream_get(path):
            try:
                event = LogEvent(**json.loads(line))
                yield event
                if event.type == "end":
                    return
            except (json.JSONDecodeError, ValueError, TypeError, KeyError):
                continue

    async def metrics(
        self, interval: int | None = None
    ) -> AsyncGenerator[SandboxMetrics, None]:
        params: list[str] = []
        if interval is not None:
            params.append(f"interval={interval}")
        qs = f"?{'&'.join(params)}" if params else ""
        path = f"/sandbox/sandboxes/{self._sandbox_id}/stream/metrics{qs}"
        async for line in self._client.stream_get(path):
            try:
                yield SandboxMetrics(**json.loads(line))
            except (json.JSONDecodeError, ValueError, TypeError, KeyError):
                continue
