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
FIXTURE = os.environ.get("TRANSLATIONSUB_FAULT_FIXTURE", "http://127.0.0.1:9122").rstrip("/")
DB = Path(os.environ.get("TRANSLATIONSUB_DB_PATH", "/tmp/lampac-runtime/database/translationsub.db"))
UID = "fault-metadata@translationsub.test"
PROFILE_ID = "0"
UID_Q = urllib.parse.quote(UID, safe="")

_ALLOWED_METADATA_MODES = {"healthy", "404", "500", "malformed", "empty", "disconnect"}
_ALLOWED_TMDB_MODES = {"healthy", "404", "500", "malformed", "empty", "disconnect", "timeout"}
_state = {"metadata": "healthy", "tmdb": "healthy"}
_state_lock = threading.Lock()


class FaultHttpServer(ThreadingHTTPServer):
    request_queue_size = 64
    daemon_threads = True


class FixtureHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        return

    def _raw(self, raw, status=200, content_type="application/json; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
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

        updates = {}
        if "metadata" in payload:
            metadata = str(payload.get("metadata") or "").strip().lower()
            if metadata not in _ALLOWED_METADATA_MODES:
                self._json({"error": "invalid_metadata_mode", "mode": metadata}, status=400)
                return
            updates["metadata"] = metadata
        if "tmdb" in payload:
            tmdb = str(payload.get("tmdb") or "").strip().lower()
            if tmdb not in _ALLOWED_TMDB_MODES:
                self._json({"error": "invalid_tmdb_mode", "mode": tmdb}, status=400)
                return
            updates["tmdb"] = tmdb
        if not updates:
            self._json({"error": "no_updates"}, status=400)
            return

        with _state_lock:
            _state.update(updates)
            current = dict(_state)
        self._json({"ok": True, **current})

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/health":
            self._json({"ok": True})
            return
        if parsed.path == "/state":
            with _state_lock:
                self._json(dict(_state))
            return

        if parsed.path.startswith("/tmdb/tv/"):
            with _state_lock:
                mode = _state["tmdb"]

            if mode == "404":
                self._json({"status_code": 34, "status_message": "not found"}, status=404)
                return
            if mode == "500":
                self._json({"status_message": "fixture failure"}, status=500)
                return
            if mode == "malformed":
                self._raw(b'{"id":', status=200)
                return
            if mode == "empty":
                self._raw(b"", status=200)
                return
            if mode == "disconnect":
                self.close_connection = True
                try:
                    self.connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                self.connection.close()
                return
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
            return

        if parsed.path.startswith("/tmdb/find/"):
            self._json({"tv_results": []})
            return

        if parsed.path.startswith("/meta"):
            with _state_lock:
                mode = _state["metadata"]

            if mode == "404":
                self._json({"error": "fixture_not_found"}, status=404)
                return
            if mode == "500":
                self._json({"error": "fixture_failure"}, status=500)
                return
            if mode == "malformed":
                self._raw(b'{"type":"episode","data":[', status=200)
                return
            if mode == "empty":
                self._raw(b"", status=200)
                return
            if mode == "disconnect":
                self.close_connection = True
                try:
                    self.connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                self.connection.close()
                return

            self._json({
                "type": "episode",
                "data": [
                    {"name": "Episode 1", "s": 1, "e": 1, "method": "play", "voice_name": "CI Voice", "voice_id": "ci-voice"},
                    {"name": "Episode 2", "s": 1, "e": 2, "method": "play", "voice_name": "CI Voice", "voice_id": "ci-voice"},
                    {"name": "Episode 3", "s": 1, "e": 3, "method": "play", "voice_name": "CI Voice", "voice_id": "ci-voice"},
                ],
            })
            return

        self._json({"error": "not_found"}, status=404)


def serve_fixture():
    server = FaultHttpServer(("127.0.0.1", 9122), FixtureHandler)
    print("TranslationSub fault-injection fixture listening on 127.0.0.1:9122", flush=True)
    server.serve_forever()


def http_json(method, url, payload=None, timeout=45):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            body = json.loads(raw) if raw else None
            return response.status, body
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            body = json.loads(raw) if raw else raw
        except Exception:
            body = raw
        return exc.code, body
    except urllib.error.URLError as exc:
        return 0, str(exc)


def request(method, path, payload=None, timeout=45):
    return http_json(method, BASE + path, payload=payload, timeout=timeout)


def control(metadata=None, tmdb=None):
    payload = {}
    if metadata is not None:
        payload["metadata"] = metadata
    if tmdb is not None:
        payload["tmdb"] = tmdb
    status, body = http_json("POST", FIXTURE + "/control", payload, timeout=5)
    assert status == 200 and isinstance(body, dict) and body.get("ok") is True, (payload, status, body)
    if metadata is not None:
        assert body.get("metadata") == metadata, body
    if tmdb is not None:
        assert body.get("tmdb") == tmdb, body
    return body


def require_ok(result, context):
    status, body = result
    assert status == 200, (context, status, body)
    assert isinstance(body, dict), (context, body)
    return body


def card():
    return {
        "id": 1396,
        "content_id": "ci-fault-series",
        "source": "custom",
        "media_type": "tv",
        "title": "CI Fault Series",
        "original_name": "CI Fault Series",
        "season": 1,
        "tmdb_id": "1396",
        "imdb_id": "tt0903747",
        "kinopoisk_id": "404900",
        "first_air_date": "2026-01-01",
    }


def get_settings():
    return request("GET", f"/translationsub/v2/settings?uid={UID_Q}")


def set_settings(source):
    return request("POST", f"/translationsub/v2/settings?uid={UID_Q}", {
        "checkIntervalHours": 6,
        "sources": [source],
        "useTmdbSchedule": False,
        "tmdbRefreshHours": 24,
        "endedRefreshDays": 7,
        "newSeasonMode": "auto",
    })


def content_state(include_voices=True):
    return request("POST", f"/translationsub/v2/content-state?uid={UID_Q}", {
        "card": card(),
        "includeVoices": include_voices,
    })


def subscribe(voice_id, voice_name):
    return request("POST", f"/translationsub/v2/subscriptions?uid={UID_Q}", {
        "card": card(),
        "voiceId": voice_id,
        "voiceName": voice_name,
    })


def check():
    return request("POST", f"/translationsub/v2/check?uid={UID_Q}&profile_id={PROFILE_ID}")


def snapshot():
    return request("GET", f"/translationsub/v2/snapshot?uid={UID_Q}&profile_id={PROFILE_ID}")


def user_q(uid):
    return urllib.parse.quote(uid, safe="")


def tmdb_card(tmdb_id, label):
    return {
        "id": tmdb_id,
        "content_id": f"ci-tmdb-{label}",
        "source": "custom",
        "media_type": "tv",
        "title": f"CI TMDB {label}",
        "original_name": f"CI TMDB {label}",
        "season": 1,
        "tmdb_id": str(tmdb_id),
        "imdb_id": "none",
        "kinopoisk_id": "404900",
        "first_air_date": "2026-01-01",
    }


def set_user_settings(uid, source, use_tmdb):
    return request("POST", f"/translationsub/v2/settings?uid={user_q(uid)}", {
        "checkIntervalHours": 6,
        "sources": [source],
        "useTmdbSchedule": use_tmdb,
        "tmdbRefreshHours": 6,
        "endedRefreshDays": 7,
        "newSeasonMode": "auto",
    })


def user_content_state(uid, card_value):
    return request("POST", f"/translationsub/v2/content-state?uid={user_q(uid)}", {
        "card": card_value,
        "includeVoices": True,
    })


def user_subscribe(uid, card_value, voice_id, voice_name):
    return request("POST", f"/translationsub/v2/subscriptions?uid={user_q(uid)}", {
        "card": card_value,
        "voiceId": voice_id,
        "voiceName": voice_name,
    }, timeout=45)


def user_check(uid):
    return request("POST", f"/translationsub/v2/check?uid={user_q(uid)}&profile_id=0", timeout=45)


def user_snapshot(uid):
    return request("GET", f"/translationsub/v2/snapshot?uid={user_q(uid)}&profile_id=0")


def selected_source():
    body = require_ok(get_settings(), "source discovery")
    items = body.get("availableSourceItems") or []
    ids = {
        str(item.get("id") or "").strip().lower()
        for item in items
        if isinstance(item, dict)
    }
    assert "flixcdn" in ids, f"FlixCDN fixture source unavailable: {sorted(ids)}"
    return "flixcdn"


def assert_db_integrity():
    assert DB.is_file(), f"TranslationSub database not found: {DB}"
    with sqlite3.connect(DB, timeout=10) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def critical_db_state():
    with sqlite3.connect(DB, timeout=10) as conn:
        conn.row_factory = sqlite3.Row
        settings = conn.execute(
            "SELECT uid, check_interval_hours, sources_json, use_tmdb_schedule, "
            "tmdb_refresh_hours, ended_refresh_days, new_season_mode "
            "FROM settings WHERE uid = ?",
            (UID,),
        ).fetchall()
        subscriptions = conn.execute(
            "SELECT id, uid, content_id, translation_id, translation_name, "
            "current_season, last_season, last_episode "
            "FROM subscriptions WHERE uid = ? ORDER BY id",
            (UID,),
        ).fetchall()
        progress = conn.execute(
            "SELECT uid, profile_id, subscription_id, watched_episode "
            "FROM profile_progress WHERE uid = ? ORDER BY profile_id, subscription_id",
            (UID,),
        ).fetchall()

    return {
        "settings": [dict(row) for row in settings],
        "subscriptions": [dict(row) for row in subscriptions],
        "progress": [dict(row) for row in progress],
    }


def assert_snapshot(subscription_id, expected_episode=3):
    body = require_ok(snapshot(), "snapshot")
    subs = body.get("subscriptions") or []
    assert len(subs) == 1, body
    sub = subs[0]
    assert sub.get("id") == subscription_id, sub
    assert sub.get("translationName") == "CI Voice", sub
    assert sub.get("availableEpisode") == expected_episode, sub
    return body


def bootstrap():
    print("1. bootstrap a healthy persisted subscription", flush=True)
    control("healthy")
    source = selected_source()
    body = require_ok(set_settings(source), "save settings")
    assert body.get("success") is True, body

    state = require_ok(content_state(True), "healthy content-state")
    assert state.get("eligible") is True, state
    voices = state.get("voices") or []
    assert len(voices) == 1, state
    voice = voices[0]
    assert voice.get("name") == "CI Voice" and voice.get("latestEpisode") == 3, voice

    created = require_ok(subscribe(voice.get("id"), voice.get("name")), "healthy subscribe")
    assert created.get("success") is True, created
    subscription_id = created.get("subscriptionId")
    assert subscription_id, created

    assert_snapshot(subscription_id)
    assert_db_integrity()
    baseline = critical_db_state()
    assert len(baseline["settings"]) == 1, baseline
    assert len(baseline["subscriptions"]) == 1, baseline
    return source, voice, subscription_id, baseline


def fault_case(mode, voice, subscription_id, baseline):
    print(f"2. metadata fault={mode}: controlled API + no state corruption", flush=True)
    control(mode)

    state = require_ok(content_state(True), f"{mode} content-state")
    assert state.get("eligible") is True, state
    assert (state.get("button") or {}).get("subscribed") is True, state
    assert (state.get("voices") or []) == [], state
    assert state.get("reason") == "voices_not_found", state

    duplicate = require_ok(
        subscribe(voice.get("id"), voice.get("name")),
        f"{mode} duplicate subscribe",
    )
    assert duplicate.get("success") is False, duplicate
    assert duplicate.get("error") == "voice_not_found", duplicate

    checked = require_ok(check(), f"{mode} check")
    assert checked.get("success") is True and isinstance(checked.get("snapshot"), dict), checked
    checked_subs = checked["snapshot"].get("subscriptions") or []
    assert len(checked_subs) == 1, checked
    assert checked_subs[0].get("id") == subscription_id, checked_subs[0]
    assert checked_subs[0].get("availableEpisode") == 3, checked_subs[0]
    assert checked_subs[0].get("translationName") == "CI Voice", checked_subs[0]

    assert_snapshot(subscription_id)
    assert_db_integrity()
    current = critical_db_state()
    assert current == baseline, (mode, baseline, current)


def recovery(voice, subscription_id, baseline):
    print("3. restore healthy metadata without restarting Lampac", flush=True)
    control("healthy")

    state = require_ok(content_state(True), "recovery content-state")
    assert state.get("eligible") is True, state
    voices = state.get("voices") or []
    assert len(voices) == 1, state
    recovered = voices[0]
    assert recovered.get("name") == "CI Voice", recovered
    assert recovered.get("latestEpisode") == 3, recovered
    assert recovered.get("subscribed") is True, recovered
    assert recovered.get("subscriptionId") == subscription_id, recovered

    again = require_ok(subscribe(voice.get("id"), voice.get("name")), "recovery idempotent subscribe")
    assert again.get("success") is True, again
    assert again.get("subscriptionId") == subscription_id, again

    checked = require_ok(check(), "recovery check")
    assert checked.get("success") is True, checked
    assert_snapshot(subscription_id)
    assert_db_integrity()
    current = critical_db_state()
    assert current == baseline, (baseline, current)


def tmdb_row(uid):
    with sqlite3.connect(DB, timeout=10) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT id, uid, tmdb_id, translation_name, last_episode, "
            "tmdb_status, tmdb_last_season, tmdb_last_episode, "
            "tmdb_target_season_episodes, tmdb_last_synced_at "
            "FROM subscriptions WHERE uid = ?",
            (uid,),
        ).fetchone()
    return dict(row) if row else None


def tmdb_fault_case(source, mode, tmdb_id):
    uid = f"fault-tmdb-{mode}@translationsub.test"
    label = mode.replace("-", "_")
    card_value = tmdb_card(tmdb_id, label)

    print(f"4. TMDB fault={mode}: subscription/check survive", flush=True)
    control(metadata="healthy", tmdb=mode)

    saved = require_ok(set_user_settings(uid, source, True), f"{mode} TMDB settings")
    assert saved.get("success") is True, saved

    started = time.monotonic()
    state = require_ok(user_content_state(uid, card_value), f"{mode} TMDB content-state")
    content_elapsed = time.monotonic() - started
    assert state.get("eligible") is True, state
    voices = state.get("voices") or []
    assert len(voices) == 1, state
    voice = voices[0]
    assert voice.get("name") == "CI Voice" and voice.get("latestEpisode") == 3, voice
    if mode == "timeout":
        assert content_elapsed >= 10, content_elapsed

    started = time.monotonic()
    created = require_ok(
        user_subscribe(uid, card_value, voice.get("id"), voice.get("name")),
        f"{mode} TMDB subscribe",
    )
    subscribe_elapsed = time.monotonic() - started
    assert created.get("success") is True, created
    subscription_id = created.get("subscriptionId")
    assert subscription_id, created
    if mode == "timeout":
        assert subscribe_elapsed >= 20, subscribe_elapsed

    before = tmdb_row(uid)
    assert before is not None, uid
    assert before["id"] == subscription_id, before
    assert before["translation_name"] == "CI Voice", before
    assert before["last_episode"] == 3, before
    assert before["tmdb_last_synced_at"] is None, before

    checked = require_ok(user_check(uid), f"{mode} TMDB check")
    assert checked.get("success") is True, checked
    subs = (checked.get("snapshot") or {}).get("subscriptions") or []
    assert len(subs) == 1 and subs[0].get("id") == subscription_id, checked
    assert subs[0].get("availableEpisode") == 3, subs[0]

    after = tmdb_row(uid)
    assert after is not None, uid
    for key in ("id", "uid", "tmdb_id", "translation_name", "last_episode"):
        assert after[key] == before[key], (mode, key, before, after)
    assert after["tmdb_last_synced_at"] is None, after
    assert_db_integrity()
    return uid, card_value, voice, subscription_id


def tmdb_recovery(source):
    print("5. TMDB recovers without Lampac restart", flush=True)
    uid = "fault-tmdb-recovery@translationsub.test"
    card_value = tmdb_card(22999, "recovery")

    control(metadata="healthy", tmdb="500")
    saved = require_ok(set_user_settings(uid, source, True), "TMDB recovery settings")
    assert saved.get("success") is True, saved
    state = require_ok(user_content_state(uid, card_value), "TMDB recovery content-state")
    voice = (state.get("voices") or [None])[0]
    assert isinstance(voice, dict) and voice.get("name") == "CI Voice", state
    created = require_ok(
        user_subscribe(uid, card_value, voice.get("id"), voice.get("name")),
        "TMDB recovery subscribe",
    )
    assert created.get("success") is True, created
    subscription_id = created.get("subscriptionId")
    failed_row = tmdb_row(uid)
    assert failed_row and failed_row["tmdb_last_synced_at"] is None, failed_row

    control(tmdb="healthy")
    checked = require_ok(user_check(uid), "TMDB recovery check")
    assert checked.get("success") is True, checked

    recovered = tmdb_row(uid)
    assert recovered and recovered["id"] == subscription_id, recovered
    assert recovered["tmdb_status"] == "Returning Series", recovered
    assert recovered["tmdb_last_season"] == 1, recovered
    assert recovered["tmdb_last_episode"] == 3, recovered
    assert recovered["tmdb_target_season_episodes"] == 3, recovered
    assert recovered["tmdb_last_synced_at"], recovered
    assert recovered["last_episode"] == 3, recovered
    assert_db_integrity()


def run_tmdb_stage(source):
    modes = [
        ("404", 22001),
        ("500", 22002),
        ("malformed", 22003),
        ("empty", 22004),
        ("disconnect", 22005),
        ("timeout", 22006),
    ]
    for mode, tmdb_id in modes:
        tmdb_fault_case(source, mode, tmdb_id)
    tmdb_recovery(source)
    print("TranslationSub TMDB fault-injection stage passed", flush=True)


def run_suite():
    source, voice, subscription_id, baseline = bootstrap()
    print(f"fixture source={source}; subscription={subscription_id}", flush=True)

    for mode in ("404", "500", "malformed", "empty", "disconnect"):
        fault_case(mode, voice, subscription_id, baseline)

    recovery(voice, subscription_id, baseline)
    print("TranslationSub metadata fault-injection stage passed", flush=True)

    run_tmdb_stage(source)


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "serve":
        serve_fixture()
        return
    if len(sys.argv) == 2 and sys.argv[1] == "run":
        run_suite()
        return
    raise SystemExit("usage: translationsub-fault-injection-regression.py [serve|run]")


if __name__ == "__main__":
    main()
