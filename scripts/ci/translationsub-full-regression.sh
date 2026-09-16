#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(pwd)"
HARNESS_COMMIT="b31714cb97d80aa0c4f04bcab2a08d464cb6216b"
BASE_RUNTIME="/tmp/lampac-translationsub-base"
RUNTIME="/tmp/lampac-runtime"
TICK_RUNTIME="/tmp/lampac-tickgate"
PIDS=()

log() { printf '\n===== %s =====\n' "$*"; }

cleanup() {
  local pid
  for pid in "${PIDS[@]:-}"; do
    if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; fi
  done
}
trap cleanup EXIT
trap 'echo "TranslationSub full regression failed at line $LINENO" >&2; cleanup' ERR

track_pid() { PIDS+=("$1"); }
kill_pid() {
  local pid="$1"
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 30); do
      if ! kill -0 "$pid" 2>/dev/null; then return 0; fi
      sleep 0.2
    done
    kill -9 "$pid" 2>/dev/null || true
  fi
}

install_harness() {
  log "Restore pinned TranslationSub regression harness"
  git fetch --no-tags --depth=1 origin "$HARNESS_COMMIT"
  mkdir -p scripts/ci
  local files=(
    translationsub-timecode-writer-audit.mjs
    translationsub-backend-driven-simulation.mjs
    translationsub-background-refresh-simulation.mjs
    translationsub-js-audit.mjs
    translationsub-settings-regression.py
    translationsub-subscriptions-regression.py
    translationsub-snapshot-progress-regression.py
    translationsub-concurrency-diagnostic.py
    translationsub-concurrency-fixture.py
    translationsub-concurrency-regression.py
    translationsub-fault-injection-regression.py
    translationsub-fault-source-fallback.py
    translationsub-persistence-restart.py
    translationsub-persistence-restart-realtime.mjs
    translationsub-realtime-client-regression.mjs
    translationsub-realtime-live.mjs
    translationsub-tick-gate-regression.py
  )
  local file
  for file in "${files[@]}"; do
    git show "$HARNESS_COMMIT:scripts/ci/$file" > "scripts/ci/$file"
  done
}

static_suite() {
  log "Static architecture, manifest and JavaScript contracts"
  while IFS= read -r -d '' file; do
    echo "node --check $file"
    node --check "$file"
  done < <(find Modules/TranslationSub -maxdepth 1 -type f -name 'translationsub*.js' -print0 | sort -z)

  python3 - <<'PY'
import json
from pathlib import Path
module = Path('Modules/TranslationSub')
manifest = json.loads((module / 'manifest.json').read_text(encoding='utf-8'))
declared = set(manifest.get('tree') or [])
actual = {
    path.relative_to(module).as_posix()
    for path in module.rglob('*.cs')
    if 'bin' not in path.parts and 'obj' not in path.parts
}
missing = sorted(actual - declared)
stale = sorted(path for path in declared if path.endswith('.cs') and not (module / path).is_file())
assert not missing, f'C# files missing from manifest.tree: {missing}'
assert not stale, f'Stale C# files in manifest.tree: {stale}'
print(f'manifest covers {len(actual)} C# files')
PY

  node scripts/ci/translationsub-timecode-writer-audit.mjs
  node scripts/ci/translationsub-backend-driven-simulation.mjs
  node scripts/ci/translationsub-background-refresh-simulation.mjs
  node scripts/ci/translationsub-js-audit.mjs

  local api='Modules/TranslationSub/translationsub-api.js'
  for route in '/translationsub/v2/snapshot' '/translationsub/v2/content-state' '/translationsub/v2/subscriptions' '/translationsub/v2/check' '/translationsub/v2/settings'; do
    grep -Fq "$route" "$api"
  done
  ! grep -Eq "request\('(PUT|DELETE)'" "$api"
  grep -Fq "'/translationsub/v2/subscriptions/' + id + '/remove'" "$api"
}

build_runtime() {
  log "Restore, build and publish current branch"
  dotnet restore --verbosity minimal NextGen.slnx
  dotnet build NextGen.slnx --configuration Release --no-restore --verbosity minimal
  rm -rf "$BASE_RUNTIME"
  dotnet publish Core/Core.csproj --configuration Release --output "$BASE_RUNTIME" --verbosity minimal -p:PlaywrightPlatform=linux-x64
  test -f "$BASE_RUNTIME/Core.dll"
  test -f "$BASE_RUNTIME/module/TranslationSub/manifest.json"
  test -f "$BASE_RUNTIME/module/Sync/TimeCode/manifest.json"
}

fresh_runtime() {
  local dir="$1"
  rm -rf "$dir"
  cp -a "$BASE_RUNTIME" "$dir"
}

write_yaml_standard() {
  local dir="$1"; shift
  local modules="$*"
  {
    cat <<'YAML'
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
YAML
    for module in $modules; do printf '    - %s\n' "$module"; done
    cat <<'YAML'
listen:
  port: 9118
YAML
  } > "$dir/init.yaml"
}

start_lampac() {
  local dir="$1" log_file="$2" ready_url="$3"
  (cd "$dir" && exec dotnet Core.dll > "$log_file" 2>&1) &
  local pid=$!
  track_pid "$pid"
  local ready=0
  for _ in $(seq 1 180); do
    if curl --silent --show-error --fail --max-time 2 "$ready_url" >/dev/null 2>&1; then ready=1; break; fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "Lampac exited before ready" >&2
      tail -n 400 "$log_file" || true
      return 1
    fi
    sleep 0.5
  done
  if [ "$ready" != 1 ]; then
    echo "Lampac did not become ready" >&2
    tail -n 400 "$log_file" || true
    return 1
  fi
  STARTED_PID="$pid"
}

assert_clean_log() {
  local log_file="$1"
  if grep -E -i 'database is locked|SQLite Error|SqliteException|Unhandled exception' "$log_file"; then
    echo "Unexpected SQLite/unhandled failure in $log_file" >&2
    return 1
  fi
}

settings_suite() {
  log "Settings API + SQLite"
  fresh_runtime "$RUNTIME"
  write_yaml_standard "$RUNTIME" TranslationSub FlixCDN Phantom ZetflixDB VideoDB CDNvideohub
  start_lampac "$RUNTIME" /tmp/lampac-settings.log 'http://127.0.0.1:9118/translationsub/v2/settings?uid=settings-regression%40translationsub.test'
  local pid="$STARTED_PID"
  python3 scripts/ci/translationsub-settings-regression.py
  kill_pid "$pid"
}

write_external_fixture_config() {
  local dir="$1" host="$2" port="$3"
  cat > "$dir/init.conf" <<JSON
{
  "TranslationSub": {"enable": true, "tmdb_apihost": "http://127.0.0.1:${port}/tmdb"},
  "FlixCDN": {"enable": true, "overridehost": "http://${host}:${port}/meta"},
  "Phantom": {"enable": true, "overridehost": "http://${host}:${port}/meta"},
  "ZetflixDB": {"enable": true, "overridehost": "http://${host}:${port}/meta"},
  "VideoDB": {"enable": true, "overridehost": "http://${host}:${port}/meta"},
  "CDNvideohub": {"enable": true, "overridehost": "http://${host}:${port}/meta"}
}
JSON
}

subscriptions_suite() {
  log "Subscriptions + content-state + metadata voices"
  fresh_runtime "$RUNTIME"
  write_yaml_standard "$RUNTIME" TranslationSub FlixCDN Phantom ZetflixDB VideoDB CDNvideohub
  write_external_fixture_config "$RUNTIME" translationsub-fixture.test 9120
  start_lampac "$RUNTIME" /tmp/lampac-subscriptions.log 'http://127.0.0.1:9118/translationsub/v2/settings?uid=subscriptions-regression%40translationsub.test'
  local pid="$STARTED_PID"
  python3 scripts/ci/translationsub-subscriptions-regression.py
  kill_pid "$pid"
}

snapshot_suite() {
  log "Snapshot + profile projection + TimeCode + forced check"
  fresh_runtime "$RUNTIME"
  write_yaml_standard "$RUNTIME" TranslationSub TimeCode FlixCDN Phantom ZetflixDB VideoDB CDNvideohub
  write_external_fixture_config "$RUNTIME" translationsub-fixture.test 9120
  start_lampac "$RUNTIME" /tmp/lampac-snapshot-progress.log 'http://127.0.0.1:9118/translationsub/v2/settings?uid=snapshot-progress%40translationsub.test'
  local pid="$STARTED_PID"
  python3 scripts/ci/translationsub-snapshot-progress-regression.py
  kill_pid "$pid"
}

concurrency_suite() {
  log "Concurrency + SQLite writer locking"
  fresh_runtime "$RUNTIME"
  write_yaml_standard "$RUNTIME" TranslationSub TimeCode FlixCDN
  cat > "$RUNTIME/init.conf" <<'JSON'
{
  "TranslationSub": {"enable": true, "tmdb_apihost": "http://127.0.0.1:9120/tmdb"},
  "FlixCDN": {"enable": true, "overridehost": "http://translationsub-fixture.test:9120/meta"}
}
JSON
  python3 scripts/ci/translationsub-concurrency-fixture.py > /tmp/translationsub-concurrency-fixture.log 2>&1 &
  local fixture=$!; track_pid "$fixture"
  for _ in $(seq 1 30); do curl -fsS --max-time 2 http://127.0.0.1:9120/health >/dev/null 2>&1 && break; sleep 0.5; done
  start_lampac "$RUNTIME" /tmp/lampac-concurrency.log 'http://127.0.0.1:9118/translationsub/v2/settings?uid=concurrency-0%40translationsub.test'
  local pid="$STARTED_PID"
  python3 scripts/ci/translationsub-concurrency-diagnostic.py
  python3 scripts/ci/translationsub-concurrency-regression.py run
  assert_clean_log /tmp/lampac-concurrency.log
  kill_pid "$pid"; kill_pid "$fixture"
}

fault_suite() {
  log "Metadata/TMDB failures, timeout and source fallback"
  fresh_runtime "$RUNTIME"
  write_yaml_standard "$RUNTIME" TranslationSub TimeCode FlixCDN Phantom
  cat > "$RUNTIME/init.conf" <<'JSON'
{
  "TranslationSub": {"enable": true, "tmdb_apihost": "http://127.0.0.1:9122/tmdb", "tmdb_apikey": "ci-fault-key"},
  "FlixCDN": {"enable": true, "overridehost": "http://translationsub-fault.test:9122/meta"},
  "Phantom": {"enable": true, "overridehost": "http://translationsub-fault.test:9123/meta"}
}
JSON
  python3 scripts/ci/translationsub-fault-injection-regression.py serve > /tmp/translationsub-fault-fixture.log 2>&1 &
  local f1=$!; track_pid "$f1"
  python3 scripts/ci/translationsub-fault-source-fallback.py serve > /tmp/translationsub-phantom-fixture.log 2>&1 &
  local f2=$!; track_pid "$f2"
  for _ in $(seq 1 40); do
    if curl -fsS --max-time 2 http://127.0.0.1:9122/health >/dev/null 2>&1 && curl -fsS --max-time 2 http://127.0.0.1:9123/health >/dev/null 2>&1; then break; fi
    sleep 0.5
  done
  start_lampac "$RUNTIME" /tmp/lampac-fault.log 'http://127.0.0.1:9118/translationsub/v2/settings?uid=fault-metadata%40translationsub.test'
  local pid="$STARTED_PID"
  python3 scripts/ci/translationsub-fault-injection-regression.py run
  python3 scripts/ci/translationsub-fault-source-fallback.py run
  assert_clean_log /tmp/lampac-fault.log
  kill_pid "$pid"; kill_pid "$f1"; kill_pid "$f2"
}

persistence_suite() {
  log "SQLite + TimeCode + clean restart + NWS recovery"
  fresh_runtime "$RUNTIME"
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
  enable: true
  accounts:
    persistence-restart@translationsub.test: '2099-01-01T00:00:00'
BaseModule:
  nws: true
  LoadModules:
    - TranslationSub
    - TimeCode
    - FlixCDN
    - Phantom
    - ZetflixDB
    - VideoDB
    - CDNvideohub
listen:
  port: 9118
YAML
  write_external_fixture_config "$RUNTIME" translationsub-fixture.test 9120
  python3 scripts/ci/translationsub-persistence-restart.py serve > /tmp/translationsub-persistence-fixture.log 2>&1 &
  local fixture=$!; track_pid "$fixture"
  for _ in $(seq 1 30); do curl -fsS --max-time 2 http://127.0.0.1:9120/health >/dev/null 2>&1 && break; sleep 0.5; done

  start_lampac "$RUNTIME" /tmp/lampac-persistence-first.log 'http://127.0.0.1:9118/translationsub/v2/settings?uid=persistence-restart%40translationsub.test'
  local first="$STARTED_PID"
  python3 scripts/ci/translationsub-persistence-restart.py prepare
  kill_pid "$first"
  test -f "$RUNTIME/database/translationsub.db"
  test -f "$RUNTIME/database/TimeCode.sql"
  python3 - <<'PY'
import sqlite3
for path in ('/tmp/lampac-runtime/database/translationsub.db','/tmp/lampac-runtime/database/TimeCode.sql'):
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',), path
PY
  start_lampac "$RUNTIME" /tmp/lampac-persistence-second.log 'http://127.0.0.1:9118/translationsub/v2/settings?uid=persistence-restart%40translationsub.test'
  local second="$STARTED_PID"
  python3 scripts/ci/translationsub-persistence-restart.py verify 2
  LAMPAC_BASE=http://127.0.0.1:9118 TRANSLATIONSUB_PERSISTENCE_STATE=/tmp/translationsub-persistence-state.json node scripts/ci/translationsub-persistence-restart-realtime.mjs
  python3 scripts/ci/translationsub-persistence-restart.py verify 3
  kill_pid "$second"; kill_pid "$fixture"
}

realtime_suite() {
  log "Live NWS + client + SQLite + TimeCode"
  node scripts/ci/translationsub-realtime-client-regression.mjs
  fresh_runtime "$RUNTIME"
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
  enable: true
  accounts:
    ci@translationsub.test: '2099-01-01T00:00:00'
BaseModule:
  nws: true
  LoadModules:
    - TranslationSub
    - TimeCode
listen:
  port: 9118
YAML
  start_lampac "$RUNTIME" /tmp/lampac-realtime.log 'http://127.0.0.1:9118/translationsub/v2/settings?uid=ci%40translationsub.test'
  local pid="$STARTED_PID"
  python3 - <<'PY'
import sqlite3
path='/tmp/lampac-runtime/database/translationsub.db'
with sqlite3.connect(path, timeout=10) as db:
    db.execute('''INSERT OR REPLACE INTO subscriptions (
      id, uid, content_id, title, original_title, is_serial, source,
      translation_id, translation_name, current_season, last_season,
      last_episode, sources_json, created_at, tmdb_new_season_available
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
    ('ci-subscription','ci@translationsub.test','ci-series','CI Series','CI Series',1,'multi','ci-voice','CI Voice',1,1,3,'[]','2026-01-01T00:00:00.0000000',0))
    db.commit()
PY
  LAMPAC_BASE=http://127.0.0.1:9118 TRANSLATIONSUB_STORE=/tmp/lampac-runtime/database/translationsub.db node scripts/ci/translationsub-realtime-live.mjs
  kill_pid "$pid"
}

tick_gate_suite() {
  log "Background tick + manual check under slow TMDB"
  fresh_runtime "$TICK_RUNTIME"
  write_yaml_standard "$TICK_RUNTIME" TranslationSub TimeCode
  cat > "$TICK_RUNTIME/init.conf" <<'JSON'
{"TranslationSub":{"enable":true,"tmdb_apihost":"http://127.0.0.1:9124/tmdb","tmdb_apikey":"ci-tick-gate-key"}}
JSON
  python3 scripts/ci/translationsub-tick-gate-regression.py serve > /tmp/translationsub-tick-gate-fixture.log 2>&1 &
  local fixture=$!; track_pid "$fixture"
  for _ in $(seq 1 30); do curl -fsS --max-time 2 http://127.0.0.1:9124/health >/dev/null 2>&1 && break; sleep 0.5; done
  start_lampac "$TICK_RUNTIME" /tmp/lampac-tick-gate.log 'http://127.0.0.1:9118/translationsub/v2/settings?uid=tick-gate-manual%40translationsub.test'
  local pid="$STARTED_PID"
  TRANSLATIONSUB_BASE_URL=http://127.0.0.1:9118 TRANSLATIONSUB_TICK_GATE_FIXTURE=http://127.0.0.1:9124 TRANSLATIONSUB_DB_PATH=/tmp/lampac-tickgate/database/translationsub.db python3 scripts/ci/translationsub-tick-gate-regression.py run
  assert_clean_log /tmp/lampac-tick-gate.log
  kill_pid "$pid"; kill_pid "$fixture"
}

install_harness
static_suite
build_runtime

echo '127.0.0.1 translationsub-fixture.test translationsub-fault.test' | sudo tee -a /etc/hosts >/dev/null

settings_suite
subscriptions_suite
snapshot_suite
concurrency_suite
fault_suite
persistence_suite
realtime_suite
tick_gate_suite

log "ALL FUNCTIONAL TRANSLATIONSUB REGRESSIONS PASSED"
