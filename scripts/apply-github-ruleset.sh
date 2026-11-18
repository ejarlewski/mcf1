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
#   - pull_request        : every change to it must arrive via a pull request,
#                           with 0 approvals required (so the maintainer can
#                           merge their own PRs while solo). This rule on its
#                           own is what refuses direct pushes to main.
#   - bypass_actors       : the repo owner, in "pull_request" mode, i.e. they
#                           may satisfy changes through PRs but nothing else.
#
# The "update" rule is deliberately NOT used. It treats merging a pull request
# as an update of the protected ref, so with a "pull_request"-mode bypass even
# the maintainer's own PR stops being mergeable. Measured on this repo: with
# "update" present, merging a PR failed with "the base branch policy prohibits
# the merge"; after removing it the same PR merged normally, while a direct push
# to main was still declined with GH013 "Cannot update this protected ref" /
# "Changes must be made through a pull request".
#
# Variants you might want (edit the JSON, then re-run this script):
#   - Let the maintainer push straight to main again:
#         "bypass_mode": "always"
#   - Do NOT add { "type": "update" } back — see the note directly above.
#   - Freeze main completely (nobody can merge, not even you — you cannot
#     approve your own PR): set "required_approving_review_count": 1
#   - Squash/rebase merges only: add { "type": "required_linear_history" } to
#     "rules" and drop "merge" from "allowed_merge_methods".
#   - Protect branches other than the default: replace "~DEFAULT_BRANCH" in
#     conditions.ref_name.include with a pattern such as "release/*".
#   - Give contributors a reason to keep PRs small: "required_approving_review_count": 1
#     only makes sense once a second human exists, because you cannot approve
#     your own pull request.

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
  echo "would verify with: gh api repos/$REPO/rulesets/<id>  (rules + bypass per ruleset)"
  exit 0
fi
echo "live rulesets on $REPO (each fetched by id - the LIST endpoint omits rules and bypass_actors):"
VERIFY_JQ=$(cat <<'JQ'
"  \(.name)  id=\(.id)  enforcement=\(.enforcement)  target=\(.target)\n" +
"  branches:  \(.conditions.ref_name.include | join(", "))\n" +
"  rules:     \([.rules[].type] | join(", "))\n" +
"  approvals required: \([.rules[]? | select(.type=="pull_request") | .parameters.required_approving_review_count] | join(","))\n" +
"  bypass:    \([.bypass_actors[]? | "\(.actor_type):\(.actor_id) (\(.bypass_mode))"] | join(", "))\n" +
"  you can bypass: \(.current_user_can_bypass)\n" +
"  edit in the UI: \(._links.html.href)"
JQ
)
for rid in $(gh api "repos/$REPO/rulesets" -q '.[].id'); do
  gh api "repos/$REPO/rulesets/$rid" -q "$VERIFY_JQ"
done
