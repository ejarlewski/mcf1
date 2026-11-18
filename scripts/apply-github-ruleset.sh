#!/usr/bin/env bash
# Apply (create or update) the branch ruleset that protects the default branch.
#
#   Usage:  REPO=ejarlewski/mcf1 bash scripts/apply-github-ruleset.sh
#   DRY_RUN=1 ...  print what would be sent instead of sending it
#   Needs:  gh (authenticated with the `repo` scope)
#
# IMPORTANT: this JSON file does nothing on its own. GitHub only enforces a
# ruleset once it is created through the API/UI. Re-run this script after
# editing the JSON to push the change.
#
# What the ruleset does (see .github/rulesets/protect-main.json):
#   - deletion            : nobody deletes the default branch
#   - non_fast_forward    : nobody force-pushes (rewrites history)
#   - update              : only bypass actors may push to it at all
#   - pull_request        : every change to it must arrive via a pull request,
#                           with 0 approvals required (so the maintainer can
#                           merge their own PRs while solo)
#   - bypass_actors       : the repo owner, but "pull_request" mode only, i.e.
#                           they may merge PRs but still cannot push directly
#
# Variants you might want (edit the JSON, then re-run this script):
#   - Let the maintainer push straight to main again:
#         "bypass_mode": "always"
#   - Freeze main completely (nobody can merge, not even you — you cannot
#     approve your own PR): set "required_approving_review_count": 1
#   - Squash/rebase merges only: add { "type": "required_linear_history" } to
#     "rules" and drop "merge" from "allowed_merge_methods".
#   - Protect branches other than the default: replace "~DEFAULT_BRANCH" in
#     conditions.ref_name.include with a pattern such as "release/*".

set -uo pipefail

REPO="${REPO:-ejarlewski/mcf1}"
FILE=".github/rulesets/protect-main.json"

if [ ! -f "$FILE" ]; then
  echo "error: run this from the repository root ($FILE not found)" >&2
  exit 1
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh (GitHub CLI) is not installed — see https://cli.github.com" >&2
  exit 1
fi

# Find a working Python. On Windows `python3` often resolves to the Microsoft
# Store stub, which only prints a message and exits non-zero, so probe each
# candidate by actually running it instead of trusting `command -v`.
PY=""
for candidate in python3 python py; do
  if "$candidate" -c 'import json,sys; json.load(open(sys.argv[1],encoding="utf-8"))' "$FILE" >/dev/null 2>&1; then
    PY="$candidate"
    break
  fi
done
if [ -z "$PY" ]; then
  echo "warning: no working python found - skipping local JSON validation" >&2
  echo "         (the API will still reject invalid JSON)" >&2
else
  "$PY" -c "import json,sys; json.load(open(sys.argv[1],encoding='utf-8'))" "$FILE" \
    || { echo "error: $FILE is not valid JSON" >&2; exit 1; }
fi

# Look for an existing ruleset with this name. A failed listing is fatal (wrong
# repo name, missing token scope); a non-numeric result is treated as "none".
existing_id=$(gh api "repos/$REPO/rulesets" -q '.[] | select(.name=="protect-main") | .id' 2>/dev/null) || {
  echo "error: cannot list rulesets for '$REPO'." >&2
  echo "       Check the REPO value (owner/name) and that 'gh auth status' shows the repo scope." >&2
  exit 1
}
case "$existing_id" in
  ''|*[!0-9]*) existing_id="" ;;
esac

try() {
  local method="$1" url="$2"
  if [ -n "${DRY_RUN:-}" ]; then
    echo "would send: gh api -X $method $url --input $FILE"
    return 0
  fi
  local err
  if err=$(gh api -X "$method" "$url" --input "$FILE" 2>&1 >/dev/null); then
    return 0
  fi
  echo "api error: ${err:-unknown}" >&2
  return 1
}

if [ -n "$existing_id" ]; then
  echo "updating existing ruleset #$existing_id on $REPO ..."
  API_URL="repos/$REPO/rulesets/$existing_id"
  METHOD=PUT
else
  echo "creating ruleset on $REPO ..."
  API_URL="repos/$REPO/rulesets"
  METHOD=POST
fi

if ! try "$METHOD" "$API_URL"; then
  # Most likely cause: the bypass actor was rejected (e.g. the API does not
  # accept a User actor for this repository). Retry without the bypass list so
  # the protection itself still lands, then tell the operator what to fix.
  if [ -z "$PY" ]; then
    echo "cannot rewrite the bypass list without python - fix the JSON by hand and retry" >&2
    exit 1
  fi
  tmp=$(mktemp)
  "$PY" - "$FILE" "$tmp" <<'PYEOF'
import json,sys
data=json.load(open(sys.argv[1],encoding='utf-8'))
data['bypass_actors']=[]
json.dump(data,open(sys.argv[2],'w',encoding='utf-8'),indent=2)
PYEOF
  echo "retrying without the bypass list ..."
  if gh api -X "$METHOD" "$API_URL" --input "$tmp" >/dev/null; then
    echo "applied, but WITHOUT a bypass actor:"
    echo "  nobody — including you — can push to or merge into the default branch."
    echo "  Add yourself in the UI: repo -> Settings -> Rules -> Rules -> protect-main"
    echo "  -> Bypass list -> Add bypass -> 'Repository admin' -> set 'For pull requests only'."
  else
    echo "error: could not apply the ruleset." >&2
    echo "Hint: on the free plan, rulesets are available for PUBLIC repositories." >&2
    echo "      A private personal repo on the free plan cannot create them until it is public." >&2
    rm -f "$tmp"
    exit 1
  fi
  rm -f "$tmp"
else
  echo "applied."
fi

echo
if [ -n "${DRY_RUN:-}" ]; then
  echo "would verify with: gh api repos/$REPO/rulesets  (name/target/enforcement/bypass)"
  exit 0
fi
echo "current rulesets on $REPO:"
gh api "repos/$REPO/rulesets" \
  -q '.[] | "\(.name)  target=\(.target)  enforcement=\(.enforcement)  bypass=\([.bypass_actors[]? | "\(.actor_type):\(.actor_id):\(.bypass_mode)"] | join(","))"'
