#!/usr/bin/env python3
"""
SessionStart hook — orientation, not enforcement.

Injects a short repo-state summary (branch, dirty tree, open PR for the branch, and a
one-line reminder of the workflow) into the session's context at startup, so a fresh
session opens already knowing where it is instead of discovering it by running git —
or, worse, by tripping a guard. Most of what pre-tool-use.py blocks is a session
acting on a wrong assumption about the branch it is on; this tells it up front.

Output contract (Claude Code hooks): print JSON with
  {"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "..."}}
to stdout; the text becomes session context. Always exits 0 — this hook cannot and
should not block (SessionStart has no block semantics), and it fails open silently on
any error so a missing `gh`/network/git never delays a session start.

This hook is ADVISORY ONLY and must stay that way: read-only, side-effect-free, and
never the thing that decides whether an action is allowed. Nothing may treat its
output as a trust source — it reports what git says, and a guard that needs a fact
must read that fact itself, from pre-tool-use.py.

  Note for anyone porting this from the claude-project-kit: there, this file is
  deliberately left OUT of the self-protected set (it only informs, so there is
  nothing to "edit away"). In THIS repo it is protected anyway — the self-edit guard
  matches the whole `.claude/hooks/**` directory by path rather than a per-file list,
  so this file inherits the protection whether or not it needs it. That is a
  difference in blast radius, not in intent: keep it advisory regardless.

Ported from claude-project-kit's session-start.py, 2026-08-25. Runs alongside
session-start-provision-env.sh (both are wired under SessionStart in settings.json;
Claude Code runs every hook in the group).
"""
import json
import os
import re
import shutil
import subprocess
import sys

# Same convention pre-tool-use.py enforces (CLAUDE.md): <type>/<short-kebab-desc>.
# Kept in sync by hand — this copy only decides what ADVICE to print, never whether
# an action is allowed, so a drift here is a stale sentence, not a hole.
BRANCH_NAME_RE = re.compile(r"^(feat|fix|chore|refactor|docs)/[a-z0-9][a-z0-9-]*$")
PROTECTED_BRANCHES = ("main", "master")


def _run(args, timeout=4):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""


def main():
    # Read the payload but don't require anything from it.
    try:
        json.load(sys.stdin)
    except Exception:
        pass

    root = os.environ.get("CLAUDE_PROJECT_DIR", ".")
    branch = _run(["git", "-C", root, "rev-parse", "--abbrev-ref", "HEAD"])
    if not branch:
        sys.exit(0)  # not a git repo — say nothing

    lines = [f"Repo orientation (SessionStart hook): on branch `{branch}`."]

    dirty = _run(["git", "-C", root, "status", "--porcelain"])
    lines.append("Working tree: " + ("dirty (uncommitted changes)." if dirty else "clean."))

    if branch in PROTECTED_BRANCHES:
        lines.append(
            "You're on a protected branch — Edit/Write/commit are hook-blocked here. "
            "Branch first: `git checkout -b <type>/<short-kebab-desc>`."
        )
    elif not BRANCH_NAME_RE.match(branch):
        # The case that actually bites: a worktree session starts on an auto-generated
        # `claude/<codename>` branch, and every Edit/Write is blocked until it renames.
        lines.append(
            f"Branch `{branch}` does NOT match the required convention "
            "(`<type>/<short-kebab-desc>`, type = feat|fix|chore|refactor|docs), so "
            "Edit/Write/commit are hook-blocked until you rename it: "
            "`git branch -m <type>/<short-kebab-desc>`."
        )
    else:
        # Best-effort open-PR lookup; silent if gh is missing/unauthed/offline.
        if shutil.which("gh"):
            pr = _run(["gh", "pr", "view", branch, "--json", "number,state",
                       "-q", '"#\\(.number) \\(.state)"'], timeout=6)
            if pr:
                lines.append(f"This branch's PR: {pr}.")
        lines.append(
            "Reminder: commits go on this feature branch via PR; you never merge "
            "(`gh pr merge` is hook-blocked — merging is Braeden's action). Open the "
            "PR, watch CI to green, then stop."
        )

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": " ".join(lines),
        }
    }))
    sys.exit(0)


if __name__ == "__main__":
    main()
