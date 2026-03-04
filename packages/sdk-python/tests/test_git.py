import httpx
import pytest
import respx

from iii_sandbox.client import HttpClient
from iii_sandbox.git import GitManager
from iii_sandbox.types import ClientConfig

BASE_URL = "http://localhost:3111"
SANDBOX_ID = "sbx-test-1234"


@pytest.fixture
def git():
    client = HttpClient(ClientConfig(base_url=BASE_URL))
    return GitManager(client, SANDBOX_ID)


@pytest.mark.asyncio
async def test_clone(git):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/clone"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "exitCode": 0,
                    "stdout": "Cloning into '/workspace/repo'...\n",
                    "stderr": "",
                    "duration": 2.5,
                },
            )
        )
        result = await git.clone(
            "https://github.com/test/repo.git"
        )
        assert result.exitCode == 0
        assert "Cloning" in result.stdout


@pytest.mark.asyncio
async def test_clone_with_options(git):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/clone"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "exitCode": 0,
                    "stdout": "",
                    "stderr": "",
                    "duration": 1.0,
                },
            )
        )
        result = await git.clone(
            "https://github.com/test/repo.git",
            path="/workspace/myrepo",
            branch="develop",
            depth=1,
        )
        assert result.exitCode == 0


@pytest.mark.asyncio
async def test_status(git):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/status"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "branch": "main",
                    "clean": True,
                    "files": [],
                },
            )
        )
        result = await git.status()
        assert result.branch == "main"
        assert result.clean is True


@pytest.mark.asyncio
async def test_status_with_path(git):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/status?path=/workspace/repo"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "branch": "feature",
                    "clean": False,
                    "files": [
                        {"path": "file.txt", "status": "modified"}
                    ],
                },
            )
        )
        result = await git.status(path="/workspace/repo")
        assert result.branch == "feature"
        assert result.clean is False


@pytest.mark.asyncio
async def test_commit(git):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/commit"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "exitCode": 0,
                    "stdout": "[main abc1234] Initial commit\n",
                    "stderr": "",
                    "duration": 0.1,
                },
            )
        )
        result = await git.commit("Initial commit", all=True)
        assert result.exitCode == 0


@pytest.mark.asyncio
async def test_diff(git):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/diff?staged=true"
        ).mock(
            return_value=httpx.Response(
                200,
                json={"diff": "+new line\n-old line\n"},
            )
        )
        result = await git.diff(staged=True)
        assert "diff" in result


@pytest.mark.asyncio
async def test_log(git):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/log?count=5"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "entries": [
                        {
                            "hash": "abc1234",
                            "message": "Initial commit",
                            "author": "Test User",
                            "date": "2024-01-01T00:00:00Z",
                        }
                    ]
                },
            )
        )
        result = await git.log(count=5)
        assert len(result["entries"]) == 1


@pytest.mark.asyncio
async def test_branch(git):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/branch"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "branches": ["main", "develop"],
                    "current": "main",
                },
            )
        )
        result = await git.branch()
        assert result.current == "main"
        assert "develop" in result.branches


@pytest.mark.asyncio
async def test_checkout(git):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/checkout"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "exitCode": 0,
                    "stdout": "Switched to branch 'develop'\n",
                    "stderr": "",
                    "duration": 0.05,
                },
            )
        )
        result = await git.checkout("develop")
        assert result.exitCode == 0


@pytest.mark.asyncio
async def test_push(git):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/push"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "exitCode": 0,
                    "stdout": "",
                    "stderr": "Everything up-to-date\n",
                    "duration": 0.5,
                },
            )
        )
        result = await git.push(remote="origin", branch="main")
        assert result.exitCode == 0


@pytest.mark.asyncio
async def test_pull(git):
    with respx.mock:
        respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/pull"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "exitCode": 0,
                    "stdout": "Already up to date.\n",
                    "stderr": "",
                    "duration": 0.3,
                },
            )
        )
        result = await git.pull()
        assert result.exitCode == 0


@pytest.mark.asyncio
async def test_commit_with_path(git):
    with respx.mock:
        route = respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/commit"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "exitCode": 0,
                    "stdout": "[main abc1234] commit\n",
                    "stderr": "",
                    "duration": 0.1,
                },
            )
        )
        result = await git.commit("commit", path="/workspace/repo")
        assert result.exitCode == 0
        import json

        body = json.loads(route.calls[0].request.content)
        assert body["path"] == "/workspace/repo"


@pytest.mark.asyncio
async def test_diff_with_path_and_file(git):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/diff?path=%2Fworkspace&file=app.py"
        ).mock(
            return_value=httpx.Response(
                200, json={"diff": "+added\n"}
            )
        )
        result = await git.diff(path="/workspace", file="app.py")
        assert "diff" in result


@pytest.mark.asyncio
async def test_diff_no_params(git):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/diff"
        ).mock(
            return_value=httpx.Response(
                200, json={"diff": ""}
            )
        )
        result = await git.diff()
        assert "diff" in result


@pytest.mark.asyncio
async def test_log_with_path(git):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/log?path=%2Fworkspace%2Frepo"
        ).mock(
            return_value=httpx.Response(
                200,
                json={"entries": []},
            )
        )
        result = await git.log(path="/workspace/repo")
        assert result["entries"] == []


@pytest.mark.asyncio
async def test_log_no_params(git):
    with respx.mock:
        respx.get(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/log"
        ).mock(
            return_value=httpx.Response(
                200,
                json={"entries": []},
            )
        )
        result = await git.log()
        assert result["entries"] == []


@pytest.mark.asyncio
async def test_branch_with_all_options(git):
    with respx.mock:
        route = respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/branch"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "branches": ["main"],
                    "current": "main",
                },
            )
        )
        result = await git.branch(
            path="/workspace/repo",
            name="feature-x",
            delete=True,
        )
        assert result.current == "main"
        import json

        body = json.loads(route.calls[0].request.content)
        assert body["path"] == "/workspace/repo"
        assert body["name"] == "feature-x"
        assert body["delete"] is True


@pytest.mark.asyncio
async def test_checkout_with_path(git):
    with respx.mock:
        route = respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/checkout"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "exitCode": 0,
                    "stdout": "Switched to branch 'main'\n",
                    "stderr": "",
                    "duration": 0.05,
                },
            )
        )
        result = await git.checkout("main", path="/workspace/repo")
        assert result.exitCode == 0
        import json

        body = json.loads(route.calls[0].request.content)
        assert body["path"] == "/workspace/repo"


@pytest.mark.asyncio
async def test_push_with_all_options(git):
    with respx.mock:
        route = respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/push"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "exitCode": 0,
                    "stdout": "",
                    "stderr": "",
                    "duration": 0.5,
                },
            )
        )
        result = await git.push(
            path="/workspace/repo",
            branch="feature",
            force=True,
        )
        assert result.exitCode == 0
        import json

        body = json.loads(route.calls[0].request.content)
        assert body["path"] == "/workspace/repo"
        assert body["branch"] == "feature"
        assert body["force"] is True


@pytest.mark.asyncio
async def test_pull_with_all_options(git):
    with respx.mock:
        route = respx.post(
            f"{BASE_URL}/sandbox/sandboxes/{SANDBOX_ID}/git/pull"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "exitCode": 0,
                    "stdout": "Updating abc..def\n",
                    "stderr": "",
                    "duration": 0.4,
                },
            )
        )
        result = await git.pull(
            path="/workspace/repo",
            remote="upstream",
            branch="develop",
        )
        assert result.exitCode == 0
        import json

        body = json.loads(route.calls[0].request.content)
        assert body["path"] == "/workspace/repo"
        assert body["remote"] == "upstream"
        assert body["branch"] == "develop"
