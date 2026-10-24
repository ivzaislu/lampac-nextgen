#!/usr/bin/env python3
"""Standalone, dependency-free LIVE Online test CLI for a running Lampac container.

Use this for VPS bring-up before MCP and pinned-branch deployment are connected.
Calls the existing live_tests module; it does NOT create, replace or configure containers.
"""
import argparse
import json
import os
import sys


def _params(raw):
    out = {}
    for item in raw:
        if "=" not in item:
            raise ValueError("Parameters must use KEY=VALUE")
        k, v = item.split("=", 1)
        if not k or not v or k in out:
            raise ValueError("Parameter keys/values must be non-empty and unique")
        out[k] = v
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Online Lampac: provider -> movie/episode -> playback -> first stream bytes")
    parser.add_argument("--provider", required=True,
                        help="Lampac route name, e.g. hdvb")
    parser.add_argument("--param", action="append", default=[], metavar="KEY=VALUE",
                        help="Test metadata (repeat); do not include private credentials")
    parser.add_argument("--navigation-timeout", type=int, default=12,
                        help="Seconds to wait for browser-backed navigation (5-120); FlixCDN: 90")
    parser.add_argument("--base", default="http://127.0.0.1:29118",
                        help="Existing, loopback-only Lampac test instance")
    parser.add_argument("--stream-hosts", default="",
                        help="Explicit external HTTPS CDN host allowlist, comma-separated")
    args = parser.parse_args(argv)

    if not (5 <= args.navigation_timeout <= 120):
        parser.error("--navigation-timeout must be between 5 and 120 seconds")
    try:
        params = _params(args.param)
    except ValueError as exc:
        parser.error(str(exc))

    # The module picks up environment at import time.
    os.environ["LAMPAC_TEST_BASE_URL"] = args.base
    os.environ["LAMPAC_TEST_STREAM_HOSTS"] = args.stream_hosts
    try:
        import live_tests
        # Don't print source URLs or untrusted HTML: they may contain auth tokens.
        result = live_tests.run_online(
            args.provider, params, navigation_timeout=args.navigation_timeout)
    except (ValueError, live_tests.TestIssue) as exc:
        result = {"status": "blocked", "reason": str(exc)}
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return {"passed": 0, "inconclusive": 2,
            "blocked": 3, "failed": 1}.get(result.get("status"), 4)


if __name__ == "__main__":
    sys.exit(main())
