#!/usr/bin/env python3
import json
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = os.environ.get("TRANSLATIONSUB_BASE_URL", "http://127.0.0.1:9118").rstrip("/")
RUNTIME = Path(os.environ.get("LAMPAC_RUNTIME", "/tmp/lampac-runtime"))
DB = RUNTIME / "database" / "translationsub.db"
TIMECODE_DB = RUNTIME / "database" / "TimeCode.sql"
STATE = Path(os.environ.get("TRANSLATIONSUB_PERSISTENCE_STATE", "/tmp/translationsub-persistence-state.json"))
UID = "persistence-restart@translationsub.test"
PROFILE_ID = "5"
UID_Q = urllib.parse.quote(UID, safe="")


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
    server = ThreadingHTTPServer(("127.0.0.1", 9120), FixtureHandler)
    print("TranslationSub persistence fixture listening on 127.0.0.1:9120", flush=True)
    server.serve_forever()


def request(method, path, payload=None, form=None):
    headers = {}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    elif form is not None:
        data = urllib.parse.urlencode(form).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8"

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


def post(path, payload=None, form=None):
    return request("POST", path, payload=payload, form=form)


def assert_ok(status, body):
    assert status == 200, (status, body)
    assert isinstance(body, dict), body


def setting(obj, pascal, camel):
    return obj.get(pascal, obj.get(camel))


def lampa_hash(value):
    result = 0
    for ch in value:
        result = ((result << 5) - result + ord(ch)) & 0xFFFFFFFF
    if result & 0x80000000:
        result -= 0x100000000
    return str(abs(result))


def timecode_user():
    value = UID + "_" + PROFILE_ID
    return re.sub(r"[^a-z0-9\-_\.]+", "", value, flags=re.IGNORECASE)


def db_integrity(path):
    assert path.is_file(), f"database missing: {path}"
    with sqlite3.connect(path, timeout=10) as conn:
        result = conn.execute("PRAGMA integrity_check").fetchone()
    assert result == ("ok",), (path, result)


def assert_no_legacy_json():
    legacy = DB.parent / "translationsub"
    for name in ("settings.json", "subscriptions.json", "profile-progress.json"):
        assert not (legacy / name).exists(), f"legacy JSON store exists: {legacy / name}"


def assert_db_permissions():
    if os.name == "posix":
        mode = DB.stat().st_mode & 0o777
        assert mode == 0o600, f"translationsub.db mode is {oct(mode)}, expected 0o600"


def load_state():
    assert STATE.is_file(), f"state file missing: {STATE}"
    return json.loads(STATE.read_text(encoding="utf-8"))


def snapshot(expected_watched, state):
    status, body = get(f"/translationsub/v2/snapshot?uid={UID_Q}&profile_id={PROFILE_ID}")
    assert_ok(status, body)
    assert body.get("profileId") == PROFILE_ID, body
    items = body.get("subscriptions") or []
    assert len(items) == 1, body
    sub = items[0]
    assert sub.get("id") == state["subscriptionId"], sub
    assert sub.get("contentId") == state["contentId"], sub
    assert sub.get("translationName") == "CI Voice", sub
    assert sub.get("availableEpisode") == 3, sub
    assert sub.get("watchedEpisode") == expected_watched, sub
    expected_badge = 1 if expected_watched < 3 else 0
    assert (body.get("badge") or {}).get("count") == expected_badge, body
    assert len(body.get("updates") or []) == expected_badge, body
    return sub


def assert_settings(state):
    status, body = get(f"/translationsub/v2/settings?uid={UID_Q}")
    assert_ok(status, body)
    assert body.get("success") is True, body
    values = body.get("settings") or {}
    assert setting(values, "Uid", "uid") == UID, values
    assert setting(values, "CheckIntervalHours", "checkIntervalHours") == 24, values
    assert setting(values, "Sources", "sources") == [state["source"]], values
    assert setting(values, "UseTmdbSchedule", "useTmdbSchedule") is False, values
    assert setting(values, "TmdbRefreshHours", "tmdbRefreshHours") == 48, values
    assert setting(values, "EndedRefreshDays", "endedRefreshDays") == 30, values
    assert setting(values, "NewSeasonMode", "newSeasonMode") == "notify", values


def assert_sqlite_rows(state, expected_watched):
    db_integrity(DB)
    with sqlite3.connect(DB, timeout=10) as conn:
        conn.row_factory = sqlite3.Row
        settings_rows = conn.execute(
            "SELECT uid, check_interval_hours, sources_json, use_tmdb_schedule, tmdb_refresh_hours, ended_refresh_days, new_season_mode "
            "FROM settings WHERE uid = ?", (UID,)
        ).fetchall()
        subscription_rows = conn.execute(
            "SELECT id, uid, content_id, translation_name, last_episode FROM subscriptions WHERE uid = ?", (UID,)
        ).fetchall()
        progress_rows = conn.execute(
            "SELECT uid, profile_id, subscription_id, watched_episode FROM profile_progress WHERE uid = ?", (UID,)
        ).fetchall()

    assert len(settings_rows) == 1, [dict(row) for row in settings_rows]
    sr = settings_rows[0]
    assert sr["uid"] == UID and sr["check_interval_hours"] == 24, dict(sr)
    assert json.loads(sr["sources_json"]) == [state["source"]], dict(sr)
    assert sr["use_tmdb_schedule"] == 0 and sr["tmdb_refresh_hours"] == 48, dict(sr)
    assert sr["ended_refresh_days"] == 30 and sr["new_season_mode"] == "notify", dict(sr)

    assert len(subscription_rows) == 1, [dict(row) for row in subscription_rows]
    sub = subscription_rows[0]
    assert sub["id"] == state["subscriptionId"], dict(sub)
    assert sub["content_id"] == state["contentId"], dict(sub)
    assert sub["translation_name"] == "CI Voice" and sub["last_episode"] == 3, dict(sub)

    assert len(progress_rows) == 1, [dict(row) for row in progress_rows]
    progress = progress_rows[0]
    assert progress["profile_id"] == PROFILE_ID, dict(progress)
    assert progress["subscription_id"] == state["subscriptionId"], dict(progress)
    assert progress["watched_episode"] == expected_watched, dict(progress)


def assert_timecode_rows(state, expected_watched):
    db_integrity(TIMECODE_DB)
    with sqlite3.connect(TIMECODE_DB, timeout=10) as conn:
        rows = conn.execute(
            "SELECT user, card, item, data FROM timecodes WHERE user = ? AND card = ? ORDER BY Id",
            (timecode_user(), state["contentId"] + "_tv"),
        ).fetchall()
    assert len(rows) >= expected_watched, rows
    assert all(row[0] == timecode_user() for row in rows), rows


def prepare():
    card = {
        "id": 1396,
        "content_id": "ci-persistence-series",
        "source": "custom",
        "media_type": "tv",
        "title": "CI Persistence Series",
        "original_name": "CI Persistence Series",
        "season": 1,
        "tmdb_id": "1396",
        "imdb_id": "tt0903747",
        "kinopoisk_id": "404900",
        "first_air_date": "2026-01-01",
    }

    status, defaults = get(f"/translationsub/v2/settings?uid={UID_Q}")
    assert_ok(status, defaults)
    known = [
        str(item.get("id") or "").strip().lower()
        for item in (defaults.get("availableSourceItems") or [])
        if isinstance(item, dict)
    ]
    preferred = ["flixcdn", "phantom", "zetflixdb", "videodb", "cdnvideohub"]
    source = next((item for item in preferred if item in known), None)
    assert source is not None, f"No persistence fixture source is available: {known}"

    status, saved = post(f"/translationsub/v2/settings?uid={UID_Q}", payload={
        "checkIntervalHours": 24,
        "sources": [source],
        "useTmdbSchedule": False,
        "tmdbRefreshHours": 48,
        "endedRefreshDays": 30,
        "newSeasonMode": "notify",
    })
    assert_ok(status, saved)
    assert saved.get("success") is True, saved

    status, content = post(
        f"/translationsub/v2/content-state?uid={UID_Q}",
        payload={"card": card, "includeVoices": True},
    )
    assert_ok(status, content)
    voices = content.get("voices") or []
    assert len(voices) == 1, content
    voice = voices[0]
    assert voice.get("name") == "CI Voice" and voice.get("latestEpisode") == 3, voice

    status, created = post(
        f"/translationsub/v2/subscriptions?uid={UID_Q}",
        payload={"card": card, "voiceId": voice.get("id"), "voiceName": voice.get("name")},
    )
    assert_ok(status, created)
    assert created.get("success") is True, created
    subscription_id = created.get("subscriptionId")
    assert subscription_id, created

    with sqlite3.connect(DB, timeout=10) as conn:
        row = conn.execute(
            "SELECT content_id, title FROM subscriptions WHERE id = ? AND uid = ?",
            (subscription_id, UID),
        ).fetchone()
    assert row and row[0], row
    content_id = row[0]
    title = row[1] or card["title"]

    for episode, percent in ((1, 100), (2, 80)):
        status, tc = post(
            f"/timecode/add?card_id={urllib.parse.quote(content_id + '_tv', safe='')}&uid={UID_Q}&profile_id={PROFILE_ID}",
            form={
                "id": lampa_hash(f"1{episode}{title}"),
                "data": json.dumps({"percent": percent}),
            },
        )
        assert_ok(status, tc)
        assert tc.get("success") is True, tc

    state = {
        "uid": UID,
        "profileId": PROFILE_ID,
        "source": source,
        "subscriptionId": subscription_id,
        "contentId": content_id,
        "title": title,
    }
    STATE.write_text(json.dumps(state, indent=2), encoding="utf-8")

    assert_settings(state)
    snapshot(2, state)
    assert_sqlite_rows(state, 2)
    assert_timecode_rows(state, 2)
    assert_no_legacy_json()
    assert_db_permissions()
    print(f"TranslationSub persistence prepare passed; source={source}; subscription={subscription_id}")


def verify(expected_watched):
    state = load_state()
    assert_settings(state)
    snapshot(expected_watched, state)
    assert_sqlite_rows(state, expected_watched)
    assert_timecode_rows(state, expected_watched)
    assert_no_legacy_json()
    assert_db_permissions()

    card = {
        "id": 1396,
        "content_id": state["contentId"],
        "source": "custom",
        "media_type": "tv",
        "title": state["title"],
        "original_name": state["title"],
        "season": 1,
        "tmdb_id": "1396",
        "imdb_id": "tt0903747",
        "kinopoisk_id": "404900",
        "first_air_date": "2026-01-01",
    }
    status, content = post(
        f"/translationsub/v2/content-state?uid={UID_Q}",
        payload={"card": card, "includeVoices": False},
    )
    assert_ok(status, content)
    button = content.get("button") or {}
    assert button.get("subscribed") is True, content

    status, default_profile = get(f"/translationsub/v2/snapshot?uid={UID_Q}")
    assert_ok(status, default_profile)
    default_subs = default_profile.get("subscriptions") or []
    assert len(default_subs) == 1 and default_subs[0].get("watchedEpisode") == 0, default_profile

    other_uid = urllib.parse.quote("other-persistence@translationsub.test", safe="")
    status, isolated = get(f"/translationsub/v2/snapshot?uid={other_uid}&profile_id={PROFILE_ID}")
    assert_ok(status, isolated)
    assert isolated.get("subscriptions") == [] and (isolated.get("badge") or {}).get("count") == 0, isolated

    print(f"TranslationSub persistence verify passed; watched={expected_watched}; subscription={state['subscriptionId']}")


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: translationsub-persistence-restart.py serve|prepare|verify [watched]")
    mode = sys.argv[1].lower()
    if mode == "serve":
        serve_fixture()
    elif mode == "prepare":
        prepare()
    elif mode == "verify":
        expected = int(sys.argv[2]) if len(sys.argv) > 2 else 2
        verify(expected)
    else:
        raise SystemExit(f"unknown mode: {mode}")


if __name__ == "__main__":
    main()
