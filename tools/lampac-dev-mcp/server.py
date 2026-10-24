"""Single-fork Lampac development MCP. Run as an isolated service account.

Tests are NOT production safety guarantees. Do not expose this MCP to untrusted clients.
"""
from __future__ import annotations

import fcntl
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import json
import os
import re
import shutil
import subprocess
import uuid
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse, urlencode

from mcp.server.fastmcp import FastMCP
from live_tests import run_online

ROOT = Path(os.environ.get("LAMPAC_MCP_DATA", "/srv/lampac-dev-mcp")).resolve()
REMOTE = os.environ.get("LAMPAC_REPO", "https://github.com/ivzaislu/lampac-nextgen.git")
BASE = "main"
FOLDERS = ("Core", "Shared", "Online", "SISI", "Modules", "TestModules")
ALLOWED_ROOT_FILES = ("NextGen.slnx",)
MAX_SOURCE = 250_000
BUILD_TIMEOUT = 600
# On 1 GB VPS, SDK builds are off by default. Prefer GitHub Actions.

mcp = FastMCP("Lampac Dev MCP")


def _check_remote() -> None:
    """Only GitHub repositories; credentials live in the service account, never the URL."""
    u = urlparse(REMOTE)
    if (u.scheme != "https" or u.hostname != "github.com" or u.username
            or u.password or u.port or u.query or u.fragment
            or not re.fullmatch(r"/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?", u.path)):
        raise RuntimeError("LAMPAC_REPO must be a credential-free https://github.com/OWNER/REPO.git URL")


def _run(args: list[str], cwd: Path | None = None, timeout: int = 120,
         check: bool = True) -> subprocess.CompletedProcess:
    p = subprocess.run(args, cwd=cwd, text=True, encoding="utf-8",
                       errors="replace", capture_output=True, timeout=timeout,
                       env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
    if check and p.returncode:
        raise RuntimeError((p.stderr or p.stdout)[-4000:])
    return p


@contextmanager
def _lock():
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / ".lock").open("a+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def _git(args: list[str], cwd: Path | None = None, check: bool = True):
    return _run(["git", "-c", "core.hooksPath=/dev/null", *args],
                cwd=cwd or ROOT / "repository", check=check)


def _task(task_id: str) -> tuple[Path, dict]:
    if not re.fullmatch(r"[a-f0-9]{12}", task_id):
        raise ValueError("Invalid task ID")
    metadata = ROOT / "tasks" / (task_id + ".json")
    if not metadata.is_file():
        raise ValueError("Unknown task")
    state = json.loads(metadata.read_text(encoding="utf-8"))
    worktree = ROOT / "worktrees" / task_id
    if not worktree.is_dir():
        raise RuntimeError("Missing task worktree")
    if not re.fullmatch(r"dev/(feature|fix)/[a-z0-9-]+-[a-f0-9]{12}", state["branch"]):
        raise RuntimeError("Invalid branch in task state")
    if _git(["branch", "--show-current"], cwd=worktree).stdout.strip() != state["branch"]:
        raise RuntimeError("Branch changed outside MCP; refusing to operate")
    return worktree, state


def _save_state(task_id: str, state: dict) -> None:
    target = ROOT / "tasks" / (task_id + ".json")
    tmp = target.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(target)


def _path(worktree: Path, filename: str, *, source_only: bool = True) -> Path:
    p = PurePosixPath(filename)
    if (not filename or p.is_absolute() or "\\" in filename or
            any(x in ("", ".", "..", ".git") for x in p.parts)):
        raise ValueError("Invalid repository-relative path")
    if source_only and not (p.parts[0] in FOLDERS or filename in ALLOWED_ROOT_FILES):
        raise ValueError("Path outside editable source directories")
    dest = (worktree / filename).resolve()
    if not dest.is_relative_to(worktree.resolve()):
        raise ValueError("Path escapes worktree (including symlinks)")
    return dest


def _module_dir(worktree: Path, module_path: str) -> Path:
    p = _path(worktree, module_path)
    if not p.is_dir() or p.relative_to(worktree).parts[0] not in (*FOLDERS[2:],):
        raise ValueError("Not a module directory")
    return p


def _github_api(path: str, method: str = "GET", payload: dict | None = None) -> dict:
    """Call the GitHub API for this fork, using a token held only in server env."""
    _check_remote()
    token = os.environ.get("LAMPAC_GH_TOKEN")
    if not token:
        raise RuntimeError("Set LAMPAC_GH_TOKEN (Actions: write/read for this fork)")
    repo_slug = urlparse(REMOTE).path.lstrip("/").removesuffix(".git")
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "lampac-dev-mcp",
    }
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = Request(f"https://api.github.com/repos/{repo_slug}{path}",
                      data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=25) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        raise RuntimeError(f"GitHub Actions API returned HTTP {exc.code}") from None
    except URLError as exc:
        raise RuntimeError("Could not reach GitHub Actions API") from exc


@mcp.tool()
def start_task(title: str, kind: str = "feature") -> dict:
    """Create an isolated worktree and new dev/feature or dev/fix branch from origin/main.

    The fork's main is never checked out or changed. No GitHub push happens yet.
    """
    if kind not in ("feature", "fix"):
        raise ValueError("kind must be feature or fix")
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:36] or "task"
    _check_remote()
    with _lock():
        repo = ROOT / "repository"
        if not (repo / ".git").is_dir():
            _run(["git", "clone", "--depth", "1", "--single-branch",
                  "--branch", BASE, "--no-checkout", REMOTE, str(repo)],
                 timeout=600)
        else:
            remote = _git(["remote", "get-url", "origin"]).stdout.strip()
            if remote.rstrip("/") != REMOTE.rstrip("/"):
                raise RuntimeError("Cached repository remote differs from LAMPAC_REPO")
        _git(["fetch", "--no-tags", "origin",
              f"+refs/heads/{BASE}:refs/remotes/origin/{BASE}"], timeout=600)
        task_id = uuid.uuid4().hex[:12]
        branch = f"dev/{kind}/{slug}-{task_id}"
        worktree = ROOT / "worktrees" / task_id
        worktree.parent.mkdir(exist_ok=True)
        _git(["worktree", "add", "-b", branch, str(worktree), f"origin/{BASE}"])
        (ROOT / "tasks").mkdir(exist_ok=True)
        state = {
            "branch": branch, "title": title[:180],
            "base_sha": _git(["rev-parse", "HEAD"], cwd=worktree).stdout.strip(),
            "validation": "not-run", "build": "not-run",
        }
        _save_state(task_id, state)
        return {"task_id": task_id, **state}


@mcp.tool()
def list_modules(task_id: str) -> list[dict]:
    """Find built-in and custom-source module manifests in the task's branch."""
    worktree, _ = _task(task_id)
    modules = []
    for folder in ("Modules", "Online", "SISI", "TestModules"):
        parent = worktree / folder
        if not parent.exists():
            continue
        for manifest in parent.rglob("manifest.json"):
            if any(x in ("bin", "obj", "node_modules") for x in manifest.parts):
                continue
            path = manifest.parent.relative_to(worktree).as_posix()
            csprojs = sorted(x.name for x in manifest.parent.glob("*.csproj"))
            modules.append({"path": path, "projects": csprojs})
    return sorted(modules, key=lambda x: x["path"])


@mcp.tool()
def inspect_module(task_id: str, module_path: str) -> dict:
    """Check manifest format, referenced files, and nearby C# projects; not a runtime test."""
    worktree, state = _task(task_id)
    module = _module_dir(worktree, module_path)
    manifest = module / "manifest.json"
    if not manifest.is_file():
        return {"status": "no-manifest", "module": module_path,
                "projects": [x.relative_to(worktree).as_posix()
                             for x in module.glob("*.csproj")]}
    data = json.loads(manifest.read_text(encoding="utf-8"))
    tree = data.get("tree", [])
    if not isinstance(tree, list) or not all(isinstance(x, str) for x in tree):
        raise ValueError("manifest.tree must be a list of paths")
    missing = []
    for name in tree:
        try:
            path = _path(worktree, (module / name).relative_to(worktree).as_posix())
            if not path.exists():
                missing.append(name)
        except (ValueError, OSError):
            missing.append(name)
    projects = sorted(x.relative_to(worktree).as_posix()
                      for x in module.glob("*.csproj"))
    return {"module": module_path, "manifest": data, "missing": missing,
            "projects": projects, "valid": not missing, "branch": state["branch"],
            "note": "Static manifest check only; does not prove module works"}


@mcp.tool()
def read_source(task_id: str, path: str) -> str:
    """Read source/config in the worktree, without Git credentials or the .git directory."""
    worktree, _ = _task(task_id)
    file = _path(worktree, path)
    if not file.is_file() or file.stat().st_size > MAX_SOURCE:
        raise ValueError("File missing or too large")
    return file.read_text(encoding="utf-8")


@mcp.tool()
def write_source(task_id: str, path: str, content: str) -> str:
    """Create/replace a source file ONLY in this task's feature/fix worktree."""
    if len(content.encode("utf-8")) > MAX_SOURCE:
        raise ValueError("Source file too large")
    with _lock():
        worktree, state = _task(task_id)
        file = _path(worktree, path)
        if file.suffix not in (".cs", ".csproj", ".json", ".yaml", ".yml", ".xml", ".md", ".slnx", ".js"):
            raise ValueError("Unsupported editable file type")
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content, encoding="utf-8")
        state["validation"] = "not-run"
        state["build"] = "not-run"
        _save_state(task_id, state)
        return f"Written to {state['branch']}: {path} (not published)"


@mcp.tool()
def build_project(task_id: str, project_path: str) -> dict:
    """Run an offline .NET 10 project build in a resource-limited Docker sandbox.

    Uses a pre-populated NuGet cache. Missing dependencies => inconclusive, NOT broken.
    """
    with _lock():
        worktree, state = _task(task_id)
        project = _path(worktree, project_path)
        if project.suffix != ".csproj" or not project.is_file():
            raise ValueError("project_path must name an existing .csproj")
        if os.environ.get("LAMPAC_ENABLE_LOCAL_BUILD") != "1":
            return {"status": "disabled-on-vps", "branch": state["branch"],
                    "project": project_path,
                    "next": "publish_branch, then request_ci_build",
                    "note": "SDK compilation is disabled by default on 1 GB VPS."}
        cache = ROOT / "nuget-cache"
        cache.mkdir(exist_ok=True)
        command = [
            "docker", "run", "--rm", "--network=none", "--read-only",
            "--cap-drop=ALL", "--security-opt=no-new-privileges",
            "--pids-limit=64", "--cpus=1", "--memory=640m",
            "--memory-swap=640m", "--tmpfs=/tmp:rw,nosuid,nodev,size=128m",
            "--user", f"{os.getuid()}:{os.getgid()}",
            "-e", "HOME=/tmp", "-e", "DOTNET_CLI_HOME=/tmp",
            "-e", "NUGET_PACKAGES=/nuget",
            "-e", "DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1",
            "-v", f"{worktree}:/work:rw", "-v", f"{cache}:/nuget:rw",
            "-w", "/work", "mcr.microsoft.com/dotnet/sdk:10.0",
            "dotnet", "build", project_path, "--nologo", "--ignore-failed-sources"
        ]
        try:
            result = _run(command, timeout=BUILD_TIMEOUT, check=False)
            output = result.stdout + "\n" + result.stderr
            status = "passed" if result.returncode == 0 else "failed"
            if result.returncode == 137 or any(x in output for x in ("NU1101", "NU1301")):
                status = "inconclusive"
            exit_code = result.returncode
        except subprocess.TimeoutExpired:
            status, exit_code, output = "timeout", None, "Docker build timed out"
        except OSError as exc:
            status, exit_code, output = "unavailable", None, str(exc)
        (ROOT / "tasks" / (task_id + "-build.log")).write_text(
            output[-100_000:], encoding="utf-8")
        state["build"] = status
        state["built_project"] = project_path
        _save_state(task_id, state)
        return {"status": status, "exit_code": exit_code,
                "log_tail": output[-10000:],
                "note": "Offline build; missing NuGet cache may make result inconclusive"}


@mcp.tool()
def request_ci_build(task_id: str) -> dict:
    """Request the EXISTING build.yml workflow on a published feature/fix branch.

    GitHub Actions does the compilation, not the 1 GB VPS. No PR, merge, or main writes.
    """
    with _lock():
        worktree, state = _task(task_id)
        sha = _git(["rev-parse", "HEAD"], cwd=worktree).stdout.strip()
        if sha != state.get("published_sha"):
            raise RuntimeError("First publish the current task branch")
        if _git(["status", "--porcelain"], cwd=worktree).stdout.strip():
            raise RuntimeError("Uncommitted changes: publish the task branch first")
        remote_sha = _git(["ls-remote", "origin",
                           f"refs/heads/{state['branch']}"], cwd=worktree).stdout.split()
        if not remote_sha or remote_sha[0] != sha:
            raise RuntimeError("Remote branch SHA differs from task; refusing CI dispatch")
        requested_at = datetime.now(timezone.utc).isoformat()
        _github_api("/actions/workflows/build.yml/dispatches", method="POST",
                    payload={"ref": state["branch"]})
        state["ci_dispatch_sha"] = sha
        state["ci_dispatch_at"] = requested_at
        _save_state(task_id, state)
        return {"status": "requested", "branch": state["branch"], "sha": sha,
                "workflow": "build.yml",
                "note": "Workflow runs asynchronously on GitHub, not on VPS; full project build, not functional module tests."}


@mcp.tool()
def get_ci_build_status(task_id: str) -> dict:
    """Fetch the latest matching GitHub Actions build result for this task branch."""
    _, state = _task(task_id)
    sha = state.get("ci_dispatch_sha")
    if not sha:
        return {"status": "not-requested"}
    branch_query = urlencode({"branch": state["branch"],
                              "event": "workflow_dispatch", "per_page": 20})
    payload = _github_api(f"/actions/workflows/build.yml/runs?{branch_query}")
    requested = datetime.fromisoformat(state["ci_dispatch_at"])
    for run in payload.get("workflow_runs", []):
        if run.get("head_sha") != sha:
            continue
        created_at = run.get("created_at")
        if not created_at:
            continue
        created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        if created < requested - timedelta(minutes=2):
            continue
        return {"status": run.get("status"), "conclusion": run.get("conclusion"),
                "url": run.get("html_url"), "run_id": run.get("id"),
                "sha": sha, "branch": state["branch"],
                "note": "Build workflow status; this is not functional validation"}
    return {"status": "awaiting-run", "branch": state["branch"],
            "sha": sha, "note": "GitHub has not listed the dispatched run yet"}


def _memory_snapshot(meminfo: str) -> dict:
    """Parse Linux /proc/meminfo (kB) without guessing host/container limits."""
    result: dict[str, int] = {}
    for line in meminfo.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0].endswith(":") and parts[1].isdigit():
            name = parts[0][:-1]
            if name in ("MemTotal", "MemAvailable", "SwapTotal", "SwapFree"):
                result[name + "_MiB"] = int(parts[1]) // 1024
    return result


def _cgroup_memory() -> dict:
    """Read effective cgroup v2 limits when accessible. max => unlimited."""
    result: dict[str, int | str] = {}
    for name in ("memory.max", "memory.current", "memory.swap.max", "memory.swap.current"):
        p = Path("/sys/fs/cgroup") / name
        try:
            value = p.read_text(encoding="ascii").strip()
            result[name] = "unlimited" if value == "max" else int(value) // (1024 * 1024)
        except (OSError, ValueError):
            continue
    return result


@mcp.tool()
def vps_browser_preflight(mode: str = "headless") -> dict:
    """Read host RAM/swap and browser prerequisites for live Lampac testing.

    mode = none | headless | headed. This does NOT start Chromium or confirm
    that the provider works. FlixCDN currently needs headed Chromium + Xvfb.
    """
    if mode not in ("none", "headless", "headed"):
        raise ValueError("mode must be none, headless or headed")
    mem: dict = {}
    try:
        mem = _memory_snapshot(Path("/proc/meminfo").read_text(encoding="ascii"))
    except OSError:
        pass
    chromium = (
        shutil.which("chromium") or shutil.which("chromium-browser")
        or shutil.which("google-chrome-stable")
    )
    xvfb = shutil.which("Xvfb")
    warnings: list[str] = []
    if mode != "none" and not chromium:
        warnings.append("No system Chromium/Chrome executable found in MCP host PATH; test container may differ")
    if mode == "headed" and not xvfb:
        warnings.append("Xvfb is missing (required by the current FlixCDN Linux browser resolver)")
    if mem.get("MemAvailable_MiB") is not None and mem["MemAvailable_MiB"] < 256:
        warnings.append("Low available physical RAM; browser startup may cause swapping or OOM")
    if mem.get("SwapTotal_MiB") is None:
        warnings.append("Could not read total configured swap")
    # An advisory only: service/container mounts may differ from the Lampac runtime.
    return {
        "mode": mode,
        "meminfo_MiB": mem,
        "cgroup_limits_MiB": _cgroup_memory(),
        "chromium": chromium,
        "xvfb": xvfb,
        "warnings": warnings,
        "status": "prerequisites-observed" if not warnings else "needs-review",
        "note": ("Swap is not RAM. Browser may be launched inside a different container; "
                 "this host-only check cannot prove Playwright or a provider is working.")
    }


@mcp.tool()
def run_live_online_test(task_id: str, provider: str, params: dict[str, str], browser_mode: str = "none") -> dict:
    """Live network test: Lampac JSON navigation -> playback link -> HLS/media -> codec.

    Requires an already deployed test-only Lampac instance at EXACT task commit.
    LAMPAC_TEST_DEPLOYED_SHA_FILE is written by a trusted deployment script;
    this MCP does NOT change, deploy, or merge main.
    """
    with _lock():
        worktree, state = _task(task_id)
        sha = _git(["rev-parse", "HEAD"], cwd=worktree).stdout.strip()
        if state.get("published_sha") != sha:
            return {"status": "not-ready", "reason": "Publish this branch commit first"}
        if _git(["status", "--porcelain"], cwd=worktree).stdout.strip():
            return {"status": "not-ready", "reason": "Task branch has unpublished edits"}
        sha_file = Path(os.environ.get(
            "LAMPAC_TEST_DEPLOYED_SHA_FILE",
            str(ROOT / "test-instance" / "commit.sha")))
        if not sha_file.is_file():
            return {"status": "not-ready", "reason": "No deployed test-instance commit marker"}
        deployed_sha = sha_file.read_text(encoding="ascii").strip()
        if not re.fullmatch(r"[0-9a-f]{40}", deployed_sha) or deployed_sha != sha:
            return {"status": "not-ready", "reason": "Running test instance does not match task commit"}
        # Browser is started by Lampac itself, not by the MCP test process.
        # This is advisory only; the Lampac test instance may be containerized.
        preflight = vps_browser_preflight(browser_mode)
        report = run_online(provider, params)
        report["browser_preflight"] = preflight
        report["tested_sha"] = sha
        state["validation"] = report["status"]
        state["last_live_report"] = report
        _save_state(task_id, state)
        return report


@mcp.tool()
def task_diff(task_id: str) -> str:
    """Show changes in the isolated branch without modifying GitHub."""
    worktree, state = _task(task_id)
    diff = _git(["diff", "--", *FOLDERS, *ALLOWED_ROOT_FILES], cwd=worktree).stdout
    untracked = _git(["ls-files", "--others", "--exclude-standard"], cwd=worktree).stdout
    return (f"branch: {state['branch']}\n\n" + diff[:35_000]
            + "\nUNTRACKED:\n" + untracked[:5_000])


@mcp.tool()
def task_status(task_id: str) -> dict:
    """Return branch, current changes, and latest build log tail."""
    worktree, state = _task(task_id)
    changes = _git(["status", "--short"], cwd=worktree).stdout
    log = ROOT / "tasks" / (task_id + "-build.log")
    return {**state, "changed_files": changes.splitlines()[:100],
            "build_log_tail": log.read_text(encoding="utf-8")[-8000:] if log.exists() else None}


@mcp.tool()
def publish_branch(task_id: str, message: str) -> dict:
    """Commit and push ONLY this task branch. No PR, no merge, never main."""
    if not 8 <= len(message) <= 180 or "\n" in message:
        raise ValueError("Commit message must be 8..180 chars on one line")
    with _lock():
        worktree, state = _task(task_id)
        editable = [name for name in (*FOLDERS, *ALLOWED_ROOT_FILES) if (worktree / name).exists()]
        _git(["add", "--", *editable], cwd=worktree)
        if _git(["diff", "--cached", "--quiet"], cwd=worktree, check=False).returncode == 0:
            return {"status": "unchanged", "branch": state["branch"]}
        _git(["-c", "user.name=Lampac Dev MCP",
              "-c", "user.email=lampac-dev-mcp@users.noreply.github.com",
              "commit", "-m", message], cwd=worktree)
        _git(["push", "origin", f"HEAD:refs/heads/{state['branch']}"],
             cwd=worktree)
        sha = _git(["rev-parse", "HEAD"], cwd=worktree).stdout.strip()
        state["published_sha"] = sha
        _save_state(task_id, state)
        return {"status": "published", "branch": state["branch"], "sha": sha,
                "build": state["build"], "validation": state["validation"],
                "note": "main untouched; no PR created"}


if __name__ == "__main__":
    _check_remote()
    # Keep stdio as the safe default. Remote HTTP requires an authenticated proxy.
    transport = os.environ.get("LAMPAC_MCP_TRANSPORT", "stdio")
    if transport not in ("stdio", "streamable-http"):
        raise RuntimeError("Unsupported transport")
    mcp.run(transport=transport)
