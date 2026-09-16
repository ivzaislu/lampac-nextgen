#!/usr/bin/env python3
import json
import os
import sqlite3
import sys
import urllib.parse
import urllib.request
from pathlib import Path

BASE = os.environ.get("TRANSLATIONSUB_BASE_URL", "http://127.0.0.1:9118").rstrip("/")
RUNTIME = Path(os.environ.get("TRANSLATIONSUB_RUNTIME", "/tmp/lampac-storage-migration"))
DB = RUNTIME / "database" / "translationsub.db"
LEGACY = RUNTIME / "database" / "translationsub"
UID = "migration-victim@translationsub.test"
SUB_ID = "legacy-subscription"


def seed():
    LEGACY.mkdir(parents=True, exist_ok=True)
    (LEGACY / "settings.json").write_text(json.dumps([
        {
            "Uid": UID,
            "CheckIntervalHours": 6,
            "Sources": ["flixcdn"],
            "UseTmdbSchedule": False,
            "TmdbRefreshHours": 48,
            "EndedRefreshDays": 30,
            "NewSeasonMode": "notify",
            "UpdatedAt": "2026-09-01T10:00:00+00:00"
        }
    ], indent=2), encoding="utf-8")
    (LEGACY / "subscriptions.json").write_text(json.dumps([
        {
            "Id": SUB_ID,
            "Uid": UID,
            "ContentId": "legacy-content",
            "Title": "Legacy Show",
            "OriginalTitle": "Legacy Show",
            "TmdbId": "12345",
            "IsSerial": True,
            "Source": "flixcdn",
            "TranslationId": "legacy-voice",
            "TranslationName": "Legacy Voice",
            "CurrentSeason": 2,
            "LastSeason": 2,
            "LastEpisode": 7,
            "Sources": [
                {"Source": "flixcdn", "TranslationId": "legacy-voice", "TranslationName": "Legacy Voice"}
            ],
            "CreatedAt": "2026-08-01T10:00:00+00:00",
            "LastCheckedAt": "2026-09-01T10:00:00+00:00",
            "ScheduleState": "waiting_air",
            "TmdbNewSeasonAvailable": False
        }
    ], indent=2), encoding="utf-8")
    (LEGACY / "profile-progress.json").write_text(json.dumps([
        {
            "Uid": UID,
            "ProfileId": "0",
            "SubscriptionId": SUB_ID,
            "WatchedEpisode": 5,
            "UpdatedAt": "2026-09-01T10:00:00+00:00"
        }
    ], indent=2), encoding="utf-8")
    print("Seeded legacy TranslationSub JSON storage", flush=True)


def get_json(path):
    with urllib.request.urlopen(BASE + path, timeout=20) as response:
        raw = response.read().decode("utf-8")
        return response.status, json.loads(raw)


def verify():
    assert DB.is_file(), f"SQLite database was not created: {DB}"
    with sqlite3.connect(DB) as conn:
        conn.row_factory = sqlite3.Row
        settings = conn.execute("SELECT * FROM settings WHERE uid = ?", (UID,)).fetchone()
        subscription = conn.execute("SELECT * FROM subscriptions WHERE id = ? AND uid = ?", (SUB_ID, UID)).fetchone()
        progress = conn.execute(
            "SELECT * FROM profile_progress WHERE uid = ? AND profile_id = '0' AND subscription_id = ?",
            (UID, SUB_ID),
        ).fetchone()
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]

    missing = []
    if settings is None:
        missing.append("settings")
    if subscription is None:
        missing.append("subscription")
    if progress is None:
        missing.append("profile_progress")

    q = urllib.parse.quote(UID, safe="")
    status, settings_api = get_json(f"/translationsub/v2/settings?uid={q}")
    assert status == 200, (status, settings_api)
    status, snapshot = get_json(f"/translationsub/v2/snapshot?uid={q}&profile_id=0")
    assert status == 200, (status, snapshot)

    if missing:
        legacy_state = {name: (LEGACY / name).exists() for name in (
            "settings.json", "subscriptions.json", "profile-progress.json"
        )}
        raise AssertionError(
            "LEGACY DATA LOSS: SQLite missing " + ", ".join(missing)
            + f"; legacy files after initialization={legacy_state}; settings_api={settings_api}; snapshot={snapshot}"
        )

    assert integrity == "ok", integrity
    assert int(settings["check_interval_hours"]) == 6, dict(settings)
    assert settings["new_season_mode"] == "notify", dict(settings)
    assert subscription["title"] == "Legacy Show", dict(subscription)
    assert int(subscription["last_episode"]) == 7, dict(subscription)
    assert int(progress["watched_episode"]) == 5, dict(progress)
    print("CLOSED: legacy JSON settings/subscription/progress migrated into SQLite without loss", flush=True)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "verify"
    if mode == "seed":
        seed()
    elif mode == "verify":
        verify()
    else:
        raise SystemExit(f"unknown mode: {mode}")
