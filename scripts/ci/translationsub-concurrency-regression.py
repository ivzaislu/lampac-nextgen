#!/usr/bin/env python3
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = os.environ.get("TRANSLATIONSUB_BASE_URL", "http://127.0.0.1:9118").rstrip("/")
DB = Path(os.environ.get("TRANSLATIONSUB_DB_PATH", "/tmp/lampac-runtime/database/translationsub.db"))
USERS = [f"concurrency-{i}@translationsub.test" for i in range(12)]
SUB_USERS = USERS[:6]
LOCK_UID = "concurrency-lock@translationsub.test"
SAME_UID = "concurrency-same-user@translationsub.test"


class ConcurrencyHttpServer(ThreadingHTTPServer):
    request_queue_size = 128


class FixtureHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        return

    def _json(self, payload, status=200):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/health":
            self._json({"ok": True})
            return
        if parsed.path.startswith("/tmdb/tv/"):
            self._json({
                "id": 1396,
                "status": "Returning Series",
                "external_ids": {"imdb_id": "tt0903747"},
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
            self._json({"tv_results": [{"id": 1396}]})
            return

        self._json({
            "type": "episode",
            "data": [
                {"name": "Episode 1", "s": 1, "e": 1, "method": "play", "voice_name": "CI Voice", "voice_id": "ci-voice"},
                {"name": "Episode 2", "s": 1, "e": 2, "method": "play", "voice_name": "CI Voice", "voice_id": "ci-voice"},
                {"name": "Episode 3", "s": 1, "e": 3, "method": "play", "voice_name": "CI Voice", "voice_id": "ci-voice"},
            ],
        })


def serve_fixture():
    server = ConcurrencyHttpServer(("127.0.0.1", 9120), FixtureHandler)
    print("TranslationSub concurrency fixture listening on 127.0.0.1:9120", flush=True)
    server.serve_forever()


def request(method, path, payload=None, timeout=45):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
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


def q(uid):
    return urllib.parse.quote(uid, safe="")


def get_settings(uid):
    return request("GET", f"/translationsub/v2/settings?uid={q(uid)}")


def set_settings(uid, source, interval=6):
    return request("POST", f"/translationsub/v2/settings?uid={q(uid)}", {
        "checkIntervalHours": interval,
        "sources": [source],
        "useTmdbSchedule": False,
        "tmdbRefreshHours": 24,
        "endedRefreshDays": 7,
        "newSeasonMode": "auto",
    })


def snapshot(uid):
    return request("GET", f"/translationsub/v2/snapshot?uid={q(uid)}&profile_id=0")


def check(uid):
    return request("POST", f"/translationsub/v2/check?uid={q(uid)}&profile_id=0")


def card():
    return {
        "id": 1396,
        "content_id": "ci-concurrency-series",
        "source": "custom",
        "media_type": "tv",
        "title": "CI Concurrency Series",
        "original_name": "CI Concurrency Series",
        "season": 1,
        "tmdb_id": "1396",
        "imdb_id": "tt0903747",
        "kinopoisk_id": "404900",
        "first_air_date": "2026-01-01",
    }


def content_state(uid):
    return request("POST", f"/translationsub/v2/content-state?uid={q(uid)}", {
        "card": card(),
        "includeVoices": True,
    })


def subscribe(uid, voice_id, voice_name):
    return request("POST", f"/translationsub/v2/subscriptions?uid={q(uid)}", {
        "card": card(),
        "voiceId": voice_id,
        "voiceName": voice_name,
    })


def remove(uid, subscription_id):
    return request("POST", f"/translationsub/v2/subscriptions/{urllib.parse.quote(subscription_id, safe='')}/remove?uid={q(uid)}")


def require_ok(result, context):
    status, body = result
    assert status == 200, (context, status, body)
    assert isinstance(body, dict), (context, body)
    return body


def parallel(calls, workers=32):
    results = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(fn) for fn in calls]
        for future in as_completed(futures):
            results.append(future.result())
    return results


def selected_source():
    status, body = get_settings(USERS[0])
    body = require_ok((status, body), "source discovery")
    items = body.get("availableSourceItems") or []
    ids = [str(item.get("id") or "").strip().lower() for item in items if isinstance(item, dict)]
    source = next((candidate for candidate in ("flixcdn", "phantom", "zetflixdb", "videodb", "cdnvideohub") if candidate in ids), None)
    assert source, f"No deterministic source available: {ids}"
    return source


def assert_db_integrity():
    assert DB.is_file(), f"TranslationSub database not found: {DB}"
    with sqlite3.connect(DB, timeout=10) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def external_lock_test(source):
    print("1. external SQLite writer lock waits and recovers", flush=True)
    status, body = set_settings(LOCK_UID, source, interval=4)
    require_ok((status, body), "lock bootstrap")

    lock = sqlite3.connect(DB, timeout=10, isolation_level=None)
    lock.execute("BEGIN IMMEDIATE")
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(lambda: set_settings(LOCK_UID, source, interval=5))
        time.sleep(1.0)
        assert not future.done(), "API write unexpectedly completed while external SQLite writer lock was held"
        lock.execute("COMMIT")
        result = future.result(timeout=15)
    lock.close()
    elapsed = time.monotonic() - started
    body = require_ok(result, "write after external lock")
    assert body.get("success") is True, body
    assert elapsed >= 0.8, elapsed


def parallel_settings_and_reads(source):
    print("2. parallel settings writes and snapshots across users", flush=True)
    calls = []
    expected = {}
    for i, uid in enumerate(USERS):
        interval = 1 + (i % 24)
        expected[uid] = interval
        for _ in range(8):
            calls.append(lambda uid=uid, interval=interval: set_settings(uid, source, interval))
            calls.append(lambda uid=uid: snapshot(uid))

    results = parallel(calls, workers=40)
    for result in results:
        body = require_ok(result, "parallel settings/snapshot")
        if "settings" in body:
            assert body.get("success") is True, body
        else:
            assert isinstance(body.get("subscriptions"), list), body

    with sqlite3.connect(DB, timeout=10) as conn:
        rows = conn.execute(
            "SELECT uid, check_interval_hours, sources_json FROM settings WHERE uid LIKE 'concurrency-%@translationsub.test'"
        ).fetchall()
    values = {row[0]: (row[1], json.loads(row[2])) for row in rows}
    for uid, interval in expected.items():
        assert values.get(uid) == (interval, [source]), (uid, values.get(uid))


def same_user_settings_race(source):
    print("3. same-user settings race preserves one valid row", flush=True)
    allowed = {3, 7, 11, 19}
    calls = []
    for interval in list(allowed) * 6:
        calls.append(lambda interval=interval: set_settings(SAME_UID, source, interval))
    for result in parallel(calls, workers=24):
        body = require_ok(result, "same-user settings race")
        assert body.get("success") is True, body

    with sqlite3.connect(DB, timeout=10) as conn:
        rows = conn.execute(
            "SELECT check_interval_hours, sources_json FROM settings WHERE uid = ?", (SAME_UID,)
        ).fetchall()
    assert len(rows) == 1, rows
    assert rows[0][0] in allowed, rows
    assert json.loads(rows[0][1]) == [source], rows


def concurrent_subscribe(source):
    print("4. concurrent metadata reads return the same canonical voice", flush=True)
    for uid in SUB_USERS:
        body = require_ok(set_settings(uid, source, 6), f"subscription settings {uid}")
        assert body.get("success") is True, body

    voice_ids = set()
    voice_names = set()
    calls = [lambda uid=uid: content_state(uid) for uid in SUB_USERS for _ in range(4)]
    for result in parallel(calls, workers=24):
        body = require_ok(result, "concurrent content-state")
        assert body.get("eligible") is True, body
        voices = body.get("voices") or []
        assert len(voices) == 1, body
        voice = voices[0]
        assert voice.get("latestEpisode") == 3, voice
        voice_ids.add(voice.get("id"))
        voice_names.add(voice.get("name"))

    assert len(voice_ids) == 1 and None not in voice_ids, voice_ids
    assert voice_names == {"CI Voice"}, voice_names
    voice_id = next(iter(voice_ids))
    voice_name = next(iter(voice_names))

    print(f"5. duplicate concurrent subscribe is idempotent per uid; voice={voice_id}", flush=True)
    calls = []
    labels = []
    for uid in SUB_USERS:
        for _ in range(6):
            calls.append(lambda uid=uid: subscribe(uid, voice_id, voice_name))
            labels.append(uid)

    ids_by_uid = {uid: set() for uid in SUB_USERS}
    with ThreadPoolExecutor(max_workers=36) as pool:
        future_to_uid = {pool.submit(fn): uid for fn, uid in zip(calls, labels)}
        for future in as_completed(future_to_uid):
            uid = future_to_uid[future]
            body = require_ok(future.result(), f"subscribe {uid}")
            assert body.get("success") is True, body
            subscription_id = body.get("subscriptionId")
            assert subscription_id, body
            ids_by_uid[uid].add(subscription_id)

    for uid, ids in ids_by_uid.items():
        assert len(ids) == 1, (uid, ids)

    with sqlite3.connect(DB, timeout=10) as conn:
        rows = conn.execute(
            "SELECT uid, COUNT(*), COUNT(DISTINCT id) FROM subscriptions WHERE uid IN (%s) GROUP BY uid" % ",".join("?" for _ in SUB_USERS),
            SUB_USERS,
        ).fetchall()
    counts = {row[0]: (row[1], row[2]) for row in rows}
    for uid in SUB_USERS:
        assert counts.get(uid) == (1, 1), (uid, counts.get(uid))
    return {uid: next(iter(ids)) for uid, ids in ids_by_uid.items()}


def mixed_check_snapshot_settings(source):
    print("6. checks, snapshots and settings run concurrently without lost subscriptions", flush=True)
    calls = []
    kinds = []
    for uid in SUB_USERS:
        for _ in range(4):
            calls.extend([
                lambda uid=uid: check(uid),
                lambda uid=uid: snapshot(uid),
                lambda uid=uid: set_settings(uid, source, 6),
            ])
            kinds.extend(["check", "snapshot", "settings"])

    with ThreadPoolExecutor(max_workers=36) as pool:
        futures = [(pool.submit(fn), kind) for fn, kind in zip(calls, kinds)]
        for future, kind in futures:
            body = require_ok(future.result(), f"mixed {kind}")
            if kind == "check":
                assert body.get("success") is True and isinstance(body.get("snapshot"), dict), body
            elif kind == "snapshot":
                assert len(body.get("subscriptions") or []) == 1, body
            else:
                assert body.get("success") is True, body

    with sqlite3.connect(DB, timeout=10) as conn:
        rows = conn.execute(
            "SELECT uid, COUNT(*) FROM subscriptions WHERE uid IN (%s) GROUP BY uid" % ",".join("?" for _ in SUB_USERS),
            SUB_USERS,
        ).fetchall()
    counts = dict(rows)
    assert all(counts.get(uid) == 1 for uid in SUB_USERS), counts


def concurrent_remove(subscription_ids):
    print("7. concurrent remove has exactly one winner per subscription", flush=True)
    for uid, subscription_id in subscription_ids.items():
        calls = [lambda uid=uid, sid=subscription_id: remove(uid, sid) for _ in range(6)]
        results = parallel(calls, workers=6)
        successes = 0
        misses = 0
        for result in results:
            body = require_ok(result, f"remove {uid}")
            if body.get("success") is True:
                successes += 1
            elif body.get("error") == "subscription_not_found":
                misses += 1
            else:
                raise AssertionError((uid, body))
        assert successes == 1 and misses == 5, (uid, successes, misses)

    with sqlite3.connect(DB, timeout=10) as conn:
        remaining = conn.execute(
            "SELECT COUNT(*) FROM subscriptions WHERE uid IN (%s)" % ",".join("?" for _ in SUB_USERS),
            SUB_USERS,
        ).fetchone()[0]
    assert remaining == 0, remaining


def final_invariants(source):
    print("8. final SQLite invariants", flush=True)
    assert_db_integrity()
    legacy = DB.parent / "translationsub"
    for name in ("settings.json", "subscriptions.json", "profile-progress.json"):
        assert not (legacy / name).exists(), f"legacy JSON store reappeared: {name}"

    with sqlite3.connect(DB, timeout=10) as conn:
        duplicate_settings = conn.execute(
            "SELECT uid, COUNT(*) FROM settings GROUP BY uid HAVING COUNT(*) > 1"
        ).fetchall()
        duplicate_subscriptions = conn.execute(
            "SELECT uid, content_id, translation_name, COUNT(*) FROM subscriptions "
            "GROUP BY uid, content_id, translation_name HAVING COUNT(*) > 1"
        ).fetchall()
        lock_row = conn.execute(
            "SELECT check_interval_hours, sources_json FROM settings WHERE uid = ?", (LOCK_UID,)
        ).fetchone()
    assert duplicate_settings == [], duplicate_settings
    assert duplicate_subscriptions == [], duplicate_subscriptions
    assert lock_row and lock_row[0] == 5 and json.loads(lock_row[1]) == [source], lock_row


def run_suite():
    source = selected_source()
    print(f"TranslationSub concurrency source={source}", flush=True)
    require_ok(set_settings(LOCK_UID, source, 4), "database bootstrap")
    assert_db_integrity()

    external_lock_test(source)
    parallel_settings_and_reads(source)
    same_user_settings_race(source)
    subscription_ids = concurrent_subscribe(source)
    mixed_check_snapshot_settings(source)
    concurrent_remove(subscription_ids)
    final_invariants(source)
    print("TranslationSub concurrency regression passed", flush=True)


def main():
    mode = sys.argv[1].lower() if len(sys.argv) > 1 else "run"
    if mode == "serve":
        serve_fixture()
    elif mode == "run":
        run_suite()
    else:
        raise SystemExit("usage: translationsub-concurrency-regression.py serve|run")


if __name__ == "__main__":
    main()
