#!/usr/bin/env python3
import json
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "http://127.0.0.1:9118"
USERS = [f"diag-{i}@translationsub.test" for i in range(6)]


def req(method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json"} if payload is not None else {}
    request = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            text = response.read().decode()
            return response.status, json.loads(text) if text else None
    except urllib.error.HTTPError as exc:
        text = exc.read().decode()
        try:
            body = json.loads(text) if text else None
        except Exception:
            body = text
        return exc.code, body
    except Exception as exc:
        return 0, {"client_exception": repr(exc)}


def q(value):
    return urllib.parse.quote(value, safe="")


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


def settings(uid):
    return req("POST", f"/translationsub/v2/settings?uid={q(uid)}", {
        "checkIntervalHours": 6,
        "sources": ["flixcdn"],
        "useTmdbSchedule": False,
    })


def state(uid):
    return req("POST", f"/translationsub/v2/content-state?uid={q(uid)}", {
        "card": card(), "includeVoices": True,
    })


def subscribe(uid, voice_id, voice_name):
    return req("POST", f"/translationsub/v2/subscriptions?uid={q(uid)}", {
        "card": card(), "voiceId": voice_id, "voiceName": voice_name,
    })


def burst(callables, workers):
    results = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_map = {pool.submit(fn): label for label, fn in callables}
        for future in as_completed(future_map):
            results.append((future_map[future], future.result()))
    return results


def summarize(name, results):
    counts = Counter()
    for uid, (status, body) in results:
        error = body.get("error") if isinstance(body, dict) else None
        client_exception = body.get("client_exception") if isinstance(body, dict) else None
        key = (status, error or client_exception or "ok")
        counts[key] += 1
    print(name, dict(counts), flush=True)


def main():
    for uid in USERS:
        status, body = settings(uid)
        assert status == 200 and body.get("success") is True, (uid, status, body)

    status, initial = state(USERS[0])
    assert status == 200 and len(initial.get("voices") or []) == 1, initial
    voice = initial["voices"][0]
    voice_id = voice.get("id")
    voice_name = voice.get("name")
    print(f"diagnostic canonical voice id={voice_id!r}, name={voice_name!r}", flush=True)

    content_calls = []
    for uid in USERS:
        for _ in range(6):
            content_calls.append((uid, lambda uid=uid: state(uid)))
    content_results = burst(content_calls, 36)
    summarize("36 concurrent content-state", content_results)

    content_failures = [(uid, result) for uid, result in content_results
                        if result[0] != 200 or not isinstance(result[1], dict)
                        or len(result[1].get("voices") or []) != 1]
    print("content-state failures", json.dumps(content_failures, ensure_ascii=False), flush=True)

    subscribe_calls = []
    for uid in USERS:
        for _ in range(6):
            subscribe_calls.append((uid, lambda uid=uid: subscribe(uid, voice_id, voice_name)))
    subscribe_results = burst(subscribe_calls, 36)
    summarize("36 concurrent subscribe", subscribe_results)

    failures = defaultdict(list)
    for uid, (status, body) in subscribe_results:
        if status != 200 or not isinstance(body, dict) or body.get("success") is not True:
            failures[uid].append((status, body))
    print("subscribe failures by uid", json.dumps(failures, ensure_ascii=False), flush=True)

    for uid in sorted(failures):
        state_result = state(uid)
        retry_result = subscribe(uid, voice_id, voice_name)
        print("post-failure sequential probe", uid,
              json.dumps({"state": state_result, "retry": retry_result}, ensure_ascii=False), flush=True)

    # Diagnostic step itself stays green so the full regression still runs and
    # remains the authoritative pass/fail signal.
    print("TranslationSub concurrency diagnostic complete", flush=True)


if __name__ == "__main__":
    main()
