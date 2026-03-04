from __future__ import annotations

from .client import HttpClient
from .types import CodeResult, KernelSpec


class CodeInterpreter:
    def __init__(self, client: HttpClient, sandbox_id: str):
        self._client = client
        self._sandbox_id = sandbox_id

    async def run(
        self, code: str, language: str = "python"
    ) -> CodeResult:
        data = await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/interpret/execute",
            {"code": code, "language": language},
        )
        return CodeResult(**data)

    async def install(
        self, packages: list[str], manager: str = "pip"
    ) -> str:
        result = await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/interpret/install",
            {"packages": packages, "manager": manager},
        )
        return result["output"]

    async def kernels(self) -> list[KernelSpec]:
        data = await self._client.get(
            f"/sandbox/sandboxes/{self._sandbox_id}/interpret/kernels"
        )
        return [KernelSpec(**k) for k in data]
