#!/usr/bin/env python3
import json
import os
import socket
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = os.environ.get("TRANSLATIONSUB_BASE_URL", "http://127.0.0.1:9118").rstrip("/")
FIXTURE = os.environ.get("TRANSLATIONSUB_TICK_GATE_FIXTURE", "http://127.0.0.1:9124").rstrip("/")
DB = Path(os.environ.get("TRANSLATIONSUB_DB_PATH", "/tmp/lampac-tickgate/database/translationsub.db"))
TARGET_UID = "tick-gate-manual@translationsub.test"
SUBSCRIPTION_COUNT = 6

_state = {"mode": "timeout", "tmdbRequests": 0}
_state_lock = threading.Lock()


class FixtureServer(ThreadingHTTPServer):
    request_queue_size = 64
    daemon_threads = True


class FixtureHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        return

    def _raw(self, raw, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        if raw:
            try:
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _json(self, payload, status=200):
        self._raw(json.dumps(payload).encode("utf-8"), status=status)

    def do_POST(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path != "/control":
            self._json({"error": "not_found"}, status=404)
            return

        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            self._json({"error": "invalid_json"}, status=400)
            return

        mode = str(payload.get("mode") or "").strip().lower()
        if mode not in {"healthy", "timeout"}:
            self._json({"error": "invalid_mode", "mode": mode}, status=400)
            return

        with _state_lock:
            _state["mode"] = mode
            state = dict(_state)
        self._json({"ok": True, **state})

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/health":
            self._json({"ok": True})
            return
        if parsed.path == "/state":
            with _state_lock:
                self._json(dict(_state))
            return
        if not parsed.path.startswith("/tmdb/tv/"):
            self._json({"error": "not_found"}, status=404)
            return

        with _state_lock:
            _state["tmdbRequests"] += 1
            mode = _state["mode"]

        if mode == "timeout":
            time.sleep(14)

        try:
            tmdb_id = int(parsed.path.rsplit("/", 1)[-1])
        except ValueError:
            tmdb_id = 0

        self._json({
            "id": tmdb_id,
            "status": "Returning Series",
            "external_ids": {"imdb_id": None},
            "last_episode_to_air": {
                "season_number": 1,
                "episode_number": 3,
                "air_date": "2026-01-01",
            },
            "next_episode_to_air": None,
            "seasons": [{"season_number": 1, "episode_count": 3}],
        })


def serve_fixture():
    server = FixtureServer(("127.0.0.1", 9124), FixtureHandler)
    print("TranslationSub tick-gate TMDB fixture listening on 127.0.0.1:9124", flush=True)
    server.serve_forever()


def http_json(method, url, payload=None, timeout=55):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            body = json.loads(raw) if raw else raw
        except Exception:
            body = raw
        return exc.code, body
    except (urllib.error.URLError, TimeoutError, socket.timeout) as exc:
        return 0, str(exc)


def fixture_state():
    status, body = http_json("GET", FIXTURE + "/state", timeout=3)
    assert status == 200 and isinstance(body, dict), (status, body)
    return body


def set_fixture_mode(mode):
    status, body = http_json("POST", FIXTURE + "/control", {"mode": mode}, timeout=3)
    assert status == 200 and isinstance(body, dict) and body.get("ok") is True, (status, body)
    assert body.get("mode") == mode, body
    return body


def api_check(uid, timeout=55):
    encoded = urllib.parse.quote(uid, safe="")
    return http_json("POST", f"{BASE}/translationsub/v2/check?uid={encoded}&profile_id=0", {}, timeout=timeout)


def iso_now():
    return datetime.now(timezone.utc).isoformat()


def seed_background_queue():
    assert DB.is_file(), f"TranslationSub database not found: {DB}"
    created = iso_now()
    with sqlite3.connect(DB, timeout=10) as conn:
        conn.execute("PRAGMA busy_timeout = 5000")
        conn.execute("DELETE FROM profile_progress")
        conn.execute("DELETE FROM subscriptions")
        conn.execute("DELETE FROM settings")

        for index in range(SUBSCRIPTION_COUNT):
            uid = f"tick-gate-bg-{index}@translationsub.test"
            tmdb_id = str(41000 + index)
            conn.execute(
                """
                INSERT INTO settings (
                    uid, check_interval_hours, sources_json, use_tmdb_schedule,
                    tmdb_refresh_hours, ended_refresh_days, new_season_mode, updated_at
                ) VALUES (?, 1, '[]', 1, 6, 7, 'auto', ?)
                """,
                (uid, created),
            )
            conn.execute(
                """
                INSERT INTO subscriptions (
                    id, uid, content_id, title, original_title, kp_id, imdb_id, tmdb_id,
                    poster, year, is_serial, source, translation_id, translation_name,
                    current_season, last_season, last_episode, sources_json, created_at,
                    last_checked_at, tmdb_last_synced_at, schedule_state, tmdb_new_season_available
                ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, 2026, 1, 'ci',
                          'ci-voice', 'CI Voice', 1, 1, 3, '[]', ?, NULL, NULL, NULL, 0)
                """,
                (
                    f"tick-gate-sub-{index}",
                    uid,
                    f"tick-gate-content-{index}",
                    f"Tick Gate Series {index}",
                    f"Tick Gate Series {index}",
                    tmdb_id,
                    created,
                ),
            )

        conn.execute(
            """
            INSERT INTO settings (
                uid, check_interval_hours, sources_json, use_tmdb_schedule,
                tmdb_refresh_hours, ended_refresh_days, new_season_mode, updated_at
            ) VALUES (?, 1, '[]', 1, 6, 7, 'auto', ?)
            """,
            (TARGET_UID, created),
        )
        conn.commit()

        integrity = conn.execute("PRAGMA integrity_check").fetchone()
        assert integrity is not None and integrity[0] == "ok", tuple(integrity) if integrity else integrity
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
        count = conn.execute("SELECT COUNT(*) FROM subscriptions").fetchone()[0]
        assert count == SUBSCRIPTION_COUNT, count


def wait_for_background_tmdb(timeout=22):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = fixture_state()
        if int(state.get("tmdbRequests") or 0) >= 1:
            return state
        time.sleep(0.1)
    raise AssertionError("background tick did not reach the TMDB fixture before timeout")


def assert_persisted_queue(expected_synced=False):
    with sqlite3.connect(DB, timeout=10) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT id, uid, last_episode, tmdb_last_synced_at
            FROM subscriptions
            ORDER BY id
            """
        ).fetchall()
        assert len(rows) == SUBSCRIPTION_COUNT, len(rows)
        for row in rows:
            assert row["last_episode"] == 3, dict(row)
            if expected_synced and row["id"] == "tick-gate-sub-0":
                assert row["tmdb_last_synced_at"], dict(row)
        integrity = conn.execute("PRAGMA integrity_check").fetchone()
        assert integrity is not None and integrity[0] == "ok", tuple(integrity) if integrity else integrity
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def run_suite():
    print("1. seed six slow-TMDB subscriptions before the first background tick", flush=True)
    set_fixture_mode("timeout")
    initial = fixture_state()
    assert int(initial.get("tmdbRequests") or 0) == 0, initial
    seed_background_queue()

    print("2. wait until the background tick owns tickGate and starts its first TMDB timeout", flush=True)
    active = wait_for_background_tmdb()
    assert int(active.get("tmdbRequests") or 0) >= 1, active

    print("3. manual /check for another uid must remain bounded behind the background tick", flush=True)
    started = time.monotonic()
    status, body = api_check(TARGET_UID, timeout=50)
    elapsed = time.monotonic() - started
    assert status == 200 and isinstance(body, dict) and body.get("success") is True, (status, body, elapsed)
    assert elapsed < 45, f"manual /check was blocked too long by background TMDB failures: {elapsed:.2f}s"

    after = fixture_state()
    requests = int(after.get("tmdbRequests") or 0)
    assert requests == 3, f"expected circuit breaker after 3 slow TMDB failures, got {requests} requests"
    assert_persisted_queue()
    print(f"manual /check completed in {elapsed:.2f}s; background TMDB requests={requests}", flush=True)

    print("4. breaker backoff expires and a healthy TMDB request succeeds without restart", flush=True)
    set_fixture_mode("healthy")
    time.sleep(5.5)
    started = time.monotonic()
    status, body = api_check("tick-gate-bg-0@translationsub.test", timeout=10)
    recovery_elapsed = time.monotonic() - started
    assert status == 200 and isinstance(body, dict) and body.get("success") is True, (status, body)
    assert recovery_elapsed < 5, recovery_elapsed
    recovered_state = fixture_state()
    assert int(recovered_state.get("tmdbRequests") or 0) == 4, recovered_state
    assert_persisted_queue(expected_synced=True)
    print(f"TMDB recovered in {recovery_elapsed:.2f}s without Lampac restart", flush=True)
    print("TranslationSub background tick-gate timeout regression passed", flush=True)


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "serve":
        serve_fixture()
        return
    if len(sys.argv) == 2 and sys.argv[1] == "run":
        run_suite()
        return
    raise SystemExit("usage: translationsub-tick-gate-regression.py [serve|run]")


if __name__ == "__main__":
    main()
