#!/usr/bin/env python3
"""
PreToolUse security hook for Todoclaw.
Runs before every Claude Code tool call.
Exit 0 = allow. Exit 2 = block (stdout shown as reason to Claude + user).
"""
import json
import os
import re
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


# ── Bash ──────────────────────────────────────────────────────────────────────
if tool == "Bash":
    cmd = inp.get("command", "")

    # Block rm -rf / rm -fr / rm --recursive --force
    if re.search(r"\brm\b[^#\n;&|]*-[a-zA-Z]*r[a-zA-Z]*f", cmd) or \
       re.search(r"\brm\b[^#\n;&|]*-[a-zA-Z]*f[a-zA-Z]*r", cmd) or \
       re.search(r"\brm\b[^#\n;&|]*--recursive", cmd):
        block(
            "rm -rf / rm --recursive detected — use specific paths or ask Braeden to confirm."
        )

    # Block curl/wget piped directly to a shell
    if re.search(
        r"(curl|wget)\s[^|\n]*\|\s*(bash|sh|zsh|fish|python3?|ruby|perl)", cmd
    ):
        block(
            "Piping curl/wget into a shell is a supply-chain risk. "
            "Download first, inspect, then run."
        )

    # Block staging planning/ or real .env files
    if re.search(r"\bgit\s+add\b[^#\n;&|]*(planning/|\.env(?!\.example))", cmd):
        block(
            "Staging planning/ or .env files is forbidden — "
            "these paths are gitignored to prevent leaks."
        )

    # Block direct commits to main or force-push
    if re.search(r"\bgit\s+push\b[^#\n;&|]*(\s+--force|\s+-f\s|\s+origin\s+main)", cmd):
        block("Direct or force-push to main is not allowed. Use a feature branch + PR.")

    # Block shell-reading secret files (cat, less, head, etc.)
    if re.search(
        r"\b(cat|less|head|tail|bat|open|more)\b[^#\n;&|]*(\.env(?!\.example)|\.pem\b|\.key\b)",
        cmd,
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
    if re.search(r"\bsupabase\b[^#\n]*\bdb\s+reset\b", cmd) and \
       re.search(r"--linked\b|--db-url\b", cmd):
        block(
            "`supabase db reset` against a linked/remote database wipes it. "
            "Only the local (Docker) reset is allowed; change prod via reviewed, "
            "reversible migrations."
        )

    # Deleting a hosted Supabase project is irreversible.
    if re.search(r"\bsupabase\b[^#\n]*\bprojects?\s+delete\b", cmd):
        block("`supabase projects delete` is irreversible and is not allowed.")

    # Raw destructive SQL (DROP / TRUNCATE / DELETE) aimed at a NON-localhost
    # Postgres host — e.g. psql against a remote connection string. A postgres URL
    # whose host is not localhost/127.0.0.1 alongside a destructive verb is blocked.
    if re.search(r"\b(drop|truncate|delete)\b", cmd, re.IGNORECASE) and re.search(
        r"postgres(?:ql)?://[^\s'\"]*@(?!(?:localhost|127\.0\.0\.1|0\.0\.0\.0))",
        cmd,
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
