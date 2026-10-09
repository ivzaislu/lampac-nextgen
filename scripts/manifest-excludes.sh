#!/usr/bin/env bash
#
# Manage per-module manifest exclusions without modifying install.sh.
# Lampac's updater already reads /opt/lampac/excludes.conf.
#
# Usage: sudo bash manifest-excludes.sh add AdminPanel ExternalBind
#        sudo bash manifest-excludes.sh remove ExternalBind
#        sudo bash manifest-excludes.sh list
set -euo pipefail

ROOT="${LAMPAC_INSTALL_ROOT:-/opt/lampac}"
EXCLUDES="${ROOT}/excludes.conf"
BEGIN_MARKER="# BEGIN lampac-manifest-excludes (managed block)"
END_MARKER="# END lampac-manifest-excludes (managed block)"

usage() {
  cat <<'EOF'
Manage protected module manifests without editing install.sh.

Usage:
  manifest-excludes.sh add MODULE_PATH [MODULE_PATH ...]     Protect manifests
  manifest-excludes.sh remove MODULE_PATH [MODULE_PATH ...]  Stop protecting manifests
  manifest-excludes.sh list                         List protected manifests

Only module/MODULE_PATH/manifest.json is excluded, not the whole module folder.
The path is relative to the 'module' directory (e.g. AdminPanel or
OnlineRUS/FlixCDN). The manifest must exist when adding a rule. Its current
'enable' value is preserved during updates; this script does not change it.

Set LAMPAC_INSTALL_ROOT to override /opt/lampac.
EOF
}

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

valid_module_path() {
  local path="$1" part
  local -a parts
  [[ -n "$path" && "$path" != /* && "$path" != */ && "$path" != *'//'* ]] || return 1
  IFS='/' read -r -a parts <<< "$path"
  for part in "${parts[@]}"; do
    [[ "$part" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ &&
       "$part" != "." && "$part" != ".." ]] || return 1
  done
}

[[ $# -ge 1 ]] || { usage; exit 2; }
command="$1"
case "$command" in
  add|remove)
    [[ $# -gt 1 ]] || fail "$command requires at least one module name"
    ;;
  list)
    [[ $# -eq 1 ]] || fail "list takes no module names"
    ;;
  --help|-h|help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

[[ -d "$ROOT" && -f "$ROOT/Core.dll" ]] ||
  fail "Lampac installation not found: $ROOT (Core.dll missing)"

declare -A protected=()
inside=0
start_count=0
end_count=0

# Read only rules previously created by this script. Reject corrupt blocks
# instead of silently replacing unrelated excludes.conf content.
if [[ -f "$EXCLUDES" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "$BEGIN_MARKER" ]]; then
      (( start_count == 0 && inside == 0 && end_count == 0 )) ||
        fail "duplicate or misplaced BEGIN marker in $EXCLUDES"
      start_count=$((start_count + 1))
      inside=1
    elif [[ "$line" == "$END_MARKER" ]]; then
      (( inside == 1 && end_count == 0 )) ||
        fail "misplaced END marker in $EXCLUDES"
      end_count=$((end_count + 1))
      inside=0
    elif (( inside )); then
      if [[ "$line" =~ ^/module/(.+)/manifest[.]json$ ]]; then
        name="${BASH_REMATCH[1]}"
        valid_module_path "$name" || fail "invalid module path inside managed block: $name"
        protected["$name"]=1
      else
        fail "unknown entry inside managed block: $line"
      fi
    fi
  done < "$EXCLUDES"
fi

(( start_count == end_count && inside == 0 )) ||
  fail "unclosed manifest excludes block in $EXCLUDES"

if [[ "$command" == list ]]; then
  if (( ${#protected[@]} == 0 )); then
    printf 'No manifests protected by this script.\n'
  else
    printf 'Protected module manifests:\n'
    while IFS= read -r name; do
      printf '  module/%s/manifest.json\n' "$name"
    done < <(printf '%s\n' "${!protected[@]}" | LC_ALL=C sort)
  fi
  exit 0
fi

for name in "${@:2}"; do
  valid_module_path "$name" || fail "invalid module path: $name"
  if [[ "$command" == add ]]; then
    [[ -f "$ROOT/module/$name/manifest.json" ]] ||
      fail "manifest not found: $ROOT/module/$name/manifest.json"
    protected["$name"]=1
  else
    unset "protected[$name]"
  fi
done

# Write atomically, preserving all exclusions outside the managed block.
# Repeated additions/removals with no changes do not touch the file.
tmp="$(mktemp "${ROOT}/.excludes.conf.tmp.XXXXXXXX")"
trap 'rm -f -- "$tmp"' EXIT
inside=0
if [[ -f "$EXCLUDES" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "$BEGIN_MARKER" ]]; then
      inside=1
    elif [[ "$line" == "$END_MARKER" ]]; then
      inside=0
    elif (( ! inside )); then
      printf '%s\n' "$line" >> "$tmp"
    fi
  done < "$EXCLUDES"
fi

if (( ${#protected[@]} > 0 )); then
  printf '%s\n' "$BEGIN_MARKER" >> "$tmp"
  while IFS= read -r name; do
    printf '/module/%s/manifest.json\n' "$name" >> "$tmp"
  done < <(printf '%s\n' "${!protected[@]}" | LC_ALL=C sort)
  printf '%s\n' "$END_MARKER" >> "$tmp"
fi

if [[ -f "$EXCLUDES" ]] && cmp -s "$tmp" "$EXCLUDES"; then
  printf 'No changes: %s\n' "$EXCLUDES"
  exit 0
fi

if [[ -f "$EXCLUDES" ]]; then
  chmod --reference="$EXCLUDES" "$tmp"
  if (( EUID == 0 )); then chown --reference="$EXCLUDES" "$tmp"; fi
else
  chmod 644 "$tmp"
fi

mv -f -- "$tmp" "$EXCLUDES"
printf 'Updated: %s\n' "$EXCLUDES"
printf 'Protected manifests: %s\n' "${#protected[@]}"
