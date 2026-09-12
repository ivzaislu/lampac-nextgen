#!/usr/bin/env python3
import json
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = "http://127.0.0.1:9118"
UID = "subscriptions-regression@translationsub.test"
UID_Q = urllib.parse.quote(UID, safe="")
DB = Path("/tmp/lampac-runtime/database/translationsub.db")

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
                "seasons": [
                    {"season_number": 1, "episode_count": 3}
                ],
            })
            return

        if parsed.path.startswith("/tmdb/find/"):
            hits["tmdb"] += 1
            self._json({"tv_results": [{"id": 1396}]})
            return

        hits["metadata"] += 1
        self._json({
            "type": "episode",
            "data": [
                {
                    "name": "Episode 1",
                    "s": 1,
                    "e": 1,
                    "method": "play",
                    "voice_name": "CI Voice",
                    "voice_id": "ci-voice",
                },
                {
                    "name": "Episode 2",
                    "s": 1,
                    "e": 2,
                    "method": "play",
                    "voice_name": "CI Voice",
                    "voice_id": "ci-voice",
                },
                {
                    "name": "Episode 3",
                    "s": 1,
                    "e": 3,
                    "method": "play",
                    "voice_name": "CI Voice",
                    "voice_id": "ci-voice",
                },
            ],
        })


def start_stub():
    server = ThreadingHTTPServer(("127.0.0.1", 9120), StubHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def request(method, path, payload=None, raw_body=None):
    url = BASE + path
    headers = {"Content-Type": "application/json"}
    data = None
    if raw_body is not None:
        data = raw_body
    elif payload is not None:
        data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
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
        {"sources": sources, "useTmdbSchedule": True},
    )
    assert_json_ok(status, body)
    assert body.get("success") is True, body
    return body


def content_state(card, include_voices=True, uid=UID):
    q = urllib.parse.quote(uid, safe="") if uid else ""
    suffix = f"?uid={q}" if uid else ""
    return post(
        "/translationsub/v2/content-state" + suffix,
        {"card": card, "includeVoices": include_voices},
    )


def db_rows():
    assert DB.is_file(), f"SQLite database not found: {DB}"
    with sqlite3.connect(DB) as conn:
        conn.row_factory = sqlite3.Row
        return conn.execute(
            "SELECT id, uid, content_id, tmdb_id, imdb_id, kp_id, translation_id, translation_name, last_episode, sources_json FROM subscriptions ORDER BY rowid"
        ).fetchall()


def source_ids(settings_body):
    items = settings_body.get("availableSourceItems") or []
    return [str(item.get("id") or "").strip().lower() for item in items if isinstance(item, dict)]


def dump_metadata_diagnostics(known, selected, body):
    print("subscriptions-regression diagnostics:", flush=True)
    print("  available_sources=", json.dumps(known, ensure_ascii=False), flush=True)
    print("  selected_source=", selected, flush=True)
    print("  stub_hits=", json.dumps(hits), flush=True)
    print("  stub_requests=", json.dumps(requests_seen, ensure_ascii=False), flush=True)
    print("  content_state=", json.dumps(body, ensure_ascii=False), flush=True)


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
        movie = {
            "id": 999,
            "source": "tmdb",
            "media_type": "movie",
            "title": "CI Movie",
            "release_date": "2026-01-01",
        }

        # content-state guards
        status, body = post("/translationsub/v2/content-state", raw_body=b"")
        assert_json_ok(status, body)
        assert body == {"eligible": False, "reason": "empty_body"}, body

        status, body = content_state(card, uid=None)
        assert_json_ok(status, body)
        assert body.get("eligible") is False and body.get("reason") == "uid_required", body

        status, body = content_state(movie)
        assert_json_ok(status, body)
        assert body.get("eligible") is False and body.get("reason") == "not_serial", body

        # With no selected source, card state is still eligible and thin-card mode
        # must not hit metadata balancers.
        settings_body = settings([])
        known = source_ids(settings_body)
        metadata_before = hits["metadata"]
        status, body = content_state(card, include_voices=False)
        assert_json_ok(status, body)
        assert body.get("eligible") is True, body
        assert (body.get("button") or {}).get("subscribed") is False, body
        assert hits["metadata"] == metadata_before, hits

        status, body = content_state(card, include_voices=True)
        assert_json_ok(status, body)
        assert body.get("eligible") is True and body.get("reason") == "sources_disabled", body
        assert body.get("voices") == [], body

        # subscribe command guards
        status, body = post(f"/translationsub/v2/subscriptions?uid={UID_Q}", raw_body=b"")
        assert_json_ok(status, body)
        assert body.get("success") is False and body.get("error") == "empty_body", body

        status, body = post("/translationsub/v2/subscriptions", {"card": card, "voiceName": "CI Voice"})
        assert_json_ok(status, body)
        assert body.get("success") is False and body.get("error") == "uid_required", body

        status, body = post(f"/translationsub/v2/subscriptions?uid={UID_Q}", {"voiceName": "CI Voice"})
        assert_json_ok(status, body)
        assert body.get("success") is False and body.get("error") == "card_required", body

        status, body = post(
            f"/translationsub/v2/subscriptions?uid={UID_Q}",
            {"card": movie, "voiceName": "CI Voice"},
        )
        assert_json_ok(status, body)
        assert body.get("success") is False and body.get("error") == "not_serial", body

        status, body = post(
            f"/translationsub/v2/subscriptions?uid={UID_Q}",
            {"card": card, "voiceName": "CI Voice"},
        )
        assert_json_ok(status, body)
        assert body.get("success") is False and body.get("error") == "sources_disabled", body

        # The workflow config points these loaded providers at the local metadata
        # stub. Pick a configured source that actually exists in this runtime.
        preferred = ["flixcdn", "phantom", "zetflixdb", "videodb", "cdnvideohub"]
        selected = next((item for item in preferred if item in known), None)
        assert selected is not None, f"No configured CI source is available. available={known}"
        settings([selected])

        # Resolve voices through the actual metadata traversal.
        status, body = content_state(card, include_voices=True)
        assert_json_ok(status, body)
        dump_metadata_diagnostics(known, selected, body)
        assert body.get("eligible") is True, body
        voices = body.get("voices") or []
        assert len(voices) == 1, body
        voice = voices[0]
        assert voice.get("name") == "CI Voice", voice
        assert voice.get("latestEpisode") == 3, voice
        assert voice.get("subscribed") is False, voice
        assert hits["metadata"] > metadata_before, hits
        assert hits["tmdb"] > 0, hits

        voice_id = voice.get("id")
        voice_name = voice.get("name")
        assert voice_id and voice_name, voice

        status, body = post(
            f"/translationsub/v2/subscriptions?uid={UID_Q}&profile_id=3",
            {"card": card, "voiceId": "definitely-missing", "voiceName": "definitely-missing"},
        )
        assert_json_ok(status, body)
        assert body.get("success") is False and body.get("error") == "voice_not_found", body

        # Successful subscribe.
        status, body = post(
            f"/translationsub/v2/subscriptions?uid={UID_Q}&profile_id=3",
            {"card": card, "voiceId": voice_id, "voiceName": voice_name},
        )
        assert_json_ok(status, body)
        assert body.get("success") is True, body
        subscription_id = body.get("subscriptionId")
        assert subscription_id, body
        assert isinstance(body.get("snapshot"), dict), body

        rows = db_rows()
        assert len(rows) == 1, [dict(row) for row in rows]
        row = rows[0]
        assert row["id"] == subscription_id, dict(row)
        assert row["uid"] == UID, dict(row)
        assert row["content_id"] == "1396", dict(row)
        assert row["tmdb_id"] == "1396", dict(row)
        assert row["imdb_id"] == "tt0903747", dict(row)
        assert row["kp_id"] == "404900", dict(row)
        assert row["translation_name"] == "CI Voice", dict(row)
        assert row["last_episode"] == 3, dict(row)
        persisted_sources = json.loads(row["sources_json"])
        assert len(persisted_sources) == 1, persisted_sources

        # Duplicate subscribe is idempotent.
        status, duplicate = post(
            f"/translationsub/v2/subscriptions?uid={UID_Q}&profile_id=3",
            {"card": card, "voiceId": voice_id, "voiceName": voice_name},
        )
        assert_json_ok(status, duplicate)
        assert duplicate.get("success") is True, duplicate
        assert duplicate.get("subscriptionId") == subscription_id, duplicate
        assert len(db_rows()) == 1, [dict(row) for row in db_rows()]

        # Existing subscription is reflected in both card-only and voice states.
        status, state = content_state(card, include_voices=False)
        assert_json_ok(status, state)
        assert (state.get("button") or {}).get("subscribed") is True, state

        status, state = content_state(card, include_voices=True)
        assert_json_ok(status, state)
        subscribed = [item for item in (state.get("voices") or []) if item.get("subscribed")]
        assert len(subscribed) == 1, state
        assert subscribed[0].get("subscriptionId") == subscription_id, subscribed[0]
        assert subscribed[0].get("action") == "unsubscribe", subscribed[0]

        # UID isolation: another user cannot remove this subscription.
        other_uid = urllib.parse.quote("other@translationsub.test", safe="")
        status, body = post(
            f"/translationsub/v2/subscriptions/{subscription_id}/remove?uid={other_uid}",
            {},
        )
        assert_json_ok(status, body)
        assert body.get("success") is False and body.get("error") == "subscription_not_found", body
        assert len(db_rows()) == 1, [dict(row) for row in db_rows()]

        status, body = post(
            f"/translationsub/v2/subscriptions/{subscription_id}/remove",
            {},
        )
        assert_json_ok(status, body)
        assert body.get("success") is False and body.get("error") == "uid_required", body

        # Successful remove and idempotent failure afterwards.
        status, body = post(
            f"/translationsub/v2/subscriptions/{subscription_id}/remove?uid={UID_Q}&profile_id=3",
            {},
        )
        assert_json_ok(status, body)
        assert body.get("success") is True, body
        assert body.get("subscriptionId") == subscription_id, body
        assert isinstance(body.get("snapshot"), dict), body
        assert db_rows() == [], [dict(row) for row in db_rows()]

        status, body = post(
            f"/translationsub/v2/subscriptions/{subscription_id}/remove?uid={UID_Q}",
            {},
        )
        assert_json_ok(status, body)
        assert body.get("success") is False and body.get("error") == "subscription_not_found", body

        status, state = content_state(card, include_voices=False)
        assert_json_ok(status, state)
        assert (state.get("button") or {}).get("subscribed") is False, state

        print(
            "TranslationSub subscriptions/content-state regression passed; "
            f"source={selected}; metadata_hits={hits['metadata']}; tmdb_hits={hits['tmdb']}"
        )
    finally:
        stub.shutdown()
        stub.server_close()


if __name__ == "__main__":
    main()
