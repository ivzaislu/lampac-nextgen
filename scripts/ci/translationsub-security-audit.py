#!/usr/bin/env python3
import json
import os
import sqlite3
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = os.environ.get("TRANSLATIONSUB_BASE_URL", "http://127.0.0.1:9118").rstrip("/")
DB = Path(os.environ.get("TRANSLATIONSUB_DB_PATH", "/tmp/lampac-security/database/translationsub.db"))
META = os.environ.get("TRANSLATIONSUB_SECURITY_META", "http://127.0.0.1:9125").rstrip("/")
VICTIM = "security-victim@translationsub.test"
VICTIM_PROFILE = "7"
VICTIM_SUB = "security-victim-subscription"
PRIVATE_TITLE = "SECURITY PRIVATE VICTIM TITLE"
SSRF_UID = "security-ssrf@translationsub.test"

_state = {"meta_hits": 0, "sentinel_hits": 0}
_state_lock = threading.Lock()


class Server(ThreadingHTTPServer):
    request_queue_size = 32
    daemon_threads = True


def ci_get(value, key, default=None):
    if not isinstance(value, dict):
        return default
    wanted = str(key).lower()
    for current, result in value.items():
        if str(current).lower() == wanted:
            return result
    return default


def send_json(handler, payload, status=200):
    raw = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    try:
        handler.wfile.write(raw)
    except (BrokenPipeError, ConnectionResetError):
        pass


class MetadataHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        return

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/health":
            send_json(self, {"ok": True})
            return
        if parsed.path == "/state":
            with _state_lock:
                send_json(self, dict(_state))
            return
        if not parsed.path.startswith("/meta"):
            send_json(self, {"error": "not_found"}, status=404)
            return

        with _state_lock:
            _state["meta_hits"] += 1

        send_json(self, {
            "type": "season",
            "data": [{
                "name": "Season 1",
                "s": 1,
                "method": "link",
                "url": "http://security-sentinel.test:9126/sentinel"
            }]
        })


class SentinelHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        return

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/health":
            send_json(self, {"ok": True})
            return
        if parsed.path != "/sentinel":
            send_json(self, {"error": "not_found"}, status=404)
            return

        with _state_lock:
            _state["sentinel_hits"] += 1

        send_json(self, {
            "type": "episode",
            "data": [{
                "name": "Episode 1",
                "s": 1,
                "e": 1,
                "method": "play",
                "voice_name": "SSRF Sentinel Voice",
                "voice_id": "ssrf-sentinel"
            }]
        })


def serve():
    meta = Server(("127.0.0.1", 9125), MetadataHandler)
    sentinel = Server(("127.0.0.1", 9126), SentinelHandler)
    thread = threading.Thread(target=sentinel.serve_forever, daemon=True)
    thread.start()
    print("TranslationSub security metadata fixture listening on 127.0.0.1:9125", flush=True)
    print("TranslationSub security sentinel listening on 127.0.0.1:9126", flush=True)
    try:
        meta.serve_forever()
    finally:
        meta.server_close()
        sentinel.shutdown()
        sentinel.server_close()


def http_json(method, url, payload=None, timeout=20):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            try:
                body = json.loads(raw) if raw else None
            except Exception:
                body = raw
            return response.status, body
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            body = json.loads(raw) if raw else raw
        except Exception:
            body = raw
        return exc.code, body


def api(method, path, payload=None, timeout=20):
    return http_json(method, BASE + path, payload=payload, timeout=timeout)


def require_ok(result, label):
    status, body = result
    assert status == 200, (label, status, body)
    return body


def now_text():
    return datetime.now(timezone.utc).isoformat()


def seed_victim():
    assert DB.is_file(), f"TranslationSub DB missing: {DB}"
    with sqlite3.connect(DB, timeout=10) as conn:
        conn.execute("DELETE FROM profile_progress WHERE uid = ?", (VICTIM,))
        conn.execute("DELETE FROM subscriptions WHERE uid = ?", (VICTIM,))
        conn.execute("DELETE FROM settings WHERE uid = ?", (VICTIM,))
        conn.execute(
            "INSERT INTO settings (uid, check_interval_hours, sources_json, use_tmdb_schedule, "
            "tmdb_refresh_hours, ended_refresh_days, new_season_mode, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (VICTIM, 17, "[]", 0, 48, 30, "notify", now_text()),
        )
        conn.execute(
            "INSERT INTO subscriptions (id, uid, content_id, title, original_title, is_serial, "
            "source, translation_id, translation_name, current_season, last_season, last_episode, "
            "sources_json, created_at, tmdb_new_season_available) "
            "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 1, 1, 3, ?, ?, 0)",
            (VICTIM_SUB, VICTIM, "security-private-content", PRIVATE_TITLE,
             "Security Private Original", "security-source", "private-voice",
             "Private Voice", "[]", now_text()),
        )
        conn.execute(
            "INSERT INTO profile_progress (uid, profile_id, subscription_id, watched_episode, updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (VICTIM, VICTIM_PROFILE, VICTIM_SUB, 2, now_text()),
        )
        conn.commit()


def assert_integrity():
    with sqlite3.connect(DB, timeout=10) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def run():
    print("1. seed victim state directly in SQLite; no HTTP identity is used", flush=True)
    seed_victim()
    assert_integrity()

    print("2. anonymous HTTP BOLA/IDOR probe against victim settings + snapshot", flush=True)
    victim_q = urllib.parse.quote(VICTIM, safe="")
    settings_response = require_ok(
        api("GET", f"/translationsub/v2/settings?uid={victim_q}"),
        "anonymous victim settings")
    victim_settings = ci_get(settings_response, "settings", {})
    assert ci_get(victim_settings, "checkIntervalHours") == 17, settings_response
    assert ci_get(victim_settings, "newSeasonMode") == "notify", settings_response

    snapshot = require_ok(
        api("GET", f"/translationsub/v2/snapshot?uid={victim_q}&profile_id={VICTIM_PROFILE}"),
        "anonymous victim snapshot")
    subs = ci_get(snapshot, "subscriptions", []) or []
    victim_sub = next((x for x in subs if ci_get(x, "id") == VICTIM_SUB), None)
    assert victim_sub is not None, snapshot
    assert ci_get(victim_sub, "title") == PRIVATE_TITLE, victim_sub
    assert int(ci_get(victim_sub, "watchedEpisode", 0) or 0) == 2, victim_sub

    changed = require_ok(api("POST", f"/translationsub/v2/settings?uid={victim_q}", {
        "checkIntervalHours": 3,
        "sources": [],
        "useTmdbSchedule": False,
        "tmdbRefreshHours": 24,
        "endedRefreshDays": 7,
        "newSeasonMode": "off"
    }), "anonymous victim settings write")
    assert ci_get(changed, "success") is True, changed

    with sqlite3.connect(DB, timeout=10) as conn:
        row = conn.execute(
            "SELECT check_interval_hours, new_season_mode FROM settings WHERE uid = ?", (VICTIM,)
        ).fetchone()
        assert row == (3, "off"), row
    print("CONFIRMED HIGH: unauthenticated caller can read and modify arbitrary uid state", flush=True)

    print("3. same-origin metadata navigation must not fetch a foreign sentinel", flush=True)
    ssrf_q = urllib.parse.quote(SSRF_UID, safe="")
    saved = require_ok(api("POST", f"/translationsub/v2/settings?uid={ssrf_q}", {
        "checkIntervalHours": 1,
        "sources": ["flixcdn"],
        "useTmdbSchedule": False,
        "tmdbRefreshHours": 24,
        "endedRefreshDays": 7,
        "newSeasonMode": "auto"
    }), "ssrf settings")
    assert ci_get(saved, "success") is True, saved

    content = require_ok(api("POST", f"/translationsub/v2/content-state?uid={ssrf_q}", {
        "card": {
            "content_id": "security-ssrf-content",
            "source": "custom",
            "media_type": "tv",
            "serial": True,
            "season": 1,
            "title": "Security SSRF Probe",
            "original_name": "Security SSRF Probe",
            "tmdb_id": "31002",
            "imdb_id": "tt0903747",
            "kinopoisk_id": "404900",
            "first_air_date": "2026-01-01"
        },
        "includeVoices": True
    }), "ssrf content-state")

    state = require_ok(http_json("GET", META + "/state"), "fixture state")
    assert int(ci_get(state, "meta_hits", 0) or 0) >= 1, state
    assert int(ci_get(state, "sentinel_hits", 0) or 0) == 0, state
    voices = ci_get(content, "voices", []) or []
    assert not any(ci_get(x, "name") == "SSRF Sentinel Voice" for x in voices), content
    print("CLOSED: configured metadata origin was fetched; foreign sentinel origin was not", flush=True)

    assert_integrity()
    print("Security HTTP/SSRF audit probes completed; SQLite integrity is clean", flush=True)


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "serve":
        serve()
        return
    if len(sys.argv) == 2 and sys.argv[1] == "run":
        run()
        return
    raise SystemExit("usage: translationsub-security-audit.py [serve|run]")


if __name__ == "__main__":
    main()
