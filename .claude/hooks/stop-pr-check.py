#!/usr/bin/env python3
"""
Stop hook for Todoclaw: nudges Claude to open a PR before ending a turn on a
pushed branch that has no PR yet. CLAUDE.md already says "open a PR when the
task is done," but that written rule wasn't reliably followed across parallel
worktree sessions (2026-07-03) — this makes it a hard-to-miss reminder instead.

Only fires once per distinct HEAD commit per branch (tracked in
.claude/.stop-pr-nag/, gitignored), so it cannot loop even if the harness
doesn't honor stop_hook_active — re-blocking on an unchanged commit would
trap Claude if it explains rather than pushes a new commit.
"""
import json
import os
import shutil
import subprocess
import sys

PROJECT_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
PROTECTED_BRANCHES = {"main", "master"}
STATE_DIR = os.path.join(PROJECT_ROOT, ".claude", ".stop-pr-nag")


def _run(args, timeout=5):
    try:
        r = subprocess.run(
            args, cwd=PROJECT_ROOT, capture_output=True, text=True, timeout=timeout
        )
        return r.returncode, r.stdout.strip()
    except Exception:
        return 1, ""


try:
    data = json.load(sys.stdin)
except Exception:
    data = {}

# Defense-in-depth: if the harness marks the re-entrant Stop call after a
# block, don't nag twice in the same cycle. The HEAD-sha dedup below is the
# real backstop, since this field isn't guaranteed.
if data.get("stop_hook_active"):
    sys.exit(0)

code, branch = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"])
if code != 0 or not branch or branch in PROTECTED_BRANCHES:
    sys.exit(0)

# Only care about branches already pushed (has an upstream) — a branch never
# pushed is still in-progress local work, not a "forgot to open the PR" gap.
code, _ = _run(["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
if code != 0:
    sys.exit(0)

code, head_sha = _run(["git", "rev-parse", "HEAD"])
if code != 0 or not head_sha:
    sys.exit(0)

# Any commits on this branch not on main?
code, _ = _run(["git", "merge-base", "--is-ancestor", "HEAD", "main"])
if code == 0:
    sys.exit(0)  # HEAD is an ancestor of main — nothing new to PR

if not shutil.which("gh"):
    sys.exit(0)

# --state all (not just open): a merged/closed PR still means the "open a PR"
# task was done, so don't nag just because local main hasn't caught up yet.
code, out = _run(
    ["gh", "pr", "list", "--head", branch, "--state", "all", "--json", "number"],
    timeout=10,
)
if code != 0:
    sys.exit(0)  # can't reach GitHub / not authed — don't block on what we can't verify

try:
    if json.loads(out or "[]"):
        sys.exit(0)  # a PR already exists for this branch
except Exception:
    sys.exit(0)

os.makedirs(STATE_DIR, exist_ok=True)
state_file = os.path.join(STATE_DIR, branch.replace("/", "_"))
try:
    with open(state_file) as f:
        if f.read().strip() == head_sha:
            sys.exit(0)  # already nagged for this exact commit
except FileNotFoundError:
    pass

try:
    with open(state_file, "w") as f:
        f.write(head_sha)
except OSError:
    pass

msg = (
    f"Branch `{branch}` has pushed commits ahead of `main` with no PR. "
    "CLAUDE.md's branch workflow expects a PR once a task is done "
    "(`gh pr create`). Open one now, or say explicitly why not "
    "(task genuinely unfinished, or the user explicitly asked to hold off)."
)
print(json.dumps({"decision": "block", "reason": msg, "systemMessage": msg}))
sys.exit(0)
