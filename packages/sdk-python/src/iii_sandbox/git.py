from __future__ import annotations

from urllib.parse import urlencode

from .client import HttpClient
from .types import ExecResult, GitBranchResult, GitLogEntry, GitStatus


class GitManager:
    def __init__(self, client: HttpClient, sandbox_id: str):
        self._client = client
        self._sandbox_id = sandbox_id

    async def clone(
        self,
        url: str,
        path: str | None = None,
        branch: str | None = None,
        depth: int | None = None,
    ) -> ExecResult:
        body: dict = {"url": url}
        if path is not None:
            body["path"] = path
        if branch is not None:
            body["branch"] = branch
        if depth is not None:
            body["depth"] = depth
        data = await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/git/clone", body
        )
        return ExecResult(**data)

    async def status(self, path: str | None = None) -> GitStatus:
        params: dict[str, str] = {}
        if path is not None:
            params["path"] = path
        qs = f"?{urlencode(params)}" if params else ""
        data = await self._client.get(
            f"/sandbox/sandboxes/{self._sandbox_id}/git/status{qs}"
        )
        return GitStatus(**data)

    async def commit(
        self,
        message: str,
        path: str | None = None,
        all: bool | None = None,
    ) -> ExecResult:
        body: dict = {"message": message}
        if path is not None:
            body["path"] = path
        if all is not None:
            body["all"] = all
        data = await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/git/commit", body
        )
        return ExecResult(**data)

    async def diff(
        self,
        path: str | None = None,
        staged: bool | None = None,
        file: str | None = None,
    ) -> dict:
        params: dict[str, str] = {}
        if path is not None:
            params["path"] = path
        if staged is not None:
            params["staged"] = str(staged).lower()
        if file is not None:
            params["file"] = file
        qs = f"?{urlencode(params)}" if params else ""
        return await self._client.get(
            f"/sandbox/sandboxes/{self._sandbox_id}/git/diff{qs}"
        )

    async def log(
        self,
        path: str | None = None,
        count: int | None = None,
    ) -> dict:
        params: dict[str, str] = {}
        if path is not None:
            params["path"] = path
        if count is not None:
            params["count"] = str(count)
        qs = f"?{urlencode(params)}" if params else ""
        return await self._client.get(
            f"/sandbox/sandboxes/{self._sandbox_id}/git/log{qs}"
        )

    async def branch(
        self,
        path: str | None = None,
        name: str | None = None,
        delete: bool | None = None,
    ) -> GitBranchResult:
        body: dict = {}
        if path is not None:
            body["path"] = path
        if name is not None:
            body["name"] = name
        if delete is not None:
            body["delete"] = delete
        data = await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/git/branch", body
        )
        return GitBranchResult(**data)

    async def checkout(
        self, ref: str, path: str | None = None
    ) -> ExecResult:
        body: dict = {"ref": ref}
        if path is not None:
            body["path"] = path
        data = await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/git/checkout", body
        )
        return ExecResult(**data)

    async def push(
        self,
        path: str | None = None,
        remote: str | None = None,
        branch: str | None = None,
        force: bool | None = None,
    ) -> ExecResult:
        body: dict = {}
        if path is not None:
            body["path"] = path
        if remote is not None:
            body["remote"] = remote
        if branch is not None:
            body["branch"] = branch
        if force is not None:
            body["force"] = force
        data = await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/git/push", body
        )
        return ExecResult(**data)

    async def pull(
        self,
        path: str | None = None,
        remote: str | None = None,
        branch: str | None = None,
    ) -> ExecResult:
        body: dict = {}
        if path is not None:
            body["path"] = path
        if remote is not None:
            body["remote"] = remote
        if branch is not None:
            body["branch"] = branch
        data = await self._client.post(
            f"/sandbox/sandboxes/{self._sandbox_id}/git/pull", body
        )
        return ExecResult(**data)
