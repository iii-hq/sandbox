from __future__ import annotations

from typing import AsyncIterator

import httpx

from .types import ClientConfig

DEFAULT_TIMEOUT_MS = 30_000


class HttpClient:
    def __init__(self, config: ClientConfig):
        self.base_url = config.base_url.rstrip("/")
        self._token = config.token
        self.timeout = config.timeout_ms / 1000
        self._client = httpx.AsyncClient(timeout=self.timeout)

    async def __aenter__(self) -> HttpClient:
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self._token:
            h["Authorization"] = f"Bearer {self._token}"
        return h

    async def get(self, path: str) -> dict:
        r = await self._client.get(
            f"{self.base_url}{path}", headers=self._headers()
        )
        r.raise_for_status()
        return r.json()

    async def post(self, path: str, body: dict | None = None) -> dict:
        r = await self._client.post(
            f"{self.base_url}{path}",
            headers=self._headers(),
            json=body,
        )
        r.raise_for_status()
        return r.json()

    async def delete(self, path: str) -> dict:
        r = await self._client.delete(
            f"{self.base_url}{path}", headers=self._headers()
        )
        r.raise_for_status()
        return r.json()

    async def stream(
        self, path: str, body: dict | None = None
    ) -> AsyncIterator[str]:
        headers = {**self._headers(), "Accept": "text/event-stream"}
        async with self._client.stream(
            "POST",
            f"{self.base_url}{path}",
            headers=headers,
            json=body,
        ) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if line.startswith("data: "):
                    yield line[6:]

    async def stream_get(self, path: str) -> AsyncIterator[str]:
        headers = {**self._headers(), "Accept": "text/event-stream"}
        async with self._client.stream(
            "GET",
            f"{self.base_url}{path}",
            headers=headers,
        ) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if line.startswith("data: "):
                    yield line[6:]

    async def close(self):
        await self._client.aclose()
