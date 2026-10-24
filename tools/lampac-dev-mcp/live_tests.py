"""Bounded REAL network smoke checks against a separately running Lampac test instance.

Never pass arbitrary URLs to this runner. Discovery happens through the Lampac API,
and external CDN egress requires explicit hostname allowlisting.
"""
from __future__ import annotations

import ipaddress
import json
import os
import resource
import re
import shutil
import socket
import subprocess
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

READ_LIMIT = 256 * 1024
JSON_LIMIT = 256 * 1024
MAX_STEPS = 6
ALLOWED_PARAMS = {
    "title", "original_title", "year", "kp", "imdb", "tmdb",
    "kinopoisk_id", "id", "serial", "s", "e", "t",
}
SAFE_HEADERS = {"user-agent", "referer", "origin", "accept"}
BASE = os.environ.get("LAMPAC_TEST_BASE_URL", "http://127.0.0.1:29118").rstrip("/")
PUBLIC_BASE = os.environ.get("LAMPAC_TEST_PUBLIC_BASE_URL", "").rstrip("/")
HOSTS = tuple(
    h.strip().lower() for h in
    os.environ.get("LAMPAC_TEST_STREAM_HOSTS", "").split(",") if h.strip()
)


class TestIssue(Exception):
    def __init__(self, status: str, reason: str):
        self.status, self.reason = status, reason
        super().__init__(reason)


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = build_opener(ProxyHandler({}), _NoRedirect())


def _origin(value: str) -> tuple[str, str, int]:
    u = urlsplit(value)
    if u.scheme not in ("http", "https") or not u.hostname or u.username or u.password:
        raise TestIssue("blocked", "Invalid URL or disallowed URL scheme")
    port = u.port or (443 if u.scheme == "https" else 80)
    return u.scheme, u.hostname.lower(), port


def _base() -> str:
    scheme, host, port = _origin(BASE)
    if scheme != "http" or host not in ("127.0.0.1", "::1", "localhost"):
        raise TestIssue("blocked", "Lampac test base must be HTTP loopback")
    if urlsplit(BASE).path not in ("", "/") or urlsplit(BASE).query:
        raise TestIssue("blocked", "Lampac test base must not have a path or query")
    return BASE


def _authorize(url: str) -> str:
    base = _base()
    # Lampac may generate its public URL; explicitly rewrite only this known origin.
    if PUBLIC_BASE:
        if _origin(url) == _origin(PUBLIC_BASE):
            u = urlsplit(url)
            b = urlsplit(base)
            url = urlunsplit((b.scheme, b.netloc, u.path, u.query, ""))
    scheme, host, port = _origin(url)
    if (scheme, host, port) == _origin(base):
        path = urlsplit(url).path
        # Never let an upstream template steer this tester to admin/config endpoints.
        safe_prefixes = ("/lite/", "/proxy/", "/proxy-dash/", "/gst/", "/transcoding/", "/ts/")
        if (not path.startswith(safe_prefixes) or
                re.search(r"%(?:2e|2f|5c)", path, flags=re.IGNORECASE)):
            raise TestIssue("blocked", "Non-playback path on Lampac test instance")
        return url
    if scheme != "https" or port != 443:
        raise TestIssue("blocked", "External playback must use HTTPS on port 443")
    matched = any(
        host == item or (item.startswith("*.") and host.endswith(item[1:]) and
                          host != item[2:])
        for item in HOSTS
    )
    if not matched:
        raise TestIssue("inconclusive", "Stream CDN host is not in the configured allowlist")
    try:
        ips = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise TestIssue("inconclusive", "Could not resolve streaming host") from exc
    if not ips or any(not ipaddress.ip_address(row[4][0]).is_global for row in ips):
        raise TestIssue("blocked", "Streaming host DNS resolved to non-public address")
    # Standard URL openers may resolve again at connect: not a hardened sandbox.
    return url


def _fetch(url: str, *, headers: dict[str, str] | None = None) -> tuple[bytes, str]:
    request_headers = {"User-Agent": "LampacDevMCP/0.1", "Accept-Encoding": "identity",
                       "Range": f"bytes=0-{READ_LIMIT - 1}"}
    if headers:
        for key, value in headers.items():
            if key.lower() in SAFE_HEADERS and isinstance(value, str) and len(value) < 500:
                request_headers[key] = value
    for _ in range(4):
        safe_url = _authorize(url)
        req = Request(safe_url, headers=request_headers, method="GET")
        try:
            resp = _opener.open(req, timeout=12)
        except HTTPError as exc:
            if exc.code in (301, 302, 303, 307, 308):
                loc = exc.headers.get("Location")
                if not loc:
                    raise TestIssue("failed", "Redirect missing Location")
                url = urljoin(safe_url, loc)
                continue
            status = "inconclusive" if exc.code in (401, 403, 407, 408, 429, 451, 500, 502, 503, 504) else "failed"
            raise TestIssue(status, f"HTTP {exc.code} from test endpoint") from None
        except (URLError, TimeoutError, OSError) as exc:
            raise TestIssue("inconclusive", "Network error or timeout") from exc
        with resp:
            kind = resp.headers.get("Content-Type", "").lower().split(";")[0]
            data = resp.read(READ_LIMIT)
        if not data:
            raise TestIssue("failed", "Empty response")
        return data, kind
    raise TestIssue("failed", "Too many HTTP redirects")


def _load_json(payload: bytes) -> dict:
    try:
        value = json.loads(payload)
    except (ValueError, UnicodeDecodeError) as exc:
        raise TestIssue("inconclusive", "Lampac returned non-JSON (HTML error or protection page)") from exc
    if not isinstance(value, dict):
        raise TestIssue("failed", "Expected JSON object from Lampac")
    return value


def _next(response: dict) -> tuple[str, str, dict[str, str]]:
    """Follow one Lampa template item (similar/season/episode/movie) or final play URL."""
    typ = response.get("type", "")
    if response.get("method") == "play" and isinstance(response.get("url"), str):
        return "play", response["url"], response.get("headers") or {}
    data = response.get("data")
    if not isinstance(data, list) or not data:
        raise TestIssue("inconclusive", f"No selectable data (type={typ or 'unknown'})")
    item = next((x for x in data if isinstance(x, dict) and
                 x.get("method") in ("call", "link", "play") and x.get("url")), None)
    if item is None:
        raise TestIssue("inconclusive", "No compatible link in provider response")
    if item.get("method") == "play":
        return "play", item["url"], item.get("headers") or {}
    return "call", item["url"], item.get("headers") or {}


def _media_probe(url: str, headers: dict[str, str]) -> dict:
    """For HLS follow at most 3 manifests, then sample ONE segment; never download full video."""
    hls_count = 0
    while hls_count < 4:
        data, kind = _fetch(url, headers=headers)
        preview = data[:1024].lstrip()
        if preview.startswith(b"#EXTM3U"):
            hls_count += 1
            # Playlists may be master, variant or media. Take one listed URI.
            playlist = data.decode("utf-8-sig", errors="replace")
            entries = [s.strip() for s in playlist.splitlines()
                       if s.strip() and not s.lstrip().startswith("#")]
            if not entries:
                raise TestIssue("inconclusive", "HLS playlist has no variant/segment URI")
            url = urljoin(url, entries[0])
            continue
        if kind in ("text/html", "application/json", "text/plain") or preview.startswith((b"<html", b"<!DOCTYPE", b"{")):
            raise TestIssue("failed", "Playback endpoint returned HTML/JSON instead of media")
        if not data:
            raise TestIssue("failed", "No media data")
        # This is real stream I/O, not a codec proof. Optional ffprobe verifies a codec.
        summary = {"bytes_sampled": len(data), "media_type": kind or "unknown",
                   "hls_manifests": hls_count, "sample_retrieved": True,
                   "codec_confirmed": False}
        ffprobe = shutil.which("ffprobe")
        if not ffprobe:
            summary.update(status="inconclusive",
                           reason="Bytes received but ffprobe is not installed")
            return summary
        try:
            def limit_probe():
                # A tiny, untrusted stream sample; prevent subprocess resource abuse.
                resource.setrlimit(resource.RLIMIT_AS, (384 * 1024**2, 384 * 1024**2))
                resource.setrlimit(resource.RLIMIT_CPU, (5, 5))

            p = subprocess.run(
                [ffprobe, "-v", "error", "-probesize", "131072",
                 "-analyzeduration", "1500000", "-protocol_whitelist", "pipe,fd",
                 "-show_entries", "stream=codec_name,codec_type",
                 "-of", "json", "-i", "pipe:0"],
                input=data, capture_output=True, timeout=10, check=False,
                env={"PATH": "/usr/bin:/bin", "HOME": "/tmp"},
                preexec_fn=limit_probe)
            info = json.loads(p.stdout or b"{}")
            streams = [x for x in info.get("streams", [])
                       if x.get("codec_type") in ("video", "audio") and x.get("codec_name")]
            if streams:
                summary.update(status="passed", codec_confirmed=True,
                               codecs=sorted({x["codec_name"] for x in streams}))
                return summary
        except (OSError, subprocess.TimeoutExpired, ValueError):
            pass
        summary.update(status="inconclusive", reason="Media bytes received, but sampled fragment has no recognized codec")
        return summary
    raise TestIssue("inconclusive", "HLS nested manifest depth exceeded")


def run_online(provider: str, params: dict[str, str]) -> dict:
    """Run actual network flow on this VPS; one provider, bounded requests/bytes/time."""
    if not re.fullmatch(r"[a-zA-Z0-9_-]{2,48}", provider):
        raise ValueError("Invalid provider")
    if not isinstance(params, dict) or not params or any(
        k not in ALLOWED_PARAMS or not isinstance(v, str) or len(v) > 180
        for k, v in params.items()
    ):
        raise ValueError("Use a small, non-secret provider query fixture")
    steps: list[dict] = []
    try:
        url = f"{_base()}/lite/{provider}?{urlencode({**params, 'rjson': 'true'})}"
        seen = set()
        for n in range(MAX_STEPS):
            if url in seen:
                raise TestIssue("failed", "Detected a loop in provider links")
            seen.add(url)
            # Only Lampac URLs can be control/call endpoints; external URLs only for playback.
            if _origin(_authorize(url)) != _origin(_base()):
                raise TestIssue("blocked", "Non-Lampac URL in provider navigation")
            payload, _ = _fetch(url)
            obj = _load_json(payload)
            action, next_url, headers = _next(obj)
            steps.append({"stage": "provider" if n == 0 else "navigation",
                          "status": "passed", "response_type": obj.get("type", obj.get("method", "unknown"))})
            if action == "play":
                steps.append({"stage": "playback_link", "status": "passed"})
                media = _media_probe(urljoin(url, next_url), headers if isinstance(headers, dict) else {})
                steps.append({"stage": "stream", **media})
                return {"status": media["status"], "provider": provider,
                        "steps": steps, "note": "Live stream probe from VPS; never downloads the full title"}
            url = urljoin(url, next_url)
            if _origin(url) != _origin(_base()):
                if PUBLIC_BASE and _origin(url) == _origin(PUBLIC_BASE):
                    u = urlsplit(url)
                    b = urlsplit(_base())
                    url = urlunsplit((b.scheme, b.netloc, u.path, u.query, ""))
                else:
                    raise TestIssue("blocked", "Provider navigation URL is not Lampac test instance")
        raise TestIssue("inconclusive", "Reached navigation step limit")
    except TestIssue as exc:
        steps.append({"stage": "test_stop", "status": exc.status, "reason": exc.reason})
        return {"status": exc.status, "provider": provider, "steps": steps}
