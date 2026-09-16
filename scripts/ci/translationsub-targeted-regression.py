#!/usr/bin/env python3
import json
import os
import re
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
RUNTIME = Path(os.environ.get("TRANSLATIONSUB_TARGET_RUNTIME", "/tmp/lampac-targeted"))
DB = RUNTIME / "database" / "translationsub.db"
TIMECODE_DB = RUNTIME / "database" / "TimeCode.sql"


class TmdbFixture(BaseHTTPRequestHandler):
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
            raw_id = parsed.path.rsplit("/", 1)[-1]
            try:
                tmdb_id = int(raw_id)
            except ValueError:
                self._json({}, 404)
                return

            self._json({
                "id": tmdb_id,
                "status": "Returning Series",
                "external_ids": {"imdb_id": None},
                "last_episode_to_air": {
                    "season_number": 29,
                    "episode_number": 1,
                    "air_date": "2026-09-01",
                },
                "next_episode_to_air": {
                    "season_number": 29,
                    "episode_number": 2,
                    "air_date": "2026-09-23",
                },
                "seasons": [
                    {"season_number": 28, "episode_count": 10},
                    {"season_number": 29, "episode_count": 10},
                ],
            })
            return

        if parsed.path.startswith("/tmdb/find/"):
            self._json({"tv_results": []})
            return

        self._json({}, 404)


def serve():
    server = ThreadingHTTPServer(("127.0.0.1", 9125), TmdbFixture)
    print("TranslationSub targeted TMDB fixture listening on 127.0.0.1:9125", flush=True)
    server.serve_forever()


def request(method, path, payload=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method=method,
    )
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


def post(path, payload=None):
    return request("POST", path, payload)


def get(path):
    return request("GET", path)


def require_ok(result, label):
    status, body = result
    assert status == 200, (label, status, body)
    assert isinstance(body, dict), (label, body)
    return body


def uidq(uid):
    return urllib.parse.quote(uid, safe="")


def set_settings(uid, mode="auto", use_tmdb=True):
    body = require_ok(post(
        f"/translationsub/v2/settings?uid={uidq(uid)}",
        {
            "checkIntervalHours": 1,
            "sources": [],
            "useTmdbSchedule": use_tmdb,
            "tmdbRefreshHours": 24,
            "endedRefreshDays": 7,
            "newSeasonMode": mode,
        },
    ), f"settings {uid}")
    assert body.get("success") is True, body


def wait_for_database():
    for _ in range(100):
        if DB.is_file():
            return
        time.sleep(0.1)
    raise AssertionError(f"TranslationSub database not created: {DB}")


def insert_subscription(conn, *, sid, uid, content, title, tmdb, season, voice_id="voice", voice_name="Voice", last_episode=1):
    conn.execute(
        """
INSERT OR REPLACE INTO subscriptions (
  id, uid, content_id, title, original_title, tmdb_id, is_serial, source,
  translation_id, translation_name, current_season, last_season,
  last_episode, sources_json, created_at, tmdb_new_season_available
) VALUES (?, ?, ?, ?, ?, ?, 1, 'test', ?, ?, ?, ?, ?, '[]', ?, 0)
""",
        (
            sid, uid, content, title, title, str(tmdb), voice_id, voice_name,
            int(season), int(season), int(last_episode),
            datetime.now(timezone.utc).isoformat(),
        ),
    )


def add_progress(conn, uid, sid, watched):
    conn.execute(
        """
INSERT OR REPLACE INTO profile_progress
(uid, profile_id, subscription_id, watched_episode, updated_at)
VALUES (?, '0', ?, ?, ?)
""",
        (uid, sid, int(watched), datetime.now(timezone.utc).isoformat()),
    )


def rows_for(uid):
    with sqlite3.connect(DB) as conn:
        conn.row_factory = sqlite3.Row
        return [dict(row) for row in conn.execute(
            """
SELECT id, uid, content_id, tmdb_id, translation_id, translation_name,
       current_season, last_season, last_episode, tmdb_new_season_available,
       tmdb_status, tmdb_last_season, tmdb_last_episode
FROM subscriptions WHERE uid = ? ORDER BY rowid
""",
            (uid,),
        )]


def progress_for(uid):
    with sqlite3.connect(DB) as conn:
        conn.row_factory = sqlite3.Row
        return [dict(row) for row in conn.execute(
            "SELECT uid, profile_id, subscription_id, watched_episode FROM profile_progress WHERE uid = ? ORDER BY subscription_id",
            (uid,),
        )]


def run_check(uid):
    body = require_ok(post(f"/translationsub/v2/check?uid={uidq(uid)}"), f"check {uid}")
    assert body.get("success") is True, body
    return body


def snapshot(uid):
    body = require_ok(get(f"/translationsub/v2/snapshot?uid={uidq(uid)}"), f"snapshot {uid}")
    assert body.get("profileId") == "0", body
    return body


def test_new_season_transition():
    print("1. auto new season replaces old season", flush=True)
    auto = "target-auto@translationsub.test"
    existing = "target-existing@translationsub.test"
    notify = "target-notify@translationsub.test"
    off = "target-off@translationsub.test"

    set_settings(auto, "auto")
    set_settings(existing, "auto")
    set_settings(notify, "notify")
    set_settings(off, "off")

    with sqlite3.connect(DB) as conn:
        insert_subscription(conn, sid="auto-old", uid=auto, content="south-park", title="South Park", tmdb=2190, season=28, last_episode=10)
        add_progress(conn, auto, "auto-old", 10)

        insert_subscription(conn, sid="existing-old", uid=existing, content="south-park-existing", title="South Park", tmdb=2191, season=28, last_episode=10)
        insert_subscription(conn, sid="existing-new", uid=existing, content="south-park-existing", title="South Park", tmdb=2191, season=29, last_episode=1)
        add_progress(conn, existing, "existing-old", 10)
        add_progress(conn, existing, "existing-new", 1)

        insert_subscription(conn, sid="notify-old", uid=notify, content="notify-show", title="Notify Show", tmdb=2192, season=28, last_episode=10)
        insert_subscription(conn, sid="off-old", uid=off, content="off-show", title="Off Show", tmdb=2193, season=28, last_episode=10)
        conn.commit()

    run_check(auto)
    rows = rows_for(auto)
    assert len(rows) == 1, rows
    assert rows[0]["id"] != "auto-old", rows
    assert rows[0]["current_season"] == 29, rows
    assert rows[0]["translation_id"] == "voice", rows
    assert not progress_for(auto), progress_for(auto)

    print("2. existing target season is reused and old season is removed", flush=True)
    run_check(existing)
    rows = rows_for(existing)
    assert len(rows) == 1, rows
    assert rows[0]["id"] == "existing-new", rows
    assert rows[0]["current_season"] == 29, rows
    progress = progress_for(existing)
    assert all(x["subscription_id"] != "existing-old" for x in progress), progress
    assert any(x["subscription_id"] == "existing-new" for x in progress), progress

    print("3. notify mode keeps old season and sets availability flag", flush=True)
    run_check(notify)
    rows = rows_for(notify)
    assert len(rows) == 1 and rows[0]["id"] == "notify-old", rows
    assert rows[0]["current_season"] == 28, rows
    assert rows[0]["tmdb_new_season_available"] == 1, rows

    print("4. off mode keeps old season without auto replacement", flush=True)
    run_check(off)
    rows = rows_for(off)
    assert len(rows) == 1 and rows[0]["id"] == "off-old", rows
    assert rows[0]["current_season"] == 28, rows
    assert rows[0]["tmdb_new_season_available"] == 0, rows


def lampa_hash(value):
    h = 0
    for ch in value:
        h = ((h << 5) - h + ord(ch)) & 0xFFFFFFFF
    if h & 0x80000000:
        h -= 0x100000000
    return str(abs(h))


def episode_hash(season, episode, title):
    separator = ":" if season > 10 else ""
    return lampa_hash(f"{season}{separator}{episode}{title}")


def timecode_user(uid, profile="0"):
    value = uid.strip()
    if str(profile).strip() not in ("", "0"):
        value += "_" + str(profile).strip()
    return re.sub(r"[^a-z0-9\-_\.]+", "", value, flags=re.IGNORECASE)


def ensure_timecode_db():
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
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS IX_timecodes_user_card_item ON timecodes(user, card, item)")
        conn.commit()


def put_timecode(uid, card, item, percent):
    ensure_timecode_db()
    with sqlite3.connect(TIMECODE_DB) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO timecodes(user, card, item, data, updated) VALUES (?, ?, ?, ?, ?)",
            (
                timecode_user(uid), card, item,
                json.dumps({"percent": int(percent)}),
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        conn.commit()


def clear_timecode(uid):
    ensure_timecode_db()
    with sqlite3.connect(TIMECODE_DB) as conn:
        conn.execute("DELETE FROM timecodes WHERE user = ?", (timecode_user(uid),))
        conn.commit()


def snapshot_watched(uid):
    body = snapshot(uid)
    return {str(item.get("id")): int(item.get("watchedEpisode") or 0) for item in (body.get("subscriptions") or [])}


def test_timecode_identity_and_reconcile():
    collision = "target-collision@translationsub.test"
    voices = "target-voices@translationsub.test"
    set_settings(collision, "off", use_tmdb=False)
    set_settings(voices, "off", use_tmdb=False)

    print("5. equal titles do not leak progress across different content", flush=True)
    with sqlite3.connect(DB) as conn:
        insert_subscription(conn, sid="collision-a", uid=collision, content="collision-a", title="Twin Title", tmdb=7001, season=1, last_episode=3)
        insert_subscription(conn, sid="collision-b", uid=collision, content="collision-b", title="Twin Title", tmdb=7002, season=1, last_episode=3)
        conn.commit()

    put_timecode(collision, "7001_tv", episode_hash(1, 2, "Twin Title"), 100)
    watched = snapshot_watched(collision)
    assert watched == {"collision-a": 2, "collision-b": 0}, watched
    progress = progress_for(collision)
    assert progress == [{"uid": collision, "profile_id": "0", "subscription_id": "collision-a", "watched_episode": 2}], progress

    print("6. empty TimeCode result removes stale projected progress", flush=True)
    clear_timecode(collision)
    watched = snapshot_watched(collision)
    assert watched == {"collision-a": 0, "collision-b": 0}, watched
    assert progress_for(collision) == [], progress_for(collision)

    print("7. two voices of one content share unambiguous TimeCode fallback", flush=True)
    with sqlite3.connect(DB) as conn:
        insert_subscription(conn, sid="voice-a", uid=voices, content="same-show", title="Same Show", tmdb=8001, season=1, voice_id="voice-a", voice_name="Voice A", last_episode=2)
        insert_subscription(conn, sid="voice-b", uid=voices, content="same-show", title="Same Show", tmdb=8001, season=1, voice_id="voice-b", voice_name="Voice B", last_episode=2)
        conn.commit()

    put_timecode(voices, "unrelated_tv", episode_hash(1, 1, "Same Show"), 100)
    watched = snapshot_watched(voices)
    assert watched == {"voice-a": 1, "voice-b": 1}, watched


def assert_integrity():
    with sqlite3.connect(DB) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    with sqlite3.connect(TIMECODE_DB) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)


def run():
    wait_for_database()
    test_new_season_transition()
    test_timecode_identity_and_reconcile()
    assert_integrity()
    print("TranslationSub targeted season/TimeCode regression passed: 7 groups", flush=True)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "run"
    if mode == "serve":
        serve()
    elif mode == "run":
        run()
    else:
        raise SystemExit(f"unknown mode: {mode}")
