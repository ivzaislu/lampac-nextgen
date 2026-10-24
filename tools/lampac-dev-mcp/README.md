# Lampac Dev MCP — first prototype

An MCP server for development **in a separate branch of the user's own Lampac fork**.
This is NOT a Lampac module: it is an independent MCP process kept in this fork for initial development.

## Implemented tools

- start_task: makes dev/feature/... or dev/fix/... from origin/main in an isolated Git worktree.
- list_modules, inspect_module: discover manifest.json and validate its tree paths.
- read_source, write_source: read and edit files in the task branch only.
- build_project: attempt a resource-limited offline .NET 10 Docker build of an individual csproj.
- task_diff, task_status: inspect local changes and build logs.
- publish_branch: commit and push the task branch only. NEVER create PR, merge, or modify main.

## Limitations

THIS IS AN MVP, NOT COMPLETE MODULE TESTING. Build/manifest checks do
not prove module functionality. A bounded live Online provider-to-stream probe
is now implemented, but automated per-task deployment, browser life-cycle
supervision, complete playback validation, SISI, background services and
other module-specific profiles remain unfinished. No actual VPS live-test
result has been obtained from this code yet.

Each MCP instance serves ONE trusted user and ONE GitHub fork. Use separate
instances, credentials, data directories, and sandbox isolation for different
users. Never expose an unauthenticated server to the public Internet.

## Requirements

Linux VPS; Python 3.11+; Git; Docker Engine; .NET 10 SDK Docker image.
Plan roughly 2 GB RAM or more as a starting point; the actual minimum has
not been benchmarked. The account running this server needs permission to
start Docker containers, which is highly privileged on most hosts.

## Installation

Run under a dedicated service account, not root.

    cd tools/lampac-dev-mcp
    python3 -m venv .venv
    . .venv/bin/activate
    pip install -r requirements.txt

    export LAMPAC_REPO="https://github.com/ivzaislu/lampac-nextgen.git"
    export LAMPAC_MCP_DATA="$HOME/lampac-dev-mcp-data"
    python server.py

Default transport is stdio. A local MCP client should launch the Python
process and communicate over stdin/stdout. A remote MCP client can use
LAMPAC_MCP_TRANSPORT=streamable-http, but this option MUST be kept on
loopback behind an authenticated HTTPS reverse proxy or OAuth gateway.
This MVP implements no OAuth. Do not expose it directly. ChatGPT's own
custom-MCP availability and auth support must be checked before connecting.

Git operations use the service account's external Git credentials.
Use a GitHub App or a managed credential helper with minimal repository
permissions. Never put tokens in repository URL, module source or task prompt.

## 1 vCPU / 1 GB RAM: recommended backend

The VPS is the **MCP controller** only. Do NOT build .NET 10 locally by default:
`build_project` returns `disabled-on-vps`. Lampac development builds are
delegated to the fork's **existing** `.github/workflows/build.yml` workflow
(which already supports `workflow_dispatch` on feature branches).

Configure a GitHub token with **Actions: read and write** on this fork;
it must be secret and should be short-lived. For pushing branches Git
also needs **Contents: write**, preferably through separate credentials.
Do not expose these tokens to test containers.

    export LAMPAC_GH_TOKEN="YOUR_SECRET_FROM_VAULT"

After editing source, call `publish_branch`; once the branch commit exists
on GitHub, call `request_ci_build(task_id)`. Read the result via
`get_ci_build_status(task_id)`. GitHub Actions might need enabling on
a new fork, and workflow runs can be delayed or fail for reasons other
than source compilation. Only the user can merge changes; the MCP cannot
create PRs or change main.

The fork's existing `build.yml` builds more than one project (including
a Docker image job with publish disabled on feature branches), so it will
use GitHub runner resources, **not** the small VPS.

A local experiment is possible with `LAMPAC_ENABLE_LOCAL_BUILD=1`; then
`build_project` uses Docker with 1 CPU, 640 MB RAM, no swap inside the
container, and a 10-minute timeout. On a 1 GB VPS it can still fail due to
RAM pressure. An out-of-memory/restore failure is **inconclusive**, not
proof that the module is broken. Do not run local builds alongside Lampac.

For actual runtime smoke tests on VPS, a separate test-only Lampac process
and per-module profiles still need implementing and RAM benchmarking. Avoid
starting a full instance, Chromium, GStreamer, and transcoding together.

## First live test on an existing test-only Lampac container

The standalone `probe_online.py` and `live_tests.py` tools support **Python 3.6+**
without installing extra Python packages. The full MCP server remains a
**Python 3.11+** application because it uses FastMCP and newer runtime features.
Before running the probe, inspect `python3 --version`. On legacy Python 3.6
there is no need to replace system Python for this standalone network test.

This step exercises the image already running at `127.0.0.1:29118`.
It is **infrastructure smoke testing**, NOT validation of changes in a
branch-specific build. Existing module code is not edited, and no
production container is touched.

Run as an unprivileged user on the VPS (not as root):

    mkdir -p ~/lampac-online-test && cd ~/lampac-online-test
    BASE_RAW="https://raw.githubusercontent.com/ivzaislu/lampac-nextgen/dev/feature/lampac-dev-mcp-20261024/tools/lampac-dev-mcp"
    curl --fail --show-error --location --output live_tests.py "$BASE_RAW/live_tests.py"
    curl --fail --show-error --location --output probe_online.py "$BASE_RAW/probe_online.py"
    python3 probe_online.py --provider hdvb \
      --param "kinopoisk_id=258687" --param "title=Интерстеллар"

The test sends real external requests through Lampac, follows up to six
`/lite/` JSON navigation steps and probes a tiny part of the final media
stream. On this low-powered VPS do just ONE test at a time; do not run
parallel browser tests.

**Confirmed real VPS result (2026-10-24):** HDVB returned a movie
template, navigated to play, delivered two HLS manifests and 65,536
MPEG-TS bytes. The sample contained 348 synchronized TS packets, a PAT,
and codecs H.264 + AAC confirmed by FFprobe (exit code 0). The test CLI
returned `passed` / exit code 0 without network retries. An anonymized
report is saved at `reports/hdvb-vps-2026-10-24.json`.
This validates real online testing on the VPS using the *stock Lampac
container*; it does **not** validate code built from this task branch
or prove full video playback.

In an earlier real HDVB smoke check, Lampac returned movie -> play and two HLS
manifests, then 65,536 bytes of video/mp2t; FFprobe did not confirm a
codec from that partial sample. The next CLI version reports MPEG-TS packet
framing (`mpegts_sync_detected`, `mpegts_packet_count`,
`mpegts_pat_seen`) and FFprobe's **numeric exit code / sanitized issue
category**, so users can distinguish valid stream transport from
inconclusive codec detection. An actual HDVB run on a 1 GB VPS reported
348 synchronized TS packets plus PAT and `ffprobe_exit_code=127`. That
points to an FFprobe process/loader failure, not evidence of bad media.
The initial 384 MiB virtual-address-space cap could prevent FFprobe's
shared libraries from loading; we now use 2048 MiB virtual memory while
keeping the 5-second CPU and 10-second wall-clock limits. This is NOT
a 2 GB physical RAM allocation or a per-process RSS guarantee.
Check `ffprobe -version` under the same VPS account if exit 127 recurs.
No raw ffprobe stderr (potentially containing tokenized URLs) is printed.

An intermittent HDVB repeat reached the `play` URL but the stream fetch
timed out. Streaming requests now use a 20-second connection/read timeout and
one additional attempt **only after a transport error**. It does not retry
HTTP errors, permission failures or provider search calls. The output includes
`phase` (initial playback or HLS follow-up), `endpoint`
(`lampac-loopback` or allowlisted HTTPS), `network_error` (timeout,
DNS, connection reset etc.), `attempts` and `network_retries`.
When the endpoint is `lampac-loopback`, the upstream CDN can still be the
root cause because Lampac may act as an HTTP proxy. These diagnostic labels
never include signed URLs, stream tokens or raw response bodies. The timeout
still cannot prove that a remote provider is generally broken.

Exit codes: 0 passed with codec, 1 failed, 2 inconclusive, 3 blocked,
4 unknown status. In particular `inconclusive` can mean provider outage,
RCH/auth requirement, geo restrictions, an unreadable partial segment or
a new CDN requiring explicit allowlisting. The code never prints complete
media URLs, tokens or captured source content. Test with
`python3 -m unittest discover -s tests -v` after retrieving
the test files if you wish to exercise the fake Lampac fixture.

A playback URL at a non-Lampac HTTPS hostname is rejected unless its exact
hostname is listed via `--stream-hosts example.cdn.com`. Review the reported
hostname before adding it; do not broadly allow arbitrary domains.
Do NOT bypass access controls or DRM.

## Memory-limited FlixCDN test after a .NET OutOfMemory exit

On the 970 MiB RAM / 5 GiB swap VPS, the FlixCDN headed-browser attempt
reached Xvfb initialization (`xkbcomp` warnings, non-fatal) and later
the Lampac log ended with `Out of memory.` at 2026-10-24 18:28:12 UTC.
The container was subsequently `exited`, `PID=0`, `OOMKilled=false`.
Kernel `journalctl` did not show a global OOM-killer entry for the
checked period. A .NET/native memory-allocation failure can therefore
stop the process without Docker setting `OOMKilled=true`. The initial
headless Chromium may also coexist with FlixCDN's separate headed
Chromium. We should NOT run another browser test under the old
unfiltered module configuration.

Use `examples/flixcdn-vps-low-memory.init.conf` to limit the loaded
dynamic modules to `Online` and `FlixCDN`. Preserve `base.conf`
inheritance, keep `lowMemoryMode` and Playwright enabled, and reduce
global browser retained contexts to one with two minutes' keepalive.
This reduces startup compilation and idle retention; it does NOT prove
the two browser processes together will fit in 700 MiB.

Because `BaseModule.LoadModules` is applied on startup, replacing an
`init.conf` inside an exited test container is followed by
`docker start`. Keep the same isolated container, its 127.0.0.1-only
published port and its 700 MiB memory limit. Avoid starting a second
container at the same time. Retrieve the immutable GitHub commit version
of this file before copying it to the container, e.g.:

    cd /home/ubuntu/lampac-online-test
    RAW="https://raw.githubusercontent.com/ivzaislu/lampac-nextgen/41a40be3205f6b05eebb382169ddfc8586e2cc8a/tools/lampac-dev-mcp"
    sudo -u ubuntu curl -fLsS "$RAW/examples/flixcdn-vps-low-memory.init.conf" -o flixcdn-vps-low-memory.init.conf
    sudo -u ubuntu python3 -m json.tool flixcdn-vps-low-memory.init.conf >/dev/null
    docker inspect lampac-mcp-test --format 'PreviousExit={{.State.ExitCode}} OOM={{.State.OOMKilled}}'
    docker cp flixcdn-vps-low-memory.init.conf lampac-mcp-test:/lampac/init.conf
    docker start lampac-mcp-test

After it reports HTTP 200 on `/api/chromium/ping`, check the
startup logs list `loaded module: Online` and
`loaded module: FlixCDN` but NOT dozens of other dynamic modules.
Only then execute a single FlixCDN test with a 90-second
navigation timeout. Inspect process RSS and the container exit status
afterward. If `Out of memory.` recurs, stop: report a resource issue,
not a provider-source-code bug. For truly browser-heavy testing the
VPS may need more physical RAM or further separated global/browser
lifecycles. Do not use `--memory-swap` on this host as a relied-upon
per-container control: Docker previously warned swap limit accounting
was unsupported.

## Headed Chrome + Xvfb live smoke: FlixCDN

The previous VPS observation confirmed `/usr/bin/chromium` and
`/usr/bin/Xvfb` inside `lampac-mcp-test`; its log contained
`loaded module: FlixCDN`. The initially checked manifest path was
wrong: the module is shipped under `/lampac/module/OnlineRUS/FlixCDN/`.
The missing `/lampac/init.conf` is normal when Lampac uses
`/lampac/base.conf` with built-in defaults. The module itself defaults
to **disabled**. To exercise FlixCDN, enable it **only in the disposable
test container**, not in a production Lampac.

On the VPS, while keeping the existing single `lampac-mcp-test`
container running (a second Lampac/Chrome would overcommit 1 GB RAM):

    docker exec lampac-mcp-test test -f /lampac/base.conf
    docker exec lampac-mcp-test test -f /lampac/module/OnlineRUS/FlixCDN/manifest.json
    cd /home/ubuntu/lampac-online-test
    RAW="https://raw.githubusercontent.com/ivzaislu/lampac-nextgen/dev/feature/lampac-dev-mcp-20261024/tools/lampac-dev-mcp"
    sudo -u ubuntu curl -fLsS "$RAW/examples/flixcdn-vps.init.conf" -o flixcdn-vps.init.conf
    sudo -u ubuntu python3 -m json.tool flixcdn-vps.init.conf > /dev/null
    docker cp flixcdn-vps.init.conf lampac-mcp-test:/lampac/init.conf

This is an ephemeral edit to that **test** container only.
`CoreInit` watches `init.conf` for changes, and `FlixCDN` registers
an update handler. New module load filters need a fresh Lampac process,
but toggling `FlixCDN.enable` on this already loaded module should be
picked up without a restart. The overlay inherits `base.conf` and
preserves the loopback-only host Docker port mapping.

Run one test; FlixCDN launches its own headed Chromium and Xvfb on
the streaming step (separate from Lampac's headless Chromium):

    timeout 180s sudo -u ubuntu python3 probe_online.py --provider flixcdn \
      --navigation-timeout 90 \
      --param "kinopoisk_id=258687" --param "title=Интерстеллар"
    echo "exit code: $?"
    docker inspect lampac-mcp-test --format 'OOM={{.State.OOMKilled}} Status={{.State.Status}}'
    docker stats --no-stream lampac-mcp-test

First live FlixCDN attempt: the provider returned `movie`, but its next
`/lite/flixcdn/stream` navigation hit the runner's 12-second read timeout.
A following `docker stats` showed `0B / 0B` despite an earlier inspect
reporting `running`, so that snapshot should **not** be read as genuine zero
memory use. Evidence is saved in
`reports/flixcdn-vps-inconclusive-2026-10-24.json`. The next attempt
sets `--navigation-timeout 90` for browser-backed navigation, without
retrying a heavy headed Chromium launch. The first provider lookup still
times out after 12 seconds. The MCP also uses the 90-second bound when
testing a provider in `headed` mode or specifically FlixCDN.

Before that attempt check the container process and HTTP readiness:
`docker inspect lampac-mcp-test --format 'PID={{.State.Pid}} Running={{.State.Running}} OOM={{.State.OOMKilled}}'`;
`docker top lampac-mcp-test -eo pid,comm,rss`; and
`curl -fsS --max-time 8 http://127.0.0.1:29118/api/chromium/ping`.
Do not run another Lampac/Chromium container in parallel.

Provider access limitations, proxy requirements, or a missing film may
yield an inconclusive test; those outcomes are not evidence that the
headless/headed runtime is broken. **Do not globally disable Chromium
or weaken its sandbox.** A line like `Browser_Disconnected` alone is not
a provider failure. Never post complete signed media URLs or access
tokens from raw HTTP responses/logs.

## Browser-required providers on a 1 vCPU / 1 GB RAM VPS

**Do not disable Playwright or Chromium globally.** Some Lampac providers
need browser execution to obtain a playable URL. The live test tool calls
Lampac's real provider HTTP endpoints; **Lampac itself** launches any
required browser. The MCP runner must **not** launch a second Chromium.

Use `vps_browser_preflight("headless")` or
`vps_browser_preflight("headed")` to inspect `/proc/meminfo`, active
swap, available RAM, Chromium installation, Xvfb availability and cgroup
limits. Preflight reports resource observations, not proof that browser
startup will work. To confirm swap directly on Linux, run
`swapon --show` and `free -h`.

Two distinct cases exist **in this fork's current source code**:

- **Standard Playwright integration**: in `Shared/CoreInit.cs`,
  `chromium.enable = true`, `Headless = true`, and the default
  `chromium.context` uses `keepopen = true`, `min = 0`,
  `max = 4`, `keepalive = 20` minutes. For this small VPS,
  experimentally reduce retained contexts (e.g. max = 1) and use
  strictly sequential requests. Do not disable `keepopen` if the
  provider relies on persistent browser state.
- **FlixCDN**: `Modules/OnlineRUS/FlixCDN/BrowserResolver.cs`
  manages a separate **headed** Chromium and, on Linux, spawns
  `/usr/bin/Xvfb`. Its current resolver can run two concurrent
  browser operations; for a 1 GB VPS this may need explicit source
  changes to cap it at one. Do not assume the headless Playwright
  setting controls this resolver.

**5 GB swap can help survival but does not turn 1 GB RAM into 6 GB RAM.**
If Chromium pages are swapped, checks may become extremely slow and
timeouts may occur. One browser-requiring module at a time, no separate
Playwright browser launched by MCP, and no concurrent transcoding.
A browser readiness failure is `inconclusive` / infrastructure failure,
**not proof that the provider itself is broken**.

These profiles are a planned improvement, not implemented automatic
per-module browser selection yet. Before every test ensure the
**isolated Lampac test instance** was deployed from the task branch
SHA; never run provider tests against production or main.

## LIVE Online tests on VPS (real internet, NOT offline)

The VPS runs a **test-only** Lampac process built from the current task branch.
The workflow is: compile on GitHub Actions -> manually deploy that exact branch
commit to the isolated test instance -> run end-to-end checks on the VPS.

New MCP tool: `run_live_online_test(task_id, provider, params, browser_mode)`. Set `browser_mode` to `none`, `headless` or `headed`; the mode is for resource diagnostics, not for launching an extra browser.

For example, after deploying the task branch, test a provider whose API accepts
a KinoPoisk identifier:

    run_live_online_test(
      task_id="THE_TASK_ID",
      provider="hdvb",
      params={"kinopoisk_id":"A_VALID_TEST_ID", "title":"A_TEST_TITLE"}
    )

The runner uses `rjson=true` and follows Lampac template responses:
`similar` -> `movie` or `season` -> `episode` -> `VideoTpl`
(playback URL). It then really fetches the HLS playlist or a direct media URL,
fetches one short media fragment (max 256 KiB per request), and optionally
asks `ffprobe` to identify an audio/video codec from that sample. This checks
**network availability and stream bytes**, not complete film playback; limited
fragments might be too short to decode, so a stream can be marked
`inconclusive` even when it actually works.

**Required on VPS:**

1. Install and start the Lampac version BUILT FROM THE TASK BRANCH in a
   separate test process. Do not use production Lampac or main.
2. Bind the test port to loopback (for example 127.0.0.1:29118) and ensure
   the MCP service can reach it. Avoid starting Chromium/transcoding alongside
   this test on a 1 GB VPS.
3. After verifying the deployed process, have the *trusted deployment script*
   write the exact 40-character **task commit SHA** to
   `LAMPAC_TEST_DATA/test-instance/commit.sha`, where
   `LAMPAC_TEST_DATA` here denotes the same location as
   `LAMPAC_MCP_DATA` (by default `/srv/lampac-dev-mcp`).
   The runner reads `LAMPAC_TEST_DEPLOYED_SHA_FILE` when overridden.
   This marker is **a deployment attestation set by the operator**, not
   verified against a remote running process. Never copy an arbitrary SHA
   without checking the running test instance.
4. Set `LAMPAC_TEST_BASE_URL=http://127.0.0.1:29118`. If Lampac generates
   playback links using its own public domain rather than loopback, set
   `LAMPAC_TEST_PUBLIC_BASE_URL` to that exact public base so the runner
   can rewrite *only* that origin to the local test instance.
5. If the playback URL bypasses Lampac's `/proxy` and targets an external
   CDN directly, its hostname must be explicitly allowed with
   `LAMPAC_TEST_STREAM_HOSTS=cdn.example.org,*.other.example.org`.
   The runner refuses arbitrary internal addresses and HTTP external URLs.
   Stream hosts and redirects must pass allowlist checks.
6. Install `ffprobe` if you need codec identification. Without it, a
   successful HTTP fragment fetch is still reported, but the full test
   returns `inconclusive`, not `passed`.

Testing makes **real outgoing connections** from your VPS to external
providers/CDNs, under their normal authentication, geographic and rate
restrictions. Outcomes are:
- `passed`: media bytes received and codec identified from the sample.
- `failed`: a definite error in the tested response or route.
- `inconclusive`: blocked source, missing allowlist, network failure,
  DRM/geo/access restrictions, or insufficient codec data.
- `not-ready`: test instance is not marked as the task's exact commit.

Secrets, complete stream URLs and response bodies are not included in
reports. Never use arbitrary sites, user-supplied URLs or untrusted
hostnames as test destinations. This initial runner covers a subset of
Online JSON template flows; provider-specific tests for complicated
selectors, required auth, SISI, Sync, background jobs and media services
remain separate work.

**Security limitation:** the Python HTTP client resolves DNS before a
request but does not pin the resolved address to the socket; DNS rebinding
and untrusted redirect behavior require a network-isolated runner or
an egress proxy with address enforcement before exposing tests to
multiple users. Do not consider this a hardened sandbox.

## Example workflow

1. start_task("fix provider X", "fix") -> task_id + branch dev/fix/...
2. list_modules(task_id), inspect_module(task_id, "Modules/OnlineRUS/HDVB")
3. read_source then write_source in the same task.
4. task_diff and task_status, review changes.
5. publish_branch(task_id, "fix: repair provider response parsing").
6. request_ci_build(task_id) and get_ci_build_status(task_id).

No Pull Request is created. Nothing is merged. The user alone decides
what to do with this branch.

## Offline NuGet setup

The build container has --network=none and cannot download NuGet packages.
Its writable cache is LAMPAC_MCP_DATA/nuget-cache. Cache it beforehand by
restoring packages in a trusted, unchanged source worktree with controlled
network access. Without cache, missing packages may cause a build failure
that is NOT proof of a broken module.

Example after creating a first task but BEFORE applying any code changes:

    docker run --rm --network=bridge \
      --user "$(id -u):$(id -g)" \
      -e HOME=/tmp -e DOTNET_CLI_HOME=/tmp -e NUGET_PACKAGES=/nuget \
      -v "$HOME/lampac-dev-mcp-data/worktrees/TASK_ID:/work:rw" \
      -v "$HOME/lampac-dev-mcp-data/nuget-cache:/nuget:rw" \
      -w /work mcr.microsoft.com/dotnet/sdk:10.0 \
      dotnet restore Modules/OnlineRUS/HDVB/HDVB.csproj

Replace TASK_ID with the real ID. Do this only in a trusted worktree. Docker
resource restrictions are NOT a guarantee of strong security isolation of
untrusted code; for multi-tenant installations use a dedicated VM/runner per
user and restrict both networking and host access.

## Quick test for input guards

    python -m unittest discover -s tests -v

Lampac itself follows AGENTS.md at repo root: build the touched csproj, do
not add a new Lampac test csproj or change root build systems unnecessarily.

## Next phase

Create functional test profiles for Online, SISI, Sync, media and background
services. Deploy a disposable test Lampac instance at a pinned commit, run
HTTP and module-specific scenarios, and report passed/failed/inconclusive
separately (auth/geoblock/offline provider must not be mislabeled as a code bug).
