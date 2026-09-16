#!/usr/bin/env bash
set -Eeuo pipefail

BASE_RUNTIME="/tmp/lampac-translationsub-base"
RUNTIME="/tmp/lampac-targeted"
PIDS=()

cleanup() {
  local pid
  for pid in "${PIDS[@]:-}"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT
trap 'echo "TranslationSub targeted regression failed at line $LINENO" >&2; cleanup' ERR

track_pid() { PIDS+=("$1"); }

if [ ! -f "$BASE_RUNTIME/Core.dll" ]; then
  echo "Published Lampac runtime is missing: $BASE_RUNTIME/Core.dll" >&2
  exit 1
fi

rm -rf "$RUNTIME"
cp -a "$BASE_RUNTIME" "$RUNTIME"

cat > "$RUNTIME/init.yaml" <<'YAML'
chromium:
  enable: false
firefox:
  enable: false
rch:
  enable: false
cache:
  type: mem
accsdb:
  enable: false
BaseModule:
  LoadModules:
    - TranslationSub
    - TimeCode
listen:
  port: 9118
YAML

cat > "$RUNTIME/init.conf" <<'JSON'
{
  "TranslationSub": {
    "enable": true,
    "tmdb_apihost": "http://127.0.0.1:9125/tmdb",
    "tmdb_apikey": "ci-targeted-key"
  }
}
JSON

python3 scripts/ci/translationsub-targeted-regression.py serve > /tmp/translationsub-targeted-fixture.log 2>&1 &
fixture_pid=$!
track_pid "$fixture_pid"

ready=0
for _ in $(seq 1 40); do
  if curl -fsS --max-time 2 http://127.0.0.1:9125/health >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.25
done
if [ "$ready" != 1 ]; then
  echo "Targeted TMDB fixture did not become ready" >&2
  cat /tmp/translationsub-targeted-fixture.log || true
  exit 1
fi

(cd "$RUNTIME" && exec dotnet Core.dll > /tmp/lampac-targeted.log 2>&1) &
lampac_pid=$!
track_pid "$lampac_pid"

ready=0
for _ in $(seq 1 180); do
  if curl -fsS --max-time 2 'http://127.0.0.1:9118/translationsub/v2/settings?uid=target-ready%40translationsub.test' >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$lampac_pid" 2>/dev/null; then
    echo "Lampac exited before targeted regression became ready" >&2
    tail -n 400 /tmp/lampac-targeted.log || true
    exit 1
  fi
  sleep 0.5
done
if [ "$ready" != 1 ]; then
  echo "Lampac did not become ready for targeted regression" >&2
  tail -n 400 /tmp/lampac-targeted.log || true
  exit 1
fi

TRANSLATIONSUB_BASE_URL=http://127.0.0.1:9118 \
TRANSLATIONSUB_TARGET_RUNTIME="$RUNTIME" \
python3 scripts/ci/translationsub-targeted-regression.py run

if grep -E -i 'database is locked|SQLite Error|SqliteException|Unhandled exception' /tmp/lampac-targeted.log; then
  echo "Unexpected SQLite/unhandled failure in targeted Lampac log" >&2
  exit 1
fi

echo "TranslationSub targeted regression completed successfully"
