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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = os.environ.get("TRANSLATIONSUB_BASE_URL", "http://127.0.0.1:9118").rstrip("/")
PHANTOM_FIXTURE = os.environ.get("TRANSLATIONSUB_PHANTOM_FIXTURE", "http://127.0.0.1:9123").rstrip("/")
FLIX_FIXTURE = os.environ.get("TRANSLATIONSUB_FAULT_FIXTURE", "http://127.0.0.1:9122").rstrip("/")
DB = Path(os.environ.get("TRANSLATIONSUB_DB_PATH", "/tmp/lampac-runtime/database/translationsub.db"))

_ALLOWED_MODES = {"healthy", "500", "timeout"}
_state = {"mode": "healthy"}
_state_lock = threading.Lock()


class FixtureServer(ThreadingHTTPServer):
    request_queue_size = 32
    daemon_threads = True


class PhantomFixtureHandler(BaseHTTPRequestHandler):
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
        if mode not in _ALLOWED_MODES:
            self._json({"error": "invalid_mode", "mode": mode}, status=400)
            return

        with _state_lock:
            _state["mode"] = mode
        self._json({"ok": True, "mode": mode})

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/health":
            self._json({"ok": True})
            return
        if parsed.path == "/state":
            with _state_lock:
                self._json(dict(_state))
            return
        if not parsed.path.startswith("/meta"):
            self._json({"error": "not_found"}, status=404)
            return

        with _state_lock:
            mode = _state["mode"]

        if mode == "500":
            self._json({"error": "phantom_fixture_failure"}, status=500)
            return
        if mode == "timeout":
            time.sleep(35)

        self._json({
            "type": "episode",
            "data": [
                {"name": "Episode 1", "s": 1, "e": 1, "method": "play", "voice_name": "Phantom CI Voice", "voice_id": "phantom-ci-voice"},
                {"name": "Episode 2", "s": 1, "e": 2, "method": "play", "voice_name": "Phantom CI Voice", "voice_id": "phantom-ci-voice"},
                {"name": "Episode 3", "s": 1, "e": 3, "method": "play", "voice_name": "Phantom CI Voice", "voice_id": "phantom-ci-voice"},
            ],
        })


def serve_fixture():
    server = FixtureServer(("127.0.0.1", 9123), PhantomFixtureHandler)
    print("TranslationSub Phantom fault fixture listening on 127.0.0.1:9123", flush=True)
    server.serve_forever()


def http_json(method, url, payload=None, timeout=50):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
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


def api(method, path, payload=None, timeout=50):
    return http_json(method, BASE + path, payload=payload, timeout=timeout)


def require_ok(result, context):
    status, body = result
    assert status == 200, (context, status, body)
    assert isinstance(body, dict), (context, body)
    return body


def set_phantom_mode(mode):
    status, body = http_json("POST", PHANTOM_FIXTURE + "/control", {"mode": mode}, timeout=5)
    assert status == 200 and body == {"ok": True, "mode": mode}, (mode, status, body)


def set_flix_mode(mode):
    status, body = http_json("POST", FLIX_FIXTURE + "/control", {"metadata": mode}, timeout=5)
    assert status == 200 and isinstance(body, dict) and body.get("ok") is True, (mode, status, body)
    assert body.get("metadata") == mode, body


def uid_q(uid):
    return urllib.parse.quote(uid, safe="")


def card(label, tmdb_id):
    return {
        "id": tmdb_id,
        "content_id": f"ci-{label}",
        "source": "custom",
        "media_type": "tv",
        "title": f"CI {label}",
        "original_name": f"CI {label}",
        "season": 1,
        "tmdb_id": str(tmdb_id),
        "imdb_id": "tt0903747",
        "kinopoisk_id": "404900",
        "first_air_date": "2026-01-01",
    }


def settings(uid):
    return api("GET", f"/translationsub/v2/settings?uid={uid_q(uid)}")


def save_settings(uid, sources):
    return api("POST", f"/translationsub/v2/settings?uid={uid_q(uid)}", {
        "checkIntervalHours": 6,
        "sources": sources,
        "useTmdbSchedule": False,
        "tmdbRefreshHours": 24,
        "endedRefreshDays": 7,
        "newSeasonMode": "auto",
    })


def content_state(uid, card_value, timeout=50):
    return api("POST", f"/translationsub/v2/content-state?uid={uid_q(uid)}", {
        "card": card_value,
        "includeVoices": True,
    }, timeout=timeout)


def subscribe(uid, card_value, voice):
    return api("POST", f"/translationsub/v2/subscriptions?uid={uid_q(uid)}", {
        "card": card_value,
        "voiceId": voice.get("id"),
        "voiceName": voice.get("name"),
    })


def snapshot(uid):
    return api("GET", f"/translationsub/v2/snapshot?uid={uid_q(uid)}&profile_id=0")


def available_sources(uid):
    body = require_ok(settings(uid), "source discovery")
    return {
        str(item.get("id") or "").strip().lower()
        for item in (body.get("availableSourceItems") or [])
        if isinstance(item, dict)
    }


def assert_db_integrity():
    assert DB.is_file(), f"TranslationSub database not found: {DB}"
    with sqlite3.connect(DB, timeout=10) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def db_state(uid):
    with sqlite3.connect(DB, timeout=10) as conn:
        conn.row_factory = sqlite3.Row
        settings_rows = conn.execute(
            "SELECT uid, check_interval_hours, sources_json, use_tmdb_schedule, "
            "tmdb_refresh_hours, ended_refresh_days, new_season_mode "
            "FROM settings WHERE uid = ?",
            (uid,),
        ).fetchall()
        subscription_rows = conn.execute(
            "SELECT id, uid, content_id, translation_id, translation_name, "
            "current_season, last_season, last_episode "
            "FROM subscriptions WHERE uid = ? ORDER BY id",
            (uid,),
        ).fetchall()
        progress_rows = conn.execute(
            "SELECT uid, profile_id, subscription_id, watched_episode "
            "FROM profile_progress WHERE uid = ? ORDER BY profile_id, subscription_id",
            (uid,),
        ).fetchall()
    return {
        "settings": [dict(row) for row in settings_rows],
        "subscriptions": [dict(row) for row in subscription_rows],
        "progress": [dict(row) for row in progress_rows],
    }


def find_voice(state, name):
    return next((voice for voice in (state.get("voices") or []) if voice.get("name") == name), None)


def assert_single_snapshot(uid, subscription_id, translation_name):
    body = require_ok(snapshot(uid), f"snapshot {uid}")
    subs = body.get("subscriptions") or []
    assert len(subs) == 1, body
    sub = subs[0]
    assert sub.get("id") == subscription_id, sub
    assert sub.get("translationName") == translation_name, sub
    assert sub.get("availableEpisode") == 3, sub
    return body


def metadata_timeout_stage():
    uid = "fault-metadata-timeout@translationsub.test"
    card_value = card("Metadata Timeout", 31001)
    print("6. real 30s metadata timeout: state survives and source recovers", flush=True)

    sources = available_sources(uid)
    assert "phantom" in sources, f"Phantom source unavailable: {sorted(sources)}"

    set_phantom_mode("healthy")
    saved = require_ok(save_settings(uid, ["phantom"]), "timeout settings")
    assert saved.get("success") is True, saved

    healthy = require_ok(content_state(uid, card_value), "timeout healthy content-state")
    voice = find_voice(healthy, "Phantom CI Voice")
    assert voice and voice.get("latestEpisode") == 3, healthy

    created = require_ok(subscribe(uid, card_value, voice), "timeout baseline subscribe")
    assert created.get("success") is True, created
    subscription_id = created.get("subscriptionId")
    assert subscription_id, created
    assert_single_snapshot(uid, subscription_id, "Phantom CI Voice")
    baseline = db_state(uid)
    assert len(baseline["settings"]) == 1 and len(baseline["subscriptions"]) == 1, baseline

    set_phantom_mode("timeout")
    started = time.monotonic()
    timed = require_ok(content_state(uid, card_value, timeout=45), "metadata timeout content-state")
    elapsed = time.monotonic() - started
    assert elapsed >= 25, f"metadata timeout returned too early: {elapsed:.2f}s"
    assert elapsed < 45, f"metadata timeout exceeded client bound: {elapsed:.2f}s"
    assert timed.get("eligible") is True, timed
    assert (timed.get("button") or {}).get("subscribed") is True, timed
    assert (timed.get("voices") or []) == [], timed
    assert timed.get("reason") == "voices_not_found", timed

    assert_single_snapshot(uid, subscription_id, "Phantom CI Voice")
    assert_db_integrity()
    assert db_state(uid) == baseline, (baseline, db_state(uid))

    set_phantom_mode("healthy")
    recovered = require_ok(content_state(uid, card_value), "metadata timeout recovery")
    recovered_voice = find_voice(recovered, "Phantom CI Voice")
    assert recovered_voice, recovered
    assert recovered_voice.get("subscribed") is True, recovered_voice
    assert recovered_voice.get("subscriptionId") == subscription_id, recovered_voice
    assert recovered_voice.get("latestEpisode") == 3, recovered_voice
    assert db_state(uid) == baseline, (baseline, db_state(uid))
    assert_db_integrity()


def source_fallback_stage():
    uid = "fault-source-fallback@translationsub.test"
    card_value = card("Source Fallback", 31002)
    print("7. one failed balancer with a healthy second balancer", flush=True)

    sources = available_sources(uid)
    required = {"flixcdn", "phantom"}
    assert required.issubset(sources), f"required sources unavailable: required={sorted(required)} actual={sorted(sources)}"

    saved = require_ok(save_settings(uid, ["flixcdn", "phantom"]), "fallback settings")
    assert saved.get("success") is True, saved

    set_flix_mode("500")
    set_phantom_mode("healthy")
    phantom_only = require_ok(content_state(uid, card_value), "FlixCDN down / Phantom healthy")
    phantom_voice = find_voice(phantom_only, "Phantom CI Voice")
    assert phantom_voice and phantom_voice.get("latestEpisode") == 3, phantom_only
    assert find_voice(phantom_only, "CI Voice") is None, phantom_only

    created = require_ok(subscribe(uid, card_value, phantom_voice), "fallback subscribe through Phantom")
    assert created.get("success") is True, created
    subscription_id = created.get("subscriptionId")
    assert subscription_id, created
    assert_single_snapshot(uid, subscription_id, "Phantom CI Voice")
    assert_db_integrity()

    set_flix_mode("healthy")
    set_phantom_mode("500")
    flix_only = require_ok(content_state(uid, card_value), "Phantom down / FlixCDN healthy")
    flix_voice = find_voice(flix_only, "CI Voice")
    assert flix_voice and flix_voice.get("latestEpisode") == 3, flix_only
    assert find_voice(flix_only, "Phantom CI Voice") is None, flix_only

    persisted = assert_single_snapshot(uid, subscription_id, "Phantom CI Voice")
    assert (persisted.get("subscriptions") or [])[0].get("availableEpisode") == 3, persisted
    state = db_state(uid)
    assert len(state["subscriptions"]) == 1, state
    assert state["subscriptions"][0]["translation_name"] == "Phantom CI Voice", state
    assert state["subscriptions"][0]["last_episode"] == 3, state
    assert_db_integrity()

    set_flix_mode("healthy")
    set_phantom_mode("healthy")
    both = require_ok(content_state(uid, card_value), "fallback recovery both healthy")
    assert find_voice(both, "CI Voice") is not None, both
    recovered_phantom = find_voice(both, "Phantom CI Voice")
    assert recovered_phantom is not None, both
    assert recovered_phantom.get("subscribed") is True, recovered_phantom
    assert recovered_phantom.get("subscriptionId") == subscription_id, recovered_phantom
    assert_db_integrity()


def run_suite():
    metadata_timeout_stage()
    source_fallback_stage()
    print("TranslationSub metadata timeout + source fallback stages passed", flush=True)


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "serve":
        serve_fixture()
        return
    if len(sys.argv) == 2 and sys.argv[1] == "run":
        run_suite()
        return
    raise SystemExit("usage: translationsub-fault-source-fallback.py [serve|run]")


if __name__ == "__main__":
    main()
