#!/usr/bin/env python3
"""Operator-attended, fail-closed deployment for ONE isolated Lampac HDVB test.

Python 3.6 stdlib; needs Docker CLI + operator Docker permission.
Default is read-only dry-run. --apply pulls an exact registry digest, stops
only an explicitly named lampac-mcp test container, and rolls it back if
the replacement fails readiness. No production containers, PRs or merges.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

IMAGE = "ghcr.io/ivzaislu/lampac-mcp-test"
PORTS = {"9118/tcp": [{"HostIp": "127.0.0.1", "HostPort": "29118"}]}
SOURCE_SHA = re.compile(r"^[0-9a-f]{40}$")
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
OLD_NAME = re.compile(r"^lampac-mcp-(?:build[0-9]+|live|test)$")
TARGET = "lampac-mcp-live"
PING_URL = "http://127.0.0.1:29118/api/chromium/ping"
MAX_MEMORY = 700 * 1024 * 1024


class DeploymentError(Exception):
    pass


def load_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def validate_receipt(receipt, expected_sha):
    if not isinstance(receipt, dict):
        raise DeploymentError("Receipt must be a JSON object")
    sha = receipt.get("source_sha")
    digest = receipt.get("digest")
    if not SOURCE_SHA.fullmatch(expected_sha) or sha != expected_sha:
        raise DeploymentError("Expected SHA and receipt source_sha must match exactly")
    if not isinstance(digest, str) or not DIGEST.fullmatch(digest):
        raise DeploymentError("Missing or invalid full SHA256 image digest")
    if receipt.get("image") != IMAGE or receipt.get("platform") != "linux/amd64":
        raise DeploymentError("Wrong registry package or image platform")
    image_ref = IMAGE + "@" + digest
    if receipt.get("image_ref") != image_ref:
        raise DeploymentError("Receipt image_ref is not the exact digest reference")
    if receipt.get("tag_ref") != IMAGE + ":sha-" + sha:
        raise DeploymentError("Receipt source tag does not match the commit")
    return image_ref


def validate_config(config):
    if not isinstance(config, dict):
        raise DeploymentError("Configuration must be a JSON object")
    listen = config.get("listen", {})
    modules = config.get("BaseModule", {}).get("LoadModules")
    chromium = config.get("chromium", {})
    if (not isinstance(listen, dict) or listen.get("ip") != "any"
            or listen.get("port") != 9118
            or listen.get("localhost") != "127.0.0.1"):
        raise DeploymentError("Test config must bind port 9118 with loopback host metadata")
    if (sorted(modules or []) != ["HDVB", "Online"]
            or config.get("lowMemoryMode") is not True
            or not isinstance(chromium, dict)
            or chromium.get("enable") is not False):
        raise DeploymentError("Only HDVB + Online with chromium disabled is supported")
    if config.get("FlixCDN", {}).get("enable"):
        raise DeploymentError("FlixCDN headed-browser mode is not supported on this VPS")
    return True


def docker(args, ok=True, timeout=120):
    try:
        p = subprocess.run(
            ["docker"] + list(args), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            universal_newlines=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DeploymentError("Docker command unavailable or timed out: " + str(exc))
    if ok and p.returncode != 0:
        raise DeploymentError("Docker {} failed: {}".format(
            args[0], (p.stderr or p.stdout).strip()[-500:]))
    return p


def container(name):
    p = docker(["inspect", "--type", "container", name], ok=False)
    if p.returncode:
        if "No such object" in p.stderr or "No such container" in p.stderr:
            return None
        raise DeploymentError("Cannot inspect container {}: {}".format(
            name, p.stderr.strip()[-300:]))
    data = json.loads(p.stdout)
    if len(data) != 1:
        raise DeploymentError("Unexpected Docker inspect response")
    return data[0]


def verify_old_container(name, data):
    if not OLD_NAME.fullmatch(name):
        raise DeploymentError("Refusing to touch non-test container name")
    if data["Name"] != "/" + name:
        raise DeploymentError("Container name mismatch")
    config_image = data.get("Config", {}).get("Image", "")
    if not (config_image.startswith(IMAGE + "@sha256:")
            or config_image.startswith(IMAGE + ":sha-")
            or config_image == "ghcr.io/lampac-nextgen/lampac"):
        raise DeploymentError("Existing container image is not an approved test image")
    host = data.get("HostConfig", {})
    if (host.get("Privileged") or data.get("Mounts")
            or host.get("Binds") or host.get("NetworkMode") == "host"):
        raise DeploymentError("Existing container has mounts/privileges: refusing replacement")
    if host.get("PortBindings") != PORTS:
        raise DeploymentError("Existing container port bindings differ from test-only loopback")
    if host.get("Memory", 0) != MAX_MEMORY:
        raise DeploymentError("Existing container memory cap is not 700 MiB")
    return True


def verify_pulled_image(image_ref):
    p = docker(["image", "inspect", image_ref])
    data = json.loads(p.stdout)
    if len(data) != 1 or data[0].get("Os") != "linux" or data[0].get("Architecture") != "amd64":
        raise DeploymentError("Pulled image platform is not linux/amd64")
    if image_ref not in data[0].get("RepoDigests", []):
        raise DeploymentError("Pulled image digest does not match receipt")


def readiness(name, max_seconds=120):
    opener = build_opener(ProxyHandler({}))
    deadline = time.time() + max_seconds
    while time.time() < deadline:
        current = container(name)
        if not current or not current["State"].get("Running"):
            raise DeploymentError("New test container stopped during startup")
        try:
            request = Request(PING_URL, headers={"User-Agent": "Lampac-MCP-deploy/1"})
            with opener.open(request, timeout=3) as response:
                if response.getcode() == 200 and response.read(32).strip() == b"pong":
                    logs = docker(["logs", "--tail", "250", name], timeout=15)
                    combined = logs.stdout + logs.stderr
                    required = ("loaded module: HDVB", "loaded module: Online", "Configure complete")
                    if all(marker in combined for marker in required):
                        if "Out of memory." in combined:
                            raise DeploymentError("Container logs contain Out of memory")
                        return
        except (HTTPError, URLError, OSError):
            pass
        time.sleep(2)
    raise DeploymentError("Test container HTTP+module readiness timed out")



def probe_hdvbp(probe_user="ubuntu"):
    """Bounded HDVB network+media smoke; sanitize output through probe_online."""
    script_dir = os.path.dirname(os.path.realpath(__file__))
    script = os.path.join(script_dir, "probe_online.py")
    live_lib = os.path.join(script_dir, "live_tests.py")
    if not (os.path.isfile(script) and os.path.isfile(live_lib)):
        raise DeploymentError("Missing probe_online.py/live_tests.py next to deployer")
    command = [sys.executable, script, "--provider", "hdvb",
               "--param", "kinopoisk_id=258687",
               "--param", "title=Интерстеллар"]
    if os.geteuid() == 0:
        # Network probing must not run as root when the operator uses sudo.
        command = ["runuser", "-u", probe_user, "--"] + command
    try:
        p = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           universal_newlines=True, timeout=150, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DeploymentError("HDVB smoke probe unavailable or timed out: " + str(exc))
    if p.returncode != 0:
        raise DeploymentError("HDVB smoke failed (exit code {})".format(p.returncode))
    try:
        report = json.loads(p.stdout)
    except ValueError:
        raise DeploymentError("HDVB smoke did not produce JSON")
    stages = report.get("steps", [])
    stream = next((step for step in stages if step.get("stage") == "stream"), {})
    if (report.get("status") != "passed" or stream.get("status") != "passed"
            or not stream.get("sample_retrieved") or not stream.get("codec_confirmed")):
        raise DeploymentError("HDVB smoke did not confirm media sample and codecs")
    return {
        "provider": "hdvb",
        "status": "passed",
        "bytes_sampled": stream.get("bytes_sampled"),
        "codec_confirmed": True,
        "codecs": stream.get("codecs", []),
        "ffprobe_exit_code": stream.get("ffprobe_exit_code")
    }


def rollback(name, old, rename_from, backup_name, failed_name, expected_sha, created):
    errors = []
    if created:
        try:
            candidate = container(name)
            if candidate:
                labels = candidate.get("Config", {}).get("Labels") or {}
                if labels.get("dev.lampac-mcp.source-sha") != expected_sha:
                    raise DeploymentError("Rollback refused to modify container without matching source label")
                docker(["stop", "--time", "5", name], timeout=25)
                if container(failed_name):
                    errors.append("failed-container name reserved; leaving candidate as " + name)
                else:
                    docker(["rename", name, failed_name])
        except DeploymentError as exc:
            errors.append(str(exc))
    if rename_from and backup_name:
        try:
            if container(backup_name) and not container(rename_from):
                docker(["rename", backup_name, rename_from])
        except DeploymentError as exc:
            errors.append(str(exc))
    if old and old["State"].get("Running"):
        try:
            restore_name = rename_from or old["Name"].lstrip("/")
            docker(["start", restore_name])
        except DeploymentError as exc:
            errors.append(str(exc))
    return errors


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--receipt", required=True, help="Downloaded CI image receipt JSON")
    parser.add_argument("--config", required=True, help="HDVB-only init.conf")
    parser.add_argument("--expected-sha", required=True, help="Full 40-character built commit SHA")
    parser.add_argument("--replace", help="Explicit existing test container to stop, if any")
    parser.add_argument("--apply", action="store_true",
                        help="Opt in to Docker pull and test-container replacement")
    options = parser.parse_args(argv)

    created = False
    renamed_from = None
    backup_name = None
    old = None
    touched_old = False
    failed_name = TARGET + "-failed-" + options.expected_sha[:12]
    try:
        image_ref = validate_receipt(load_json(options.receipt), options.expected_sha)
        validate_config(load_json(options.config))
        old_name = options.replace
        if old_name is not None and not OLD_NAME.fullmatch(old_name):
            raise DeploymentError("--replace must identify an approved test container")
        target = container(TARGET)
        old = container(old_name) if old_name else None
        if target and old_name != TARGET:
            raise DeploymentError("Target test container exists: pass --replace lampac-mcp-live")
        if old_name and old is None:
            raise DeploymentError("Explicit --replace container was not found")
        if options.apply:
            base = os.path.dirname(os.path.realpath(__file__))
            if not (os.path.isfile(os.path.join(base, "probe_online.py"))
                    and os.path.isfile(os.path.join(base, "live_tests.py"))):
                raise DeploymentError("Missing HDVB probe dependencies; refusing deployment")
        if old:
            verify_old_container(old_name, old)
        elif target:
            raise DeploymentError("Existing target requires explicit --replace")
        if not options.apply:
            print(json.dumps({
                "status": "dry-run", "target": TARGET, "replace": old_name,
                "image_ref": image_ref, "sha": options.expected_sha,
                "note": "No image pulled, no container stopped or created"
            }, indent=2))
            return 0

        if container(failed_name):
            raise DeploymentError("Failed deployment backup already exists: " + failed_name)
        if old_name == TARGET and container(TARGET + "-rollback"):
            raise DeploymentError("Previous test-container rollback backup already exists")
        docker(["pull", image_ref], timeout=900)
        verify_pulled_image(image_ref)

        if old:
            if old["State"].get("Running"):
                touched_old = True
                docker(["stop", "--time", "15", old_name], timeout=40)
            if old_name == TARGET:
                backup_name = TARGET + "-rollback"
                if container(backup_name) is not None:
                    raise DeploymentError("Existing rollback backup must be handled manually")
                renamed_from = TARGET
                touched_old = True
                docker(["rename", TARGET, backup_name])

        created = True
        docker(["create",
                "--name", TARGET,
                "--label", "dev.lampac-mcp.test=true",
                "--label", "dev.lampac-mcp.source-sha=" + options.expected_sha,
                "--cpus", "1",
                "--memory", "700m",
                "--pids-limit", "256",
                "--shm-size", "128m",
                "--restart", "no",
                "-p", "127.0.0.1:29118:9118",
                image_ref], timeout=90)
        docker(["cp", options.config, TARGET + ":/lampac/init.conf"], timeout=30)
        docker(["start", TARGET], timeout=90)
        readiness(TARGET)
        smoke = probe_hdvbp()
        after = container(TARGET)
        if not after or not after["State"].get("Running") or after["State"].get("OOMKilled"):
            raise DeploymentError("Container unhealthy after successful HDVB smoke")
        print(json.dumps({
            "status": "deployed-and-smoke-passed", "container": TARGET,
            "source_sha": options.expected_sha, "image_ref": image_ref,
            "old_container": old_name, "old_backup": backup_name,
            "running": True, "oom_killed": False, "smoke": smoke,
            "note": "Only a bounded media sample was validated, not a complete film"
        }, indent=2))
        return 0
    except (DeploymentError, ValueError, KeyError, TypeError, OSError) as exc:
        recovery = []
        if created or touched_old or renamed_from:
            recovery = rollback(
                TARGET, old, renamed_from, backup_name, failed_name, options.expected_sha, created)
        print(json.dumps({
            "status": "blocked" if not (created or touched_old or renamed_from) else "deployment-failed",
            "error": str(exc), "rollback_issues": recovery
        }, indent=2), file=sys.stderr)
        return 2 if recovery else 1


if __name__ == "__main__":
    sys.exit(main())
