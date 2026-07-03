#!/usr/bin/env python3
"""
PreToolUse security hook for Todoclaw.
Runs before every Claude Code tool call.
Exit 0 = allow. Exit 2 = block (stdout shown as reason to Claude + user).
"""
import json
import os
import re
import shutil
import subprocess
import sys


def block(reason: str) -> None:
    print(f"[Security Hook] BLOCKED: {reason}")
    sys.exit(2)


try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool = data.get("tool_name", "")
inp = data.get("tool_input", {})


# ── Branch guard: no edits or commits while on main ─────────────────────────────
# Enforces the feature-branch workflow automatically (see docs/COLLABORATION.md).
# Edit/Write and `git commit` are blocked whenever the todoclaw repo is on a
# protected branch, so starting new work *forces* a branch first. This is what
# keeps main clean and conflict-free when several people (or agents) share the repo.
PROJECT_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
PROTECTED_BRANCHES = {"main", "master"}
BRANCH_HELP = (
    "You're on `{branch}` in the todoclaw repo, where direct edits/commits are "
    "blocked (docs/COLLABORATION.md). Create a feature branch first, then retry:\n"
    "  git checkout -b <type>/<short-kebab-desc>\n"
    "  (type = feat | fix | chore | refactor | docs; e.g. feat/grid-drag)\n"
    "Pull latest main before branching if collaborators are active: "
    "git checkout main && git pull && git checkout -b <type>/<desc>"
)


def _current_branch() -> str:
    try:
        r = subprocess.run(
            ["git", "-C", PROJECT_ROOT, "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""


# ── Merged-PR guard: no commits/pushes on a branch whose PR already merged ──────
# A branch pushed with more work after its PR merges is silently stranded: GitHub
# stops syncing that PR's head and stops running CI on further pushes to the
# branch (learned the hard way 2026-07-03, PR #54 — see CLAUDE.md's branch
# workflow and the verify-pr-merged-before-followup memory). Only fires once the
# branch has an upstream (skips the common case of fresh local-only branches,
# avoiding a network call), and fails open on any gh/network error — never block
# on something this can't verify.
MERGED_PR_HELP = (
    "`{branch}`'s PR (#{number}) is already MERGED. Commits/pushes here would be "
    "silently stranded — GitHub stops syncing a merged PR's head and stops "
    "running CI on further pushes to that branch. Branch fresh off updated main "
    "instead:\n"
    "  git checkout main && git pull --ff-only && git checkout -b <type>/<desc>"
)


def _has_upstream() -> bool:
    try:
        r = subprocess.run(
            ["git", "-C", PROJECT_ROOT, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        return r.returncode == 0
    except Exception:
        return False


def _merged_pr_info(branch: str):
    """Returns {"number": ...} if `branch` has a MERGED PR, else None. Fails open."""
    if not shutil.which("gh"):
        return None
    try:
        r = subprocess.run(
            ["gh", "pr", "view", branch, "--json", "state,number"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if r.returncode != 0:
            return None
        info = json.loads(r.stdout)
        return info if info.get("state") == "MERGED" else None
    except Exception:
        return None


def _in_project(path: str) -> bool:
    if not path:
        return False
    try:
        return (
            os.path.commonpath([os.path.abspath(path), PROJECT_ROOT]) == PROJECT_ROOT
        )
    except Exception:
        return False


if tool in ("Edit", "Write") and _in_project(inp.get("file_path", "")):
    branch = _current_branch()
    if branch in PROTECTED_BRANCHES:
        block(BRANCH_HELP.format(branch=branch))

if tool == "Bash" and re.search(r"\bgit\s+commit\b", inp.get("command", "")):
    branch = _current_branch()
    if branch in PROTECTED_BRANCHES:
        block(BRANCH_HELP.format(branch=branch))
    elif _has_upstream():
        merged = _merged_pr_info(branch)
        if merged:
            block(MERGED_PR_HELP.format(branch=branch, number=merged["number"]))


# ── Bash ──────────────────────────────────────────────────────────────────────
if tool == "Bash":
    cmd = inp.get("command", "")

    # v2 (retro 2026-07-03): guards must match OPERATIONS, not PROSE. Commit messages
    # and PR titles/bodies passed inline (-m "drop stale rows") were false-positiving
    # the destructive-verb patterns below. Strip quoted message payloads before
    # scanning; long text via `git commit -F` / `--body-file` remains the norm.
    def _strip_prose(c: str) -> str:
        # -[a-z]*m catches combined short flags too (git commit -am / -sm "msg").
        return re.sub(
            r"(-[a-zA-Z]*m|--message|--title|--body|-t|-b)(\s+|=)(\"(?:[^\"\\]|\\.)*\"|'[^']*')",
            r"\1\2''",
            c,
        )

    scan = _strip_prose(cmd)

    # Block rm -rf / rm -fr / rm --recursive --force
    if re.search(r"\brm\b[^#\n;&|]*-[a-zA-Z]*r[a-zA-Z]*f", scan) or \
       re.search(r"\brm\b[^#\n;&|]*-[a-zA-Z]*f[a-zA-Z]*r", scan) or \
       re.search(r"\brm\b[^#\n;&|]*--recursive", scan):
        block(
            "rm -rf / rm --recursive detected — use specific paths or ask Braeden to confirm."
        )

    # Block curl/wget piped directly to a shell
    if re.search(
        r"(curl|wget)\s[^|\n]*\|\s*(bash|sh|zsh|fish|python3?|ruby|perl)", scan
    ):
        block(
            "Piping curl/wget into a shell is a supply-chain risk. "
            "Download first, inspect, then run."
        )

    # Block staging planning/ or real .env files
    if re.search(r"\bgit\s+add\b[^#\n;&|]*(planning/|\.env(?!\.example))", scan):
        block(
            "Staging planning/ or .env files is forbidden — "
            "these paths are gitignored to prevent leaks."
        )

    # Push guard v2 (retro 2026-07-03): protect main/master from ANY push; elsewhere
    # allow the safe `--force-with-lease` (refuses to clobber unseen remote commits)
    # but block bare `--force`/`-f`. GitHub branch protection is the server-side
    # backstop for anything this heuristic misses.
    _push = re.search(r"\bgit\s+push\b([^#\n;&|]*)", scan)
    if _push:
        _seg = _push.group(1)
        if re.search(r"[\s:](main|master)(?![\w./-])", _seg):
            block("Pushing to main/master is not allowed. Use a feature branch + PR.")
        if re.search(r"(^|\s)--force(?!-with-lease\b)\b", _seg) or re.search(
            r"(^|\s)-f\b", _seg
        ):
            block(
                "Bare --force/-f push is blocked — use `git push --force-with-lease`, "
                "which refuses to overwrite remote commits you haven't seen."
            )
        branch = _current_branch()
        if branch not in PROTECTED_BRANCHES and _has_upstream():
            merged = _merged_pr_info(branch)
            if merged:
                block(MERGED_PR_HELP.format(branch=branch, number=merged["number"]))

    # Merging a PR (with or without --auto) is Braeden's action only — Claude opens
    # PRs and stops there (2026-07-03: `gh pr merge --auto` was briefly used to
    # auto-merge Claude-opened PRs before being corrected). `--disable-auto` is
    # exempted since it only *undoes* an auto-merge, never causes one.
    _gh_merge = re.search(r"\bgh\s+pr\s+merge\b([^#\n;&|]*)", scan)
    if _gh_merge and "--disable-auto" not in _gh_merge.group(1):
        block(
            "`gh pr merge` (including --auto) is not allowed — merging PRs is "
            "Braeden's action only. Open the PR (`gh pr create`) and stop there. "
            "(`gh pr merge --disable-auto` is still allowed, to undo an auto-merge "
            "that shouldn't have been enabled.)"
        )

    # Block shell-reading secret files (cat, less, head, etc.)
    if re.search(
        r"\b(cat|less|head|tail|bat|open|more)\b[^#\n;&|]*(\.env(?!\.example)|\.pem\b|\.key\b)",
        scan,
    ):
        block(
            "Reading secret files (.env, .pem, .key) via shell is not allowed. "
            "Reference by variable name only."
        )

    # ── Guard PROD/REMOTE databases from destructive ops ────────────────────────
    # The local Supabase stack (Docker, 127.0.0.1) is disposable — resetting it is
    # routine and stays allowed. Production is irreplaceable, so the catastrophic
    # remote operations are blocked here (defence against a fat-fingered command by
    # Claude *or* a human). Prod changes go through reviewed, reversible migrations.

    # `supabase db reset` wipes the database. Local is fine; --linked / --db-url
    # target a REMOTE db and would destroy it.
    if re.search(r"\bsupabase\b[^#\n]*\bdb\s+reset\b", scan) and \
       re.search(r"--linked\b|--db-url\b", scan):
        block(
            "`supabase db reset` against a linked/remote database wipes it. "
            "Only the local (Docker) reset is allowed; change prod via reviewed, "
            "reversible migrations."
        )

    # Deleting a hosted Supabase project is irreversible.
    if re.search(r"\bsupabase\b[^#\n]*\bprojects?\s+delete\b", scan):
        block("`supabase projects delete` is irreversible and is not allowed.")

    # Raw destructive SQL (DROP / TRUNCATE / DELETE) aimed at a NON-localhost
    # Postgres host — e.g. psql against a remote connection string. A postgres URL
    # whose host is not localhost/127.0.0.1 alongside a destructive verb is blocked.
    if re.search(r"\b(drop|truncate|delete)\b", scan, re.IGNORECASE) and re.search(
        r"postgres(?:ql)?://[^\s'\"]*@(?!(?:localhost|127\.0\.0\.1|0\.0\.0\.0))",
        scan,
        re.IGNORECASE,
    ):
        block(
            "Destructive SQL (DROP/TRUNCATE/DELETE) against a remote database is "
            "blocked. Run destructive changes only on the local DB, via migrations."
        )


# ── Read ──────────────────────────────────────────────────────────────────────
if tool == "Read":
    path = inp.get("file_path", "")
    basename = os.path.basename(path)

    if re.match(r"^\.env", basename) and not basename.endswith(".example"):
        block(
            f"Reading {basename} is blocked — it may contain real secrets. "
            "Reference env vars by name only."
        )
    if re.search(r"\.(pem|key)$", basename):
        block(f"Reading {basename} is blocked — private key files are off-limits.")


# ── Edit / Write ──────────────────────────────────────────────────────────────
if tool in ("Edit", "Write"):
    path = inp.get("file_path", "")
    basename = os.path.basename(path)

    # Block writing to real .env files
    if re.match(r"^\.env", basename) and not basename.endswith(".example"):
        block(
            f"Writing to {basename} is blocked. "
            "Only .env.example (with placeholder values) is committed."
        )

    # Block embedding secret values in any file content
    content = inp.get("new_string", "") or inp.get("content", "")
    SECRET_PATTERNS = [
        (r"sk-ant-[a-zA-Z0-9\-_]{20,}", "Anthropic API key (sk-ant-…)"),
        (r"(?:supabase|postgres)://[^:@\s]+:[^@\s]{8,}@", "DB connection string with password"),
        (r"-----BEGIN (?:RSA |EC )?PRIVATE KEY-----", "Private key block"),
        (r"(?:AKID|AKIA)[A-Z0-9]{16}", "AWS access key"),
        (r"gh[pousr]_[A-Za-z0-9_]{36,}", "GitHub personal access token"),
        (r"eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}", "JWT token value"),
    ]
    for pattern, label in SECRET_PATTERNS:
        if re.search(pattern, content):
            block(
                f"Secret value pattern detected in file content ({label}). "
                "Reference secrets by env var name only — never embed values."
            )


sys.exit(0)
