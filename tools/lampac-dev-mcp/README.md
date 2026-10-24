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

THIS IS AN MVP, NOT COMPLETE MODULE TESTING. A passing build/manifest check
does not prove module functionality. Running a Lampac instance, validating HTTP
routes and media/provider behavior, background services, and regressions are NOT
implemented. No VPS tests have been run yet.

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

## LIVE Online tests on VPS (real internet, NOT offline)

The VPS runs a **test-only** Lampac process built from the current task branch.
The workflow is: compile on GitHub Actions -> manually deploy that exact branch
commit to the isolated test instance -> run end-to-end checks on the VPS.

New MCP tool: \`run_live_online_test(task_id, provider, params)\`.

For example, after deploying the task branch, test a provider whose API accepts
a KinoPoisk identifier:

    run_live_online_test(
      task_id="THE_TASK_ID",
      provider="hdvb",
      params={"kinopoisk_id":"A_VALID_TEST_ID", "title":"A_TEST_TITLE"}
    )

The runner uses \`rjson=true\` and follows Lampac template responses:
\`similar\` -> \`movie\` or \`season\` -> \`episode\` -> \`VideoTpl\`
(playback URL). It then really fetches the HLS playlist or a direct media URL,
fetches one short media fragment (max 256 KiB per request), and optionally
asks \`ffprobe\` to identify an audio/video codec from that sample. This checks
**network availability and stream bytes**, not complete film playback; limited
fragments might be too short to decode, so a stream can be marked
\`inconclusive\` even when it actually works.

**Required on VPS:**

1. Install and start the Lampac version BUILT FROM THE TASK BRANCH in a
   separate test process. Do not use production Lampac or main.
2. Bind the test port to loopback (for example 127.0.0.1:29118) and ensure
   the MCP service can reach it. Avoid starting Chromium/transcoding alongside
   this test on a 1 GB VPS.
3. After verifying the deployed process, have the *trusted deployment script*
   write the exact 40-character **task commit SHA** to
   \`LAMPAC_TEST_DATA/test-instance/commit.sha\`, where
   \`LAMPAC_TEST_DATA\` here denotes the same location as
   \`LAMPAC_MCP_DATA\` (by default \`/srv/lampac-dev-mcp\`).
   The runner reads \`LAMPAC_TEST_DEPLOYED_SHA_FILE\` when overridden.
   This marker is **a deployment attestation set by the operator**, not
   verified against a remote running process. Never copy an arbitrary SHA
   without checking the running test instance.
4. Set \`LAMPAC_TEST_BASE_URL=http://127.0.0.1:29118\`. If Lampac generates
   playback links using its own public domain rather than loopback, set
   \`LAMPAC_TEST_PUBLIC_BASE_URL\` to that exact public base so the runner
   can rewrite *only* that origin to the local test instance.
5. If the playback URL bypasses Lampac's \`/proxy\` and targets an external
   CDN directly, its hostname must be explicitly allowed with
   \`LAMPAC_TEST_STREAM_HOSTS=cdn.example.org,*.other.example.org\`.
   The runner refuses arbitrary internal addresses and HTTP external URLs.
   Stream hosts and redirects must pass allowlist checks.
6. Install \`ffprobe\` if you need codec identification. Without it, a
   successful HTTP fragment fetch is still reported, but the full test
   returns \`inconclusive\`, not \`passed\`.

Testing makes **real outgoing connections** from your VPS to external
providers/CDNs, under their normal authentication, geographic and rate
restrictions. Outcomes are:
- \`passed\`: media bytes received and codec identified from the sample.
- \`failed\`: a definite error in the tested response or route.
- \`inconclusive\`: blocked source, missing allowlist, network failure,
  DRM/geo/access restrictions, or insufficient codec data.
- \`not-ready\`: test instance is not marked as the task's exact commit.

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
