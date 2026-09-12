#!/usr/bin/env python3
import json
import re
import sqlite3
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = "http://127.0.0.1:9118"
UID = "snapshot-progress@translationsub.test"
UID_Q = urllib.parse.quote(UID, safe="")
TRANSLATIONSUB_DB = Path("/tmp/lampac-runtime/database/translationsub.db")
TIMECODE_DB = Path("/tmp/lampac-runtime/database/TimeCode.sql")

fixture = {"episodes": 3}
hits = {"metadata": 0, "tmdb": 0}
requests_seen = []


class StubHandler(BaseHTTPRequestHandler):
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
        requests_seen.append(self.path)

        if parsed.path.startswith("/tmdb/tv/"):
            hits["tmdb"] += 1
            count = int(fixture["episodes"])
            self._json({
                "id": 1396,
                "status": "Returning Series",
                "external_ids": {"imdb_id": "tt0903747"},
                "last_episode_to_air": {
                    "season_number": 1,
                    "episode_number": count,
                    "air_date": "2026-01-01",
                },
                "next_episode_to_air": None,
                "seasons": [
                    {"season_number": 1, "episode_count": count}
                ],
            })
            return

        if parsed.path.startswith("/tmdb/find/"):
            hits["tmdb"] += 1
            self._json({"tv_results": [{"id": 1396}]})
            return

        hits["metadata"] += 1
        rows = []
        for episode in range(1, int(fixture["episodes"]) + 1):
            rows.append({
                "name": f"Episode {episode}",
                "s": 1,
                "e": episode,
                "method": "play",
                "voice_name": "CI Voice",
                "voice_id": "ci-voice",
            })
        self._json({"type": "episode", "data": rows})


def start_stub():
    server = ThreadingHTTPServer(("127.0.0.1", 9120), StubHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def request(method, path, payload=None, raw_body=None):
    headers = {"Content-Type": "application/json"}
    data = None
    if raw_body is not None:
        data = raw_body
    elif payload is not None:
        data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            body = json.loads(raw) if raw else None
        except Exception:
            body = raw
        return exc.code, body


def get(path):
    return request("GET", path)


def post(path, payload=None, raw_body=None):
    return request("POST", path, payload=payload, raw_body=raw_body)


def assert_json_ok(status, body):
    assert status == 200, (status, body)
    assert isinstance(body, dict), body


def settings(sources):
    status, body = post(
        f"/translationsub/v2/settings?uid={UID_Q}",
        {"sources": sources, "useTmdbSchedule": False},
    )
    assert_json_ok(status, body)
    assert body.get("success") is True, body
    return body


def source_ids(settings_body):
    items = settings_body.get("availableSourceItems") or []
    return [str(item.get("id") or "").strip().lower() for item in items if isinstance(item, dict)]


def snapshot(profile_id=None, uid=UID):
    q = urllib.parse.quote(uid, safe="") if uid else ""
    path = f"/translationsub/v2/snapshot?uid={q}" if uid else "/translationsub/v2/snapshot"
    if profile_id is not None:
        separator = "&" if "?" in path else "?"
        path += separator + "profile_id=" + urllib.parse.quote(str(profile_id), safe="")
    return get(path)


def lampa_hash(value):
    hash_value = 0
    for ch in value:
        hash_value = ((hash_value << 5) - hash_value + ord(ch)) & 0xFFFFFFFF
    if hash_value & 0x80000000:
        hash_value -= 0x100000000
    return str(abs(hash_value))


def episode_hash(season, episode, title):
    separator = ":" if season > 10 else ""
    return lampa_hash(f"{season}{separator}{episode}{title}")


def timecode_user(profile_id="0"):
    value = UID.strip()
    if str(profile_id).strip() not in ("", "0"):
        value += "_" + str(profile_id).strip()
    return re.sub(r"[^a-z0-9\-_\.]+", "", value, flags=re.IGNORECASE)


def seed_timecode(profile_id, percents):
    TIMECODE_DB.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(TIMECODE_DB) as conn:
        conn.execute("""
CREATE TABLE IF NOT EXISTS timecodes (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT NOT NULL,
    card TEXT NOT NULL,
    item TEXT NOT NULL,
    data TEXT NULL,
    updated TEXT NOT NULL
)
""")
        conn.execute("""
CREATE UNIQUE INDEX IF NOT EXISTS IX_timecodes_user_card_item
ON timecodes(user, card, item)
""")
        user = timecode_user(profile_id)
        conn.execute("DELETE FROM timecodes WHERE user = ?", (user,))
        for episode, percent in sorted(percents.items()):
            conn.execute(
                "INSERT INTO timecodes(user, card, item, data, updated) VALUES (?, ?, ?, ?, ?)",
                (
                    user,
                    "1396_tv",
                    episode_hash(1, int(episode), "CI Series"),
                    json.dumps({"percent": int(percent)}),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
        conn.commit()


def translation_rows():
    assert TRANSLATIONSUB_DB.is_file(), f"SQLite database not found: {TRANSLATIONSUB_DB}"
    with sqlite3.connect(TRANSLATIONSUB_DB) as conn:
        conn.row_factory = sqlite3.Row
        return conn.execute(
            "SELECT id, uid, last_episode, last_checked_at, schedule_state, sources_json FROM subscriptions ORDER BY rowid"
        ).fetchall()


def progress_rows():
    assert TRANSLATIONSUB_DB.is_file(), f"SQLite database not found: {TRANSLATIONSUB_DB}"
    with sqlite3.connect(TRANSLATIONSUB_DB) as conn:
        conn.row_factory = sqlite3.Row
        return conn.execute(
            "SELECT uid, profile_id, subscription_id, watched_episode FROM profile_progress ORDER BY profile_id"
        ).fetchall()


def only_subscription(body):
    values = body.get("subscriptions") or []
    assert len(values) == 1, body
    return values[0]


def assert_snapshot(body, profile_id, watched, available, from_episode, to_episode, new_count):
    assert body.get("profileId") == str(profile_id), body
    assert (body.get("badge") or {}).get("count") == 1, body
    sub = only_subscription(body)
    assert sub.get("watchedEpisode") == watched, sub
    assert sub.get("availableEpisode") == available, sub
    assert sub.get("hasNewEpisodes") is True, sub
    assert sub.get("fromEpisode") == from_episode, sub
    assert sub.get("toEpisode") == to_episode, sub
    assert sub.get("newCount") == new_count, sub
    assert (sub.get("navigation") or {}) == {"id": "1396", "method": "tv"}, sub
    assert sub.get("translationName") == "CI Voice", sub
    assert len(body.get("updates") or []) == 1, body
    return sub


def main():
    stub = start_stub()
    try:
        card = {
            "id": 1396,
            "content_id": "ci-series",
            "source": "custom",
            "media_type": "tv",
            "title": "CI Series",
            "original_name": "CI Series",
            "season": 1,
            "tmdb_id": "1396",
            "imdb_id": "tt0903747",
            "kinopoisk_id": "404900",
            "first_air_date": "2026-01-01",
        }

        # Snapshot and check require a user identity.
        status, body = snapshot(uid=None)
        assert_json_ok(status, body)
        assert body == {"success": False, "error": "uid_required"}, body

        status, body = post("/translationsub/v2/check")
        assert_json_ok(status, body)
        assert body == {"success": False, "error": "uid_required"}, body

        settings_body = settings([])
        known = source_ids(settings_body)
        preferred = ["flixcdn", "phantom", "zetflixdb", "videodb", "cdnvideohub"]
        selected = next((item for item in preferred if item in known), None)
        assert selected is not None, f"No configured CI source is available. available={known}"
        settings([selected])

        # Resolve the voice through the real metadata path and create one shared
        # subscription. Progress is intentionally absent at this point.
        status, state = post(
            f"/translationsub/v2/content-state?uid={UID_Q}",
            {"card": card, "includeVoices": True},
        )
        assert_json_ok(status, state)
        voices = state.get("voices") or []
        assert len(voices) == 1, state
        voice = voices[0]
        assert voice.get("name") == "CI Voice", voice
        assert voice.get("latestEpisode") == 3, voice

        status, result = post(
            f"/translationsub/v2/subscriptions?uid={UID_Q}",
            {"card": card, "voiceId": voice.get("id"), "voiceName": voice.get("name")},
        )
        assert_json_ok(status, result)
        assert result.get("success") is True, result
        subscription_id = result.get("subscriptionId")
        assert subscription_id, result

        status, body = snapshot()
        assert_json_ok(status, body)
        sub = assert_snapshot(body, "0", 0, 3, 1, 3, 3)
        assert sub.get("progressPercent") == 0, sub
        assert (sub.get("display") or {}).get("progress") == "Можно смотреть E1–E3", sub

        # Lampac TimeCode is authoritative. E1=100 and E2=60 are watched;
        # E3=59 is deliberately below the TranslationSub 60% threshold.
        seed_timecode("0", {1: 100, 2: 60, 3: 59})
        status, body = snapshot()
        assert_json_ok(status, body)
        sub = assert_snapshot(body, "0", 2, 3, 3, 3, 1)
        assert sub.get("progressPercent") == 67, sub
        assert (sub.get("display") or {}).get("watched") == "Просмотрено E2", sub
        assert (sub.get("display") or {}).get("progress") == "Можно смотреть E3", sub

        # Profile 3 has its own TimeCode identity and must not inherit profile 0.
        seed_timecode("3", {1: 100, 2: 59})
        status, body = snapshot(profile_id="3")
        assert_json_ok(status, body)
        sub = assert_snapshot(body, "3", 1, 3, 2, 3, 2)
        assert sub.get("progressPercent") == 33, sub

        rows = progress_rows()
        assert len(rows) == 2, [dict(row) for row in rows]
        by_profile = {row["profile_id"]: row for row in rows}
        assert by_profile["0"]["uid"] == UID, dict(by_profile["0"])
        assert by_profile["0"]["subscription_id"] == subscription_id, dict(by_profile["0"])
        assert by_profile["0"]["watched_episode"] == 2, dict(by_profile["0"])
        assert by_profile["3"]["uid"] == UID, dict(by_profile["3"])
        assert by_profile["3"]["subscription_id"] == subscription_id, dict(by_profile["3"])
        assert by_profile["3"]["watched_episode"] == 1, dict(by_profile["3"])

        # Another uid sees no shared subscription or progress.
        other = urllib.parse.quote("other@translationsub.test", safe="")
        status, isolated = get(f"/translationsub/v2/snapshot?uid={other}&profile_id=3")
        assert_json_ok(status, isolated)
        assert isolated.get("profileId") == "3", isolated
        assert (isolated.get("badge") or {}).get("count") == 0, isolated
        assert isolated.get("subscriptions") == [], isolated
        assert isolated.get("updates") == [], isolated

        # Simulate one newly available episode. /check must run the real forced
        # scheduler, refresh shared subscription metadata, then rebuild profile 3.
        fixture["episodes"] = 4
        metadata_before = hits["metadata"]
        status, checked = post(f"/translationsub/v2/check?uid={UID_Q}&profile_id=3")
        assert_json_ok(status, checked)
        assert checked.get("success") is True, checked
        checked_snapshot = checked.get("snapshot") or {}
        sub = assert_snapshot(checked_snapshot, "3", 1, 4, 2, 4, 3)
        assert hits["metadata"] > metadata_before, hits
        assert sub.get("lastCheckedAt") is not None, sub

        rows = translation_rows()
        assert len(rows) == 1, [dict(row) for row in rows]
        row = rows[0]
        assert row["id"] == subscription_id, dict(row)
        assert row["uid"] == UID, dict(row)
        assert row["last_episode"] == 4, dict(row)
        assert row["last_checked_at"], dict(row)
        persisted_sources = json.loads(row["sources_json"])
        assert len(persisted_sources) == 1, persisted_sources
        assert str(persisted_sources[0].get("Source") or persisted_sources[0].get("source") or "").lower() == selected, persisted_sources

        # Shared availability changed to E4, but profile 0 progress remains E2.
        status, body = snapshot()
        assert_json_ok(status, body)
        sub = assert_snapshot(body, "0", 2, 4, 3, 4, 2)
        assert sub.get("progressPercent") == 50, sub

        rows = progress_rows()
        by_profile = {row["profile_id"]: row for row in rows}
        assert by_profile["0"]["watched_episode"] == 2, [dict(row) for row in rows]
        assert by_profile["3"]["watched_episode"] == 1, [dict(row) for row in rows]

        print(
            "TranslationSub snapshot/progress/check regression passed; "
            f"source={selected}; metadata_hits={hits['metadata']}; tmdb_hits={hits['tmdb']}"
        )
    except Exception:
        print("snapshot-progress diagnostics:", flush=True)
        print("  fixture=", json.dumps(fixture), flush=True)
        print("  hits=", json.dumps(hits), flush=True)
        print("  requests=", json.dumps(requests_seen, ensure_ascii=False), flush=True)
        if TRANSLATIONSUB_DB.is_file():
            try:
                print("  subscriptions=", json.dumps([dict(row) for row in translation_rows()], default=str), flush=True)
                print("  progress=", json.dumps([dict(row) for row in progress_rows()], default=str), flush=True)
            except Exception as exc:
                print("  sqlite_diagnostics_error=", repr(exc), flush=True)
        raise
    finally:
        stub.shutdown()
        stub.server_close()


if __name__ == "__main__":
    main()
