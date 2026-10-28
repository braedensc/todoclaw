# ADR 2026-09-06 — Sessions are bound by Linear delegation, not by a pin file

**Date:** 2026-09-06 · **Post-launch** (security boundary) · **Status:** Accepted · narrows [ADR 2026-08-25](2026-08-25-pipeline-guard-enforcement.md) for the `local-daemon` backend

## What changed

`delivery.json` sets `dispatch.backend: "local-daemon"`. Cyrus dispatches from the
operator's machine, and it binds a session to a ticket **by a named person delegating that
ticket in Linear** — it writes no pin file at all.

The pin was never the point; *a binding the session cannot forge* was. A delegation is also
a value a session cannot write for itself, so the doctrine holds by a different route. What
it does not carry is the pin's other cargo: the budget, the mode, and the dispatch-time
snapshot of the acceptance criteria.

## Which guards still hold

`.claude/hooks/pre-tool-use.py` reads a pin from outside the worktree and, by the contract's
fail direction, guards that merely *withhold* autonomy fail **open** when no pin is present.
That branch was designed for a human working ad hoc in a configured repo, so that the repo is
never bricked. **An unpinned Cyrus session is indistinguishable from that case to the hook.**

| Guard | On the live `local-daemon` lane |
|---|---|
| `pin-binding` | Withholds nothing without a pin — **fails open** |
| `ticket-branch` | Needs a pinned ticket id — **inactive** |
| `scope-fence` | `if pin:`-gated, both the Edit/Write arm and the Bash arm — **does not hold** |
| `lifecycle-label` | Pinned-only — **does not hold** |
| `self-approval` | Unconditional on `configured` — **holds** |
| `telemetry-required` | Half-enforced here by design; the counting half is the safe-outputs validator, unported — **channel only** |

**This is documented, intended behaviour, not a bug, and the fix is not in the hook.** A
fail-closed guard keyed on pin absence would brick every ad-hoc session in the repo. The
guards that still hold on this lane are the unconditional ones plus the layers underneath:
the self-edit and config-anchor Bash arms, the protected-label guard, branch protection, and
CI — none of which read a pin.

The three standing guards that *do* read one are unaffected in their own right: the tier-0
local dispatcher (`scripts/pipeline_dispatch_local.py`) still writes a real pin, the hook
still reads it, and `dispatch.pinsRoot` is still validated on every write. **None of the pin
machinery is dead — it is unused by one backend.**

## Consequences

- Budgets and autonomy tiers are contract-defined and enforced by the `github-actions`
  backend; on this lane they are unenforced (KIT-17). `budgets.maxMinutes` is the only cap
  with teeth.
- `.github/workflows/pipeline-safe-outputs.yml` requires `pinned_ticket_id` and
  `pinned_dispatch_id`. Nothing on this lane produces either, so it is unreachable as well
  as inert.
- `dispatch.labelTrigger: "agent:queued"` describes the CI dispatcher's queue-by-label
  model. It stays because the schema requires it and `check_delivery_config.py` validates
  it — not because it describes how work is queued today.
- Re-keying the binding so a delegation carries a budget and a criteria snapshot is
  [KIT-18](https://linear.app/braedenclaw/issue/KIT-18); it is open and its options point
  three different directions.

## Alternatives rejected

**Have Cyrus write a pin.** Plausible, and it is one of KIT-18's live options — but it is an
upstream change to the daemon, not a todoclaw decision, and it would need the pin's budget
and snapshot fields populated to be worth anything.

**Make the pinned-only guards fail closed.** Bricks every human session in a configured
repo, which is the exact failure the fail-open direction exists to prevent.

## Where the rest of it is written down

`docs/PIPELINE-ACTIVATION.md` is todoclaw's operational record of what is active and why —
including why `pipeline-dispatch.yml` is held and why review was staged again (TOD-112).
`docs/PIPELINE-CONTRACT.md` and `schemas/` are vendored byte-identical from
claude-project-kit; their unconditional "the dispatcher writes the pin" phrasing is corrected
upstream in kit PR #74 and arrives here by re-sync, not by hand-editing.

## Update — the lane gets the tracker guards (KIT-241)

The table above read "no pin" as a human's ad-hoc session, so on this lane every
withholding tracker guard failed open: a session could create tickets directly, set or
clear `agent:*` and `blocked:*`, and write other tickets.

**Decision (ported from the kit).** The lane is marked by a file no session can create or
delete: `<pinsRoot>/dispatched-lane/<OS account>`, root-owned, mode 444, in a root-owned
folder, written once by the owner (the kit's Stage E installer, card CK-10). With the
marker and no pin, the hook applies the pinned `ticket` rules to tracker writes: no
lifecycle label, no direct create, writes only to the ticket the worktree folder is named
after (`<base>/TOD-123`, or `<base>/TOD-123/<repo>`), no comment on another ticket, and no
rewrite of the own ticket's acceptance criteria. So `lifecycle-label` now **holds** on this
lane, along with own-ticket scoping and AC integrity. `scope-fence` and `ticket-branch`
still do not: turning them on changes what a live coding session may edit, which is the
owner's call.

**Read so that a session cannot move it.** The account and its home come from the account
database, never `$USER`, `$LOGNAME` or `$HOME`: the dispatcher loads a worktree's env file
into the next session it starts there (KIT-240). `~` in `dispatch.pinsRoot` is that home
for the pin too, since a pin found switches the marker check off. A marker the hook cannot
check for (any error but "no such file"), or an account the database cannot name, counts
as the lane. And the pipeline stays on while a commit holds `delivery.json`, so
`mv delivery.json x` no longer switches every guard off.

## Update 2026-10-11 — the marker moves to root's /etc and wins over a pin (KIT-241, second review)

A bypass review of the kit's merged change and of this port found the marker could be
switched off two ways, three gaps beside it, and two gaps of this port's own.

**This port's own: the tracker label guard was narrower than the kit's.** It covered
`agent:*` and `blocked:*` only, so `provenance:*` and `hooks-change` could be set or
cleared through the tracker (by name or by the IDs this repo's `delivery.json`
configures), and `save_issue_label` / `save_project_label` were not tracker writes at
all, so a session could rename `agent:blocked` by name or define a protected name.
**Decision: as the kit does.** The guard matches all four protected classes — the same
set the gh/Bash protected-label guard refuses — and both verbs are tracker writes. This
holds for pinned sessions as well as on the lane.

**A forged pin switched the lane off.** A pin found used to skip the marker check, and
the pins root is created by the role account, so a session whose sandbox lets a write
leave the worktree could forge one there (a maintenance pin: creates allowed, any
in-team ticket writable). **Decision: the marker wins.** No dispatcher writes a pin for a
marked account, so the hook reads the marker first and, with it, does not read a pin at
all.

**The marker's folders were the role account's.** The pins root and every folder above
the marker's own were the role account's, and rename needs only write on the parent, so
the role account itself could move the marker out of sight. **Decision: the marker lives
at `/etc/claude-pipeline/dispatched-lane/<OS account>`**, a fixed path in folders root
owns all the way down (on macOS `/etc` is `/private/etc`). This repository has no
installer of its own: card CK-10 of claude-project-kit's Stage E installer writes it with
`install -d -o root -g wheel -m 755`, and that installer's `lane-marker` row checks that
every folder above it, up to `/`, is root's and writable by no group or other account.
The old marker still counts — either one makes the lane — so a machine that has only the
old one keeps its guards until the new one is written.

**Three gaps beside it**, each now refused in a pinned or dispatched session:

- *A state set by name.* The approval guard knows `ready` by its ID, and the Linear MCP's
  `save_issue` takes `state` as a "type, name, or ID": `state: "Ready"` approved past it.
  A tracker issue write that sets a state by anything but an ID is refused. Nothing here
  tells a session to set one by name (`docs/SESSION-BRIEF.md` says not to move tickets at
  all). The `ready` ID also matches whatever the case of its letters, in every session.
- *A partial description edit.* `save_issue`'s `patch` rewrote the own ticket's
  acceptance criteria past AC integrity; it now counts as the description.
- *git's environment.* The hook's git calls inherited the session's environment, so a
  `GIT_DIR`, `GIT_OBJECT_DIRECTORY`, or a broken global config at a planted `$HOME`,
  `$XDG_CONFIG_HOME` or `GIT_CONFIG_GLOBAL` (all reachable through the KIT-240 env file)
  made a moved-aside `delivery.json` read as *off*, and a planted `GIT_DIR` could hand the
  hook another repository's branch or config. They now run with no `GIT_*` variable and
  no global git config (`GIT_CONFIG_GLOBAL` is the null device), `gh` included.

A relative `dispatch.pinsRoot` (read from the hook's cwd, which `cd` moves) is now refused
as unresolved.

**Residuals, named.** Comments and relations naming another ticket by an internal UUID
still pass on this lane, as the contract allows a target the guard cannot resolve (§4
reporting). `PATH` is the session's too, through the same env file: a planted `git` (or
`python3`, which runs the hooks) is a KIT-240 matter, not one a hook can close from
inside.
