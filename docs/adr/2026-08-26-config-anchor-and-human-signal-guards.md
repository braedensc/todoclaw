# The git ref store is a trust anchor, and human signals are human-only

**Status:** Accepted
**Date:** 2026-08-26

## Context

`claude-project-kit` grew three PreToolUse guards that never came downstream to
TodoClaw. Verified 2026-08-26 by diffing the two live hook files rather than by
reading docs: the kit's is 1929 lines, this repo's was 1502.

| Guard | Kit PR | Was present here |
| -- | -- | -- |
| Config anchor — the git ref store is human-only | #39 | no |
| Protected labels — `hooks-change`, `agent:*`, `blocked:*`, `provenance:*` | #40 | no |
| PR self-approval — `gh pr review --approve` | #50 (KIT-21) | no |

All three are one defect class: **an agent producing a signal a human is meant to
produce.** The gap matters more downstream than upstream, because the kit ships
`delivery.example.json` while TodoClaw has a live `delivery.json` and is where
unattended sessions actually run.

### The config anchor is the consequential one, but not for the reason the ticket assumed

TOD-111 was filed on the premise that this repo read `delivery.json` from the
working tree. It does not, and has not since #397: `_read_delivery_config()` reads
it from the **committed default branch** via `_CONFIG_REFS`, and `_read_pin()`
already distinguishes an **expired** pin (fails closed) from an **absent** one
(fails open, so a human's ad-hoc session is never bricked). Both properties named
in the acceptance criteria were already true. The ticket's evidence grep
(`grep "git show|default_branch"`) returned 0 because an unescaped `|` in a basic
regular expression is a literal, not an alternation.

What was genuinely missing is the half that makes those two properties *mean*
something. Reading `origin/main` instead of the worktree is only a defence while
the **ref** is not model-writable — and nothing stopped a session from moving it.
One `git update-ref refs/remotes/origin/main <sha>` and every guard that reads
from the default branch reads config the session just wrote. That includes
`dispatch.pinsRoot`, which is where the **pin** is looked for. Anchor poisoning is
the entire escalation in one command: the guard is only as trustworthy as the
thing it anchors on.

### The other two, measured rather than assumed

**Protected labels.** `hooks-change` is the label that turns CI's *Hooks change
guard* job green. A session that can apply it acknowledges its own
guard-machinery change. This was already a known gap: PR #397's own body flagged
that this repo protects the **whole** `.claude/hooks/` directory where the kit
protects three named scripts, and that the stricter posture buys less than it
looks like it does without the guard the kit compensates with. The `agent:*` /
`blocked:*` / `provenance:*` sets are dispatcher-owned by
`docs/PIPELINE-CONTRACT.md` §6 — the pipeline's `lifecycle-label` guard already
refused them through a **tracker MCP**, but the identical write arriving as a `gh`
command was unguarded, and cheaper.

**PR self-approval.** `braedensc/todoclaw`'s `main` has
`required_approving_review_count: 0`, four required status checks, and admins
enforced. So an approval does **not** unlock a merge here today. This is signal
pollution, not a merge unlock, and the ADR says so rather than overstating it:
what it does is make a session's own PR read as *reviewed* to the person who then
merges it by hand — which is exactly when a false signal costs the most — and it
is one branch-protection setting away from being an unlock.

## Decision

Port all three from the kit **as a merge, not a replacement** — preserving this
repo's own additions (its egress allowlist, its local-dispatch guard, its
Supabase-specific rules) and its own naming (`_mutate_re`, `_is_self_guard_path`,
`SELF_EDIT_*`). Ported rather than rewritten so the next `/sync-kit` diff is clean.

1. **Config anchor.** Writing a protected ref (`update-ref`, `replace`,
   `fast-import`, `filter-branch`; `symbolic-ref`/`branch -f`/`-D`/`-M` naming
   `main`/`master`; a `fetch`/`pull` **refspec** landing on a protected ref),
   repointing `origin`, or mutating `.git/**` is blocked in Bash — plus an
   Edit/Write twin, because a ref file rewritten with `Write` moves the anchor
   exactly as `git update-ref` would.
2. **Protected labels.** Blocked in every `gh` spelling that applies or removes
   one, including comma-lists, `=` form, the `…/issues/N/labels` endpoint, and an
   opaque `--input` body.
3. **PR self-approval.** Blocked in every spelling that yields an APPROVE event:
   flag, `=true`, `-a`, a pflag shorthand **cluster** (`-ab`), the bare
   interactive form, and the REST/GraphQL/`curl` endpoints.

### What stays allowed, deliberately

The carve-outs are load-bearing and are pinned by 30 allow-cases:

- `git fetch` is the **one honest writer** of `origin/main`. A guard that stopped
  it would stop the repo from learning the truth. Every read — `git log`,
  `git diff origin/main...HEAD`, `cat .git/config`, `git config --get` — is
  untouched, and `git remote add origin` still works (git refuses to add a remote
  that already exists, so `add` cannot repoint an anchor; `set-url`/`remove` can,
  and both are blocked).
- `git branch -m <name>` — the codename rename every worktree session starts with
  — carries no protected ref and is not caught. A branch merely *containing*
  `main` (`fix/domain-model-rework`) is not caught either.
- `.gitignore` and `.github/` only *start* with `.git`; matching is component-wise
  so workflow edits are never caught.
- `--comment` and `--request-changes` reviews stay reachable — neither
  manufactures a human signal — as do reading reviews and `--add-reviewer`, which
  *asks* for a review rather than gives one.
- `gh label create` stays allowed: **defining** a label is setup, not
  acknowledgement.

### Fail direction

Two places fail **closed** on something this hook cannot read, matching the kit:
a **bare** `gh pr review` (its event is chosen at an interactive prompt), and a
write to the labels or reviews endpoint whose payload is hidden in `--input`.
Hiding the value in a file is the obvious next spelling, so an unreadable payload
on an already-mutating endpoint is refused rather than waved through.

## Consequences

**Nothing changes for ordinary work.** 30 commands copied out of `CLAUDE.md` and
`docs/COLLABORATION.md` — the whole branch/PR/CI workflow — were probed against
both the old and the new hook: 30/30 allowed by both.

**Two things a session could do before, it cannot now:** apply its own
`hooks-change` label, and approve its own PR. Both were always meant to be
Braeden's; neither had a guard. Print the command and let him run it.

**Scope, stated rather than implied.** These are a first line over command
*shapes*. An exhaustive denylist of shell spellings is not achievable, and this
is tamper-**evident**, not tamper-proof — the same posture
`docs/PIPELINE-CONTRACT.md` §3 states for the pin. What it buys is that the cheap,
silent, single-command version of each attack is gone. The durable halves are
server-side and outside anything a session can reach: branch protection, and a CI
job that checks *who* applied a label. Specifically **not** addressed here, and
left to their own tickets: KIT-36 (GuardFall — the Bash guards inspect a string
the shell then rewrites) and KIT-41 (runner-selection labels).

**Verified by** a 330-case battery (`npm run test:hooks`), 70 of them new. The 40
that assert a block all fail against the pre-change hook; all 260 pre-existing
cases still pass.

## Alternatives considered

**Narrow this repo's self-protection to the kit's three named files, so the
battery and hooks README become session-editable.** Rejected as a *net* change,
but it is worth recording why: #397 kept the stricter whole-directory posture
precisely because this guard was missing, and noted that loosening without it
would be a weakening. With the protected-label guard now in place the trade is
genuinely open again — a session can no longer acknowledge its own hook change —
but it is a separate decision, not a side effect of this port, and the cost it
would remove (three human `cp`s per hook change) is real but small.

**Rewrite the three guards to fit this repo's idiom instead of porting them.**
Rejected: divergence is what produced this ticket. Every rewritten line is a line
the next `/sync-kit` cannot recognize as already-present.
