import httpx
import json
import os
import sys
from pathlib import Path
from typing import Any


def load_scenarios() -> dict:
    scenario_path = Path(__file__).parent / "scenario.json"
    with open(scenario_path) as f:
        data = json.load(f)
    if os.environ.get("TEST_BASE_URL"):
        data["config"]["baseUrl"] = os.environ["TEST_BASE_URL"]
    if os.environ.get("TEST_AUTH_TOKEN"):
        data["config"]["authToken"] = os.environ["TEST_AUTH_TOKEN"]
    return data


def make_headers(token: str) -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def http_post(client: httpx.Client, base_url: str, path: str, token: str, body: Any = None) -> Any:
    resp = client.post(
        f"{base_url.rstrip('/')}{path}",
        headers=make_headers(token),
        json=body,
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json()


def http_get(client: httpx.Client, base_url: str, path: str, token: str) -> Any:
    resp = client.get(
        f"{base_url.rstrip('/')}{path}",
        headers=make_headers(token),
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json()


def http_delete(client: httpx.Client, base_url: str, path: str, token: str) -> Any:
    resp = client.delete(
        f"{base_url.rstrip('/')}{path}",
        headers=make_headers(token),
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json()


def check_expect(result: dict, expect: dict, action: str) -> None:
    for key, val in expect.items():
        if key == "containsFile":
            files = result.get("files", [])
            if not any(f.get("name") == val for f in files):
                raise AssertionError(f"{action}: expected files to contain '{val}'")
        elif key == "containsKey":
            vars_dict = result.get("vars", {})
            if val not in vars_dict:
                raise AssertionError(f"{action}: expected vars to contain key '{val}'")
        elif key == "minCount":
            count = len(result.get("snapshots", []))
            if count < val:
                raise AssertionError(f"{action}: expected at least {val} items, got {count}")
        elif key == "success":
            continue
        else:
            actual = result.get(key)
            if actual != val:
                raise AssertionError(f"{action}.{key}: expected {json.dumps(val)}, got {json.dumps(actual)}")


def run_step(client: httpx.Client, step: dict, ctx: dict) -> str:
    action = step["action"]
    params = step.get("params", {})
    expect = step.get("expect")
    prefix = ctx["prefix"]
    base_url = ctx["base_url"]
    token = ctx["token"]
    sbx_id = ctx["sandbox_id"]
    result = {}

    if action == "create":
        data = http_post(client, base_url, f"{prefix}/sandboxes", token, params)
        ctx["sandbox_id"] = data["id"]
        result = data

    elif action == "get":
        result = http_get(client, base_url, f"{prefix}/sandboxes/{sbx_id}", token)

    elif action == "exec":
        body = {"command": params["command"]}
        if "workdir" in params:
            body["cwd"] = params["workdir"]
        result = http_post(client, base_url, f"{prefix}/sandboxes/{sbx_id}/exec", token, body)

    elif action == "pause":
        http_post(client, base_url, f"{prefix}/sandboxes/{sbx_id}/pause", token)
        result = http_get(client, base_url, f"{prefix}/sandboxes/{sbx_id}", token)

    elif action == "resume":
        http_post(client, base_url, f"{prefix}/sandboxes/{sbx_id}/resume", token)
        result = http_get(client, base_url, f"{prefix}/sandboxes/{sbx_id}", token)

    elif action == "kill":
        http_delete(client, base_url, f"{prefix}/sandboxes/{sbx_id}", token)
        ctx["sandbox_id"] = ""
        result = {"success": True}

    elif action == "fs-write":
        http_post(client, base_url, f"{prefix}/sandboxes/{sbx_id}/files/write", token, {
            "path": params["path"],
            "content": params["content"],
        })

    elif action == "fs-read":
        data = http_post(client, base_url, f"{prefix}/sandboxes/{sbx_id}/files/read", token, {
            "path": params["path"],
        })
        result = {"content": data} if isinstance(data, str) else data

    elif action == "fs-list":
        data = http_post(client, base_url, f"{prefix}/sandboxes/{sbx_id}/files/list", token, {
            "path": params["path"],
        })
        result = {"files": data}

    elif action == "fs-delete":
        http_post(client, base_url, f"{prefix}/sandboxes/{sbx_id}/files/delete", token, {
            "path": params["path"],
        })

    elif action == "env-set":
        http_post(client, base_url, f"{prefix}/sandboxes/{sbx_id}/env", token, {
            "vars": {params["key"]: params["value"]},
        })

    elif action == "env-get":
        result = http_post(client, base_url, f"{prefix}/sandboxes/{sbx_id}/env/get", token, {
            "key": params["key"],
        })

    elif action == "env-list":
        result = http_get(client, base_url, f"{prefix}/sandboxes/{sbx_id}/env", token)

    elif action == "env-delete":
        http_post(client, base_url, f"{prefix}/sandboxes/{sbx_id}/env/delete", token, {
            "key": params["key"],
        })

    elif action == "snapshot-create":
        result = http_post(client, base_url, f"{prefix}/sandboxes/{sbx_id}/snapshots", token, {
            "name": params["name"],
        })

    elif action == "snapshot-list":
        result = http_get(client, base_url, f"{prefix}/sandboxes/{sbx_id}/snapshots", token)

    else:
        raise ValueError(f"Unknown action: {action}")

    if expect:
        check_expect(result, expect, action)

    return ctx["sandbox_id"]


def run_scenario(client: httpx.Client, scenario: dict, config: dict) -> dict:
    ctx = {
        "base_url": config["baseUrl"],
        "prefix": config["apiPrefix"],
        "token": config["authToken"],
        "sandbox_id": "",
    }

    try:
        for step in scenario["steps"]:
            ctx["sandbox_id"] = run_step(client, step, ctx)
        return {"name": scenario["name"], "pass": True}
    except Exception as e:
        if ctx["sandbox_id"]:
            try:
                http_delete(client, ctx["base_url"], f"{ctx['prefix']}/sandboxes/{ctx['sandbox_id']}", ctx["token"])
            except Exception as cleanup_err:
                print(f"[WARN] Cleanup failed for {ctx['sandbox_id']}: {cleanup_err}")
        return {"name": scenario["name"], "pass": False, "error": str(e)}


def main() -> None:
    data = load_scenarios()
    config = data["config"]
    scenarios = data["scenarios"]
    results = []

    print(f"Running {len(scenarios)} scenarios against {config['baseUrl']}\n")

    with httpx.Client() as client:
        for scenario in scenarios:
            result = run_scenario(client, scenario, config)
            results.append(result)
            if result["pass"]:
                print(f"[PASS] {result['name']}")
            else:
                print(f"[FAIL] {result['name']}: {result['error']}")

    passed = sum(1 for r in results if r["pass"])
    failed = sum(1 for r in results if not r["pass"])
    print(f"\n{passed} passed, {failed} failed out of {len(results)} scenarios")
    sys.exit(1 if failed > 0 else 0)


if __name__ == "__main__":
    main()
